import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import type { SceneNode } from '../../src/core/scene.js';

const html = `<!doctype html><html><head><style>
body{margin:0;font:16px Arial}
#bar{display:flex;width:600px}
#logo{width:120px;height:80px;background:rgb(0,0,0)}
#search{flex:1;background:rgb(220,220,220)}
#side{width:100px;background:rgb(0,120,200)}
#top{width:100px;height:20px;align-self:flex-start;background:rgb(200,0,0)}
@keyframes rise{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}
#hero{width:300px;height:100px;background:rgb(0,160,80);animation:rise 1.2s ease-out both}
</style></head><body>
<div id="bar"><div id="logo"></div><div id="search"></div><div id="side"></div><div id="top"></div></div>
<div id="hero">Ready</div>
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
