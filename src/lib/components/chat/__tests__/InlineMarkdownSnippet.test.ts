/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InlineMarkdownSnippet from '../InlineMarkdownSnippet.svelte';
import { renderInlineMarkdownPlainText } from '../inline-markdown-snippet';

afterEach(cleanup);

describe('InlineMarkdownSnippet', () => {
  it('returns a clean inert plain-text projection for compact peeks', async () => {
    const result = await renderInlineMarkdownPlainText(
      'Review `src/agent.ts`, **strong text**, [safe label](https://example.com), and <button>unsafe</button>',
    );

    expect(result).toBe('Review src/agent.ts, strong text, safe label, and unsafe');
    expect(result).not.toMatch(/[`*_\[\]<>]/);
  });

  it('keeps safe inline Markdown and flattens links to inert labels', async () => {
    const { container } = render(InlineMarkdownSnippet, {
      props: {
        content:
          '**strong** _emphasis_ `code` [readable label](https://example.com) &amp; \\*literal\\*',
      },
    });

    await waitFor(() => expect(container.querySelector('strong')?.textContent).toBe('strong'));
    expect(container.querySelector('em')?.textContent).toBe('emphasis');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.textContent).toContain('readable label & *literal*');
    expect(container.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it('projects block syntax to one inert line and omits unsupported block content', async () => {
    const { container } = render(InlineMarkdownSnippet, {
      props: {
        content:
          '# Heading\n\n- First\n- Second\n\n![image](https://example.com/a.png)\n\n```js\nalert(1)\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<img src=x onerror="alert(2)"><script>alert(3)</script>',
      },
    });

    await waitFor(() => expect(container.textContent).toContain('Heading First Second'));
    expect(container.querySelector('h1, ul, li, img, pre, table, script')).toBeNull();
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('truncates complete Unicode graphemes without cutting generated markup', async () => {
    const { container } = render(InlineMarkdownSnippet, {
      props: { content: '**👩‍💻👩‍💻👩‍💻👩‍💻👩‍💻**', maxVisibleCharacters: 4 },
    });

    await waitFor(() => expect(container.textContent).toBe('👩‍💻👩‍💻👩‍💻👩‍💻…'));
    expect(container.querySelector('strong')?.textContent).toBe('👩‍💻👩‍💻👩‍💻👩‍💻…');
    expect(container.innerHTML).not.toContain('�');
  });

  it('reacts to streaming-style updates and leaves plain text structurally unchanged', async () => {
    const { container, rerender } = render(InlineMarkdownSnippet, {
      props: { content: 'plain preview' },
    });
    await waitFor(() => expect(container.textContent?.trim()).toBe('plain preview'));
    expect(container.querySelector('[data-inline-markdown-snippet]')?.childElementCount).toBe(0);

    await rerender({ content: '**updated** _stream_' });
    await waitFor(() => expect(container.querySelector('strong')?.textContent).toBe('updated'));
    expect(container.querySelector('em')?.textContent).toBe('stream');
  });
});
