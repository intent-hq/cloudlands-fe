export type ParsedImageDataUrl = {
  mimeType: string;
  data: string;
};

const DATA_PREFIX = 'data:';
const BASE64_MARKER = ';base64,';

/** Parse a base64 data URL without running a regex over its potentially multi-megabyte payload. */
export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | null {
  if (!dataUrl.startsWith(DATA_PREFIX)) return null;

  const markerIndex = dataUrl.indexOf(BASE64_MARKER, DATA_PREFIX.length);
  if (markerIndex === -1) return null;

  const mimeType = dataUrl.slice(DATA_PREFIX.length, markerIndex);
  const data = dataUrl.slice(markerIndex + BASE64_MARKER.length);
  if (!mimeType.startsWith('image/') || data.length === 0) return null;

  return { mimeType, data };
}