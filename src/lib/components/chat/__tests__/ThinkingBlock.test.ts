/**
 * @vitest-environment jsdom
 *
 * Tool-call-style streaming UX for daemon-emitted reasoning (PROTOCOL §7.1
 * `thinking` blocks, intentd#973).
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

describe('ThinkingBlock — tool-call presentation', () => {
  it('uses the compact tool-call row treatment', async () => {
    await renderBlock({ content: 'Let me check the schema', isStreaming: false });

    const row = screen.getByTestId('reasoning-tool-call');
    expect(row.className).toContain('tool-call-container');
    expect(row.className).toContain('type-caption');
    expect(row.className).not.toContain('bg-muted');
    const icon = row.querySelector('[data-icon="brain"]');
    expect(icon?.className).toContain('text-foreground/60');
    expect(icon?.className).not.toContain('opacity-30');
    expect(row.className).toContain('text-foreground/75');
  });

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
