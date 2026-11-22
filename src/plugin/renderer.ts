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
  /** Wrap the imported screens in a section (default) instead of a plain frame. */
  section?: boolean;
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
  // Auto layout paints in flow order. A different stacking order only matters
  // where flow items overlap (a sticky header over separate content does not).
  if (paintConflict(children)) return { ...layout, mode: 'none' };
  // A wrapping row whose items were measured on one line stays one line: a fraction
  // of a pixel (min-width rounding) must not push the last item to a second row.
  if (
    layout.wrap &&
    layout.mode === 'horizontal' &&
    children.length &&
    children.every(
      (c) =>
        c.bounds.y < children[0]!.bounds.y + children[0]!.bounds.height &&
        children[0]!.bounds.y < c.bounds.y + c.bounds.height,
    )
  )
    layout.wrap = false;
  // A wrapping column (flex-direction: column with wrap) has no auto-layout
  // counterpart: one measured column is a plain column, several keep their positions.
  if (layout.wrap && layout.mode === 'vertical' && children.length) {
    const oneColumn = children.every(
      (c) =>
        c.bounds.x < children[0]!.bounds.x + children[0]!.bounds.width &&
        children[0]!.bounds.x < c.bounds.x + c.bounds.width,
    );
    if (!oneColumn) return { ...layout, mode: 'none' };
    layout.wrap = false;
  }
  // CSS reaches the same picture in many ways (auto margins, align-self, baselines,
  // transforms). Auto layout is kept only where it reproduces the measured positions:
  // alignment and edge padding are taken from the measurement, and a container whose
  // children fit no single alignment keeps their measured positions instead.
  if (
    (layout.mode === 'vertical' || layout.mode === 'horizontal') &&
    !layout.wrap &&
    children.length
  ) {
    const vertical = layout.mode === 'vertical';
    const border = gridBorder(node);
    const boxStart = vertical ? node.bounds.x + border[3] : node.bounds.y + border[0];
    const boxEnd = vertical
      ? node.bounds.x + node.bounds.width - border[1]
      : node.bounds.y + node.bounds.height - border[2];
    const before = vertical ? 3 : 0,
      after = vertical ? 1 : 2;
    const crossStart = (c: SceneNode) => (vertical ? c.bounds.x : c.bounds.y);
    const crossEnd = (c: SceneNode) =>
      vertical ? c.bounds.x + c.bounds.width : c.bounds.y + c.bounds.height;
    const fit = (from: number, to: number): Layout['align'] | undefined => {
      const gaps = children.map((c) => [crossStart(c) - from, to - crossEnd(c)] as const);
      const fills = ([a, b]: readonly [number, number]) => Math.abs(a) <= 1.5 && Math.abs(b) <= 1.5;
      const matches = {
        start: gaps.every((g) => fills(g) || Math.abs(g[0]) <= 1.5),
        center: gaps.every((g) => fills(g) || Math.abs(g[0] - g[1]) <= 2),
        end: gaps.every((g) => fills(g) || Math.abs(g[1]) <= 1.5),
      };
      const wanted = layout.align === 'stretch' ? 'start' : layout.align;
      if (matches[wanted]) return layout.align;
      return (['start', 'center', 'end'] as const).find((align) => matches[align]);
    };
    let align = fit(boxStart + layout.padding[before], boxEnd - layout.padding[after]);
    if (!align) {
      // Shared margins: the tightest box around the children, then the same test.
      const from = Math.min(...children.map(crossStart)),
        to = Math.max(...children.map(crossEnd));
      // Children that start before the box (a carousel track moved by a transform)
      // cannot be reached by padding: they keep their measured positions.
      align = from < boxStart - 1.5 ? undefined : fit(from, to);
      if (align) {
        layout.padding[before] = Math.max(0, from - boxStart);
        layout.padding[after] = Math.max(0, boxEnd - to);
      }
    }
    if (!align) return { ...layout, mode: 'none' };
    layout.align = align;
    if (vertical && Math.min(...children.map((c) => c.bounds.y)) < node.bounds.y + border[0] - 1.5)
      return { ...layout, mode: 'none' };
    if (!vertical) {
      // Main axis of a row: where the first and last items sit decides the justification.
      const rowStart = node.bounds.x + border[3],
        rowEnd = node.bounds.x + node.bounds.width - border[1];
      const first = Math.min(...children.map((c) => c.bounds.x)),
        last = Math.max(...children.map((c) => c.bounds.x + c.bounds.width));
      if (first < rowStart - 1.5) return { ...layout, mode: 'none' };
      const lead = first - rowStart - layout.padding[3],
        trail = rowEnd - layout.padding[1] - last;
      const matches = {
        start: Math.abs(lead) <= 1.5,
        end: Math.abs(trail) <= 1.5,
        center: Math.abs(lead - trail) <= 2,
        'space-between': children.length > 1 && Math.abs(lead) <= 1.5 && Math.abs(trail) <= 1.5,
      };
      if (!matches[layout.justify]) {
        const justify = (['start', 'center', 'end'] as const).find((j) => matches[j]);
        if (justify) layout.justify = justify;
        else {
          layout.justify = 'start';
          layout.padding[3] = Math.max(0, first - rowStart);
          layout.padding[1] = Math.max(0, rowEnd - last);
        }
      }
    }
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
const gridBorder = (source: SceneNode): [number, number, number, number] => {
  const edge = source.style.border;
  return edge?.sides ?? [edge?.width ?? 0, edge?.width ?? 0, edge?.width ?? 0, edge?.width ?? 0];
};
/** Column widths of a grid: the measured CSS tracks, or equal shares of the content box. */
function gridTracks(source: SceneNode, layout: Layout): number[] {
  const columns = Math.max(1, layout.columns ?? 1);
  if (layout.tracks?.length === columns) return layout.tracks;
  const border = gridBorder(source);
  const inner = source.bounds.width - layout.padding[1] - layout.padding[3] - border[1] - border[3];
  return Array.from({ length: columns }, () => (inner - layout.gap * (columns - 1)) / columns);
}
const overlaps = (a: SceneNode, b: SceneNode) =>
  a.bounds.x < b.bounds.x + b.bounds.width - 0.5 &&
  b.bounds.x < a.bounds.x + a.bounds.width - 0.5 &&
  a.bounds.y < b.bounds.y + b.bounds.height - 0.5 &&
  b.bounds.y < a.bounds.y + a.bounds.height - 0.5;
function paintConflict(flow: SceneNode[]): boolean {
  for (let i = 0; i < flow.length; i++)
    for (let j = i + 1; j < flow.length; j++)
      if (paintRank(flow[i]!) > paintRank(flow[j]!) && overlaps(flow[i]!, flow[j]!)) return true;
  return false;
}
/** True when hugging reproduces the measured height (no fixed, minimum or stretched height). */
function hugsHeight(source: SceneNode, layout: Layout): boolean {
  const flow = source.children.filter((c) => c.position !== 'absolute');
  if (!flow.length || layout.mode === 'grid' || layout.wrap) return true;
  // A column's top and bottom padding are measured, so hugging matches unless the
  // content runs past the box (a child moved by a transform, or clipped overflow).
  if (layout.mode === 'vertical')
    return (
      Math.max(...flow.map((c) => c.bounds.y + c.bounds.height)) -
        (source.bounds.y + source.bounds.height) <=
      1.5
    );
  const edge = gridBorder(source);
  const tallest = Math.max(...flow.map((c) => c.bounds.height));
  const content = tallest + layout.padding[0] + layout.padding[2] + edge[0] + edge[2];
  return Math.abs(content - source.bounds.height) <= 1.5;
}
function firstTextDirection(node: SceneNode): string | undefined {
  if (node.text) return node.text.direction;
  for (const child of node.children) {
    const found = firstTextDirection(child);
    if (found) return found;
  }
  return undefined;
}
const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));
const STRONG_RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
export function rtlMark(text: { characters: string; direction: string }): string {
  if (text.direction !== 'rtl') return '';
  const first = [...text.characters].find((ch) => /\p{L}/u.test(ch));
  return first && STRONG_RTL.test(first) ? '' : '\u200f';
}
function isSingleLine(source: SceneNode): boolean {
  // The browser's own line count when it was measured (a one-line label in a tall
  // button is still one line); otherwise judged from the box height.
  if (source.text?.lines !== undefined) return source.text.lines === 1;
  return (
    !!source.text &&
    !source.text.characters.includes('\n') &&
    source.bounds.height < source.text.lineHeight * 1.6
  );
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
  // Auto flow fills each row from the left. A short last row in a right-to-left
  // grid starts at the right edge, so measured cells are placed explicitly.
  const placeGridCells = (node: FrameNode, source: SceneNode, screenId: string) => {
    const items = source.children.filter(
      (c) => c.position !== 'absolute' && c.source.tag !== '#background',
    );
    const columns = node.gridColumnCount;
    const layout = layoutOf(source);
    const tracks = gridTracks(source, layout);
    const left = source.bounds.x + layout.padding[3] + gridBorder(source)[3];
    const starts = tracks.map(
      (_, i) => left + tracks.slice(0, i).reduce((sum, w) => sum + w, 0) + layout.gap * i,
    );
    const columnOf = (c: SceneNode) => starts.findIndex((x) => Math.abs(c.bounds.x - x) <= 2);
    const rows: number[] = [];
    for (const y of items.map((c) => c.bounds.y).sort((a, b) => a - b))
      if (!rows.length || y - rows.at(-1)! > 2) rows.push(y);
    const cells = items.map((c) => ({
      node: node.children.find((n) => n.id === mapping[`${screenId}:${c.id}`]),
      row: rows.findIndex((y) => Math.abs(c.bounds.y - y) <= 2),
      column: columnOf(c),
    }));
    if (
      cells.some((cell) => !cell.node || cell.row < 0 || cell.column < 0 || cell.column >= columns)
    )
      return;
    if (
      cells.every((cell, i) => cell.row === Math.floor(i / columns) && cell.column === i % columns)
    )
      return;
    if (new Set(cells.map((cell) => `${cell.row}:${cell.column}`)).size !== cells.length) return;
    const rowCount = node.gridRowCount;
    node.gridRowCount = Math.max(rowCount, rows.length);
    node.gridItemsPositioning = 'MANUAL';
    try {
      // Move the furthest cells first so no target is still held by an unmoved item.
      for (const cell of [...cells].sort(
        (a, b) => b.row * columns + b.column - (a.row * columns + a.column),
      ))
        (cell.node as FrameNode).setGridChildPosition(cell.row, cell.column);
    } catch {
      node.gridItemsPositioning = 'ROW_AUTO_FLOW';
      node.gridRowCount = rowCount;
      issues.push({
        code: 'GRID_ORDER',
        message:
          'Grid cells keep automatic order; the measured cell positions could not be placed.',
        sourceId: source.id,
        nodeId: node.id,
      });
    }
  };
  const huggers = new Set<string>();
  const oneLineTexts: { node: TextNode; lineHeight: number; width: number }[] = [];
  /** Makes the single-child chain under a shrink-wrapped box hug down to one line of copy. */
  const hugChain = (source: SceneNode, node: FrameNode, screenId: string): boolean => {
    const layout = layoutOf(source);
    if (layout.mode !== 'vertical' && layout.mode !== 'horizontal') return false;
    const flow = source.children.filter((c) => c.position !== 'absolute');
    if (flow.length !== 1) return false;
    const only = flow[0]!;
    const native = node.children.find((n) => n.id === mapping[`${screenId}:${only.id}`]);
    if (!native) return false;
    const border = gridBorder(source);
    const content =
      source.bounds.width - layout.padding[1] - layout.padding[3] - border[1] - border[3];
    if (Math.abs(content - only.bounds.width) > 2) return false;
    if (native.type === 'TEXT') {
      // Only copy that fills its box naturally: a centred line in a wider block must not shrink it.
      if (!isSingleLine(only) || only.text?.sizing !== 'inline') return false;
      native.layoutSizingHorizontal = 'HUG';
      native.textAutoResize = 'WIDTH_AND_HEIGHT';
      return true;
    }
    if (native.type !== 'FRAME' || !hugChain(only, native, screenId)) return false;
    native.layoutSizingHorizontal = 'HUG';
    huggers.add(only.id);
    return true;
  };
  const imageFilters = new Map<string, ImageFilters>();
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
  // When Figma is in the background its timers are throttled to about a second each;
  // yielding every 32 ms would then stretch an import to many minutes. A slow turn
  // widens the interval, a fast one restores it.
  let yieldEvery = 32;
  const breathe = async () => {
    if (Date.now() - lastYield < yieldEvery) return;
    const before = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    lastYield = Date.now();
    yieldEvery = lastYield - before > 200 ? 1500 : 32;
  };
  try {
    let offset = 0;
    for (const screen of pkg.screens) {
      check();
      const native = await buildNative(screen.root, staging, undefined, screen.id);
      native.name = `${pkg.capture.title || 'Page'} / ${screen.viewport.width >= 1000 ? 'Desktop' : screen.viewport.width >= 600 ? 'Tablet' : 'Mobile'} / ${screen.viewport.width}`;
      native.x = offset;
      native.y = 0;
      // Last resort for lines the browser showed on one row that wrapped at their
      // measured width (wider glyphs, a substituted font): one row matters more than
      // the exact box, so those lines size themselves. Sizes are read first, in one
      // layout pass, then changed.
      const wrapped = oneLineTexts.filter((t) => t.node.height > t.lineHeight * 1.5);
      for (const t of wrapped) t.node.textAutoResize = 'WIDTH_AND_HEIGHT';
      // A line that needs much more room than it had (a far wider substitute font)
      // would run over its neighbours; wrapping inside its own box is the lesser fault.
      for (const t of wrapped.filter((t) => t.node.width > t.width * 1.15 + 4)) {
        t.node.textAutoResize = 'HEIGHT';
        t.node.resize(Math.max(0.01, t.width), t.node.height);
      }
      oneLineTexts.length = 0;
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
    // A section keeps each screen a top-level frame: exportable, prototypable and
    // usable as a starting point for the web design, with the import labelled once.
    let container: FrameNode | SectionNode = staging;
    if (options.section !== false && typeof api.createSection === 'function') {
      const section = api.createSection();
      cleanup.push(section);
      section.name = `${pkg.capture.title || captureHost(pkg.capture.url)} · ${captureHost(pkg.capture.url)}`;
      section.x = staging.x;
      section.y = staging.y;
      const margin = 80;
      for (const child of [...staging.children]) {
        const x = child.x,
          y = child.y;
        section.appendChild(child);
        child.x = x + margin;
        child.y = y + margin;
      }
      section.resizeWithoutConstraints(staging.width + margin * 2, staging.height + margin * 2);
      if (options.metadata !== false)
        section.setPluginData(
          'website-import',
          JSON.stringify({ captureId: pkg.capture.id, url: pkg.capture.url }),
        );
      staging.remove();
      container = section;
    }
    const createdNodeIds: string[] = [];
    const collect = (n: BaseNode) => {
      createdNodeIds.push(n.id);
      if ('children' in n) (n as ChildrenMixin).children.forEach(collect);
    };
    collect(container);
    api.currentPage.selection = screens.map(
      (id) => (container.children as readonly BaseNode[]).find((n) => n.id === id) as FrameNode,
    );
    api.viewport.scrollAndZoomIntoView([container]);
    return {
      containerId: container.id,
      screenIds: screens,
      createdNodeIds,
      mapping,
      issues,
      stats,
    };
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
    // CSS colour filters apply to every image painted inside the filtered box.
    const inherited = parentSource ? imageFilters.get(parentSource.id) : undefined;
    const own = source.style.imageFilters;
    const filters = own
      ? {
          saturation: clampUnit((inherited?.saturation ?? 0) + (own.saturation ?? 0)),
          contrast: clampUnit((inherited?.contrast ?? 0) + (own.contrast ?? 0)),
          exposure: clampUnit((inherited?.exposure ?? 0) + (own.exposure ?? 0)),
        }
      : inherited;
    if (filters) imageFilters.set(source.id, filters);
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
      // Figma picks a paragraph's direction from its first strong letter. A right-to-left
      // paragraph that starts with Latin text or punctuation needs an invisible RLM so
      // brackets, numbers and Latin runs are ordered as the browser showed them.
      const mark = rtlMark(text);
      node.characters = mark + text.characters;
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
      for (const sourceRun of text.runs ?? []) {
        const run = {
          ...sourceRun,
          start: sourceRun.start + mark.length,
          end: sourceRun.end + mark.length,
        };
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
        // A one-line paragraph was measured at its own line height; a taller run
        // (a floated or enlarged glyph) did not grow that browser line box.
        if (
          run.lineHeight !== undefined &&
          !(isSingleLine(source) && run.lineHeight > source.bounds.height + 0.5)
        )
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
      // Import at the measured size so Figma scales paths and stroke widths itself;
      // resizing a 512-unit import afterwards leaves strokes at their original weight.
      const sized = svg.replace(
        /^(\s*<svg\b)([^>]*)>/i,
        (_match, open: string, attributes: string) => {
          const rest = attributes.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
          const w = Math.max(0.01, source.bounds.width).toFixed(3);
          const h = Math.max(0.01, source.bounds.height).toFixed(3);
          return `${open} width="${w}" height="${h}"${rest}>`;
        },
      );
      native = api.createNodeFromSvg(sized);
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
      const basePaint: ImagePaint =
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
      const imagePaint: ImagePaint = filters ? { ...basePaint, filters } : basePaint;
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
          // Keep every CSS track, including empty ones: a short list in a wide grid
          // must not stretch across the whole row.
          const columns = Math.max(1, layout.columns ?? 1);
          node.gridColumnCount = columns;
          node.gridRowCount = Math.max(1, Math.ceil(source.children.length / columns));
          node.gridItemsPositioning = 'ROW_AUTO_FLOW';
          node.gridColumnGap = layout.gap;
          node.gridRowGap = layout.rowGap ?? layout.gap;
          const tracks = gridTracks(source, layout);
          for (let i = 0; i < columns; i++) {
            node.gridColumnSizes[i]!.type = 'FLEX';
            node.gridColumnSizes[i]!.value = Math.max(1, tracks[i]!);
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
        if (layout.mode === 'grid' && flow.length) {
          // Empty tracks (spacers, zero-height sentinels) still add CSS row gaps
          // below the visible rows; keep that measured space as bottom padding.
          const rows: { top: number; bottom: number }[] = [];
          for (const item of [...flow].sort((a, b) => a.bounds.y - b.bounds.y)) {
            const row = rows.find((r) => Math.abs(r.top - item.bounds.y) <= 2);
            if (row) row.bottom = Math.max(row.bottom, item.bounds.y + item.bounds.height);
            else rows.push({ top: item.bounds.y, bottom: item.bounds.y + item.bounds.height });
          }
          const border = gridBorder(source);
          const content =
            rows.reduce((sum, r) => sum + r.bottom - r.top, 0) +
            (layout.rowGap ?? layout.gap) * (rows.length - 1);
          const extra =
            source.bounds.height - content - padding[0] - padding[2] - border[0] - border[2];
          if (extra > 1) padding[2] += extra;
        }
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
        if (flow.length && layout.mode !== 'grid') {
          // Negative margins pull every item past the padding (full-bleed rows);
          // auto layout cannot overflow its padding, so the padding shrinks instead.
          // Only edges every item shares move, so siblings never shift.
          const border = gridBorder(source);
          const lefts = flow.map((c) => c.bounds.x - source.bounds.x - border[3]);
          const rights = flow.map(
            (c) => source.bounds.x + source.bounds.width - border[1] - c.bounds.x - c.bounds.width,
          );
          const shared = (values: number[]) =>
            layout.mode === 'vertical'
              ? Math.max(...values) - Math.min(...values) <= 0.5
                ? values[0]!
                : undefined
              : undefined;
          const left = layout.mode === 'horizontal' ? lefts[0] : shared(lefts);
          const right = layout.mode === 'horizontal' ? rights.at(-1) : shared(rights);
          if (left !== undefined && left < padding[3] - 0.5) padding[3] = Math.max(0, left);
          if (right !== undefined && right < padding[1] - 0.5) padding[1] = Math.max(0, right);
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
      const builtChildren = new Map<string, Awaited<ReturnType<typeof buildNative>>>();
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
        builtChildren.set(child.id, built);
        paintRanks.set(built.id, paintRank(child));
        if (child.position !== 'absolute') previous = child;
      }
      const painted = [...node.children].sort(
        (a, b) => (paintRanks.get(a.id) ?? 0) - (paintRanks.get(b.id) ?? 0),
      );
      // Re-stack only when it keeps the flow order; auto layout positions follow child order.
      const flowIds = new Set(
        source.children
          .filter((c) => c.position !== 'absolute')
          .map((c) => builtChildren.get(c.id)?.id),
      );
      const flowOrder = (list: readonly BaseNode[]) =>
        list
          .filter((n) => flowIds.has(n.id))
          .map((n) => n.id)
          .join();
      const keepsFlow = layout.mode === 'none' || flowOrder(painted) === flowOrder(node.children);
      if (keepsFlow && painted.some((child, index) => child.id !== node.children[index]?.id))
        for (const child of painted) node.appendChild(child);
      if (layout.mode === 'grid') placeGridCells(node, source, screenId);
      if (
        layout.mode !== 'none' &&
        source.layout?.heightSizing === 'hug' &&
        hugsHeight(source, layout)
      )
        node.layoutSizingVertical = 'HUG';
      // Buttons, links and chips around one line of copy hug it, as a designer
      // would build them; the label then never wraps when Figma glyphs are wider.
      // Only boxes the browser shrink-wrapped hug; block-level buttons keep their width.
      if (source.layout?.widthSizing === 'hug' && hugChain(source, node, screenId)) {
        node.layoutSizingHorizontal = 'HUG';
        huggers.add(source.id);
      }
    }
    native.name = source.name;
    // A minimum above the measured width (sub-pixel rounding) would widen the layer.
    if (source.layout?.minWidth !== undefined)
      native.minWidth = Math.min(source.layout.minWidth, source.bounds.width) || null;
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
        native.dashPattern = border.dash === 'dashed' ? [unit * 2, unit] : [unit, unit];
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
        // A hugging right-to-left badge keeps its right edge when Figma's copy is narrower.
        if (huggers.has(source.id) && firstTextDirection(source) === 'rtl')
          native.x += source.bounds.width - native.width;
      } else if (mode === 'grid') {
        native.gridChildVerticalAlign = 'MIN';
        // A cell fills its column only when it was measured that wide; a narrower item
        // (a link under a heading) keeps its width at the edge it was measured on.
        const parentLayout = layoutOf(parentSource);
        const tracks = gridTracks(parentSource, parentLayout);
        const left = parentSource.bounds.x + parentLayout.padding[3] + gridBorder(parentSource)[3];
        const starts = tracks.map(
          (_, i) => left + tracks.slice(0, i).reduce((sum, w) => sum + w, 0) + parentLayout.gap * i,
        );
        const column = starts.findIndex(
          (x, i) => source.bounds.x >= x - 2 && source.bounds.x < x + tracks[i]! + 2,
        );
        const track = column < 0 ? undefined : tracks[column]!;
        if (track === undefined || Math.abs(source.bounds.width - track) <= 2) {
          native.gridChildHorizontalAlign = 'AUTO';
          native.layoutSizingHorizontal = 'FILL';
        } else {
          const lead = source.bounds.x - starts[column]!,
            trail = starts[column]! + track - source.bounds.x - source.bounds.width;
          native.gridChildHorizontalAlign =
            Math.abs(lead - trail) <= 2 ? 'CENTER' : lead > trail ? 'MAX' : 'MIN';
        }
      } else {
        // Fill only where it reproduces the measured width: the layer spans its parent's
        // content box, and in a row it is the only item (two full-width items in a
        // sliding row would each be squeezed to half).
        const parentLayout = layoutOf(parentSource);
        const edge = gridBorder(parentSource);
        const inner =
          parentSource.bounds.width -
          parentLayout.padding[1] -
          parentLayout.padding[3] -
          edge[1] -
          edge[3];
        const alone =
          mode !== 'horizontal' ||
          parentSource.children.filter((c) => c.position !== 'absolute').length === 1;
        // A single line keeps its measured width instead of filling: it can then size
        // itself if Figma's glyphs would wrap it (same place, since it spans the box).
        const oneLine = native.type === 'TEXT' && isSingleLine(source);
        if (
          !huggers.has(source.id) &&
          alone &&
          !oneLine &&
          Math.abs(source.bounds.width - inner) <= 3
        )
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
      } else {
        // One measured line must stay one line: Figma's glyph metrics can be a
        // little wider than the browser's, which would wrap a fixed-width label.
        const positioned =
          parent.type !== 'FRAME' ||
          parent.layoutMode === 'NONE' ||
          native.layoutPositioning === 'ABSOLUTE';
        // Positioned single lines grow from their aligned edge. In auto layout a line
        // may hug only where that keeps its place: in a row, or in a column aligned to
        // the same edge as the text. Otherwise hugging would move it to the flow start.
        const textAlign = source.text?.align;
        const keepsPlace =
          positioned ||
          (parent.type === 'FRAME' &&
            (parent.layoutMode === 'HORIZONTAL' ||
              (parent.layoutMode === 'VERTICAL' &&
                ((parent.counterAxisAlignItems === 'MAX' && textAlign === 'right') ||
                  (parent.counterAxisAlignItems === 'MIN' && textAlign === 'left') ||
                  (parent.counterAxisAlignItems === 'CENTER' && textAlign === 'center')))));
        const singleLine =
          isSingleLine(source) && native.layoutSizingHorizontal !== 'FILL' && keepsPlace;
        const before = native.width;
        native.textAutoResize =
          (source.text?.sizing === 'inline' && isSingleLine(source)) || singleLine
            ? 'WIDTH_AND_HEIGHT'
            : 'HEIGHT';
        // Checked once the whole screen exists: reading a size while the tree is still
        // being built forces a layout pass on a half-finished auto-layout tree.
        if (
          native.textAutoResize === 'HEIGHT' &&
          isSingleLine(source) &&
          native.layoutSizingHorizontal !== 'FILL'
        )
          oneLineTexts.push({
            node: native,
            lineHeight: source.text!.lineHeight,
            width: source.bounds.width,
          });
        if (singleLine && positioned && native.width !== before) {
          // Keep the edge the browser aligned the line to.
          const align =
            source.text!.align === 'justify'
              ? source.text!.direction === 'rtl'
                ? 'right'
                : 'left'
              : source.text!.align;
          if (align === 'right') native.x += before - native.width;
          else if (align === 'center') native.x += (before - native.width) / 2;
        }
      }
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
