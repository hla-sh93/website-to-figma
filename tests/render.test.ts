import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScene, textRoles } from '../src/plugin/renderer.js';
import { gradientPaint, gradientTransform, utf8Decode, colorName } from '../src/plugin/paint.js';
import type { ScenePackage, SceneNode, TextSpec } from '../src/core/scene.js';
import { createFakeFigma } from './fake-figma.js';

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 1, g: 1, b: 1, a: 1 };
const red = { r: 1, g: 0, b: 0, a: 1 };
const text = (characters: string, extra: Partial<TextSpec> = {}): TextSpec => ({
  characters,
  fontFamily: 'Inter',
  fontStyle: 'normal',
  fontWeight: 400,
  fontSize: 16,
  lineHeight: 20,
  letterSpacing: 0,
  color: black,
  align: 'left',
  direction: 'ltr',
  ...extra,
});
const node = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  id,
  name: id,
  kind: 'frame',
  source: { tag: 'div', key: id },
  bounds: { x: 0, y: 0, width: 200, height: 100 },
  style: { opacity: 1 },
  position: 'absolute',
  children: [],
  ...extra,
});
const scene = (children: SceneNode[], assets: ScenePackage['assets'] = []): ScenePackage => ({
  version: 1,
  capture: {
    id: 'capture-123456789',
    url: 'https://example.test/',
    title: 'Example',
    capturedAt: new Date(0).toISOString(),
    engine: 'test',
  },
  screens: [
    {
      id: 'viewport-1440',
      viewport: { width: 1440, height: 900, dpr: 1 },
      root: node('root', {
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        position: 'flow',
        children,
      }),
    },
  ],
  assets,
  issues: [],
});
const render = async (pkg: ScenePackage) => {
  const figma = createFakeFigma();
  const result = await renderScene(figma.api, pkg, { components: false });
  const byId = (sourceId: string) =>
    figma.all.find((n) => n.id === result.mapping[`viewport-1440:${sourceId}`])!;
  return { ...figma, result, byId };
};
const apply = (t: number[][], x: number, y: number) => [
  t[0]![0]! * x + t[0]![1]! * y + t[0]![2]!,
  t[1]![0]! * x + t[1]![1]! * y + t[1]![2]!,
];
const close = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) < 1e-9, `${actual} ≈ ${expected}`));

test('linear gradient transform maps CSS start/end points onto Figma handles', () => {
  const t = gradientTransform(
    {
      kind: 'linear',
      from: [0.5, 0],
      to: [0.5, 1],
      stops: [
        { position: 0, color: red },
        { position: 1, color: white },
      ],
    },
    300,
    100,
  );
  close(apply(t, 0.5, 0), [0, 0.5]);
  close(apply(t, 0.5, 1), [1, 0.5]);
});

test('radial gradient transform centres the ellipse and scales its radii', () => {
  const t = gradientTransform(
    {
      kind: 'radial',
      from: [0.25, 0.5],
      to: [0.75, 0.5],
      radius: [0.5, 0.25],
      stops: [
        { position: 0, color: red },
        { position: 1, color: white },
      ],
    },
    200,
    200,
  );
  close(apply(t, 0.25, 0.5), [0.5, 0.5]);
  close(apply(t, 0.75, 0.5), [1, 0.5]);
  close(apply(t, 0.25, 0.75), [0.5, 1]);
});

test('UTF-8 decoding keeps Arabic, symbols and astral characters', () => {
  const value = 'مرحبا ← 😀 <svg/>';
  assert.equal(utf8Decode(new Uint8Array(Buffer.from(value, 'utf8'))), value);
  assert.equal(colorName({ r: 1, g: 0.5, b: 0, a: 0.5 }), '#ff8000 50%');
});

