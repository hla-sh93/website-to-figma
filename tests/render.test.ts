import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScene } from '../src/plugin/renderer.js';
import { gradientTransform, utf8Decode, colorName } from '../src/plugin/paint.js';
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
