/** @vitest-environment jsdom */
import hljs from 'highlight.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearHighlightCache,
  escapeCodeHtml,
  getCachedHighlight,
  highlightAsync,
} from '../code-highlighter';

const CODE = 'const x: number = 42;';
const LANG = 'typescript';

afterEach(() => {
  clearHighlightCache();
  vi.restoreAllMocks();
});

describe('escapeCodeHtml', () => {
  it('escapes HTML entities', () => {
    expect(escapeCodeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;',
    );
  });
});

describe('highlightAsync', () => {
  it('resolves with highlighted HTML', async () => {
    const html = await highlightAsync(CODE, LANG);
    expect(html).toContain('hljs-');
    expect(html).toContain('42');
  });

  it('does not invoke highlight.js synchronously', () => {
    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');
    void highlightAsync(CODE, LANG);
    expect(highlightSpy).not.toHaveBeenCalled();
    expect(autoSpy).not.toHaveBeenCalled();
  });

  it('caches results: second call skips highlight.js', async () => {
    await highlightAsync(CODE, LANG);
    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');
    const html = await highlightAsync(CODE, LANG);
    expect(html).toContain('hljs-');
    expect(highlightSpy).not.toHaveBeenCalled();
    expect(autoSpy).not.toHaveBeenCalled();
  });

  it('dedupes concurrent identical requests', async () => {
    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const [a, b] = await Promise.all([highlightAsync(CODE, LANG), highlightAsync(CODE, LANG)]);
    expect(a).toBe(b);
    expect(highlightSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to highlightAuto for unknown languages', async () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');
    await highlightAsync('hello world', 'not-a-language');
    expect(autoSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to escaped code when highlight.js throws', async () => {
    vi.spyOn(hljs, 'highlight').mockImplementation(() => {
      throw new Error('boom');
    });
    const html = await highlightAsync('<b>&</b>', LANG);
    expect(html).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });
});

describe('getCachedHighlight', () => {
  it('returns null before highlighting and the HTML after', async () => {
    expect(getCachedHighlight(CODE, LANG)).toBeNull();
    const html = await highlightAsync(CODE, LANG);
    expect(getCachedHighlight(CODE, LANG)).toBe(html);
  });

  it('is keyed by language as well as code', async () => {
    await highlightAsync(CODE, LANG);
    expect(getCachedHighlight(CODE, 'plaintext')).toBeNull();
  });

  it('never invokes highlight.js', () => {
    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');
    getCachedHighlight(CODE, LANG);
    expect(highlightSpy).not.toHaveBeenCalled();
    expect(autoSpy).not.toHaveBeenCalled();
  });
});
