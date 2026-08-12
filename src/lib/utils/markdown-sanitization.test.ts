/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { processMarkdownToHTML } from './markdown-processor';

describe('markdown HTML sanitization boundary', () => {
  it('sanitizes HTML when markdown parsing is skipped', async () => {
    const html = await processMarkdownToHTML(
      '<p>Safe</p><img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(html).toContain('<p>Safe</p>');
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });

  it('removes unsafe link protocols from skipped HTML', async () => {
    const html = await processMarkdownToHTML('<a href="javascript:alert(1)">Open</a>');

    expect(html).toContain('>Open</a>');
    expect(html).not.toContain('javascript:');
  });
});
