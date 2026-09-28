/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { filterFileMedia } from './media-provenance';

describe('file media provenance', () => {
  it.each([
    'workspace-file://ws/output.png',
    'intent://local/file/output.png',
    'file:///output.png',
    'output.png',
    '/output.png',
  ])('removes %s before mounting, including recovery paths', (src) => {
    const html = filterFileMedia(
      `<img src="${src}" alt="preview"><video src="${src}"></video><img data-media-src="${src}" data-media-unavailable="missing">`,
      false,
    );
    expect(html).not.toContain(src);
    const inert = document.createElement('template');
    inert.innerHTML = html;
    expect(inert.content.querySelectorAll('[src], [poster], [data-media-src]')).toHaveLength(0);
    expect(inert.content.querySelectorAll('[data-media-unavailable]')).toHaveLength(3);
  });
  it('preserves external, embedded and asset sources while removing file posters and alternate sources', () => {
    const html = filterFileMedia(
      '<img src="https://example.com/image.png"><img src="data:image/png;base64,AAAA"><img src="workspace-asset://ws/image.png"><video src="workspace-asset://ws/video.mp4" poster="workspace-file://ws/poster.png"></video>',
      false,
    );
    expect(html).toContain('https://example.com/image.png');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('workspace-asset://ws/image.png');
    expect(html).toContain('workspace-asset://ws/video.mp4');
    expect(html).not.toContain('workspace-file:');
  });
  it('preserves local HTML exactly', () => {
    const html =
      '<img src="workspace-file://ws/image.png"><video src="workspace-file://ws/video.mp4"></video>';
    expect(filterFileMedia(html, true)).toBe(html);
  });
});
