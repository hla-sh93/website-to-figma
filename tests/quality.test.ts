import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { comparePng, compareGeometry } from '../src/quality/compare.js';
const png = (color: string, w = 100, h = 80) =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } })
    .png()
    .toBuffer();
test('identical pixels produce zero difference and real output images', async () => {
  const source = await png('#fff');
  const r = await comparePng(source, source);
  assert.equal(r.changedFraction, 0);
  assert.equal(r.meanError, 0);
  assert.equal(r.sizeMismatch, false);
  assert.equal((await sharp(r.diff).metadata()).width, 100);
});
test('detects changed regions and reports dimension mismatch without stretching', async () => {
  const r = await comparePng(await png('#fff'), await png('#000', 90));
  assert.equal(r.sizeMismatch, true);
  assert.ok(r.changedFraction > 0.8);
  assert.ok(r.regions.length > 0);
});
test('geometry comparison detects missing layers, wrong content and displaced bounds', () => {
  const expected = [
    { sourceId: 'a', bounds: { x: 0, y: 0, width: 20, height: 20 }, text: 'Hello' },
    { sourceId: 'b', bounds: { x: 25, y: 0, width: 20, height: 20 } },
  ];
  const actual = [{ sourceId: 'a', bounds: { x: 10, y: 0, width: 20, height: 20 }, text: 'World' }];
  const r = compareGeometry(expected, actual);
  assert.equal(r.missing, 1);
  assert.equal(r.textMismatches, 1);
  assert.equal(r.withinTolerance, 0);
});
