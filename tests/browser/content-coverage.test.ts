import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import { computeImagePlacement } from '../../src/core/image.js';
const image =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>',
  );
test('visible images survive zero-size and display-contents ancestors', async () => {
  const scene = await captureHtml(
    `<body><section style="position:relative;height:100px"><picture style="display:contents"><img src="${image}" width="120" height="80"></picture></section><section style="position:relative;height:100px"><span style="display:block;width:0;height:0"><img style="position:absolute;left:20px;top:0" src="${image}" width="120" height="80"></span></section></body>`,
    { widths: [390] },
  );
  assert.equal(flatten(scene.screens[0]!.root).filter((n) => n.kind === 'image').length, 2);
});
test('a visible video poster is retained as a disclosed static media image', async () => {
  const scene = await captureHtml(
    `<body><video data-figma-id="hero-video" width="120" height="80" poster="${image}"></video></body>`,
    { widths: [390] },
  );
  const video = flatten(scene.screens[0]!.root).find((n) => n.source.key === 'hero-video')!;
  assert.equal(video.kind, 'image');
  assert.ok(scene.assets.some((a) => a.id === video.assetId));
  assert.ok(scene.issues.some((i) => i.code === 'media-static-frame'));
});
test('clipped screen-reader copies are excluded from editable visible text', async () => {
  const scene = await captureHtml(
    '<body><p><span style="position:absolute;width:1px;height:1px;clip:rect(1px,1px,1px,1px);overflow:hidden">Fashion</span><span>Fashion</span><span style="visibility:hidden">Hidden</span></p></body>',
    { widths: [390] },
  );
  assert.equal(
    flatten(scene.screens[0]!.root)
      .filter((n) => n.text)
      .map((n) => n.text!.characters)
      .join(''),
    'Fashion',
  );
});
test('a fully clipped positioned navigation region is excluded even when its box is large', async () => {
  const scene = await captureHtml(
    '<body><p>Home</p><div style="position:absolute;width:250px;height:40px;clip:rect(0px,0px,0px,0px)">Hidden navigation links</div></body>',
    { widths: [390] },
  );
  assert.ok(
    !flatten(scene.screens[0]!.root).some((n) => n.text?.characters.includes('Hidden navigation')),
  );
});
test('zero-height wrappers with clipping do not reveal hidden navigation text', async () => {
  const scene = await captureHtml(
    '<body><p>Home</p><div style="width:250px;height:0;overflow-x:visible;overflow-y:clip"><div style="height:40px">Clipped navigation</div></div></body>',
    { widths: [390] },
  );
  assert.ok(
    !flatten(scene.screens[0]!.root).some((n) => n.text?.characters.includes('Clipped navigation')),
  );
});
test('single-line product captions retain their ellipsis behavior', async () => {
  const scene = await captureHtml(
    '<body><p style="width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A long product caption which is clipped</p></body>',
    { widths: [390] },
  );
  const caption = flatten(scene.screens[0]!.root).find((n) =>
    n.text?.characters.startsWith('A long product'),
  )!;
  assert.equal(caption.text!.maxLines, 1);
});
test('CSS background photos and scaled icon sprites become editable image layers', async () => {
  const sprite =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="red"/><rect x="120" width="120" height="120" fill="blue"/></svg>',
    );
  const scene = await captureHtml(
    `<style>body{margin:0}.hero{width:120px;height:80px;background-image:url("${sprite}");background-size:cover;background-position:center;background-repeat:no-repeat}.sprite{width:30px;height:30px;background-image:url("${sprite}");background-size:120px 60px;background-position:-60px 0;background-repeat:repeat-x}</style><body><section class="hero" data-figma-id="hero"><h1>Home</h1></section><span class="sprite" style="display:block" data-figma-id="sprite"></span></body>`,
    { widths: [390] },
  );
  const nodes = flatten(scene.screens[0]!.root);
  for (const key of ['hero', 'sprite']) {
    const frame = nodes.find((n) => n.source.key === key)!;
    const bg = frame.children.find((n) => n.source.tag === '#background')!;
    assert.ok(bg, 'Missing ' + key + ' background');
    assert.equal(bg.kind, 'image');
    assert.equal(bg.position, 'absolute');
    assert.ok(scene.assets.some((a) => a.id === bg.assetId));
  }
  const bg = nodes
    .find((n) => n.source.key === 'sprite')!
    .children.find((n) => n.source.tag === '#background')!;
  const asset = scene.assets.find((a) => a.id === bg.assetId)!;
  const placement = computeImagePlacement(bg.bounds, asset, bg.image!);
  assert.equal(placement.width, 120);
  assert.equal(placement.height, 60);
  assert.equal(placement.x, -60);
  assert.ok(nodes.some((n) => n.text?.characters === 'Home'));
});
test('recognized cookie rejection reveals homepage content and positioned titles retain stacking', async () => {
  const scene = await captureHtml(
    '<body><section style="position:relative;width:300px;height:100px"><h1 style="position:absolute;z-index:2">Home title</h1><div style="height:100px;background:red"></div></section><aside id="sp-cc" style="position:fixed;inset:0;background:white;z-index:999"><button id="sp-cc-rejectall-link" onclick="this.parentElement.remove()">Decline</button></aside></body>',
    { widths: [390] },
  );
  const nodes = flatten(scene.screens[0]!.root);
  assert.ok(!nodes.some((n) => n.source.key === 'sp-cc'));
  assert.equal(nodes.find((n) => n.text?.characters === 'Home title')!.style.zIndex, 2);
});
