import sharp from 'sharp';
import type { Bounds } from '../core/scene.js';

export type GeometryRecord = { sourceId: string; bounds: Bounds; text?: string };
export function compareGeometry(
  expected: GeometryRecord[],
  actual: GeometryRecord[],
  tolerance = 2,
) {
  const map = new Map(actual.map((n) => [n.sourceId, n]));
  let missing = 0,
    withinTolerance = 0,
    textMismatches = 0;
  const displaced: { sourceId: string; error: number }[] = [];
  for (const source of expected) {
    const node = map.get(source.sourceId);
    if (!node) {
      missing++;
      continue;
    }
    const a = source.bounds,
      b = node.bounds;
    const error = Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.x + a.width - b.x - b.width),
      Math.abs(a.y + a.height - b.y - b.height),
    );
    if (error <= tolerance) withinTolerance++;
    else displaced.push({ sourceId: source.sourceId, error });
    if (source.text !== undefined && source.text !== node.text) textMismatches++;
  }
  return {
    total: expected.length,
    matched: expected.length - missing,
    missing,
    withinTolerance,
    textMismatches,
    displaced: displaced.sort((a, b) => b.error - a.error),
    tolerance,
  };
}

export async function comparePng(source: Buffer, rendered: Buffer, threshold = 24) {
  const decode = async (buffer: Buffer) =>
    sharp(buffer, { limitInputPixels: 16000000 })
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([decode(source), decode(rendered)]);
  const width = Math.max(a.info.width, b.info.width),
    height = Math.max(a.info.height, b.info.height);
  if (width * height > 16000000)
    throw new Error('Comparison exceeds 16 million pixels. Compare sections separately.');
  const diff = Buffer.alloc(width * height * 3, 255),
    overlay = Buffer.alloc(width * height * 3, 255);
  const tileSize = 48;
  const blocks = new Map<string, { x: number; y: number; changed: number }>();
  let changed = 0,
    error = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let maxDelta = 0;
      for (let channel = 0; channel < 3; channel++) {
        const av =
          x < a.info.width && y < a.info.height
            ? a.data[(y * a.info.width + x) * 3 + channel]!
            : 255;
        const bv =
          x < b.info.width && y < b.info.height
            ? b.data[(y * b.info.width + x) * 3 + channel]!
            : 255;
        const delta = Math.abs(av - bv);
        maxDelta = Math.max(maxDelta, delta);
        error += delta;
        overlay[(y * width + x) * 3 + channel] = Math.round((av + bv) / 2);
        diff[(y * width + x) * 3 + channel] = channel === 0 ? 255 : Math.max(0, 255 - maxDelta * 3);
      }
      if (maxDelta > threshold) {
        changed++;
        const tx = Math.floor(x / tileSize) * tileSize,
          ty = Math.floor(y / tileSize) * tileSize,
          key = `${tx}:${ty}`;
        let tile = blocks.get(key);
        if (!tile) {
          tile = { x: tx, y: ty, changed: 0 };
          blocks.set(key, tile);
        }
        tile.changed++;
      }
    }
  const regions = [...blocks.values()]
    .filter((tile) => tile.changed > 12)
    .sort((a, b) => b.changed - a.changed)
    .slice(0, 200)
    .map((tile) => ({
      ...tile,
      width: Math.min(tileSize, width - tile.x),
      height: Math.min(tileSize, height - tile.y),
    }));
  const encode = (buffer: Buffer) =>
    sharp(buffer, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
  return {
    width,
    height,
    sourceSize: { width: a.info.width, height: a.info.height },
    renderedSize: { width: b.info.width, height: b.info.height },
    sizeMismatch: a.info.width !== b.info.width || a.info.height !== b.info.height,
    changedFraction: changed / (width * height),
    meanError: error / (width * height * 3 * 255),
    threshold,
    regions,
    diff: await encode(diff),
    overlay: await encode(overlay),
  };
}
