import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import { computeImagePlacement } from '../../src/core/image.js';

test('capture waits for initially hidden pages to reveal meaningful content', async () => {
  const scene = await captureHtml(
    '<body style="display:none"><p>Ready after hydration</p><script>setTimeout(()=>{document.body.style.display="block"},800)</script></body>',
    { widths: [390] },
  );
  assert.ok(
    flatten(scene.screens[0]!.root).some(
      (node) => node.text?.characters === 'Ready after hydration',
    ),
  );
});
test('capture waits through a visible loading shell before collecting delayed page content', async () => {
  const scene = await captureHtml(
    '<body><p>Loading</p><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend",\'<section style="height:1200px"><h1>Hydrated content</h1></section>\')},700)</script></body>',
    { widths: [390] },
  );
  assert.ok(flatten(scene.screens[0]!.root).some((n) => n.text?.characters === 'Hydrated content'));
  assert.ok(scene.screens[0]!.root.bounds.height >= 1200);
});

test('website language reaches Chromium navigator and source text without translation', async () => {
  for (const language of ['ar', 'en'] as const) {
    const scene = await captureHtml(
      '<body><p id="locale"></p><script>document.getElementById("locale").textContent=navigator.language.startsWith("ar")?"الصفحة العربية":"English page";</script></body>',
      { widths: [390], language },
    );
    assert.equal(scene.capture.language, language);
    const text = flatten(scene.screens[0]!.root).find((node) => node.source.key === 'locale')!.text!
      .characters;
    assert.equal(text, language === 'ar' ? 'الصفحة العربية' : 'English page');
  }
});

test('browser capture records actual font usage, measured normal line height, decorations and axes', async () => {
  const scene = await captureHtml(await readFile('fixtures/fidelity.html', 'utf8'), {
    widths: [390],
  });
  const nodes = flatten(scene.screens[0]!.root),
    normal = nodes.find((n) => n.source.key === 'normal')!;
  assert.ok(normal.text!.fontUsage?.length);
  assert.ok(
    normal.text!.fontUsage!.every(
      (font) => font.glyphCount > 0 && font.family !== 'Missing Fixture Font',
    ),
  );
  assert.equal(normal.text!.resolvedFontFamily, normal.text!.fontUsage![0]!.family);
  assert.ok(
    Math.abs(normal.text!.lineHeight - normal.bounds.height) < 1,
    'normal line height comes from a measured line box',
  );
  const details = nodes.find((n) => n.source.key === 'details')!.text!;
  assert.ok(
    details.runs!.some((run) => run.textDecoration === 'underline' && run.letterSpacing === 2),
  );
  assert.ok(details.runs!.some((run) => run.textDecoration === 'strikethrough'));
  assert.equal(nodes.find((n) => n.source.key === 'variation')!.text!.variationSettings?.wght, 550);
});

test('captured crop geometry reproduces browser pixels for cover, contain, padded, none, scale-down and fill', async () => {
  const scene = await captureHtml(await readFile('fixtures/fidelity.html', 'utf8'), {
    widths: [390],
  });
  const screen = scene.screens[0]!,
    nodes = flatten(screen.root),
    assets = new Map(scene.assets.map((a) => [a.id, a]));
  const reference = await sharp(Buffer.from(screen.screenshot!, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let samples = 0;
  for (const id of ['cover', 'contain', 'padded', 'none', 'small', 'fill']) {
    const node = nodes.find((n) => n.source.key === id)!;
    const asset = assets.get(node.assetId!)!;
    const placement = computeImagePlacement(node.bounds, asset, node.image!);
    assert.equal(node.image!.fit, id === 'small' ? 'scale-down' : id === 'padded' ? 'cover' : id);
    const bitmap = await sharp(Buffer.from(asset.data, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const [fx, fy] of [
      [0.15, 0.15],
      [0.5, 0.5],
      [0.85, 0.85],
      [0.15, 0.85],
      [0.85, 0.15],
    ]) {
      const x = Math.floor(placement.content.x + placement.content.width * fx!),
        y = Math.floor(placement.content.y + placement.content.height * fy!);
      const u = (x - placement.x) / placement.width,
        v = (y - placement.y) / placement.height;
      let expected: number[];
      if (u < 0 || u >= 1 || v < 0 || v >= 1) expected = [210, 220, 230];
      else {
        const index =
          (Math.min(bitmap.info.height - 1, Math.floor(v * bitmap.info.height)) *
            bitmap.info.width +
            Math.min(bitmap.info.width - 1, Math.floor(u * bitmap.info.width))) *
          4;
        expected = Array.from(bitmap.data.subarray(index, index + 3));
      }
      const px = Math.floor(node.bounds.x - screen.root.bounds.x + x),
        py = Math.floor(node.bounds.y - screen.root.bounds.y + y),
        index = (py * reference.info.width + px) * 4;
      const actual = Array.from(reference.data.subarray(index, index + 3));
      assert.ok(
        actual.every((value, c) => Math.abs(value - expected[c]!) <= 2),
        `${id} sample ${x},${y}: ${actual} vs ${expected}`,
      );
      samples++;
    }
  }
  assert.equal(samples, 30);
  const padded = nodes.find((n) => n.source.key === 'padded')!.image!;
  assert.deepEqual(padded.positionOffset, [-12, 8]);
  assert.deepEqual(padded.contentBox, { x: 14, y: 14, width: 212, height: 152 });
});

test('unsupported grid placement and reversed flex preserve measured positions; width limits survive capture', async () => {
  const scene = await captureHtml(
    `<body style="margin:0"><main id="limits" style="display:flex;flex-direction:column;min-width:200px;max-width:350px"><section id="span" style="display:grid;grid-template-columns:repeat(2,1fr)"><article style="grid-column:span 2">Wide</article><article>Next</article></section><section id="reverse" style="display:flex;flex-direction:row-reverse"><span>A</span><span>B</span></section><section id="box" style="box-sizing:content-box;min-width:100px;max-width:200px;padding:10px;border:2px solid">Box</section><section id="conflict" style="min-width:200px;max-width:150px"><div>Conflict</div></section></main></body>`,
    { widths: [390] },
  );
  const nodes = flatten(scene.screens[0]!.root),
    limits = nodes.find((n) => n.source.key === 'limits')!;
  assert.equal(limits.layout!.minWidth, 200);
  assert.equal(limits.layout!.maxWidth, 350);
  // Decorated leaf boxes still expose layout limits even with a single text child.
  const box = nodes.find((n) => n.source.key === 'box')!;
  assert.equal(box.layout!.minWidth, 124);
  assert.equal(box.layout!.maxWidth, 224);
  const conflict = nodes.find((n) => n.source.key === 'conflict')!;
  assert.equal(conflict.layout!.minWidth, 200);
  assert.equal(conflict.layout!.maxWidth, 200);
  for (const key of ['span', 'reverse']) {
    const node = nodes.find((n) => n.source.key === key)!;
    assert.equal(node.layout!.mode, 'none');
    assert.ok(
      scene.issues.some(
        (issue) => issue.nodeId === node.id && issue.code === 'layout-fixed-unsupported',
      ),
    );
  }
});
