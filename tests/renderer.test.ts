import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFont,
  deriveLayout,
  paintRank,
  decodeBase64,
  captureHost,
} from '../src/plugin/renderer.js';
import type { SceneNode, TextSpec } from '../src/core/scene.js';
const text: TextSpec = {
  characters: 'Hello',
  fontFamily: '"Arial", sans-serif',
  fontStyle: 'Regular',
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 24,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0, a: 1 },
  align: 'left',
  direction: 'ltr',
};
test('names imports without depending on browser-only URL globals in Figma main', () => {
  assert.equal(captureHost('https://example.com/a'), 'example.com');
  assert.equal(captureHost('fixture:owned'), 'Owned fixture');
});
test('resolves CSS font weight against actual available Figma font faces', () => {
  const result = resolveFont(text, [
    { family: 'Arial', style: 'Regular' },
    { family: 'Arial', style: 'Bold' },
  ]);
  assert.deepEqual(result, { font: { family: 'Arial', style: 'Bold' }, exact: true });
});
test('reports substitution instead of silently treating fallback as exact', () => {
  const result = resolveFont({ ...text, fontFamily: 'Unavailable', fontWeight: 400 }, [
    { family: 'Inter', style: 'Regular' },
  ]);
  assert.equal(result.exact, false);
  assert.equal(result.font.family, 'Inter');
});
test('font resolution fails when no usable font exists', () =>
  assert.throws(() => resolveFont(text, []), /font/i));

test('uses the measured rendered font rather than a missing first CSS family', () => {
  const resolved = resolveFont(
    {
      ...text,
      fontFamily: '"Unavailable Web Font", Arial, sans-serif',
      resolvedFontFamily: 'Arial',
    },
    [
      { family: 'Arial', style: 'Bold' },
      { family: 'Inter', style: 'Bold' },
    ],
  );
  assert.deepEqual(resolved, { font: { family: 'Arial', style: 'Bold' }, exact: true });
});
test('matches quoted CSS fallback names without calling an unmeasured fallback exact', () => {
  const resolved = resolveFont(
    { ...text, fontFamily: '"Missing, Named Font", "Arial", sans-serif' },
    [
      { family: 'Arial', style: 'Bold' },
      { family: 'Inter', style: 'Bold' },
    ],
  );
  assert.equal(resolved.font.family, 'Arial');
  assert.equal(resolved.exact, false);
});
test('preserves a supported variable weight and discloses unsupported variation axes', () => {
  const request = { ...text, fontFamily: 'Inter', fontWeight: 550 };
  const available = [{ family: 'Inter', style: 'Regular' }];
  const resolved = resolveFont(request, available, 'Inter', { Inter: ['wght'] });
  assert.equal(resolved.exact, true);
  assert.equal(resolved.font.variationSettings?.wght, 550);
  const unsupported = resolveFont(
    { ...request, variationSettings: { wdth: 85 } },
    available,
    'Inter',
    { Inter: ['wght'] },
  );
  assert.equal(unsupported.exact, false);
});
test('base64 asset decoding preserves original bytes', () => {
  assert.deepEqual(Array.from(decodeBase64('AAECA/8=')), [0, 1, 2, 3, 255]);
  assert.throws(() => decodeBase64('not base64!'));
});
const frame: SceneNode = {
  id: 'root',
  kind: 'frame',
  name: 'Section',
  source: { tag: 'section' },
  bounds: { x: 0, y: 0, width: 300, height: 160 },
  style: { opacity: 1 },
  layout: {
    mode: 'vertical',
    gap: 0,
    padding: [10, 10, 10, 10],
    align: 'start',
    justify: 'start',
    wrap: false,
    widthSizing: 'fill',
    heightSizing: 'hug',
  },
  children: [
    {
      id: 'a',
      kind: 'frame',
      name: 'A',
      source: { tag: 'div' },
      bounds: { x: 10, y: 10, width: 280, height: 40 },
      style: { opacity: 1 },
      children: [],
    },
    {
      id: 'b',
      kind: 'frame',
      name: 'B',
      source: { tag: 'div' },
      bounds: { x: 10, y: 70, width: 280, height: 80 },
      style: { opacity: 1 },
      children: [],
    },
  ],
};
test('derives measured gaps instead of dropping CSS margin space', () => {
  const layout = deriveLayout(frame);
  assert.equal(layout.mode, 'vertical');
  assert.equal(layout.gap, 20);
});
test('does not force overlapping children into a flow layout', () => {
  const node = structuredClone(frame);
  node.children[1]!.bounds.y = 30;
  assert.equal(deriveLayout(node).mode, 'none');
});
test('keeps narrow centered and right-aligned children in a vertical flow', () => {
  const parent = structuredClone(frame);
  const child = parent.children[0]!;
  child.bounds = { x: 128, y: 10, width: 44, height: 44 };
  assert.equal(deriveLayout(parent).align, 'center');
  child.bounds.x = 246;
  assert.equal(deriveLayout(parent).align, 'end');
  child.bounds.x = 10;
  assert.equal(deriveLayout(parent).align, 'start');
});
test('positioned headings paint above a later flow image and backgrounds stay behind', () => {
  const heading = { ...structuredClone(frame.children[0]!), position: 'absolute' as const };
  const photo = structuredClone(frame.children[1]!);
  const background = { ...photo, source: { tag: '#background' } };
  assert.ok(paintRank(heading) > paintRank(photo));
  assert.ok(paintRank(background) < paintRank(photo));
  heading.style.zIndex = -1;
  assert.ok(paintRank(heading) < paintRank(photo));
});
