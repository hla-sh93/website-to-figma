import {
  validateScene,
  type Layout,
  type ScenePackage,
  type SceneNode,
  type RGBA,
} from '../core/scene.js';
import { blurEffect, colorName, gradientPaint, shadowEffect, utf8Decode } from './paint.js';
import { createComponents } from './components.js';
import { computeImagePlacement } from '../core/image.js';
import { errorMessage } from './errors.js';
import {
  resolveFont,
  fontKey,
  fontRequest,
  fontLabel,
  normalizeFamily,
  splitFontFamilies,
  collectFontRequests,
  type FontFace,
  type FontResolution,
  type FontRequest,
} from './fonts.js';
export { resolveFont, collectFontRequests } from './fonts.js';
export type { FontFace, FontResolution } from './fonts.js';

type NativeNode = FrameNode | TextNode | RectangleNode;
export type RenderOptions = {
  fontPolicy?: 'stop' | 'substitute';
  fallbackFamily?: string;
  foundations?: boolean;
  components?: boolean;
  metadata?: boolean;
  /** Set when the caller already ran validateScene on this exact object. */
  validated?: boolean;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
};
export type RenderIssue = { code: string; message: string; sourceId?: string; nodeId?: string };
export type RenderResult = {
  containerId: string;
  screenIds: string[];
  createdNodeIds: string[];
  mapping: Record<string, string>;
  issues: RenderIssue[];
  stats: {
    text: number;
    images: number;
    vectors: number;
    autoLayout: number;
    fixedFrames: number;
    variables: number;
    textStyles: number;
    components: number;
    instances: number;
  };
};

