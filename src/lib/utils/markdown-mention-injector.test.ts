/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { injectMentionSpans } from './markdown-mention-injector';

// The composer injector must stay DOM-free so it can run in a Web Worker.
describe('injectMentionSpans without a DOM', () => {
  it('runs with no document and emits chips from the registry', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const html = injectMentionSpans('<p>see @terminal[pty-0:R&amp;D logs] and @src/a.ts:12</p>');
    expect(html).toBe(
      '<p>see <span data-mention="true" data-type="terminal" data-id="pty-0" data-label="R&amp;D logs" data-meta="{}" class="mention-chip">R&amp;D logs</span>' +
        ' and <span data-mention="true" data-type="file" data-id="src/a.ts" data-label="src/a.ts:12" data-meta="{&quot;fullPath&quot;:&quot;src/a.ts&quot;,&quot;line&quot;:12,&quot;lineSuffix&quot;:&quot;:12&quot;}" class="mention-chip">src/a.ts:12</span></p>',
    );
  });

  it('skips code, links, existing chips and math', () => {
    for (const html of [
      '<code>@src/a.ts</code>',
      '<a href="x">@src/a.ts</a>',
      '<span data-mention="true">@src/a.ts</span>',
      '<span data-math-source="x">@src/a.ts</span>',
    ]) {
      expect(injectMentionSpans(html)).toBe(html);
    }
  });

  it('keeps malformed tokens and non-note links as text', () => {
    const html = '<p>@member[bm90LWpzb24=] intent://local/workspace/w1</p>';
    expect(injectMentionSpans(html)).toBe(html);
  });
});
