import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import type { SceneNode } from '../../src/core/scene.js';

// A page that behaves like sites behind a speed plugin and a scroll-animation library:
// its script runs only after real pointer input, one section is built when the visitor
// scrolls near it, the page colour follows the scroll, and one section is pinned.
const html = `<!doctype html><html><head><style>
body{margin:0;font:16px/20px Arial;background:rgb(255,255,255)}
section{height:700px}
#dark{color:rgb(255,255,255)}
.pin-spacer{height:2400px;padding-bottom:1500px;box-sizing:border-box}
#pinned{height:500px;background:rgb(230,230,230)}
#title{width:300px;font:32px/40px Arial}
#title h2{display:inline-block;margin:0;font:inherit}
</style></head><body>
<section id="first">First</section>
<section id="dark"><div id="title"><h2>A heading that needs two lines here</h2></div></section>
<div class="pin-spacer"><div id="pinned">Pinned</div></div>
<div id="slot"></div>
<script>
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    addEventListener('scroll', () => {
      document.body.style.backgroundColor = scrollY > 400 && scrollY < 1300 ? 'rgb(0, 19, 115)' : 'rgb(255, 255, 255)';
      if (scrollY > 900 && !document.getElementById('late')) {
        const late = document.createElement('section');
        late.id = 'late';
        late.textContent = 'Built on scroll';
        document.getElementById('slot').append(late);
      }
    });
  };
  for (const type of ['mousemove', 'wheel', 'keydown', 'touchstart']) addEventListener(type, start, { once: true });
</script>
</body></html>`;

const scene = await captureHtml(html, { widths: [1000] });
const nodes = flatten(scene.screens[0]!.root);
const byKey = (key: string): SceneNode | undefined => nodes.find((n) => n.source.key === key);

test('scripts held back until real input run, and sections built on scroll are captured', () => {
  assert.ok(byKey('late'), 'the section built on scroll is missing');
  assert.ok(nodes.some((n) => n.text?.characters === 'Built on scroll'));
});

test('a band shown on a scroll-driven page colour keeps that colour', () => {
  const dark = byKey('dark')!.style.background!;
  assert.deepEqual(
    [dark.r, dark.g, dark.b].map((v) => Math.round(v * 255)),
    [0, 19, 115],
  );
  assert.equal(byKey('first')!.style.background?.a ?? 0, 0);
});

test('a pinned section does not leave its scroll distance as empty space', () => {
  const spacer = nodes.find((n) => n.children.some((c) => c.source.key === 'pinned'))!;
  assert.ok(spacer.bounds.height < 600, `spacer is ${spacer.bounds.height} tall`);
});

test('lines inside an inline-block heading are counted', () => {
  const heading = nodes.find((n) => n.text?.characters.startsWith('A heading'))!;
  assert.equal(heading.text!.lines, 2);
  assert.ok(heading.bounds.height >= 70);
});

test('a highlighted phrase and a border underline inside copy become boxes behind it', async () => {
  const page = `<!doctype html><html><head><style>
  body{margin:0;font:20px/30px Arial}
  h1{margin:0;width:260px;font:20px/30px Arial}
  .highlight{background:rgb(124,76,219);border-radius:5px;padding:0 4px}
  .underline{border-bottom:3px solid rgb(0,150,90)}
  </style></head><body><h1>Plain <span class="highlight">marked words that wrap onto two lines</span> and <span class="underline">lined</span></h1></body></html>`;
  const all = flatten((await captureHtml(page, { widths: [800] })).screens[0]!.root);
  const title = all.find((n) => n.children.some((c) => c.text?.characters.startsWith('Plain')))!;
  const highlights = title.children.filter((c) => c.name === 'Highlight');
  const underline = title.children.filter((c) => c.name === 'Underline');
  // One box per line of the phrase, behind the copy (earlier in the children).
  assert.equal(highlights.length, 2);
  assert.deepEqual(
    [highlights[0]!.style.background!.r, highlights[0]!.style.background!.g].map((v) =>
      Math.round(v * 255),
    ),
    [124, 76],
  );
  assert.equal(highlights[0]!.style.radius?.[0], 5);
  assert.equal(underline.length, 1);
  assert.equal(Math.round(underline[0]!.bounds.height), 3);
  assert.equal(title.children.at(-1)!.kind, 'text');
  assert.ok(highlights.every((h) => h.position === 'absolute'));
});

test('a box keeps the height its style rules give it, whatever fills it', async () => {
  const page = `<!doctype html><html><head><style>
  body{margin:0;font:16px/20px Arial}
  .item{width:400px;aspect-ratio:1/1}
  .card{height:100%;box-sizing:border-box;padding:32px;display:flex;flex-direction:column;justify-content:space-between;background:rgb(124,76,219)}
  .fixed{height:120px;display:flex;flex-direction:column;justify-content:space-between}
  .free{display:flex;flex-direction:column}
  </style></head><body>
  <div class="item" id="item"><div class="card" id="card"><div id="badge">01</div><div id="copy">Proven Clients</div></div></div>
  <div class="fixed" id="fixed"><span>a</span><span>b</span></div>
  <div class="free" id="free"><span>a</span><span>b</span></div>
  </body></html>`;
  const all = flatten((await captureHtml(page, { widths: [800] })).screens[0]!.root);
  const key = (k: string) => all.find((n) => n.source.key === k)!;
  assert.equal(key('item').bounds.height, 400);
  assert.equal(key('item').layout!.heightSizing, 'fixed');
  assert.equal(key('card').layout!.heightSizing, 'fixed');
  assert.equal(key('fixed').layout!.heightSizing, 'fixed');
  // No rule gives this one a height: it is as tall as its content.
  assert.equal(key('free').layout!.heightSizing, 'hug');
});

test('a stretched column that spreads its children keeps its height', async () => {
  const page = `<!doctype html><html><head><style>
  body{margin:0;font:16px/20px Arial}
  .item{width:400px;height:400px;display:flex}
  .card{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:32px}
  </style></head><body><div class="item" id="item"><div class="card" id="card"><div>01</div><div>Proven Clients</div></div></div></body></html>`;
  const all = flatten((await captureHtml(page, { widths: [800] })).screens[0]!.root);
  const card = all.find((n) => n.source.key === 'card')!;
  assert.equal(card.bounds.height, 400);
  assert.equal(card.layout!.heightSizing, 'fixed');
});