test('renders gradients, per-side borders, inset shadows, blur and text case natively', async () => {
  const { byId, result } = await render(
    scene([
      node('card', {
        style: {
          opacity: 1,
          background: white,
          gradients: [
            {
              kind: 'linear',
              from: [0, 0.5],
              to: [1, 0.5],
              stops: [
                { position: 0, color: red },
                { position: 1, color: { ...white, a: 0 } },
              ],
            },
          ],
          border: { color: black, width: 2, sides: [0, 0, 2, 0], dash: 'dashed' },
          shadow: [
            { color: black, x: 0, y: 4, blur: 8, spread: 0 },
            { color: red, x: 0, y: 0, blur: 0, spread: 1, inset: true },
          ],
          backdropBlur: 6,
        },
      }),
      node('label', {
        kind: 'text',
        text: text('Read more', {
          textCase: 'upper',
          shadow: [{ color: black, x: 1, y: 1, blur: 2, spread: 0 }],
        }),
      }),
    ]),
  );
  const card = byId('card');
  assert.deepEqual(
    card.fills.map((f: Paint) => f.type),
    ['SOLID', 'GRADIENT_LINEAR'],
  );
  assert.equal(card.strokeBottomWeight, 2);
  assert.equal(card.strokeTopWeight, 0);
  assert.deepEqual(card.dashPattern, [4, 2]);
  assert.deepEqual(
    card.effects.map((e: Effect) => e.type),
    ['INNER_SHADOW', 'DROP_SHADOW', 'BACKGROUND_BLUR'],
  );
  assert.equal(card.effects[2].radius, 12);
  const label = byId('label');
  assert.equal(label.characters, 'Read more');
  assert.equal(label.textCase, 'UPPER');
  assert.equal(label.effects[0].type, 'DROP_SHADOW');
  assert.equal(result.issues.length, 0);
});

test('rotated leaf layers keep their centre and untransformed size', async () => {
  const { byId } = await render(
    scene([
      node('badge', {
        bounds: { x: 100, y: 100, width: 141.4213562, height: 141.4213562 },
        style: { opacity: 1, background: red, rotation: 45, size: { width: 100, height: 100 } },
      }),
    ]),
  );
  const badge = byId('badge');
  assert.equal(badge.width, 100);
  const t = badge.relativeTransform as number[][];
  // The centre of the unrotated box must land on the centre of the measured bounds.
  close(
    apply(t, 50, 50).map((v) => Math.round(v * 1e6) / 1e6),
    [170.710678, 170.710678],
  );
  // CSS rotates clockwise; Figma's rotation is counter-clockwise.
  assert.ok(t[0]![1]! < 0);
});

test('gradient text and image overlays use native gradient fills', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
  const gradient = {
    kind: 'linear' as const,
    from: [0, 0] as [number, number],
    to: [1, 1] as [number, number],
    stops: [
      { position: 0, color: red },
      { position: 1, color: black },
    ],
  };
  const { byId } = await render(
    scene(
      [
        node('title', {
          kind: 'text',
          text: text('Gradient', { color: { ...black, a: 0 } }),
          style: { opacity: 1, gradients: [gradient] },
        }),
        node('hero', {
          kind: 'image',
          assetId: 'img',
          image: { fit: 'cover', position: [0.5, 0.5] },
          style: { opacity: 1, gradients: [gradient] },
        }),
      ],
      [
        {
          id: 'img',
          kind: 'image',
          mimeType: 'image/png',
          data: png.toString('base64'),
          width: 200,
          height: 100,
        },
      ],
    ),
  );
  assert.equal(byId('title').fills[0].type, 'GRADIENT_LINEAR');
  assert.deepEqual(
    byId('hero').fills.map((f: Paint) => f.type),
    ['IMAGE', 'GRADIENT_LINEAR'],
  );
});

