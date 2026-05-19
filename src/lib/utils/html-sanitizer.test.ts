/**
 * @vitest-environment jsdom
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import { sanitizeMarkdownHTML } from './html-sanitizer';

describe('html-sanitizer', () => {
  it('preserves diff block data attributes', () => {
    const html = '<div data-type="diff-block" data-diff-code="abc123"></div>';

    expect(sanitizeMarkdownHTML(html)).toContain('data-diff-code="abc123"');
  });
});
