/** Normalize legacy MIME spelling without changing the original attachment bytes. */
export function canonicalImageMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

/** Formats supported by both model image input and workspace image previews. */
export function isSupportedImageMimeType(mimeType: string | undefined): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
    canonicalImageMimeType(mimeType),
  );
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jxl': 'jxl',
};

/** Keep unknown bytes honest instead of giving every unsupported format a PNG suffix. */
export function imageAttachmentName(mimeType: string | undefined, basename: string): string {
  const extension = IMAGE_EXTENSIONS[canonicalImageMimeType(mimeType)] ?? 'bin';
  return `${basename}.${extension}`;
}