export function captureHost(url: string): string {
  return /^https?:\/\//i.test(url)
    ? url
        .replace(/^https?:\/\//i, '')
        .split(/[/?#]/)[0]!
        .replace(/[^a-zA-Z0-9.:[\]-]/g, '')
    : 'Owned fixture';
}
export function decodeBase64(value: string, api?: Pick<PluginAPI, 'base64Decode'>): Uint8Array {
  if (api && typeof api.base64Decode === 'function') return api.base64Decode(value);
  if (!value || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('Invalid base64 asset.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(
    (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0),
  );
  let accumulator = 0,
    bits = 0,
    index = 0;
  for (const c of value) {
    if (c === '=') break;
    accumulator = (accumulator << 6) | alphabet.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (accumulator >> bits) & 255;
    }
  }
  return bytes;
}
const defaultLayout: Layout = {
  mode: 'none',
  gap: 0,
  padding: [0, 0, 0, 0],
  align: 'start',
  justify: 'start',
  wrap: false,
  widthSizing: 'fixed',
  heightSizing: 'fixed',
};
export function deriveLayout(node: SceneNode): Layout {
  const layout = {
    ...(node.layout ?? defaultLayout),
    padding: [...(node.layout?.padding ?? [0, 0, 0, 0])] as Layout['padding'],
  };
  const children = node.children.filter((n) => n.position !== 'absolute');
  const paintedFlow = [...children].sort((a, b) => paintRank(a) - paintRank(b));
  if (children.some((child, index) => child.id !== paintedFlow[index]?.id))
    return { ...layout, mode: 'none' };
  if (layout.mode === 'vertical' && !layout.wrap) {
    const start = node.bounds.x + layout.padding[3],
      end = node.bounds.x + node.bounds.width - layout.padding[1];
    const narrow = children.filter((c) => c.bounds.width < end - start - 2);
    if (
      narrow.length &&
      children.every((c) => Math.abs(c.bounds.x + c.bounds.width / 2 - (start + end) / 2) <= 1)
    )
      layout.align = 'center';
    else if (
      narrow.length &&
      children.every((c) => Math.abs(c.bounds.x + c.bounds.width - end) <= 1)
    )
      layout.align = 'end';
  }
  if (layout.mode === 'grid' || layout.mode === 'none' || layout.wrap || children.length < 2)
    return layout;
  const vertical = layout.mode === 'vertical';
  const gaps = children
    .slice(1)
    .map((n, i) =>
      vertical
        ? n.bounds.y - children[i]!.bounds.y - children[i]!.bounds.height
        : n.bounds.x - children[i]!.bounds.x - children[i]!.bounds.width,
    );
  if (gaps.some((g) => g < -1)) return { ...layout, mode: 'none' };
  const min = Math.min(...gaps),
    max = Math.max(...gaps);
  if (max - min <= 1) layout.gap = Math.max(0, gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return layout;
}
export function paintRank(node: SceneNode): number {
  if (node.source.tag === '#background') return -Infinity;
  const z = node.style.zIndex;
  return z === undefined
    ? node.position === 'absolute'
      ? 0.5
      : 0
    : z < 0
      ? z
      : z === 0
        ? 0.5
        : z + 1;
}
function allNodes(pkg: ScenePackage): SceneNode[] {
  const result: SceneNode[] = [];
  const visit = (n: SceneNode) => {
    result.push(n);
    n.children.forEach(visit);
  };
  pkg.screens.forEach((s) => visit(s.root));
  return result;
}
const rgb = ({ r, g, b }: RGBA) => ({ r, g, b });
const solid = (c: RGBA): SolidPaint => ({ type: 'SOLID', color: rgb(c), opacity: c.a });
export async function preflightFonts(
  api: PluginAPI,
  input: ScenePackage | FontRequest[],
  fallback = 'Inter',
) {
  const available = (await api.listAvailableFontsAsync()).map((f) => f.fontName);
  const requests = new Map<string, FontRequest>();
  for (const request of Array.isArray(input) ? input : collectFontRequests(input))
    requests.set(fontKey(request), request);
  const wanted = new Set(
    [...requests.values()]
      .flatMap((request) => [
        ...(request.resolvedFontFamily
          ? [request.resolvedFontFamily]
          : splitFontFamilies(request.fontFamily)),
        fallback,
      ])
      .map(normalizeFamily),
  );
  const axesByFamily: Record<string, string[] | null> = {};
  if (typeof api.getFontFamilyVariationAxes === 'function')
    for (const name of new Set(available.map((font) => font.family))) {
      if (!wanted.has(normalizeFamily(name))) continue;
      try {
        axesByFamily[name] = api.getFontFamilyVariationAxes(name);
      } catch {
        axesByFamily[name] = null;
      }
    }
  const resolutions = new Map<string, FontResolution>();
  const missing: { requested: string; replacement: FontFace }[] = [];
  for (const [key, spec] of requests) {
    const resolved = resolveFont(spec, available, fallback, axesByFamily);
    resolutions.set(key, resolved);
    if (!resolved.exact)
      missing.push({
        requested: `${fontLabel(spec)} ${spec.fontWeight} ${spec.fontStyle}`,
        replacement: resolved.font,
      });
  }
  return {
    resolutions,
    missing,
    availableFamilies: [...new Set(available.map((f) => f.family))].sort(),
  };
}

/** Uses only the documented native Plugin API; the same renderer is bundled for
 * the shipped plugin and executed independently in the real-editor check. */
export async function renderScene(
  api: PluginAPI,
  input: unknown,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const pkg = options.validated ? (input as ScenePackage) : validateScene(input);
  const check = () => {
    if (options.isCancelled?.()) throw new Error('Import cancelled.');
  };
  check();
  const fonts = await preflightFonts(api, pkg, options.fallbackFamily);
  if (fonts.missing.length && options.fontPolicy !== 'substitute')
    throw new Error(
      `Missing exact editor fonts: ${fonts.missing.map((f) => f.requested).join(', ')}. Enable them or explicitly allow substitution.`,
    );
  const uniqueFonts = new Map<string, FontFace>();
  fonts.resolutions.forEach(({ font }) => uniqueFonts.set(JSON.stringify(font), font));
  await Promise.all([...uniqueFonts.values()].map((font) => api.loadFontAsync(font)));
  check();
  const issues: RenderIssue[] = fonts.missing.map((f) => ({
    code: 'FONT_SUBSTITUTED',
    message: `${f.requested} → ${f.replacement.family} ${f.replacement.style}. Text wrapping may differ.`,
  }));
  const mapping: Record<string, string> = {};
  const screens: string[] = [];
  const stats = {
    text: 0,
    images: 0,
    vectors: 0,
    autoLayout: 0,
    fixedFrames: 0,
    variables: 0,
    textStyles: 0,
    components: 0,
    instances: 0,
  };
  const cleanup: { remove: () => void }[] = [];
  const assets = new Map(pkg.assets.map((a) => [a.id, a]));
  const imageCache = new Map<string, Image>();
  const textStyles = new Map<string, TextStyle>();
  const colors = new Map<string, Variable>();
  const numbers = new Map<number, Variable>();
  let collection: VariableCollection | undefined;
  const prefix = `Import / ${captureHost(pkg.capture.url)} / ${pkg.capture.id.slice(0, 8)}`;
  const staging = api.createFrame();
  cleanup.push(staging);
  staging.name = `${prefix} / Building`;
  staging.fills = [];
  staging.clipsContent = false;
  const right = api.currentPage.children.reduce((max, n) => Math.max(max, n.x + n.width), 0);
  staging.x = right + 120;
  staging.y = 0;
  const paint = (c: RGBA): SolidPaint => {
    let result = solid(c);
    if (options.foundations === false) return result;
    collection ??= api.variables.createVariableCollection(`${prefix} / Foundations`);
    if (!cleanup.includes(collection)) cleanup.push(collection);
    const key = [c.r, c.g, c.b, c.a].map((v) => v.toFixed(5)).join('/');
    let variable = colors.get(key);
    if (!variable) {
      variable = api.variables.createVariable(`color/${colorName(c)}`, collection, 'COLOR');
      variable.scopes = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
      variable.setValueForMode(collection.defaultModeId, c);
      colors.set(key, variable);
      cleanup.push(variable);
      stats.variables++;
    }
    result = api.variables.setBoundVariableForPaint(result, 'color', variable);
    return result;
  };
  const gradientFills = (source: SceneNode): Paint[] => {
    const result: Paint[] = [];
    for (const gradient of [...(source.style.gradients ?? [])].reverse()) {
      try {
        result.push(gradientPaint(gradient, source.bounds.width, source.bounds.height));
      } catch {
        issues.push({
          code: 'GRADIENT_SKIPPED',
          message: 'A degenerate CSS gradient could not be drawn.',
          sourceId: source.id,
        });
      }
    }
    return result;
  };
  const bindNumber = (
    node: FrameNode,
    field: 'itemSpacing' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft',
    value: number,
  ) => {
    node[field] = value;
    if (options.foundations === false) return;
    collection ??= api.variables.createVariableCollection(`${prefix} / Foundations`);
    if (!cleanup.includes(collection)) cleanup.push(collection);
    value = Math.round(value * 100) / 100;
    node[field] = value;
    let variable = numbers.get(value);
    if (!variable) {
      variable = api.variables.createVariable(
        `space/${String(Math.round(value * 100) / 100).replace('.', '_')}`,
        collection,
        'FLOAT',
      );
      variable.scopes = ['GAP', 'WIDTH_HEIGHT'];
      variable.setValueForMode(collection.defaultModeId, value);
      numbers.set(value, variable);
      cleanup.push(variable);
      stats.variables++;
    }
    node.setBoundVariable(field, variable);
  };
  let done = 0,
    lastYield = Date.now();
  const total = allNodes(pkg).length;
  const layouts = new Map<SceneNode, Layout>();
  const layoutOf = (node: SceneNode) => {
    let layout = layouts.get(node);
    if (!layout) layouts.set(node, (layout = deriveLayout(node)));
    return layout;
  };
  // Give Figma's event loop a turn so the canvas, progress messages and
  // cancellation stay responsive during large imports.
  const breathe = async () => {
    if (Date.now() - lastYield < 32) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    lastYield = Date.now();
  };
  try {
    let offset = 0;
    for (const screen of pkg.screens) {
      check();
      const native = await buildNative(screen.root, staging, undefined, screen.id);
      native.name = `${pkg.capture.title || 'Page'} / ${screen.viewport.width >= 1000 ? 'Desktop' : screen.viewport.width >= 600 ? 'Tablet' : 'Mobile'} / ${screen.viewport.width}`;
      native.x = offset;
      native.y = 0;
      screens.push(native.id);
      offset += screen.root.bounds.width + 80;
    }
    staging.resize(
      Math.max(1, offset - 80),
      Math.max(...pkg.screens.map((s) => s.root.bounds.height), 1),
    );
    if (options.components !== false) {
      const count = await createComponents(
        api,
        pkg,
        { containerId: staging.id, screenIds: screens, createdNodeIds: [], mapping, issues, stats },
        options.metadata !== false,
      );
      stats.components = count.components;
      stats.instances = count.instances;
    }
    staging.name = `${prefix} / Editable layers`;
    check();
    const createdNodeIds: string[] = [];
    const collect = (n: BaseNode) => {
      createdNodeIds.push(n.id);
      if ('children' in n) (n as ChildrenMixin).children.forEach(collect);
    };
    collect(staging);
    api.currentPage.selection = screens.map((id) => staging.children.find((n) => n.id === id)!);
    api.viewport.scrollAndZoomIntoView([staging]);
    return { containerId: staging.id, screenIds: screens, createdNodeIds, mapping, issues, stats };
  } catch (error) {
    for (const resource of cleanup.reverse())
      try {
        resource.remove();
      } catch {
        /* best-effort cleanup only of resources created here */
      }
    throw error;
  }

  async function buildNative(
    source: SceneNode,
    parent: FrameNode,
    parentSource: SceneNode | undefined,
    screenId: string,
  ): Promise<NativeNode> {
    try {
      return await buildNativeNode(source, parent, parentSource, screenId);
    } catch (error) {
      const message = errorMessage(error);
      throw new Error(
        message.startsWith('Layer import: ')
          ? message
          : 'Layer import: ' + source.name + ' (' + source.id + '): ' + message,
      );
    }
  }
  async function buildNativeNode(
    source: SceneNode,
    parent: FrameNode,
    parentSource: SceneNode | undefined,
    screenId: string,
  ): Promise<NativeNode> {
    check();
    await breathe();
    let native: NativeNode;
    if (source.kind === 'text') {
      const text = source.text!;
      const node = api.createText();
      native = node;
      parent.appendChild(node);
      node.fontName = fonts.resolutions.get(fontKey(text))!.font;
      node.fontSize = text.fontSize;
      node.lineHeight = { unit: 'PIXELS', value: Math.max(1, text.lineHeight) };
      node.letterSpacing = { unit: 'PIXELS', value: text.letterSpacing };
      node.characters = text.characters;
      node.textDecoration = (text.textDecoration ?? 'none').toUpperCase() as TextDecoration;
      if (text.textCase) node.textCase = text.textCase.toUpperCase() as TextCase;
      const textEffects: Effect[] = (text.shadow ?? [])
        .map((sh) => shadowEffect(sh, true))
        .reverse();
      if (source.style.blur) textEffects.push(blurEffect('LAYER_BLUR', source.style.blur));
      if (textEffects.length) node.effects = textEffects;
      node.textAlignHorizontal = text.align.toUpperCase() as TextNode['textAlignHorizontal'];
      node.fills = source.style.gradients?.length ? gradientFills(source) : [paint(text.color)];
      const styleKey = JSON.stringify([
        node.fontName,
        text.fontSize,
        text.lineHeight,
        text.letterSpacing,
        text.textDecoration ?? 'none',
        text.textCase ?? 'original',
      ]);
      if (options.foundations !== false) {
        let style = textStyles.get(styleKey);
        if (!style) {
          style = api.createTextStyle();
          style.name = `${prefix} / Type / ${text.fontSize}-${text.fontWeight}-${textStyles.size + 1}`;
          style.fontName = node.fontName as FontName;
          style.fontSize = text.fontSize;
          style.lineHeight = node.lineHeight;
          style.letterSpacing = node.letterSpacing;
          style.textDecoration = node.textDecoration as TextDecoration;
          style.textCase = node.textCase as TextCase;
          textStyles.set(styleKey, style);
          cleanup.push(style);
          stats.textStyles++;
        }
        await node.setTextStyleIdAsync(style.id);
      }
      for (const run of text.runs ?? []) {
        if (run.end <= run.start) continue;
        const request = fontRequest(text, run);
        node.setRangeFontName(run.start, run.end, fonts.resolutions.get(fontKey(request))!.font);
        if (run.fontSize !== undefined) node.setRangeFontSize(run.start, run.end, run.fontSize);
        if (run.color) node.setRangeFills(run.start, run.end, [paint(run.color)]);
        if (run.textCase && run.textCase !== text.textCase)
          node.setRangeTextCase(run.start, run.end, run.textCase.toUpperCase() as TextCase);
        if (run.textDecoration)
          node.setRangeTextDecoration(
            run.start,
            run.end,
            run.textDecoration.toUpperCase() as TextDecoration,
          );
        if (run.lineHeight !== undefined)
          node.setRangeLineHeight(run.start, run.end, {
            unit: 'PIXELS',
            value: Math.max(1, run.lineHeight),
          });
        if (run.letterSpacing !== undefined)
          node.setRangeLetterSpacing(run.start, run.end, {
            unit: 'PIXELS',
            value: run.letterSpacing,
          });
      }
      node.textAutoResize = 'HEIGHT';
      node.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
      stats.text++;
    } else if (source.kind === 'svg') {
      const asset = assets.get(source.assetId!)!;
      const svg = utf8Decode(decodeBase64(asset.data, api));
      if (
        /<(script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|\/\/)/i.test(
          svg,
        )
      )
        throw new Error('Unsafe SVG asset rejected.');
      native = api.createNodeFromSvg(svg);
      parent.appendChild(native);
      native.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
      stats.vectors++;
    } else if (source.kind === 'image') {
      const asset = assets.get(source.assetId!)!;
      let image = imageCache.get(asset.id);
      if (!image) {
        image = api.createImage(decodeBase64(asset.data, api));
        imageCache.set(asset.id, image);
      }
      const spec = source.image ?? {
        fit: 'cover' as const,
        position: [0.5, 0.5] as [number, number],
      };
      const placement = computeImagePlacement(source.bounds, asset, spec);
      const custom =
        spec.fit === 'none' ||
        spec.fit === 'scale-down' ||
        spec.position.some((p) => Math.abs(p - 0.5) > 0.001) ||
        (spec.positionOffset ?? []).some((p) => Math.abs(p) > 0.001) ||
        placement.content.x !== 0 ||
        placement.content.y !== 0 ||
        Math.abs(placement.content.width - source.bounds.width) > 0.01 ||
        Math.abs(placement.content.height - source.bounds.height) > 0.01 ||
        (source.style.background?.a ?? 0) > 0;
      const imagePaint: ImagePaint =
        spec.fit === 'fill'
          ? {
              type: 'IMAGE',
              imageHash: image.hash,
              scaleMode: 'CROP',
              imageTransform: [
                [1, 0, 0],
                [0, 1, 0],
              ],
            }
          : {
              type: 'IMAGE',
              imageHash: image.hash,
              scaleMode: spec.fit === 'contain' ? 'FIT' : 'FILL',
            };
      if (custom) {
        const outer = api.createFrame();
        native = outer;
        parent.appendChild(outer);
        outer.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
        outer.fills = source.style.background ? [paint(source.style.background)] : [];
        outer.clipsContent = true;
        const clip = api.createFrame();
        outer.appendChild(clip);
        clip.name = 'Image / content box';
        clip.fills = [];
        clip.clipsContent = true;
        clip.resize(
          Math.max(0.01, placement.content.width),
          Math.max(0.01, placement.content.height),
        );
        clip.x = placement.content.x;
        clip.y = placement.content.y;
        const bitmap = api.createRectangle();
        clip.appendChild(bitmap);
        bitmap.name = 'Image / original pixels';
        bitmap.resize(Math.max(0.01, placement.width), Math.max(0.01, placement.height));
        bitmap.x = placement.x - placement.content.x;
        bitmap.y = placement.y - placement.content.y;
        bitmap.fills = [
          {
            ...imagePaint,
            scaleMode: 'CROP',
            imageTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
        ];
        if (source.style.gradients?.length) {
          const overlay = api.createRectangle();
          outer.appendChild(overlay);
          overlay.name = 'Image / overlay';
          overlay.resize(outer.width, outer.height);
          overlay.fills = gradientFills(source);
        }
        issues.push({
          code: 'IMAGE_CROP_CAPTURED',
          message:
            'Image crop retained with editable clipping frames. Recheck crop after resizing this frame.',
          sourceId: source.id,
          nodeId: outer.id,
        });
      } else {
        const node = api.createRectangle();
        native = node;
        parent.appendChild(node);
        node.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
        node.fills = [imagePaint, ...gradientFills(source)];
      }
      stats.images++;
    } else {
      const node = api.createFrame();
      native = node;
      parent.appendChild(node);
      node.fills = [];
      node.clipsContent = source.style.clipContent ?? false;
      node.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
      const layout = layoutOf(source);
      if (layout.mode !== 'none') {
        node.layoutMode =
          layout.mode === 'grid'
            ? 'GRID'
            : (layout.mode.toUpperCase() as 'HORIZONTAL' | 'VERTICAL');
        node.primaryAxisSizingMode = 'FIXED';
        node.counterAxisSizingMode = 'FIXED';
        if (layout.mode === 'grid') {
          const columns = Math.min(layout.columns ?? 1, Math.max(1, source.children.length));
          node.gridColumnCount = columns;
          node.gridRowCount = Math.max(1, Math.ceil(source.children.length / columns));
          node.gridItemsPositioning = 'ROW_AUTO_FLOW';
          node.gridColumnGap = layout.gap;
          node.gridRowGap = layout.rowGap ?? layout.gap;
          for (let i = 0; i < columns; i++) {
            const item = source.children[i];
            if (item) {
              node.gridColumnSizes[i]!.type = 'FLEX';
              node.gridColumnSizes[i]!.value = Math.max(1, item.bounds.width);
            }
          }
          for (const track of node.gridRowSizes) track.type = 'HUG';
        } else {
          bindNumber(node, 'itemSpacing', layout.gap);
          node.layoutWrap = layout.wrap ? 'WRAP' : 'NO_WRAP';
          node.primaryAxisAlignItems =
            layout.justify === 'space-between'
              ? 'SPACE_BETWEEN'
              : layout.justify === 'center'
                ? 'CENTER'
                : layout.justify === 'end'
                  ? 'MAX'
                  : 'MIN';
          node.counterAxisAlignItems =
            layout.align === 'center' ? 'CENTER' : layout.align === 'end' ? 'MAX' : 'MIN';
        }
        const padding = [...layout.padding] as Layout['padding'];
        const flow = source.children.filter((c) => c.position !== 'absolute');
        const first = flow[0],
          last = flow.at(-1);
        if (first && last && layout.mode === 'vertical' && !layout.wrap) {
          // Browser margins before/after the flow are measured, not snapped to a scale.
          const edge = source.style.border;
          const top = edge?.sides?.[0] ?? edge?.width ?? 0,
            bottom = edge?.sides?.[2] ?? edge?.width ?? 0;
          padding[0] = Math.max(0, first.bounds.y - source.bounds.y - top);
          padding[2] = Math.max(
            0,
            source.bounds.y + source.bounds.height - last.bounds.y - last.bounds.height - bottom,
          );
        }
        const fields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
        fields.forEach((field, i) => bindNumber(node, field, padding[i]!));
        stats.autoLayout++;
      } else {
        stats.fixedFrames++;
        if (source.layout && source.layout.mode !== 'none')
          issues.push({
            code: 'LAYOUT_FIXED',
            message: 'Overlapping source layout preserved with fixed positions.',
            sourceId: source.id,
            nodeId: node.id,
          });
      }
      const paintRanks = new Map<string, number>();
      let previous: SceneNode | undefined;
      for (const child of source.children) {
        if (
          previous &&
          child.position !== 'absolute' &&
          layout.mode !== 'none' &&
          layout.mode !== 'grid' &&
          !layout.wrap &&
          layout.justify !== 'space-between'
        ) {
          const vertical = layout.mode === 'vertical';
          const measured = vertical
            ? child.bounds.y - previous.bounds.y - previous.bounds.height
            : child.bounds.x - previous.bounds.x - previous.bounds.width;
          const extra = measured - layout.gap;
          if (extra > 1) {
            const spacer = api.createFrame();
            node.appendChild(spacer);
            spacer.name = 'Spacing / source margin';
            spacer.fills = [];
            spacer.resize(vertical ? 0.01 : extra, vertical ? extra : 0.01);
            paintRanks.set(spacer.id, paintRank(child));
          }
        }
        const built = await buildNative(child, node, source, screenId);
        paintRanks.set(built.id, paintRank(child));
        if (child.position !== 'absolute') previous = child;
      }
      const painted = [...node.children].sort(
        (a, b) => (paintRanks.get(a.id) ?? 0) - (paintRanks.get(b.id) ?? 0),
      );
      if (painted.some((child, index) => child.id !== node.children[index]?.id))
        for (const child of painted) node.appendChild(child);
      if (layout.mode !== 'none' && source.layout?.heightSizing === 'hug')
        node.layoutSizingVertical = 'HUG';
    }
    native.name = source.name;
    if (source.layout?.minWidth !== undefined) native.minWidth = source.layout.minWidth || null;
    if (source.layout?.maxWidth !== undefined)
      native.maxWidth = Math.max(0.01, source.layout.maxWidth);
    native.opacity = source.style.opacity;
    if ('fills' in native && source.kind === 'frame') {
      const fills: Paint[] = source.style.background ? [paint(source.style.background)] : [];
      fills.push(...gradientFills(source));
      if (fills.length) native.fills = fills;
    }
    const border = source.style.border;
    if ('strokes' in native && border && (border.width > 0 || border.sides?.some((w) => w > 0))) {
      native.strokes = [paint(border.color)];
      native.strokeAlign = 'INSIDE';
      if (border.sides && 'strokeTopWeight' in native) {
        native.strokeTopWeight = border.sides[0];
        native.strokeRightWeight = border.sides[1];
        native.strokeBottomWeight = border.sides[2];
        native.strokeLeftWeight = border.sides[3];
      } else native.strokeWeight = border.width;
      const unit = Math.max(1, border.width || Math.max(...(border.sides ?? [1])));
      if (border.dash)
        native.dashPattern = border.dash === 'dashed' ? [unit * 3, unit * 3] : [unit, unit];
    }
    if ('topLeftRadius' in native && source.style.radius) {
      [
        native.topLeftRadius,
        native.topRightRadius,
        native.bottomRightRadius,
        native.bottomLeftRadius,
      ] = source.style.radius;
    }
    if ('effects' in native && native.type !== 'TEXT') {
      const effects: Effect[] = [...(source.style.shadow ?? [])]
        .reverse()
        .map((sh) => shadowEffect(sh));
      if (source.style.blur) effects.push(blurEffect('LAYER_BLUR', source.style.blur));
      if (source.style.backdropBlur)
        effects.push(blurEffect('BACKGROUND_BLUR', source.style.backdropBlur));
      if (effects.length) native.effects = effects;
    }
    if (parentSource) {
      const mode = layoutOf(parentSource).mode;
      if (mode === 'none' || source.position === 'absolute') {
        if (parent.layoutMode !== 'NONE') native.layoutPositioning = 'ABSOLUTE';
        native.x = source.bounds.x - parentSource.bounds.x;
        native.y = source.bounds.y - parentSource.bounds.y;
      } else if (mode === 'grid') {
        native.gridChildHorizontalAlign = 'AUTO';
        native.gridChildVerticalAlign = 'MIN';
        native.layoutSizingHorizontal = 'FILL';
      } else {
        const padding = parentSource.layout?.padding ?? [0, 0, 0, 0];
        const inner = parentSource.bounds.width - padding[1] - padding[3];
        if (Math.abs(source.bounds.width - inner) <= 3 || source.layout?.widthSizing === 'fill')
          native.layoutSizingHorizontal = 'FILL';
      }
    }
    if (source.style.rotation && source.style.size && parentSource) {
      // CSS rotates around the centre; Figma rotates around the top-left corner.
      const { width, height } = source.style.size;
      if (native.type === 'TEXT') native.textAutoResize = 'NONE';
      native.resize(Math.max(0.01, width), Math.max(0.01, height));
      const theta = (-source.style.rotation * Math.PI) / 180;
      const cos = Math.cos(theta),
        sin = Math.sin(theta);
      const cx = source.bounds.x - parentSource.bounds.x + source.bounds.width / 2,
        cy = source.bounds.y - parentSource.bounds.y + source.bounds.height / 2;
      if (parent.layoutMode !== 'NONE') native.layoutPositioning = 'ABSOLUTE';
      native.relativeTransform = [
        [cos, sin, cx - (cos * width) / 2 - (sin * height) / 2],
        [-sin, cos, cy + (sin * width) / 2 - (cos * height) / 2],
      ];
    }
    // Resizing and parent sizing setters can reset text resizing. Apply it last
    // so edited copy grows vertically instead of clipping at capture-time height.
    if (native.type === 'TEXT' && !source.style.rotation) {
      if (source.text?.maxLines) {
        native.textAutoResize = 'NONE';
        native.resize(Math.max(0.01, source.bounds.width), Math.max(0.01, source.bounds.height));
        native.textTruncation = 'ENDING';
        native.maxLines = source.text.maxLines;
      } else
        native.textAutoResize = source.text?.sizing === 'inline' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
    }
    if (options.metadata !== false)
      native.setPluginData(
        'website-source',
        JSON.stringify({
          captureId: pkg.capture.id,
          screenId,
          sourceId: source.id,
          key: source.source.key ?? null,
          bounds: source.bounds,
        }),
      );
    mapping[`${screenId}:${source.id}`] = native.id;
    options.onProgress?.(++done, total);
    return native;
  }
}
