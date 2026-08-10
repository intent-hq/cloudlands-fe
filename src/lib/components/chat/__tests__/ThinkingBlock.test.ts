/**
 * @vitest-environment jsdom
 *
 * Streaming UX for daemon-emitted reasoning (PROTOCOL §7.1 `thinking` blocks,
 * intentd#973): the block auto-expands while the thought streams and collapses
 * once the turn's block is complete, unless the user has toggled it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

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

describe('ThinkingBlock — Zed streaming UX', () => {
  it('auto-expands while the thought is streaming', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: true });

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('markdown-viewer').textContent).toContain('Let me check the schema');
  });

  it('renders collapsed with a summary when not streaming (persisted)', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: false });

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
    expect(toggle.textContent).toContain('Let me check the schema');
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
