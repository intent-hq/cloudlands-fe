/**
 * Image resizing utility for agent image attachments.
 *
 * Optimizes images before sending to LLMs by:
 * - Capping the longest dimension at 1568px (Claude's optimal max)
 * - Converting opaque PNGs to JPEG (quality 85) for significant size savings
 * - Preserving PNGs that contain transparency
 */

const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

export interface ResizedImage {
  base64: string;
  mimeType: string;
}

/**
 * Resize and optimize a base64-encoded image for agent consumption.
 *
 * Fast-path: returns the original data unchanged when the image is already
 * JPEG and within the dimension limit.
 */
export async function resizeImageForAgent(
  base64: string,
  mimeType: string,
): Promise<ResizedImage> {
  const originalSizeKb = Math.round((base64.length * 3) / 4 / 1024);

  // Load the image to inspect dimensions
  const img = await loadImage(base64, mimeType);
  const { width, height } = img;

  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;
  const isPng = mimeType === 'image/png';
  const isJpeg = mimeType === 'image/jpeg' || mimeType === 'image/jpg';
  const isSupportedFormat = isPng || isJpeg;

  // Fast path: JPEG already within limits
  if (isJpeg && !needsResize) {
    console.debug(
      `[image-resize] JPEG ${width}×${height} already within limits (${originalSizeKb} KB) — skipping`,
    );
    return { base64, mimeType };
  }

  // Fast path: unsupported format (e.g. GIF, WebP) — return original unchanged
  // since convertToBlob may not reliably encode these formats.
  if (!isSupportedFormat) {
    console.debug(
      `[image-resize] ${mimeType} ${width}×${height} is not PNG/JPEG — returning original (${originalSizeKb} KB)`,
    );
    return { base64, mimeType };
  }

  // Compute target dimensions
  let targetWidth = width;
  let targetHeight = height;
  if (needsResize) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetWidth = Math.round(width * scale);
    targetHeight = Math.round(height * scale);
  }

  // Draw onto a canvas at target size
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context for image resize');
  }
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Decide output format
  let outputMimeType = mimeType;
  if (isPng) {
    const hasAlpha = canvasHasTransparency(ctx, targetWidth, targetHeight);
    if (!hasAlpha) {
      outputMimeType = 'image/jpeg';
    }
  }

  // Encode
  const blob = await canvas.convertToBlob({
    type: outputMimeType,
    quality: outputMimeType === 'image/jpeg' ? JPEG_QUALITY : undefined,
  });

  // Use the blob's actual type — the browser may ignore unsupported requested types
  const actualMimeType = blob.type || outputMimeType;

  const outputBase64 = await blobToBase64(blob);
  const outputSizeKb = Math.round((outputBase64.length * 3) / 4 / 1024);

  console.debug(
    `[image-resize] ${width}×${height} → ${targetWidth}×${targetHeight} | ` +
      `${mimeType} → ${actualMimeType} | ${originalSizeKb} KB → ${outputSizeKb} KB`,
  );

  return { base64: outputBase64, mimeType: actualMimeType };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a base64-encoded image into an ImageBitmap. */
async function loadImage(base64: string, mimeType: string): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return createImageBitmap(blob);
}

/** Check whether any pixel in the canvas has a non-255 alpha value. */
function canvasHasTransparency(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  // Alpha is every 4th byte starting at index 3
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      return true;
    }
  }
  return false;
}

/** Convert a Blob to a raw base64 string (no data-URI prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
