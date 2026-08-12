import { describe, expect, it } from 'vitest';
import { parseImageDataUrl } from './image-data-url';

describe('parseImageDataUrl', () => {
  it('extracts image metadata and base64 content', () => {
    expect(parseImageDataUrl('data:image/png;base64,aGVsbG8=')).toEqual({
      mimeType: 'image/png',
      data: 'aGVsbG8=',
    });
  });

  it.each([
    'https://example.com/image.png',
    'data:image/png,not-base64',
    'data:text/plain;base64,aGVsbG8=',
    'data:image/png;base64,',
  ])('rejects invalid image data URL %s', (value) => {
    expect(parseImageDataUrl(value)).toBeNull();
  });

  it('handles a large payload without regex processing', () => {
    const data = 'a'.repeat(2_000_000);
    expect(parseImageDataUrl(`data:image/png;base64,${data}`)).toEqual({
      mimeType: 'image/png',
      data,
    });
  });
});
