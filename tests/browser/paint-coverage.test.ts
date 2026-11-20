import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { captureHtml } from '../../src/capture/capture.js';
import { flatten } from '../../src/core/analysis.js';
import type { SceneNode } from '../../src/core/scene.js';

const jpeg = await sharp({
  create: { width: 64, height: 32, channels: 3, background: { r: 200, g: 80, b: 40 } },
})
  .jpeg({ quality: 80 })
  .toBuffer();

const html = `<!doctype html><html><head><style>
body{margin:0;font:16px Arial}
.box{width:200px;height:80px;margin:10px}
#linear{background:linear-gradient(to right, rgb(255,0,0), rgb(0,0,255))}
#angle{background:linear-gradient(45deg, rgb(255,0,0) 10%, rgb(0,255,0) 50%, rgb(0,0,255))}
#radial{background:radial-gradient(circle at 25% 50%, rgb(255,255,0), rgb(0,0,0) 60px)}
#conic{background:conic-gradient(from 90deg, rgb(255,0,0), rgb(0,0,255))}
#overlay{background:linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0)), url("data:image/jpeg;base64,${jpeg.toString('base64')}") center/cover}
#rule{border-bottom:3px dashed rgb(10,20,30)}
#shadows{box-shadow:rgba(0,0,0,0.2) 0 4px 6px -1px, rgb(255,0,0) 0 0 0 2px inset}
#blurred{filter:blur(4px);background:rgb(0,128,0)}
#glass{backdrop-filter:blur(10px);background:rgba(255,255,255,0.4)}
#card{position:relative;background:rgb(240,240,240)}
#card::before{content:"";position:absolute;left:10px;top:5px;width:40px;height:4px;background:rgb(255,0,0)}
#link::after{content:" \\2192"}
#icon::before{content:"★";color:rgb(250,180,0)}
#rotated{width:60px;height:20px;background:rgb(0,0,0);transform:rotate(30deg);margin:40px}
#upper{text-transform:uppercase}
#shadowed{text-shadow:rgb(0,0,0) 1px 2px 3px}
#gradient-text{background:linear-gradient(90deg, rgb(255,0,0), rgb(0,0,255));-webkit-background-clip:text;background-clip:text;color:transparent;font-size:32px}
</style></head><body>
<div id="linear" class="box"></div>
<div id="angle" class="box"></div>
<div id="radial" class="box"></div>
<div id="conic" class="box"></div>
<div id="overlay" class="box"></div>
<div id="rule" class="box"></div>
<div id="shadows" class="box"></div>
<div id="blurred" class="box"></div>
<div id="glass" class="box"></div>
<div id="card" class="box"></div>
<p id="link-line"><a id="link" href="#">Continue</a></p>
<p><i id="icon"></i></p>
<div id="rotated"></div>
<p id="upper">Read more</p>
<p id="shadowed">Shadow</p>
<p id="gradient-text">Gradient</p>
<p id="icon-line"><a href="#"><i id="fa" style="font-family:'Font Awesome 6 Brands'"></i></a></p>
<style>#fa::before{content:"${String.fromCharCode(0xf232)}"}</style>
<img id="photo" width="64" height="32" src="data:image/jpeg;base64,${jpeg.toString('base64')}">
<div id="deep">${'<div>'.repeat(115)}Deep text${'</div>'.repeat(115)}</div>
</body></html>`;

const scene = await captureHtml(html, { widths: [390] });
const nodes = flatten(scene.screens[0]!.root);
const byKey = (key: string): SceneNode => {
  const found = nodes.find((n) => n.source.key === key);
  assert.ok(found, `missing ${key}`);
  return found;
};

