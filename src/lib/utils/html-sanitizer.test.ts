/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHTML } from './html-sanitizer';

describe('html-sanitizer', () => {
  it('preserves diff block data attributes', () => {
    const html = '<div data-type="diff-block" data-diff-code="abc123"></div>';

    expect(sanitizeMarkdownHTML(html)).toContain('data-diff-code="abc123"');
  });

  it('allows workspace-file:// image sources', () => {
    const html = '<img src="workspace-file://ws-abc/docs/shot.png" alt="shot">';

    expect(sanitizeMarkdownHTML(html)).toContain('src="workspace-file://ws-abc/docs/shot.png"');
  });

  it('still strips javascript: image sources', () => {
    const html = '<img src="javascript:alert(1)" alt="x">';

    expect(sanitizeMarkdownHTML(html)).not.toContain('javascript:');
  });
});
