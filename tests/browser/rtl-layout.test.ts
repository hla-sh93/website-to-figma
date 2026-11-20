import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import { deriveLayout } from '../../src/plugin/renderer.js';
import type { SceneNode } from '../../src/core/scene.js';

const html = `<!doctype html><html dir="rtl" lang="ar"><head><style>
body{margin:0;font:16px Arial}
#row{display:flex;gap:12px;padding:8px}
#row a{display:block;width:80px;height:30px;background:rgb(200,200,200)}
#grid{display:grid;grid-template-columns:repeat(3,100px);gap:10px;width:320px}
#grid .cell{height:60px;background:rgb(0,120,200)}
#grid .sentinel{grid-column:1/-1;height:0}
</style></head><body>
<nav id="row"><a href="#">الرئيسية</a><a href="#">المنتجات</a><a href="#">السلة</a></nav>
<div id="grid"><div class="cell">1</div><div class="cell">2</div><div class="cell">3</div><div class="cell">4</div><div class="cell">5</div><div class="sentinel"></div></div>
<section id="col"><p>نص</p><p>نص آخر</p></section>
<div id="badge-host" style="position:relative;height:40px"><span id="badge" style="position:absolute;right:8px;top:4px;padding:4px 10px;background:rgb(200,0,0)">آخر قطعة</span></div>
</body></html>`;

const scene = await captureHtml(html, { widths: [390] });
const nodes = flatten(scene.screens[0]!.root);
const byKey = (key: string): SceneNode => {
  const found = nodes.find((n) => n.source.key === key);
  assert.ok(found, `missing ${key}`);
  return found;
};

test('right-to-left rows keep auto layout with children in visual order', () => {
  const row = byKey('row');
  const xs = row.children.map((c) => c.bounds.x);
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b),
  );
  // flex-start in RTL packs items to the right edge.
  assert.equal(row.layout?.justify, 'end');
  assert.equal(deriveLayout(row).mode, 'horizontal');
  assert.equal(row.name, 'Navigation');
  assert.match(row.children[0]!.name, /^Link \/ السلة/);
});

test('empty grid sentinels do not turn a grid into fixed positions', () => {
  const grid = byKey('grid');
  assert.equal(grid.layout?.mode, 'grid');
  assert.equal(grid.layout?.columns, 3);
  const cells = grid.children.map((c) => [Math.round(c.bounds.y), Math.round(c.bounds.x)]);
  assert.deepEqual(
    cells,
    [...cells].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!),
  );
});

test('right-to-left columns align to the right and free absolute badges hug', () => {
  assert.equal(byKey('col').layout?.align, 'end');
  assert.equal(byKey('badge').layout?.widthSizing, 'hug');
  // The label flows inside the positioned badge.
  assert.equal(byKey('badge').children[0]?.position, 'flow');
});
