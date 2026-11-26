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