test('CSS gradients become editable gradient layers with resolved geometry', () => {
  const linear = byKey('linear').style.gradients![0]!;
  assert.equal(linear.kind, 'linear');
  assert.deepEqual(
    linear.from.map((v) => Math.round(v * 100) / 100),
    [0, 0.5],
  );
  assert.deepEqual(
    linear.to.map((v) => Math.round(v * 100) / 100),
    [1, 0.5],
  );
  assert.equal(linear.stops[0]!.color.r, 1);
  const angle = byKey('angle').style.gradients![0]!;
  assert.deepEqual(
    angle.stops.map((s) => Math.round(s.position * 100) / 100),
    [0.1, 0.5, 1],
  );
  const radial = byKey('radial').style.gradients![0]!;
  assert.equal(radial.kind, 'radial');
  assert.ok(Math.abs(radial.from[0] - 0.25) < 0.01);
  // A 60px stop on a circle reaching the farthest corner keeps its pixel position.
  assert.ok(radial.stops[1]!.position > 0.3 && radial.stops[1]!.position < 0.5);
  assert.equal(byKey('conic').style.gradients![0]!.kind, 'conic');
});

test('gradient overlays above a background photo stay above it', () => {
  const overlay = byKey('overlay');
  assert.equal(overlay.style.gradients, undefined);
  const background = overlay.children.find((c) => c.source.tag === '#background')!;
  assert.equal(background.style.gradients?.length, 1);
});

test('per-side borders, multiple and inset shadows and blur filters are kept', () => {
  const rule = byKey('rule').style.border!;
  assert.deepEqual(rule.sides, [0, 0, 3, 0]);
  assert.equal(rule.dash, 'dashed');
  const shadows = byKey('shadows').style.shadow!;
  assert.equal(shadows.length, 2);
  assert.equal(shadows[1]!.inset, true);
  assert.equal(shadows[0]!.spread, -1);
  assert.equal(byKey('blurred').style.blur, 4);
  assert.equal(byKey('glass').style.backdropBlur, 10);
});

test('pseudo-elements become layers or join the text they decorate', () => {
  const card = byKey('card');
  const before = card.children.find((c) => c.source.tag === '::before')!;
  assert.ok(before, 'positioned ::before layer');
  assert.equal(before.bounds.width, 40);
  assert.equal(Math.round(before.bounds.x - card.bounds.x), 10);
  assert.equal(before.style.background!.r, 1);
  assert.match(byKey('link-line').text!.characters, /Continue\s*→$/);
  assert.equal(byKey('icon').text!.characters, '★');
});

test('rotated leaves keep their rotation and untransformed size', () => {
  const rotated = byKey('rotated');
  assert.ok(Math.abs(rotated.style.rotation! - 30) < 0.01);
  assert.deepEqual(rotated.style.size, { width: 60, height: 20 });
  assert.ok(rotated.bounds.width > 60);
});

test('text case, text shadow and gradient text stay editable', () => {
  const upper = byKey('upper').text!;
  assert.equal(upper.characters, 'Read more');
  assert.equal(upper.textCase, 'upper');
  assert.equal(byKey('shadowed').text!.shadow![0]!.blur, 3);
  const gradientText = byKey('gradient-text');
  assert.equal(gradientText.kind, 'text');
  assert.equal(gradientText.style.gradients![0]!.kind, 'linear');
});

test('JPEG photos keep their original bytes instead of being re-encoded', () => {
  const photo = byKey('photo');
  const asset = scene.assets.find((a) => a.id === photo.assetId)!;
  assert.equal(asset.mimeType, 'image/jpeg');
  assert.equal(asset.data, jpeg.toString('base64'));
});

test('content beyond the depth budget becomes an image instead of failing the capture', () => {
  assert.ok(scene.issues.some((i) => i.code === 'raster-fallback'));
  const raster = nodes.find((n) => n.kind === 'image' && n.source.tag === 'div');
  assert.ok(raster?.assetId, 'raster image asset');
});

test('icon-font glyphs become sharp icon images instead of text in a missing font', () => {
  const icon = byKey('fa');
  assert.equal(icon.kind, 'image');
  assert.equal(icon.name, 'Icon');
  const asset = scene.assets.find((a) => a.id === icon.assetId)!;
  assert.equal(asset.mimeType, 'image/png');
  assert.ok(asset.width >= icon.bounds.width * 3);
  assert.ok(nodes.every((n) => !/Font Awesome/.test(n.text?.fontFamily ?? '')));
});
