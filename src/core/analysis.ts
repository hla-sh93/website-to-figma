import type { SceneNode, ScenePackage } from './scene.js';
export type ComponentCandidate = {
  id: string;
  name: string;
  screenId: string;
  members: { sourceId: string }[];
  confidence: 'high';
};
export type ResponsiveChange = {
  key: string;
  name: string;
  kind: 'visibility' | 'layout' | 'columns' | 'typography';
  observedAt: { width: number; value: string | number | boolean }[];
};
export function flatten(root: SceneNode): SceneNode[] {
  return [root, ...root.children.flatMap(flatten)];
}

/** Conservative repetition detector: observed structure and exact styling only.
 * Changing text is a slot; changing visual style is not silently normalized. */
export function componentSignature(node: SceneNode): string {
  const shape = (n: SceneNode): unknown => ({
    kind: n.kind,
    tag: n.source.tag,
    style: n.style,
    layout: n.layout ?? null,
    position: n.position ?? 'flow',
    text: n.text
      ? {
          family: n.text.fontFamily,
          style: n.text.fontStyle,
          weight: n.text.fontWeight,
          size: n.text.fontSize,
          line: n.text.lineHeight,
          color: n.text.color,
          align: n.text.align,
          direction: n.text.direction,
          letterSpacing: n.text.letterSpacing,
          sizing: n.text.sizing,
          maxLines: n.text.maxLines,
          resolvedFamily: n.text.resolvedFontFamily,
          variations: n.text.variationSettings,
          decoration: n.text.textDecoration ?? 'none',
        }
      : null,
    // Only text is currently exposed as instance properties. Asset and crop
    // differences must stay in separate families until image overrides exist.
    asset: n.assetId,
    image: n.image ?? null,
    children: n.children.map(shape),
  });
  return JSON.stringify(shape(node));
}
export function analyzeScene(scene: ScenePackage) {
  const components: ComponentCandidate[] = [];
  let nodeCount = 0,
    textCharacters = 0,
    flowContainers = 0;
  const fonts = new Set<string>();
  for (const screen of scene.screens) {
    const groups = new Map<string, SceneNode[]>();
    for (const node of flatten(screen.root)) {
      nodeCount++;
      textCharacters += node.text?.characters.length ?? 0;
      if (node.text) fonts.add(`${node.text.fontFamily} / ${node.text.fontWeight}`);
      if (node.layout && node.layout.mode !== 'none') flowContainers++;
      if (
        node.kind !== 'frame' ||
        node.children.length === 0 ||
        node.children.length > 12 ||
        flatten(node).length > 50
      )
        continue;
      if (
        flatten(node).some((child) =>
          child.text?.runs?.some((run) => {
            const text = child.text!;
            return (
              (run.fontFamily !== undefined && run.fontFamily !== text.fontFamily) ||
              (run.fontWeight !== undefined && run.fontWeight !== text.fontWeight) ||
              (run.fontSize !== undefined && run.fontSize !== text.fontSize) ||
              (run.fontStyle !== undefined && run.fontStyle !== text.fontStyle) ||
              (run.resolvedFontFamily !== undefined &&
                run.resolvedFontFamily !== text.resolvedFontFamily) ||
              (run.textDecoration !== undefined &&
                run.textDecoration !== (text.textDecoration ?? 'none')) ||
              (run.lineHeight !== undefined && run.lineHeight !== text.lineHeight) ||
              (run.letterSpacing !== undefined && run.letterSpacing !== text.letterSpacing) ||
              (run.variationSettings !== undefined &&
                JSON.stringify(run.variationSettings) !== JSON.stringify(text.variationSettings)) ||
              (run.color !== undefined && JSON.stringify(run.color) !== JSON.stringify(text.color))
            );
          }),
        )
      )
        continue;
      if (
        !['button', 'a', 'article', 'li', 'input'].includes(node.source.tag) &&
        !/(card|badge|button|item)/i.test(node.name)
      )
        continue;
      const key = componentSignature(node);
      const list = groups.get(key) ?? [];
      list.push(node);
      groups.set(key, list);
    }
    let index = 0;
    const covered = new Set<string>();
    // Prefer outer reusable families. Preparing a parent and its descendant in
    // the same transaction would invalidate the descendant when replacing it.
    const families = [...groups.values()].sort(
      (a, b) => flatten(b[0]!).length - flatten(a[0]!).length,
    );
    for (const group of families)
      if (group.length >= 2) {
        if (group.some((node) => covered.has(node.id))) continue;
        components.push({
          id: `${screen.id}-family-${++index}`,
          screenId: screen.id,
          name: group[0]!.name,
          members: group.map((n) => ({ sourceId: n.id })),
          confidence: 'high',
        });
        for (const member of group)
          for (const descendant of flatten(member)) covered.add(descendant.id);
      }
  }
  const widths = [...scene.screens].sort((a, b) => a.viewport.width - b.viewport.width);
  const matches = new Map<string, { screen: (typeof widths)[number]; node: SceneNode }[]>();
  for (const screen of widths) {
    const local = new Map<string, SceneNode[]>();
    for (const node of flatten(screen.root)) {
      const key = node.source.key ?? node.id;
      const list = local.get(key) ?? [];
      list.push(node);
      local.set(key, list);
    }
    for (const [key, nodes] of local) {
      if (nodes.length !== 1) continue;
      const list = matches.get(key) ?? [];
      list.push({ screen, node: nodes[0]! });
      matches.set(key, list);
    }
  }
  const responsive: ResponsiveChange[] = [];
  for (const [key, items] of matches) {
    const name = items[0]!.node.name;
    if (items.length < widths.length) {
      responsive.push({
        key,
        name,
        kind: 'visibility',
        observedAt: widths.map((s) => ({
          width: s.viewport.width,
          value: items.some((i) => i.screen.id === s.id),
        })),
      });
    }
    for (const [kind, get] of [
      ['layout', (n: SceneNode) => n.layout?.mode ?? n.kind],
      ['columns', (n: SceneNode) => n.layout?.columns ?? 0],
      ['typography', (n: SceneNode) => n.text?.fontSize ?? 0],
    ] as const) {
      const values = items.map((i) => ({ width: i.screen.viewport.width, value: get(i.node) }));
      if (new Set(values.map((i) => i.value)).size > 1)
        responsive.push({ key, name, kind, observedAt: values });
    }
  }
  return {
    summary: {
      screens: scene.screens.length,
      nodes: nodeCount,
      textCharacters,
      flowContainers,
      assets: scene.assets.length,
      fonts: [...fonts],
    },
    components,
    responsive,
    notes: [
      'Changes are observations at captured widths, not recovered exact CSS breakpoint thresholds.',
      'Component candidates require review; only matching structure and visual styling are grouped.',
    ],
  };
}