test('every created spacing and colour variable is bound, with readable names', async () => {
  const flow = node('stack', {
    position: 'flow',
    bounds: { x: 0, y: 0, width: 400, height: 200 },
    style: { opacity: 1, background: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
    layout: {
      mode: 'vertical',
      gap: 10,
      padding: [5, 8, 5, 8],
      align: 'start',
      justify: 'start',
      wrap: false,
      widthSizing: 'fixed',
      heightSizing: 'fixed',
    },
    children: [
      node('a', { position: 'flow', bounds: { x: 8, y: 20, width: 100, height: 40 } }),
      node('b', { position: 'flow', bounds: { x: 8, y: 70, width: 100, height: 40 } }),
    ],
  });
  const { variables, all } = await render(scene([flow]));
  const used = new Set<string>();
  for (const n of all) {
    for (const v of Object.values(n.bound)) used.add((v as { id: string }).id);
    for (const f of (n.fills as Paint[] | undefined) ?? [])
      if ('boundVariables' in f && f.boundVariables?.color) used.add(f.boundVariables.color.id);
  }
  const unused = variables.filter((v) => !used.has(v.id)).map((v) => v.name);
  assert.deepEqual(unused, []);
  assert.ok(variables.some((v) => v.name === 'color/#1a334d'));
  assert.ok(variables.some((v) => v.name === 'space/10'));
});

test('cancellation removes every layer, style and variable the import created', async () => {
  const figma = createFakeFigma();
  let calls = 0;
  await assert.rejects(
    renderScene(
      figma.api,
      scene([
        node('one', { style: { opacity: 1, background: red } }),
        node('two', { kind: 'text', text: text('Two') }),
      ]),
      { components: false, isCancelled: () => ++calls > 3 },
    ),
    /cancelled/,
  );
  assert.equal(figma.page.children.length, 0);
  assert.ok(figma.variables.every((v) => v.removed));
  assert.ok(figma.styles.every((s) => s.removed));
});

test('screens become top-level frames inside one labelled section', async () => {
  const { page, result, all } = await render(
    scene([node('one', { style: { opacity: 1, background: red } })]),
  );
  const section = all.find((n) => n.id === result.containerId)!;
  assert.equal(section.type, 'SECTION');
  assert.equal(section.parent, page);
  assert.equal(section.name, 'Example · example.test');
  assert.ok(
    result.screenIds.every((id) => section.children.some((c: { id: string }) => c.id === id)),
  );
  assert.ok(
    all.every((n) => n.type !== 'FRAME' || !n.name.endsWith('/ Editable layers') || n.removed),
  );
});

test('a short last row of a right-to-left grid keeps its measured cells', async () => {
  const cell = (id: string, x: number, y: number) =>
    node(id, { position: 'flow', bounds: { x, y, width: 100, height: 100 } });
  const { byId } = await render(
    scene([
      node('grid', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 320, height: 210 },
        layout: {
          mode: 'grid',
          gap: 10,
          rowGap: 10,
          padding: [0, 0, 0, 0],
          align: 'start',
          justify: 'start',
          wrap: false,
          widthSizing: 'fixed',
          heightSizing: 'hug',
          columns: 3,
        },
        // Visual order after the collector's RTL reordering: row by row, left to right.
        children: [
          cell('a', 0, 0),
          cell('b', 110, 0),
          cell('c', 220, 0),
          cell('d', 110, 110),
          cell('e', 220, 110),
        ],
      }),
    ]),
  );
  assert.equal(byId('grid').gridItemsPositioning, 'MANUAL');
  assert.deepEqual(
    ['d', 'e'].map((id) => [byId(id).gridRowAnchorIndex, byId(id).gridColumnAnchorIndex]),
    [
      [1, 1],
      [1, 2],
    ],
  );
});

test('single measured lines cannot wrap when Figma glyphs are wider', async () => {
  const { byId } = await render(
    scene([
      node('nav', {
        kind: 'text',
        bounds: { x: 0, y: 0, width: 60, height: 20 },
        text: text('الرئيسية', { direction: 'rtl', align: 'right' }),
      }),
      node('copy', {
        kind: 'text',
        bounds: { x: 0, y: 40, width: 200, height: 60 },
        text: text('A paragraph that the browser wrapped over three lines.'),
      }),
    ]),
  );
  assert.equal(byId('nav').textAutoResize, 'WIDTH_AND_HEIGHT');
  assert.equal(byId('copy').textAutoResize, 'HEIGHT');
});

