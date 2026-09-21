/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, PlanEntry } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

afterEach(cleanup);

warmImport(() => import('../MessageContent.svelte'));
warmImport(() => import('../StreamingMessageContent.svelte'));

const initialEntries: PlanEntry[] = [
  { content: 'Inspect the renderer', priority: 'high', status: 'in_progress' },
  { content: 'Add the card', priority: 'medium', status: 'pending' },
];

function plan(entries: PlanEntry[]): ContentBlock {
  return { type: 'plan', id: 'message-1:plan', entries };
}

describe('execution plan renderer routing', () => {
  it('renders the same plan snapshot in live and persisted message paths', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    render(StreamingMessageContent, {
      props: { content: [plan(initialEntries)], isStreaming: true },
    });
    expect(screen.getByTestId('execution-plan-card').textContent).toContain('Step 1 / 2');
    expect(screen.getByText('Inspect the renderer')).toBeTruthy();
    cleanup();

    const MessageContent = (await import('../MessageContent.svelte')).default;
    render(MessageContent, { props: { content: [plan(initialEntries)] } });
    expect(screen.getByTestId('execution-plan-card').textContent).toContain('Step 1 / 2');
    expect(screen.getByText('Inspect the renderer')).toBeTruthy();
  });

  it('keeps a plan-only message inline without creating a utility column', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const view = render(StreamingMessageContent, {
      props: { content: [plan(initialEntries)], isStreaming: true },
    });

    const card = screen.getByTestId('execution-plan-card');
    expect(view.container.querySelectorAll('[data-testid="execution-plan-card"]')).toHaveLength(1);
    expect(card.closest('[data-operational-stack]')).not.toBeNull();
    expect(card.classList.contains('w-full')).toBe(true);
    expect(card.classList.contains('min-w-0')).toBe(true);
    expect(card.classList.contains('max-w-full')).toBe(true);
    expect(view.container.querySelector('[data-testid="subscription-utility-area"]')).toBeNull();
  });

  it('replaces a streamed snapshot in place without duplicating the card', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const view = render(StreamingMessageContent, {
      props: { content: [plan(initialEntries)], isStreaming: true },
    });

    await view.rerender({
      content: [
        plan([
          { ...initialEntries[0], status: 'completed' },
          { ...initialEntries[1], status: 'in_progress' },
        ]),
      ],
      isStreaming: true,
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('execution-plan-card')).toHaveLength(1);
      expect(screen.getByTestId('execution-plan-card').textContent).toContain('Step 2 / 2');
    });
  });
});
