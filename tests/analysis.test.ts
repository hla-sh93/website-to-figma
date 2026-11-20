import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScene } from '../src/core/analysis.js';
import type { SceneNode, ScenePackage } from '../src/core/scene.js';
const frame = (id: string, name = 'Card'): SceneNode => ({
  id,
  name,
  kind: 'frame',
  source: { tag: 'article', key: id },
  bounds: { x: 0, y: 0, width: 200, height: 100 },
  style: { opacity: 1 },
  children: [
    {
      id: id + '/t',
      name: 'Heading',
      kind: 'text',
      source: { tag: 'h3' },
      bounds: { x: 10, y: 10, width: 180, height: 24 },
      style: { opacity: 1 },
      children: [],
      text: {
        characters: id,
        fontFamily: 'Inter',
        fontStyle: 'Regular',
        fontWeight: 400,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: 0,
        color: { r: 0, g: 0, b: 0, a: 1 },
        align: 'left',
        direction: 'ltr',
      },
    },
  ],
});
function sample(): ScenePackage {
  const root = frame('root', 'Root');
  root.source.tag = 'body';
  root.children = [frame('card1'), frame('card2')];
  return {
    version: 1,
    capture: {
      id: 'x',
      url: 'https://example.com',
      title: 'Test',
      capturedAt: '2026-10-29',
      engine: 'test',
    },
    screens: [
      { id: 'desktop', viewport: { width: 1440, height: 900, dpr: 1 }, root },
      { id: 'mobile', viewport: { width: 390, height: 900, dpr: 1 }, root: structuredClone(root) },
    ],
    assets: [],
    issues: [],
  };
}
test('finds repeated component candidates without merging a parent with its descendants', () => {
  const r = analyzeScene(sample());
  assert.ok(
    r.components.some(
      (c) => c.members.length === 2 && c.members.every((m) => m.sourceId.startsWith('card')),
    ),
  );
});
test('reports observed responsive changes, not invented breakpoint thresholds', () => {
  const s = sample();
  s.screens[1]!.root.children.pop();
  const r = analyzeScene(s);
  assert.ok(r.responsive.some((c) => c.kind === 'visibility'));
  assert.ok(r.responsive.every((c) => c.observedAt.length > 0));
});

test('does not merge rich text into a component property that would lose styled ranges', () => {
  const s = sample();
  for (const screen of s.screens) {
    const text = screen.root.children[1]!.children[0]!.text!;
    text.runs = [{ start: 0, end: 2, fontWeight: 700 }];
  }
  assert.equal(analyzeScene(s).components.length, 0);
});

test('keeps decorated, spaced and variable rich text out of plain text component properties', () => {
  for (const run of [
    { textDecoration: 'underline' as const },
    { letterSpacing: 2 },
    { lineHeight: 30 },
    { variationSettings: { wght: 550 } },
  ]) {
    const s = sample();
    for (const screen of s.screens)
      for (const card of screen.root.children)
        card.children[0]!.text!.runs = [{ start: 0, end: 2, ...run }];
    assert.equal(analyzeScene(s).components.length, 0, JSON.stringify(run));
  }
});

test('font evidence glyph counts do not create separate component families', () => {
  const s = sample();
  for (const screen of s.screens)
    screen.root.children.forEach((card, i) => {
      const text = card.children[0]!.text!;
      text.resolvedFontFamily = 'Inter';
      text.fontUsage = [
        { family: 'Inter', postScriptName: 'Inter-Regular', glyphCount: i + 1, isCustomFont: true },
      ];
    });
  assert.equal(analyzeScene(s).components.length, 2);
  s.screens[0]!.root.children[1]!.children[0]!.text!.variationSettings = { wght: 550 };
  assert.equal(analyzeScene(s).components.length, 1);
});

test('preserves distinct image assets and crop settings instead of replacing them with the first image', () => {
  for (const variant of ['asset', 'crop'] as const) {
    const s = sample();
    for (const screen of s.screens) {
      screen.root.children.forEach((card, index) => {
        card.children.push({
          id: card.id + '/image',
          name: 'Photo',
          kind: 'image',
          source: { tag: 'img' },
          bounds: { x: 0, y: 30, width: 200, height: 70 },
          style: { opacity: 1 },
          children: [],
          assetId: variant === 'asset' ? `photo-${index}` : 'same-photo',
          image: {
            fit: 'cover',
            position: variant === 'crop' && index === 1 ? [0, 0] : [0.5, 0.5],
          },
        });
      });
    }
    assert.equal(analyzeScene(s).components.length, 0, variant);
  }
});

test('selects outer repeated families without also replacing their nested buttons', () => {
  const s = sample();
  for (const screen of s.screens)
    for (const card of screen.root.children) {
      const button = frame(card.id + '/button', 'Button');
      button.source.tag = 'button';
      card.children.push(button);
    }
  const candidates = analyzeScene(s).components;
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.members.every((m) => /^card[12]$/.test(m.sourceId))));
});

test('keeps different text alignment and italic styles out of the same family', () => {
  for (const property of ['align', 'fontStyle'] as const) {
    const s = sample();
    for (const screen of s.screens) {
      const text = screen.root.children[1]!.children[0]!.text!;
      if (property === 'align') text.align = 'right';
      else text.fontStyle = 'Italic';
    }
    assert.equal(analyzeScene(s).components.length, 0, property);
  }
});