test('a chip around one line of copy hugs its label instead of filling', async () => {
  const flow = (mode: 'vertical' | 'horizontal', padding: [number, number, number, number]) => ({
    mode,
    gap: 0,
    padding,
    align: 'start' as const,
    justify: 'start' as const,
    wrap: false,
    widthSizing: 'fixed' as const,
    heightSizing: 'hug' as const,
  });
  const { byId } = await render(
    scene([
      node('row', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 400, height: 40 },
        layout: flow('horizontal', [0, 0, 0, 0]),
        children: [
          node('chip', {
            position: 'flow',
            bounds: { x: 0, y: 0, width: 77, height: 40 },
            style: { opacity: 1, border: { color: red, width: 1 } },
            layout: { ...flow('vertical', [6, 16, 6, 16]), widthSizing: 'hug' as const },
            children: [
              node('label', {
                kind: 'text',
                position: 'flow',
                bounds: { x: 17, y: 7, width: 43, height: 20 },
                text: text('إكسسوار', { direction: 'rtl', align: 'right', sizing: 'inline' }),
              }),
            ],
          }),
        ],
      }),
    ]),
  );
  assert.equal(byId('chip').layoutSizingHorizontal, 'HUG');
  assert.equal(byId('label').layoutSizingHorizontal, 'HUG');
  assert.equal(byId('label').textAutoResize, 'WIDTH_AND_HEIGHT');
});

test('a stacked sticky header that overlaps nothing keeps the page in auto layout', async () => {
  const { byId } = await render(
    scene([
      node('page', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        layout: {
          mode: 'vertical',
          gap: 0,
          padding: [0, 0, 0, 0],
          align: 'start',
          justify: 'start',
          wrap: false,
          widthSizing: 'fixed',
          heightSizing: 'hug',
        },
        children: [
          node('header', {
            position: 'flow',
            bounds: { x: 0, y: 0, width: 400, height: 60 },
            style: { opacity: 1, zIndex: 50 },
          }),
          node('main', { position: 'flow', bounds: { x: 0, y: 60, width: 400, height: 240 } }),
        ],
      }),
    ]),
  );
  const page = byId('page');
  assert.equal(page.layoutMode, 'VERTICAL');
  assert.deepEqual(
    page.children.map((c: { id: string }) => c.id),
    [byId('header').id, byId('main').id],
  );
});

test('SVG icons are imported at their measured size so strokes scale with them', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" viewBox="0 0 512 512"><path d="M48 80h64" stroke="red" stroke-width="32"/></svg>';
  const { byId } = await render(
    scene(
      [
        node('cart', {
          kind: 'svg',
          assetId: 'cart',
          bounds: { x: 0, y: 0, width: 18, height: 18 },
        }),
      ],
      [
        {
          id: 'cart',
          kind: 'svg',
          mimeType: 'image/svg+xml',
          data: Buffer.from(svg).toString('base64'),
          width: 512,
          height: 512,
        },
      ],
    ),
  );
  const imported = byId('cart').svg as string;
  assert.match(imported, /^<svg width="18\.000" height="18\.000" xmlns=/);
  assert.doesNotMatch(imported, /width="512"/);
});

test('right-to-left copy that starts with Latin text keeps the browser order', async () => {
  const { byId } = await render(
    scene([
      node('title', {
        kind: 'text',
        text: text('(TEST) Nike Air Jordan 5', {
          direction: 'rtl',
          align: 'right',
          runs: [{ start: 1, end: 5, color: red }],
        }),
      }),
      node('arabic', { kind: 'text', text: text('نايكي ترافيس', { direction: 'rtl' }) }),
    ]),
  );
  const title = byId('title');
  assert.equal(title.characters, '\u200f(TEST) Nike Air Jordan 5');
  assert.equal(title.ranges.find((r) => r.method === 'setRangeFontName')!.start, 2);
  assert.equal(byId('arabic').characters, 'نايكي ترافيس');
});

test('grayscale and saturate filters reach the images inside the filtered box', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  );
  const { byId } = await render(
    scene(
      [
        node('logo', {
          style: { opacity: 1, imageFilters: { saturation: -1 } },
          children: [
            node('mark', {
              kind: 'image',
              assetId: 'img',
              image: { fit: 'cover', position: [0.5, 0.5] },
            }),
          ],
        }),
      ],
      [
        {
          id: 'img',
          kind: 'image',
          mimeType: 'image/png',
          data: png.toString('base64'),
          width: 200,
          height: 100,
        },
      ],
    ),
  );
  assert.equal(byId('mark').fills[0].filters.saturation, -1);
});

