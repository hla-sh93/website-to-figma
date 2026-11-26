import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import type { SceneNode } from '../../src/core/scene.js';

const html = `<!doctype html><html><head><style>
:root{--color-primary:#0a66c2;--brand-accent:rgb(255, 90, 0);--surface:220 20% 96%;--space-4:16px;--font:Arial}
body{margin:0;font:16px Arial}
#bar{display:flex;width:600px}
#logo{width:120px;height:80px;background:rgb(0,0,0)}
#search{flex:1;background:var(--color-primary)}
#side{width:100px;background:rgb(0,120,200)}
#top{width:100px;height:20px;align-self:flex-start;background:rgb(200,0,0)}
@keyframes rise{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}
#hero{width:300px;height:100px;background:rgb(0,160,80);animation:rise 1.2s ease-out both}
</style></head><body>
<div id="bar"><div id="logo"></div><div id="search"></div><div id="side"></div><div id="top"></div></div>
<div id="hero">Ready</div>
<p id="copy" style="width:200px;margin:0;font:16px/20px Arial">One two three four five six seven <b>eight nine</b> ten eleven twelve thirteen</p>
<p id="short" style="width:200px;margin:0">One line</p>
</body></html>`;

const scene = await captureHtml(html, { widths: [800] });
const nodes = flatten(scene.screens[0]!.root);
const byKey = (key: string): SceneNode => {
  const found = nodes.find((n) => n.source.key === key);
  assert.ok(found, `missing ${key}`);
  return found;
};

test('flex-grow and stretch are recorded as authored intent', () => {
  assert.equal(byKey('search').layout?.grow, true);
  assert.equal(byKey('logo').layout?.grow, undefined);
  assert.equal(byKey('side').layout?.stretch, true);
  // Fixed height or its own alignment: not stretched.
  assert.equal(byKey('logo').layout?.stretch, undefined);
  assert.equal(byKey('top').layout?.stretch, undefined);
});

test('an entrance animation is captured at its final state', () => {
  const hero = byKey('hero');
  assert.equal(hero.style.opacity, 1);
  assert.equal(hero.bounds.y, 80);
});

test('colour custom properties are captured as named tokens', () => {
  const tokens = Object.fromEntries(scene.tokens!.colors.map((t) => [t.name, t.value]));
  assert.deepEqual(Object.keys(tokens), ['primary', 'brand-accent', 'surface']);
  assert.equal(Math.round(tokens.primary!.b * 255), 194);
  assert.equal(Math.round(tokens['brand-accent']!.r * 255), 255);
  // "220 20% 96%" is read as hsl().
  assert.ok(tokens.surface!.r > 0.9 && tokens.surface!.b > tokens.surface!.r);
});

test('line breaks of the browser are recorded for copy on several lines', () => {
  const copy = nodes.find((n) => n.text?.characters.startsWith('One two three'))!;
  const text = copy.text!;
  assert.ok(text.lines! >= 3);
  assert.equal(text.breaks!.length, text.lines! - 1);
  // Every break starts a word, right after the space that ended the line before.
  for (const offset of text.breaks!) {
    assert.equal(text.characters[offset - 1], ' ');
    assert.match(text.characters[offset]!, /\S/);
  }
  assert.equal(nodes.find((n) => n.text?.characters === 'One line')!.text!.breaks, undefined);
});
