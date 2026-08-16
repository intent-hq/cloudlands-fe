/**
 * @vitest-environment jsdom
 *
 * Tool-call-style streaming UX for daemon-emitted reasoning (PROTOCOL §7.1
 * `thinking` blocks, intentd#973).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import { OPERATIONAL_SECONDARY_CLASS } from '../operational-disclosure-row';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

afterEach(cleanup);

warmImport(() => import('../ThinkingBlock.svelte'));

async function renderBlock(props: { content: string; isStreaming?: boolean }) {
  const ThinkingBlock = (await import('../ThinkingBlock.svelte')).default;
  return render(ThinkingBlock, { props });
}

describe('ThinkingBlock — tool-call presentation', () => {
  it('uses the compact tool-call row treatment', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: false });

    const row = screen.getByTestId('reasoning-tool-call');
    expect(row.className).toContain('tool-call-container');
    expect(row.className).toContain('type-body');
    expect(row.className).not.toContain('bg-muted');
    const icon = row.querySelector('[data-icon="brain"]');
    const iconBox = icon?.closest('[data-operational-icon-box]');
    expect(iconBox?.className).toContain(OPERATIONAL_SECONDARY_CLASS);
    expect(iconBox?.className).not.toContain('text-muted-foreground/70');
    expect(icon?.className).not.toContain('opacity-30');
    expect(row.className).toContain('text-muted-foreground');
  });

  it('auto-expands with the localized fallback while headingless reasoning streams', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: true });

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent?.trim()).toMatch(/^Thinking/);
    expect(screen.getByTestId('markdown-viewer').textContent).toContain('Let me check the schema');
  });

  it('uses the localized Reasoning fallback for headingless persisted content', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: false });

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
    expect(toggle.textContent?.trim()).toBe('Reasoning');
  });

  it('renders the first Markdown heading once as plain toggle text', async () => {
    await renderBlock({
      content: '## **Check** `schema` with [label](https://example.com)\n\nBody',
    });

    const toggle = screen.getByRole('button');
    const summary = screen.getByTestId('reasoning-summary');
    expect(toggle.textContent?.trim()).toBe('Check schema with label');
    expect(summary.children).toHaveLength(0);

    await fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Body');
    expect(document.body.textContent?.match(/Check schema with label/g)).toHaveLength(1);
  });

  it('reactively replaces the streaming fallback without remounting or moving focus', async () => {
    const view = await renderBlock({ content: 'Partial body', isStreaming: true });
    const toggle = screen.getByRole('button');
    toggle.focus();
    expect(toggle.textContent?.trim()).toMatch(/^Thinking/);

    await view.rerender({ content: '# `Plan` **changes**\n\nPartial body', isStreaming: true });

    await waitFor(() => expect(toggle.textContent?.trim()).toBe('Plan changes'));
    expect(screen.getByRole('button')).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Partial body');
  });

  it('collapses when streaming completes', async () => {
    const { rerender } = await renderBlock({ content: 'partial', isStreaming: true });
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');

    await rerender({ content: 'partial thought, now complete', isStreaming: false });

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a user-expanded block open after streaming completes', async () => {
    const { rerender } = await renderBlock({ content: 'partial', isStreaming: true });
    const toggle = screen.getByRole('button');

    // Collapse then re-expand: the manual toggle wins over the auto behavior.
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await rerender({ content: 'partial complete', isStreaming: false });

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('stays collapsed while streaming when autoExpandWhileStreaming is off', async () => {
    const ThinkingBlock = (await import('../ThinkingBlock.svelte')).default;
    render(ThinkingBlock, {
      props: { content: 'quiet thought', isStreaming: true, autoExpandWhileStreaming: false },
    });

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });
});