test('a block-level button keeps its full width instead of hugging its label', async () => {
  const flow = {
    gap: 0,
    align: 'start' as const,
    justify: 'start' as const,
    wrap: false,
    heightSizing: 'hug' as const,
  };
  const { byId } = await render(
    scene([
      node('card', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 300, height: 60 },
        layout: { ...flow, mode: 'vertical', padding: [0, 0, 0, 0], widthSizing: 'fixed' },
        children: [
          node('button', {
            position: 'flow',
            bounds: { x: 0, y: 0, width: 300, height: 44 },
            style: { opacity: 1, background: red },
            layout: { ...flow, mode: 'vertical', padding: [10, 12, 10, 12], widthSizing: 'fill' },
            children: [
              node('label', {
                kind: 'text',
                position: 'flow',
                bounds: { x: 12, y: 10, width: 276, height: 24 },
                text: text('عرض المنتج', { direction: 'rtl', align: 'center', lineHeight: 24 }),
              }),
            ],
          }),
        ],
      }),
    ]),
  );
  assert.equal(byId('button').layoutSizingHorizontal, 'FILL');
  assert.notEqual(byId('label').textAutoResize, 'WIDTH_AND_HEIGHT');
});

test('a label beside an icon in a row stays on one line', async () => {
  const { byId } = await render(
    scene([
      node('link', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 80, height: 32 },
        layout: {
          mode: 'horizontal',
          gap: 8,
          padding: [6, 12, 6, 12],
          align: 'center',
          justify: 'start',
          wrap: false,
          widthSizing: 'hug',
          heightSizing: 'hug',
        },
        children: [
          node('icon', { position: 'flow', bounds: { x: 12, y: 7, width: 18, height: 18 } }),
          node('label', {
            kind: 'text',
            position: 'flow',
            bounds: { x: 38, y: 6, width: 30, height: 20 },
            text: text('السلة', { direction: 'rtl', align: 'right' }),
          }),
        ],
      }),
    ]),
  );
  assert.equal(byId('label').textAutoResize, 'WIDTH_AND_HEIGHT');
});

const flowLayout = (mode: 'vertical' | 'horizontal', extra: Record<string, unknown> = {}) => ({
  mode,
  gap: 0,
  padding: [0, 0, 0, 0] as [number, number, number, number],
  align: 'start' as const,
  justify: 'start' as const,
  wrap: false,
  widthSizing: 'fixed' as const,
  heightSizing: 'hug' as const,
  ...extra,
});

test('alignment and justification follow the measured positions', async () => {
  const { byId } = await render(
    scene([
      // margin: auto centres the only item of a row that CSS calls justify-start.
      node('bar', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 1440, height: 52 },
        layout: flowLayout('horizontal'),
        children: [
          node('inner', { position: 'flow', bounds: { x: 110, y: 0, width: 1220, height: 52 } }),
        ],
      }),
      // An icon centred beside taller copy in a row that CSS calls align-start.
      node('row', {
        position: 'flow',
        bounds: { x: 0, y: 100, width: 300, height: 40 },
        layout: flowLayout('horizontal'),
        children: [
          node('icon', { position: 'flow', bounds: { x: 0, y: 110, width: 20, height: 20 } }),
          node('copy', { position: 'flow', bounds: { x: 20, y: 100, width: 100, height: 40 } }),
        ],
      }),
      // Items at unrelated offsets fit no alignment: measured positions are kept.
      node('mixed', {
        position: 'flow',
        bounds: { x: 0, y: 200, width: 300, height: 100 },
        layout: flowLayout('vertical'),
        children: [
          node('left', { position: 'flow', bounds: { x: 0, y: 200, width: 100, height: 40 } }),
          node('offset', { position: 'flow', bounds: { x: 57, y: 240, width: 100, height: 40 } }),
        ],
      }),
    ]),
  );
  assert.equal(byId('bar').primaryAxisAlignItems, 'CENTER');
  assert.equal(byId('row').counterAxisAlignItems, 'CENTER');
  assert.equal(byId('mixed').layoutMode, 'NONE');
  assert.equal(byId('offset').x, 57);
});

