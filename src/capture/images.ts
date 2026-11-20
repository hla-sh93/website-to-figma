import sharp from 'sharp';

/** Largest single encoded asset sent to Figma. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/** Figma stores images at most 4096 px on each side. */
export const MAX_IMAGE_SIDE = 4096;

export type NormalizedImage = {
  mime: string;
  body: Buffer;
  width: number;
  height: number;
  /** True when an animated source was flattened to its first frame. */
  flattened: boolean;
};

const PASSTHROUGH: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

/**
 * Keeps the original bytes whenever Figma can use them directly (JPEG, PNG, GIF
 * within 4096 px, no EXIF rotation). Other formats, rotated or oversized images
 * are re-encoded once: JPEG for opaque pixels, PNG when transparency matters.
 */
export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const metadata = await sharp(input, { limitInputPixels: 40_000_000, pages: 1 }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format)
    throw new Error('Missing image dimensions');
  const pages = metadata.pages ?? 1;
  const passthrough = PASSTHROUGH[metadata.format];
  if (
    passthrough &&
    (!metadata.orientation || metadata.orientation === 1) &&
    metadata.width <= MAX_IMAGE_SIDE &&
    metadata.height <= MAX_IMAGE_SIDE &&
    input.length <= MAX_ASSET_BYTES
  )
    return {
      mime: passthrough,
      body: input,
      width: metadata.width,
      height: metadata.height,
      // Figma animates GIF fills itself; other animated formats lose motion.
      flattened: pages > 1 && metadata.format !== 'gif',
    };
  let pipeline = sharp(input, { limitInputPixels: 40_000_000, pages: 1 })
    .rotate()
    .resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, { fit: 'inside', withoutEnlargement: true });
  const transparent = metadata.hasAlpha === true;
  pipeline = transparent
    ? pipeline.png({ compressionLevel: 8, adaptiveFiltering: true })
    : pipeline.jpeg({ quality: 90, mozjpeg: true });
  const output = await pipeline.toBuffer({ resolveWithObject: true });
  if (output.data.length > MAX_ASSET_BYTES) throw new Error('Decoded image budget');
  return {
    mime: transparent ? 'image/png' : 'image/jpeg',
    body: output.data,
    width: output.info.width,
    height: output.info.height,
    flattened: pages > 1,
  };
}
