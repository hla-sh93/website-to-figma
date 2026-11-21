import { analyzeScene, flatten } from '../core/analysis.js';
import type { ScenePackage } from '../core/scene.js';
import type { RenderResult } from './renderer.js';

function pathTo(root: SceneNode, id: string, path: number[] = []): number[] | undefined {
  if (root.id === id) return path;
  if (!('children' in root)) return;
  for (let i = 0; i < root.children.length; i++) {
    const found = pathTo(root.children[i]!, id, [...path, i]);
    if (found) return found;
  }
}
function atPath(root: SceneNode, path: number[]): SceneNode | undefined {
  let node = root;
  for (const index of path) {
    if (!('children' in node)) return;
    const child = node.children[index];
    if (!child) return;
    node = child;
  }
  return node;
}
function nativeTexts(root: SceneNode): TextNode[] {
  return [
    ...(root.type === 'TEXT' ? [root] : []),
    ...('children' in root ? root.children.flatMap(nativeTexts) : []),
  ];
}

/** Clones and prepares all instances before replacing original screen content. */
export async function createComponents(
  api: PluginAPI,
  scene: ScenePackage,
  result: RenderResult,
  metadata = true,
) {
  const container = await api.getNodeByIdAsync(result.containerId);
  if (!container || container.type !== 'FRAME') throw new Error('Import container was removed.');
  const candidates = analyzeScene(scene).components;
  if (!candidates.length) return { components: 0, instances: 0 };
  const library = api.createFrame();
  container.appendChild(library);
  library.name = 'Components / Observed families';
  library.fills = [];
  library.layoutMode = 'VERTICAL';
  library.itemSpacing = 24;
  library.paddingTop = library.paddingRight = library.paddingBottom = library.paddingLeft = 24;
  library.x = 0;
  library.y =
    Math.max(...container.children.filter((n) => n.id !== library.id).map((n) => n.y + n.height)) +
    80;
  library.resize(600, 100);
  library.layoutSizingVertical = 'HUG';
  const prepared: {
    old: FrameNode;
    instance: InstanceNode;
    updates: [string, number[]][];
    textSizing: TextNode['textAutoResize'][];
    textWidths: number[];
  }[] = [];
  let components = 0,
    instances = 0;
  try {
    for (const candidate of candidates) {
      const screen = scene.screens.find((s) => s.id === candidate.screenId)!;
      const sourceNodes = new Map(flatten(screen.root).map((n) => [n.id, n]));
      const firstId = result.mapping[`${screen.id}:${candidate.members[0]!.sourceId}`];
      const first = firstId ? await api.getNodeByIdAsync(firstId) : null;
      if (!first || first.type !== 'FRAME') continue;
      let ancestor = first.parent,
        insideInstance = false;
      while (ancestor) {
        if (ancestor.type === 'INSTANCE') {
          insideInstance = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (insideInstance) continue;
      const originalTextSizing = nativeTexts(first).map((text) => text.textAutoResize);
      const clone = first.clone();
      library.appendChild(clone);
      const master = api.createComponentFromNode(clone);
      master.name = `${candidate.name} / ${screen.viewport.width}`;
      master.layoutSizingHorizontal = 'FIXED';
      master.layoutSizingVertical = 'HUG';
      master.description =
        'Observed repeated structure from the imported website. Text properties preserve each instance’s visible content.';
      const masterTexts = nativeTexts(master);
      const sizing = masterTexts.map((_text, index) => originalTextSizing[index] ?? 'HEIGHT');
      const properties = masterTexts.map((text, index) => {
        const property = master.addComponentProperty(`Text ${index + 1}`, 'TEXT', text.characters);
        text.componentPropertyReferences = {
          ...text.componentPropertyReferences,
          characters: property,
        };
        text.textAutoResize = sizing[index]!;
        return property;
      });
      components++;
      for (const member of candidate.members) {
        const oldId = result.mapping[`${screen.id}:${member.sourceId}`];
        const old = oldId ? await api.getNodeByIdAsync(oldId) : null;
        if (!old || old.type !== 'FRAME') continue;
        const instance = master.createInstance();
        library.appendChild(instance);
        const oldTexts = nativeTexts(old);
        const values: Record<string, string> = {};
        properties.forEach(
          (property, index) => (values[property] = oldTexts[index]?.characters ?? ''),
        );
        instance.setProperties(values);
        instance.resize(old.width, old.height);
        instance.name = old.name;
        const source = sourceNodes.get(member.sourceId)!;
        const updates: [string, number[]][] = [];
        for (const desc of flatten(source)) {
          const key = `${screen.id}:${desc.id}`,
            id = result.mapping[key];
          const path = id ? pathTo(old, id) : undefined;
          if (path) updates.push([key, path]);
        }
        // Each member keeps its own text sizing: a two-line title must not inherit the
        // one-line sizing of the member the component was made from.
        prepared.push({
          old,
          instance,
          updates,
          textSizing: oldTexts.map((t, index) => t.textAutoResize ?? sizing[index] ?? 'HEIGHT'),
          textWidths: oldTexts.map((t) => t.width),
        });
        instances++;
      }
    }
    // No awaits during replacement: cancellation cannot interrupt this commit block.
    const grids = new Set<FrameNode>();
    for (const { old, instance, updates, textSizing, textWidths } of prepared) {
      const parent = old.parent;
      if (!parent || !('insertChild' in parent))
        throw new Error('A source parent was removed during component creation.');
      const index = parent.children.indexOf(old),
        x = old.x,
        y = old.y,
        widthMode = old.layoutSizingHorizontal,
        heightMode = old.layoutSizingVertical,
        position = old.layoutPositioning;
      const manualCell =
        parent.type === 'FRAME' &&
        parent.layoutMode === 'GRID' &&
        parent.gridItemsPositioning === 'MANUAL'
          ? [old.gridRowAnchorIndex, old.gridColumnAnchorIndex]
          : undefined;
      parent.insertChild(index, instance);
      instance.layoutPositioning = position;
      // A manual cell is still held by the original; the instance takes it after removal below.
      if (!manualCell && parent.type === 'FRAME' && parent.layoutMode === 'GRID') {
        parent.gridItemsPositioning = 'ROW_AUTO_FLOW';
        grids.add(parent);
      }
      if (position === 'ABSOLUTE' || !('layoutMode' in parent) || parent.layoutMode === 'NONE') {
        instance.x = x;
        instance.y = y;
      }
      instance.layoutSizingHorizontal = widthMode;
      instance.layoutSizingVertical = heightMode;
      nativeTexts(instance).forEach((text, index) => {
        const mode = textSizing[index] ?? 'HEIGHT';
        text.textAutoResize = mode;
        const width = textWidths[index];
        // Wrapping copy keeps the width it was measured at, unless its parent sizes it.
        if (mode !== 'WIDTH_AND_HEIGHT' && width && text.layoutSizingHorizontal === 'FIXED')
          text.resize(width, text.height);
      });
      for (const [key, path] of updates) {
        const node = atPath(instance, path);
        if (node) {
          result.mapping[key] = node.id;
          if (metadata)
            node.setPluginData(
              'website-source',
              JSON.stringify({ captureId: scene.capture.id, sourceKey: key }),
            );
        }
      }
      old.remove();
      if (manualCell) instance.setGridChildPosition(manualCell[0]!, manualCell[1]!);
    }
    for (const grid of grids)
      grid.gridRowCount = Math.max(
        1,
        Math.ceil(
          grid.children.filter(
            (n) => !('layoutPositioning' in n) || n.layoutPositioning !== 'ABSOLUTE',
          ).length / grid.gridColumnCount,
        ),
      );
    if (!components) {
      library.remove();
      return { components: 0, instances: 0 };
    }
    library.layoutSizingHorizontal = 'HUG';
    container.resize(
      Math.max(container.width, library.width),
      Math.max(container.height, library.y + library.height),
    );
    return { components, instances };
  } catch (error) {
    // Prepared nodes still in the library can be removed without touching originals.
    if (prepared.every((item) => item.instance.parent?.id === library.id)) library.remove();
    throw error;
  }
}
