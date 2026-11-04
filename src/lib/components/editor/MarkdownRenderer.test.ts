/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import MarkdownRenderer from './MarkdownRenderer.svelte';

afterEach(() => {
  cleanup();
});

// Tool results (note reads, agent conversations, task content) are rendered
// through this component, and their text is controlled by collaborators and
// agents. Raw HTML must never reach the DOM with live handlers or script URLs.
describe('MarkdownRenderer sanitization', () => {
  it('strips inline event handlers from raw HTML in markdown', async () => {
    const { container } = render(MarkdownRenderer, {
      props: { content: 'Hello <img src="x" onerror="window.__xss = 1"> world' },
    });

    await waitFor(() => expect(container.textContent).toContain('Hello'));
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('drops script elements and javascript: links', async () => {
    const { container } = render(MarkdownRenderer, {
      props: {
        content: '<script>window.__xss = 1</script>\n\n[click](javascript:alert(1)) and **bold**',
      },
    });

    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull());
    expect(container.querySelector('script')).toBeNull();
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    }
  });

  it('does not let a crafted link title break out of its attribute', async () => {
    const { container } = render(MarkdownRenderer, {
      props: { content: '[x](https://example.com "a\\" onmouseover=\\"window.__xss=1")' },
    });

    await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
    expect(container.querySelector('[onmouseover]')).toBeNull();
  });

  it('keeps ordinary markdown formatting', async () => {
    const { container } = render(MarkdownRenderer, {
      props: { content: '# Title\n\nSome **bold** and a [link](https://example.com).' },
    });

    await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });
});
