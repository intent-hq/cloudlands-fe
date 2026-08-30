/** @vitest-environment jsdom */
import hljs from 'highlight.js';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(true);
      return () => undefined;
    },
  }),
}));

import CodeBlock from './CodeBlock.svelte';
import { clearHighlightCache } from '$lib/utils/code-highlighter';

const CODE = 'const answer = 42;';
const LANG = 'javascript';

afterEach(() => {
  cleanup();
  clearHighlightCache();
  vi.restoreAllMocks();
});

describe('CodeBlock async highlighting', () => {
  it('renders escaped plain code on mount without synchronous highlight.js work', () => {
    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');

    const { container } = render(CodeBlock, { props: { code: CODE, language: LANG } });

    expect(highlightSpy).not.toHaveBeenCalled();
    expect(autoSpy).not.toHaveBeenCalled();
    const codeEl = container.querySelector('code');
    expect(codeEl?.textContent).toContain('const answer = 42;');
    expect(codeEl?.querySelector('[class*="hljs-"]')).toBeNull();
  });

  it('applies highlighting asynchronously after mount', async () => {
    const { container } = render(CodeBlock, { props: { code: CODE, language: LANG } });

    await waitFor(() => {
      expect(container.querySelector('code [class*="hljs-"]')).not.toBeNull();
    });
    expect(container.querySelector('code')?.textContent).toContain('const answer = 42;');
  });

  it('re-mounts of previously highlighted code are cache hits (no highlight.js work)', async () => {
    const first = render(CodeBlock, { props: { code: CODE, language: LANG } });
    await waitFor(() => {
      expect(first.container.querySelector('code [class*="hljs-"]')).not.toBeNull();
    });
    first.unmount();

    const highlightSpy = vi.spyOn(hljs, 'highlight');
    const autoSpy = vi.spyOn(hljs, 'highlightAuto');
    const second = render(CodeBlock, { props: { code: CODE, language: LANG } });

    // Highlighted immediately from cache, before any async work
    expect(second.container.querySelector('code [class*="hljs-"]')).not.toBeNull();
    expect(highlightSpy).not.toHaveBeenCalled();
    expect(autoSpy).not.toHaveBeenCalled();
  });

  it('updates highlighting when the code prop changes (streaming appends)', async () => {
    const { container, rerender } = render(CodeBlock, {
      props: { code: CODE, language: LANG },
    });
    await waitFor(() => {
      expect(container.querySelector('code [class*="hljs-"]')).not.toBeNull();
    });

    const appended = `${CODE}\nconst more = true;`;
    await rerender({ code: appended, language: LANG });

    // New text is visible immediately (escaped), highlighting catches up async
    expect(container.querySelector('code')?.textContent).toContain('const more = true;');
    await waitFor(() => {
      expect(container.querySelector('code')?.innerHTML).toContain('hljs-');
    });
  });
});
