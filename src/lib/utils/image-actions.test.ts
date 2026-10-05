import { describe, expect, it } from 'vitest';
import { imageDownloadFileName, supportsImageActions } from './image-actions';

describe('image action source eligibility', () => {
  it.each([
    'https://example.com/image',
    'HTTPS://example.com/image.png',
    'data:image/png;base64,aGVsbG8=',
    'data:image/webp;base64,aGVsbG8=',
    'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
    'workspace-file://ws-1/docs/image.png?v=123',
    'workspace-asset://asset-123',
  ])('accepts %s', (src) => expect(supportsImageActions(src)).toBe(true));

  it.each([
    '',
    'http://example.com/image.png',
    'https://',
    'file:///tmp/image.png',
    'blob:local',
    'javascript:alert(1)',
    'data:text/html;base64,aGVsbG8=',
    'data:image/png',
    'workspace-file://ws-1',
    'workspace-asset://',
  ])('rejects %s', (src) => expect(supportsImageActions(src)).toBe(false));
});

describe('image download filename', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/svg+xml', 'svg'],
    ['image/svg+xml;charset=utf-8', 'svg'],
    ['image/avif', 'avif'],
    ['image/bmp', 'bmp'],
  ])('uses %s for an extensionless display name', (mimeType, extension) => {
    expect(imageDownloadFileName({ imageName: 'diagram', mimeType })).toBe(`diagram.${extension}`);
  });
  it('preserves a named original file over MIME fallback', () => {
    expect(
      imageDownloadFileName({ workspacePath: 'docs/original.jpeg', mimeType: 'image/png' }),
    ).toBe('original.jpeg');
  });
});
