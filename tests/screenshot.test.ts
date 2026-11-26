import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isTiledScreenshot } from '../src/capture/images.js';

const picture = (width: number, height: number, value: (x: number, y: number) => number) => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.fill(value(x, y) & 255, (y * width + x) * 3, (y * width + x) * 3 + 3);
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
};

test('a screenshot made of one repeated 512 px tile is recognised; a real page is not', async () => {
  const page = (x: number, y: number) => (x * 7 + y * 3 + ((x >> 6) ^ (y >> 5)) * 40) % 251;
  assert.equal(await isTiledScreenshot(await picture(1440, 900, page)), false);
  assert.equal(await isTiledScreenshot(await picture(1440, 900, (x, y) => page(x % 512, y))), true);
  // A plain page equals itself at every shift: nothing to tell, so it is not reported.
  assert.equal(await isTiledScreenshot(await picture(1440, 900, () => 240)), false);
  // Narrow screenshots hold less than two tiles.
  assert.equal(await isTiledScreenshot(await picture(390, 900, (x, y) => page(x % 512, y))), false);
});
