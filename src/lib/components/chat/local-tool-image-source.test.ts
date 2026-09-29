import { describe, expect, it } from 'vitest';
import { resolveLocalToolImageSource } from './local-tool-image-source';

describe('local tool image source', () => {
  it('resolves workspace absolute and relative image paths', () => {
    expect(resolveLocalToolImageSource('/work/repo/desktop.png', 'ws', '/work/repo')).toBe(
      'workspace-file://ws/desktop.png',
    );
    expect(resolveLocalToolImageSource('images/screen #1%.JPG', 'ws')).toBe(
      'workspace-file://ws/images/screen%20%231%25.JPG',
    );
    expect(resolveLocalToolImageSource('/work/repo/a.webp', 'ws', '/work/repo/')).toBe(
      'workspace-file://ws/a.webp',
    );
  });

  it.each([
    '/work/other/desktop.png',
    '/work/repository/desktop.png',
    '../desktop.png',
    '/work/repo/../desktop.png',
    'image.svg',
    'notes.txt',
    'https://example.com/a.png',
    'C:\\work\\desktop.png',
    '',
  ])('rejects unsupported or escaping paths: %s', (path) => {
    expect(resolveLocalToolImageSource(path, 'ws', '/work/repo')).toBeNull();
  });

  it('does not guess an absolute root or workspace', () => {
    expect(resolveLocalToolImageSource('/work/repo/desktop.png', 'ws')).toBeNull();
    expect(resolveLocalToolImageSource('desktop.png')).toBeNull();
  });
});
