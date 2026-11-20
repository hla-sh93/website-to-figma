import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, SCHEMA_VERSION } from '../src/core/scene.js';
const fixture = (): any => ({
  version: 1,
  capture: {
    id: 'capture',
    url: 'https://example.test',
    title: 'Test',
    capturedAt: '2026-10-28',
    engine: 'test',
  },
  screens: [
    {
      id: 'desktop',
      viewport: { width: 1440, height: 900, dpr: 1 },
      root: {
        id: 'root',
        name: 'Root',
        kind: 'frame',
        source: { tag: 'main' },
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        style: { opacity: 1 },
        children: [],
      },
    },
  ],
  assets: [],
  issues: [],
});

test('rejects exotic arrays and sparse tuples with named keys', () => {
  class Bypass extends Array<any> {
    forEach() {}
  }
  const a = fixture();
  a.screens[0].root.children = new Bypass({ invalid: true });
  assert.throws(() => validateScene(a));
  const b = fixture();
  const sparse = new Array(4);
  Object.assign(sparse, { a: 1, b: 2, c: 3, d: 4 });
  b.screens[0].root.style.radius = sparse;
  assert.throws(() => validateScene(b));
});
test('rejects non-PNG screenshot payloads', () => {
  for (const data of ['', 'aGVsbG8=', 'iVBORw0KGgo=']) {
    const s = fixture();
    s.screens[0].screenshot = data;
    assert.throws(() => validateScene(s));
  }
});
test('returns the original valid scene', () => {
  const s = fixture();
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(validateScene(s), s);
});

test('validates measured font evidence, variation axes, decorations and image content geometry', () => {
  const s = fixture();
  const n = s.screens[0].root;
  n.kind = 'text';
  n.text = {
    characters: 'Measured',
    fontFamily: 'Arial',
    fontStyle: 'Regular',
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
    align: 'left',
    direction: 'ltr',
    resolvedFontFamily: 'Arial',
    fontUsage: [{ family: 'Arial', postScriptName: 'ArialMT', glyphCount: 8, isCustomFont: false }],
    variationSettings: { wght: 450 },
    textDecoration: 'underline',
  };
  validateScene(s);
  for (const mutate of [
    (n: any) => (n.text.resolvedFontFamily = 3),
    (n: any) => (n.text.fontUsage[0].glyphCount = -1),
    (n: any) => (n.text.variationSettings = { weight: 450 }),
    (n: any) => (n.text.textDecoration = 'unknown'),
  ]) {
    const copy = structuredClone(s);
    mutate(copy.screens[0].root);
    assert.throws(() => validateScene(copy));
  }
  const image = fixture();
  image.screens[0].root.image = {
    fit: 'none',
    position: [0.5, 0.5],
    positionOffset: [2, 3],
    contentBox: { x: 4, y: 4, width: 100, height: 100 },
  };
  validateScene(image);
  image.screens[0].root.image.contentBox.width = -1;
  assert.throws(() => validateScene(image));
});
test('rejects invalid versions, geometry and optional fields', () => {
  for (const mutate of [
    (s: any) => (s.version = 2),
    (s: any) => (s.screens[0].root.bounds.x = NaN),
    (s: any) => (s.screens[0].root.style.radius = [1, 2]),
    (s: any) => (s.screens[0].viewport.width = 1),
    (s: any) => (s.screens[0].root.layout = {}),
  ]) {
    const s = fixture();
    mutate(s);
    assert.throws(() => validateScene(s));
  }
});
test('rejects duplicate identifiers and unresolved references', () => {
  for (const mutate of [
    (s: any) => s.screens.push(s.screens[0]),
    (s: any) => s.screens[0].root.children.push({ ...s.screens[0].root, children: [] }),
    (s: any) =>
      s.issues.push({
        code: 'x',
        severity: 'warning',
        message: 'x',
        nodeId: 'missing',
        screenId: 'desktop',
      }),
    (s: any) => {
      s.screens[0].root.kind = 'image';
      s.screens[0].root.assetId = 'missing';
    },
  ]) {
    const s = fixture();
    mutate(s);
    assert.throws(() => validateScene(s));
  }
});
test('validates text UTF-16 runs and kind constraints', () => {
  const s = fixture();
  const n = s.screens[0].root;
  n.kind = 'text';
  n.text = {
    characters: 'Hi😀',
    fontFamily: 'Arial',
    fontStyle: 'Regular',
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
    align: 'left',
    direction: 'ltr',
    runs: [{ start: 0, end: 4 }],
  };
  validateScene(s);
  n.text.runs[0].end = 5;
  assert.throws(() => validateScene(s));
  n.text.runs = [];
  n.kind = 'frame';
  assert.throws(() => validateScene(s));
});
test('rejects non-JSON values, cycles and excessive depth', () => {
  const s = fixture();
  s.extra = undefined;
  assert.throws(() => validateScene(s));
  delete s.extra;
  s.extra = s;
  assert.throws(() => validateScene(s));
  delete s.extra;
  s.extra = new Date();
  assert.throws(() => validateScene(s));
  delete s.extra;
  let n = s.screens[0].root;
  for (let i = 0; i < 81; i++) {
    const c = { ...n, id: `n${i}`, children: [] };
    n.children = [c];
    n = c;
  }
  assert.throws(() => validateScene(s));
});
test('rejects asset mismatch, oversized counts and invalid issue scope', () => {
  const s = fixture();
  s.assets = [
    { id: 'a', kind: 'svg', mimeType: 'image/svg+xml', data: 'PHN2Zy8+', width: 1, height: 1 },
  ];
  s.screens[0].root.kind = 'image';
  s.screens[0].root.assetId = 'a';
  assert.throws(() => validateScene(s));
  const t = fixture();
  t.issues = Array.from({ length: 5001 }, () => ({ code: 'x', severity: 'info', message: 'x' }));
  assert.throws(() => validateScene(t));
  const u = fixture();
  u.issues = [{ code: 'x', severity: 'info', message: 'x', nodeId: 'root' }];
  assert.throws(() => validateScene(u));
});
test('enforces data and collection limits', () => {
  const cases = [
    (s: any) =>
      (s.assets = Array.from({ length: 301 }, (_, i) => ({
        id: String(i),
        kind: 'image',
        mimeType: 'image/png',
        data: '',
        width: 1,
        height: 1,
      }))),
    (s: any) =>
      (s.assets = [
        {
          id: 'a',
          kind: 'image',
          mimeType: 'image/png',
          data: 'A'.repeat(32 * 1024 * 1024 + 4),
          width: 1,
          height: 1,
        },
      ]),
    (s: any) =>
      (s.screens = Array.from({ length: 6 }, (_, i) => ({ ...s.screens[0], id: String(i) }))),
    (s: any) =>
      (s.screens[0].root.children = Array.from({ length: 12000 }, (_, i) => ({
        ...s.screens[0].root,
        id: String(i),
        children: [],
      }))),
  ];
  for (const mutate of cases) {
    const s = fixture();
    mutate(s);
    assert.throws(() => validateScene(s));
  }
});
test('rejects unsafe properties and non-finite optional numbers', () => {
  const s = fixture();
  s.extra = JSON.parse('{"__proto__":{}}');
  assert.throws(() => validateScene(s));
  delete s.extra;
  s.screens[0].root.style.shadow = [
    { color: { r: 0, g: 0, b: 0, a: 1 }, x: 0, y: 0, blur: Infinity, spread: 0 },
  ];
  assert.throws(() => validateScene(s));
});