test('wrapped inline copy keeps its measured width', async () => {
  const { byId } = await render(
    scene([
      node('item', {
        kind: 'text',
        bounds: { x: 0, y: 0, width: 269, height: 44 },
        text: text('Run campaigns, personalize content, and track it all.', {
          sizing: 'inline',
          lineHeight: 22,
        }),
      }),
    ]),
  );
  assert.equal(byId('item').textAutoResize, 'HEIGHT');
  assert.equal(byId('item').width, 269);
});

test('grid columns use measured tracks and narrow cells keep their width', async () => {
  const { byId } = await render(
    scene([
      node('grid', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 1220, height: 200 },
        layout: {
          ...flowLayout('vertical'),
          mode: 'grid',
          gap: 24,
          rowGap: 24,
          columns: 2,
          tracks: [399, 797],
        },
        children: [
          node('aside', { position: 'flow', bounds: { x: 0, y: 0, width: 399, height: 200 } }),
          node('link', { position: 'flow', bounds: { x: 423, y: 0, width: 86, height: 48 } }),
        ],
      }),
    ]),
  );
  assert.deepEqual(
    byId('grid').gridColumnSizes.map((t: { value: number }) => t.value),
    [399, 797],
  );
  assert.equal(byId('aside').layoutSizingHorizontal, 'FILL');
  assert.notEqual(byId('link').layoutSizingHorizontal, 'FILL');
  assert.equal(byId('link').gridChildHorizontalAlign, 'MIN');
});

test('boxes taller than their row content keep their height', async () => {
  const { byId } = await render(
    scene([
      node('stage', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 1280, height: 900 },
        layout: flowLayout('horizontal', { align: 'center' }),
        children: [
          node('title', { position: 'flow', bounds: { x: 0, y: 340, width: 1280, height: 220 } }),
        ],
      }),
    ]),
  );
  assert.notEqual(byId('stage').layoutSizingVertical, 'HUG');
  assert.equal(byId('stage').height, 900);
});

test('transparent gradient stops fade the neighbouring colour', () => {
  const paint = gradientPaint(
    {
      kind: 'linear',
      from: [0, 0.5],
      to: [1, 0.5],
      stops: [
        { position: 0, color: white },
        { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
      ],
    },
    100,
    100,
  );
  assert.deepEqual(paint.gradientStops[1]!.color, { r: 1, g: 1, b: 1, a: 0 });
});

test('a wrapping column with several measured columns keeps positions; one column stays a column', async () => {
  const item = (id: string, x: number, y: number) =>
    node(id, { position: 'flow', bounds: { x, y, width: 220, height: 33 } });
  const { byId } = await render(
    scene([
      node('two', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 487, height: 66 },
        layout: flowLayout('vertical', { wrap: true }),
        children: [item('a', 0, 0), item('b', 0, 33), item('c', 252, 0), item('d', 252, 33)],
      }),
      node('one', {
        position: 'flow',
        bounds: { x: 0, y: 100, width: 220, height: 66 },
        layout: flowLayout('vertical', { wrap: true }),
        children: [item('e', 0, 100), item('f', 0, 133)],
      }),
    ]),
  );
  assert.equal(byId('two').layoutMode, 'NONE');
  assert.equal(byId('c').x, 252);
  assert.equal(byId('one').layoutMode, 'VERTICAL');
});

test('grid rows use the measured gap when item margins add to the CSS gap', async () => {
  const { byId } = await render(
    scene([
      node('grid', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 296, height: 120 },
        layout: {
          ...flowLayout('vertical'),
          mode: 'grid',
          gap: 16,
          rowGap: 0,
          columns: 1,
          tracks: [296],
        },
        children: [
          node('title', { position: 'flow', bounds: { x: 0, y: 0, width: 296, height: 64 } }),
          node('more', { position: 'flow', bounds: { x: 0, y: 72, width: 86, height: 48 } }),
        ],
      }),
    ]),
  );
  assert.equal(byId('grid').gridRowGap, 8);
});

