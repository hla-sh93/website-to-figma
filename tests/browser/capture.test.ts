import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureHtml, captureUrl } from '../../src/capture/capture.js';
import { validateScene, type SceneNode } from '../../src/core/scene.js';
import { analyzeScene } from '../../src/core/analysis.js';
const html = await readFile(new URL('../../fixtures/reference.html', import.meta.url), 'utf8');
const walk = (n: SceneNode): SceneNode[] => [n, ...n.children.flatMap(walk)];

test('captured nested families and distinct photographs remain safe to componentize', async () => {
  const html = await readFile(
    new URL('../../fixtures/component-regression.html', import.meta.url),
    'utf8',
  );
  const scene = await captureHtml(html, { widths: [390] });
  const analysis = analyzeScene(scene);
  assert.equal(analysis.components.length, 1);
  const nodes = new Map(walk(scene.screens[0]!.root).map((node) => [node.id, node]));
  assert.deepEqual(
    analysis.components[0]!.members.map((member) => nodes.get(member.sourceId)!.source.key),
    ['nested-a', 'nested-b'],
  );
  const images = [...nodes.values()].filter((node) => node.kind === 'image');
  assert.equal(images.length, 2);
  assert.equal(new Set(images.map((image) => image.assetId)).size, 2);
});
test('real Chromium preserves responsive editable fixture and assets', async () => {
  const scene = await captureHtml(html);
  validateScene(scene);
  assert.match(scene.capture.title, /Forma/);
  assert.equal(scene.screens.length, 2);
  for (const screen of scene.screens) {
    const nodes = walk(screen.root),
      texts = nodes.filter((n) => n.text).map((n) => n.text!);
    assert.equal(texts.filter((t) => t.characters.startsWith('Bring your plans')).length, 1);
    assert.ok(texts.some((t) => t.characters === 'Big ideas.\nClear space.'));
    assert.ok(texts.some((t) => t.characters.includes('عمل أوضح، وإبداع أكبر.')));
    assert.equal(
      texts.find((t) => t.characters.includes('عمل أوضح، وإبداع أكبر.'))!.align,
      'right',
    );
    assert.ok(texts.some((t) => t.runs?.some((r) => (r.fontWeight ?? 0) >= 700)));
    assert.ok(
      nodes.some(
        (n) => n.source.key === (screen.viewport.width === 390 ? 'mobile-menu' : 'desktop-nav'),
      ),
    );
    assert.ok(
      !nodes.some(
        (n) => n.source.key === (screen.viewport.width === 390 ? 'desktop-nav' : 'mobile-menu'),
      ),
    );
    assert.equal(
      nodes.find((n) => n.name === 'cards')?.layout?.columns,
      screen.viewport.width === 390 ? 1 : 3,
    );
    assert.equal(Buffer.from(screen.screenshot!, 'base64').subarray(1, 4).toString(), 'PNG');
  }
  assert.ok(scene.assets.some((a) => a.kind === 'image'));
  assert.ok(scene.assets.some((a) => a.kind === 'svg'));
  const repeat = await captureHtml(html, { widths: [390] });
  const a = walk(scene.screens[1]!.root),
    b = walk(repeat.screens[0]!.root);
  assert.equal(a.length, b.length);
  a.forEach((n, i) => assert.ok(Math.abs(n.bounds.y - b[i]!.bounds.y) < 1));
  const region = await captureHtml(html, { widths: [390], selector: '#features' });
  assert.ok(walk(region.screens[0]!.root).some((n) => n.source.key === 'features'));
});
test('viewport validation and cancellation are bounded', async () => {
  await assert.rejects(captureHtml(html, { widths: [1] }), /width/i);
  await assert.rejects(captureUrl('http://127.0.0.1'), /public|local/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(captureHtml(html, { signal: controller.signal }), /abort/i);
  const active = new AbortController();
  const pending = captureHtml(html, { signal: active.signal, onProgress: () => active.abort() });
  await assert.rejects(pending, /abort|closed/i);
  await assert.rejects(captureHtml(html, { widths: [390], selector: '#missing' }), /selector/i);
});
test('owned fixture resources and executable SVG content are blocked', async () => {
  const scene = await captureHtml(
    '<html><body><p>Owned only</p><img src="http://127.0.0.1/private"><svg width="20" height="20" onload="fetch(\'http://127.0.0.1/blocked\')"><script>fetch("https://example.com")</script><foreignObject>unsafe</foreignObject><rect width="20" height="20" fill="red"/></svg></body></html>',
    { widths: [390] },
  );
  const svg = scene.assets.find((a) => a.kind === 'svg');
  assert.ok(svg);
  assert.doesNotMatch(Buffer.from(svg.data, 'base64').toString(), /script|foreignObject|onload/);
  assert.ok(scene.issues.some((i) => i.code === 'missing-asset'));
});

test('decorated text, mixed assets, sizing, shadows and SVG image pixels retain semantics', async () => {
  const scene = await captureHtml(html, { widths: [390] });
  const nodes = walk(scene.screens[0]!.root);
  const cta = nodes.find((n) => n.source.key === 'hero-cta')!;
  assert.equal(cta.kind, 'frame');
  assert.ok(cta.children[0]!.bounds.x > cta.bounds.x);
  assert.equal(cta.children[0]!.style.background, undefined);
  const visible = nodes
    .filter((n) => n.text)
    .map((n) => n.text!.characters)
    .join(' ');
  for (const expected of [
    'forma',
    'Find your flow ↗',
    'Start your free trial ↗',
    'Privacy',
    'عمل أوضح، وإبداع أكبر.',
    '© 2026 Forma.',
  ])
    assert.ok(visible.includes(expected), expected);
  assert.ok(nodes.some((n) => n.style.shadow?.length));
  assert.ok(nodes.some((n) => n.layout?.widthSizing === 'fill'));
  assert.ok(nodes.some((n) => n.layout?.heightSizing === 'hug'));
  const image = scene.assets.find((a) => a.kind === 'image')!;
  assert.equal(image.mimeType, 'image/png');
  const sharp = (await import('sharp')).default;
  const pixels = await sharp(Buffer.from(image.data, 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(pixels.info.width > 0 && pixels.info.height > 0);
  assert.ok(pixels.data.some((v) => v > 0));
});
test('capture cap excludes unseen geometry and rejects a continuously moving layout', async () => {
  const scene = await captureHtml(
    '<body style="margin:0"><div style="height:17000px;background:red">Tall</div></body>',
    { widths: [390] },
  );
  assert.equal(scene.screens[0]!.root.bounds.height, 16000);
  await assert.rejects(
    captureHtml('<div id="off" style="position:absolute;top:17000px">Offscreen</div>', {
      widths: [390],
      selector: '#off',
    }),
    /visible|covered/i,
  );
  await assert.rejects(
    captureHtml(
      '<div id="move" style="position:absolute;width:50px;height:50px">Move</div><script>let x=0;setInterval(()=>document.getElementById("move").style.left=(++x%100)+"px",30)</script>',
      { widths: [390] },
    ),
    /لم يستقر|تغيّر/,
  );
});

test('reference frame covers the screenshot viewport including default body margins and ancestor background', async () => {
  const scene = await captureHtml(
    '<body style="background:rgb(242,244,239)"><section id="part"><p>One line</p></section></body>',
    { widths: [390] },
  );
  assert.equal(scene.screens[0]!.root.bounds.x, 0);
  assert.equal(scene.screens[0]!.root.bounds.width, 390);
  const selected = await captureHtml(
    '<body style="background:rgb(242,244,239)"><section id="part"><p>One line</p></section></body>',
    { widths: [390], selector: '#part' },
  );
  assert.ok(selected.screens[0]!.root.style.background!.a === 1);
  assert.ok(selected.screens[0]!.root.style.background!.g > 0.9);
});
