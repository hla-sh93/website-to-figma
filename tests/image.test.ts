import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseObjectPosition, computeImagePlacement } from '../src/core/image.js';

test('parses computed percentages, pixels and affine calc positions', () => {
  assert.deepEqual(parseObjectPosition('25% 80%'), { position: [0.25, 0.8], offset: [0, 0] });
  assert.deepEqual(parseObjectPosition('12px -8px'), { position: [0, 0], offset: [12, -8] });
  assert.deepEqual(parseObjectPosition('calc(100% - 12px) calc(50% + 8px)'), {
    position: [1, 0.5],
    offset: [-12, 8],
  });
});
test('supports keyword order and rejects unsupported position expressions', () => {
  assert.deepEqual(parseObjectPosition('right top'), { position: [1, 0], offset: [0, 0] });
  assert.deepEqual(parseObjectPosition('top left'), { position: [0, 0], offset: [0, 0] });
  assert.deepEqual(parseObjectPosition('center'), { position: [0.5, 0.5], offset: [0, 0] });
  assert.equal(parseObjectPosition('var(--unknown) center'), null);
  assert.equal(parseObjectPosition('calc(50% * 2) 0px'), null);
});
test('cover cropping respects right anchoring and pixel offsets', () => {
  const placement = computeImagePlacement(
    { width: 200, height: 100 },
    { width: 300, height: 100 },
    { fit: 'cover', position: [1, 0.5], positionOffset: [-12, 0] },
  );
  assert.deepEqual(placement, {
    x: -112,
    y: 0,
    width: 300,
    height: 100,
    content: { x: 0, y: 0, width: 200, height: 100 },
  });
});
test('contain leaves correctly positioned space and honors the content box', () => {
  const placement = computeImagePlacement(
    { width: 240, height: 180 },
    { width: 400, height: 100 },
    { fit: 'contain', position: [0.5, 1], contentBox: { x: 20, y: 10, width: 200, height: 150 } },
  );
  assert.deepEqual(placement, {
    x: 20,
    y: 110,
    width: 200,
    height: 50,
    content: { x: 20, y: 10, width: 200, height: 150 },
  });
});
test('none and scale-down preserve intrinsic pixels when the source fits', () => {
  for (const fit of ['none', 'scale-down'] as const) {
    const p = computeImagePlacement(
      { width: 200, height: 100 },
      { width: 80, height: 40 },
      { fit, position: [0.5, 0.5] },
    );
    assert.equal(p.width, 80);
    assert.equal(p.height, 40);
    assert.equal(p.x, 60);
    assert.equal(p.y, 30);
  }
  const p = computeImagePlacement(
    { width: 40, height: 30 },
    { width: 80, height: 40 },
    { fit: 'scale-down', position: [0, 0] },
  );
  assert.equal(p.width, 40);
  assert.equal(p.height, 20);
});
test('fill uses the full content box and invalid dimensions are rejected', () => {
  const p = computeImagePlacement(
    { width: 200, height: 100 },
    { width: 80, height: 40 },
    { fit: 'fill', position: [1, 1] },
  );
  assert.equal(p.width, 200);
  assert.equal(p.height, 100);
  assert.throws(() =>
    computeImagePlacement(
      { width: 100, height: 100 },
      { width: 0, height: 30 },
      { fit: 'cover', position: [0.5, 0.5] },
    ),
  );
});
