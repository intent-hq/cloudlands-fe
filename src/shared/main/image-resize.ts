/**
 * Main-process image resize utility using sharp.
 *
 * Resizes images so the longest dimension is at most 1568 px (Claude's optimal max)
 * and converts opaque PNGs to JPEG for significant size savings on screenshots.
 */

import { Logger } from '../logger';

const logger = new Logger('ImageResize');

/** Claude's recommended max dimension for optimal token efficiency */
const MAX_DIMENSION = 1568;
/** JPEG quality when converting from PNG */
const JPEG_QUALITY = 85;

export interface ResizedImage {
  data: string; // base64
  mimeType: string;
}

/**
 * Resize an image for agent consumption (main-process, uses sharp).
 *
 * - Caps the longest dimension at 1568 px
 * - Converts opaque PNGs → JPEG (quality 85) for ~3-5× size savings
 * - Fast-paths images that are already small enough JPEG/WebP
 *
 * @returns resized base64 data + (possibly changed) mimeType
 */
export async function resizeImageForAgent(
  base64Data: string,
  mimeType: string,
): Promise<ResizedImage> {
  try {
    // Lazy-import sharp so the module doesn't fail at require-time if sharp is missing
    const sharp = (await import('sharp')).default;

    const inputBuffer = Buffer.from(base64Data, 'base64');
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width === 0 || height === 0) {
      // Can't determine dimensions — return as-is
      return { data: base64Data, mimeType };
    }

    const longestSide = Math.max(width, height);
    const needsResize = longestSide > MAX_DIMENSION;
    const isPng = mimeType === 'image/png';

    // Fast path: already small enough and already a compact format
    if (!needsResize && !isPng) {
      return { data: base64Data, mimeType };
    }

    // Determine if PNG has transparency (alpha channel)
    let hasAlpha = false;
    if (isPng) {
      hasAlpha = metadata.hasAlpha ?? false;
    }

    // Decide output format
    const convertToJpeg = isPng && !hasAlpha;
    let pipeline = sharp(inputBuffer);

    if (needsResize) {
      pipeline = pipeline.resize({
        width: width >= height ? MAX_DIMENSION : undefined,
        height: height > width ? MAX_DIMENSION : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    let outputBuffer: Buffer;
    let outputMimeType: string;

    if (convertToJpeg) {
      outputBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      outputMimeType = 'image/jpeg';
    } else if (isPng) {
      // Keep PNG but still resize if needed
      outputBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
      outputMimeType = 'image/png';
    } else {
      // JPEG/WebP/etc — just resize
      outputBuffer = await pipeline.toBuffer();
      outputMimeType = mimeType;
    }

    const outputBase64 = outputBuffer.toString('base64');

    const beforeKb = Math.round(inputBuffer.length / 1024);
    const afterKb = Math.round(outputBuffer.length / 1024);
    if (beforeKb !== afterKb) {
      logger.debug('Image resized for agent', {
        before: `${beforeKb}KB`,
        after: `${afterKb}KB`,
        dimensions: `${width}x${height}`,
        resized: needsResize,
        formatChange: convertToJpeg ? 'png→jpeg' : 'none',
      });
    }

    return { data: outputBase64, mimeType: outputMimeType };
  } catch (error) {
    // If sharp fails for any reason, return the original image
    logger.warn('Failed to resize image, using original', {
      error: (error as Error).message,
      mimeType,
    });
    return { data: base64Data, mimeType };
  }
}