test('authored grow and stretch become fill only where the picture stays the same', async () => {
  const cell = (id: string, x: number, width: number, height: number, extra = {}) =>
    node(id, { position: 'flow', bounds: { x, y: 0, width, height }, ...extra });
  const { byId } = await render(
    scene([
      node('bar', {
        position: 'flow',
        bounds: { x: 0, y: 0, width: 600, height: 80 },
        layout: flowLayout('horizontal'),
        children: [
          cell('logo', 0, 120, 80),
          cell('search', 120, 380, 80, { layout: { ...flowLayout('vertical'), grow: true } }),
          cell('side', 500, 100, 80, { layout: { ...flowLayout('vertical'), stretch: true } }),
        ],
      }),
      // The row is not full: free space would move the growing item.
      node('loose', {
        position: 'flow',
        bounds: { x: 0, y: 100, width: 600, height: 80 },
        layout: flowLayout('horizontal'),
        children: [
          node('short', {
            position: 'flow',
            bounds: { x: 0, y: 100, width: 200, height: 80 },
            layout: { ...flowLayout('vertical'), grow: true },
          }),
        ],
      }),
    ]),
  );
  assert.equal(byId('search').layoutSizingHorizontal, 'FILL');
  assert.equal(byId('search').width, 380);
  assert.equal(byId('side').layoutSizingVertical, 'FILL');
  assert.notEqual(byId('logo').layoutSizingHorizontal, 'FILL');
  assert.notEqual(byId('short').layoutSizingHorizontal, 'FILL');
});

test('colours declared as page tokens take the token name', async () => {
  const pkg = scene([
    node('brand', { style: { opacity: 1, background: red } }),
    node('ink', { style: { opacity: 1, background: black } }),
  ]);
  pkg.tokens = {
    colors: [
      { name: 'primary', value: red },
      { name: 'danger', value: red },
    ],
  };
  const { variables } = await render(pkg);
  const names = variables.map((v) => v.name);
  assert.ok(names.includes('color/primary'));
  assert.ok(names.includes('color/#000000'));
  assert.ok(!names.includes('color/danger') && !names.includes('color/#ff0000'));
});

test('text styles are named by use, and a second import reuses styles and colours', async () => {
  const label = (id: string, tag: string, spec: Partial<TextSpec>, y: number) =>
    node(id + '-box', {
      source: { tag, key: id + '-box' },
      bounds: { x: 0, y, width: 300, height: 40 },
      children: [
        node(id, {
          kind: 'text',
          source: { tag: 'span', key: id },
          bounds: { x: 0, y, width: 300, height: 40 },
          text: text(id, spec),
        }),
      ],
    });
  const pkg = () =>
    scene([
      label('title', 'h1', { fontSize: 40, lineHeight: 48, fontWeight: 700 }, 0),
      label('copy', 'p', {}, 60),
      label('cta', 'button', { fontSize: 14, fontWeight: 600 }, 120),
      label('note', 'p', { fontSize: 11, lineHeight: 14 }, 180),
    ]);
  assert.deepEqual([...textRoles(pkg()).values()], ['Heading', 'Body', 'Label', 'Caption']);
  const figma = createFakeFigma([
    { family: 'Inter', style: 'Regular' },
    { family: 'Inter', style: 'Semi Bold' },
    { family: 'Inter', style: 'Bold' },
  ]);
  const first = await renderScene(figma.api, pkg(), { components: false });
  const names = figma.styles.map((s) => s.name);
  assert.deepEqual(names, [
    'example.test / Heading / 40 Bold',
    'example.test / Body / 16 Regular',
    'example.test / Label / 14 SemiBold',
    'example.test / Caption / 11 Regular',
  ]);
  const variables = figma.variables.length;
  const second = await renderScene(figma.api, pkg(), { components: false });
  assert.equal(figma.styles.length, names.length);
  assert.equal(figma.variables.length, variables);
  assert.ok(first.stats.textStyles === 4 && second.stats.textStyles === 0);
  assert.equal(second.stats.variables, 0);
});
