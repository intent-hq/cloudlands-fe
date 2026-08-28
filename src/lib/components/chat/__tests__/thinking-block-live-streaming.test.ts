/**
 * @vitest-environment jsdom
 *
 * Integration test: thinking blocks update live during streaming (monorepo reasoning task).
 * Simulates the full flow from daemon deltas → ChatTranscriptReconciler → StreamingMessageContent.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatTranscriptReconciler } from '$lib/client/live/live-chat-client';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

// Mock the store to enable thinking blocks
const storeState = vi.hoisted(() => ({
  current: { userPreferences: { showReasoningBlocks: true } } as Record<string, unknown>,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => storeState.current, dispatch: vi.fn() });
});

afterEach(() => {
  storeState.current = { userPreferences: { showReasoningBlocks: true } };
  cleanup();
});

warmImport(() => import('../StreamingMessageContent.svelte'));

describe('ThinkingBlock — live streaming integration', () => {
  it('updates live as thinking deltas accumulate during a turn', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;

    // Simulate incremental deltas from the daemon
    const reconciler = new ChatTranscriptReconciler();

    // Snapshot: empty
    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });

    // Delta 1: first thinking chunk
    reconciler.applyDelta(1, {
      added: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Let me ' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    let transcript = reconciler.transcript();
    let blocks = transcript.messages[0]?.contentBlocks || [];

    // Render with first chunk
    const { rerender } = render(StreamingMessageContent, {
      props: { content: blocks, isStreaming: true },
    });

    // Should show thinking block auto-expanded (last block while streaming)
    const thinkingButton = screen.getByRole('button');
    expect(thinkingButton).toBeTruthy();
    expect(thinkingButton.getAttribute('aria-expanded')).toBe('true');
    expect(thinkingButton.textContent).toContain('Thinking'); // Label while streaming

    // Content should be visible (auto-expanded)
    const viewer = screen.getByTestId('markdown-viewer');
    expect(viewer.textContent).toBe('Let me ');

    // Delta 2: second thinking chunk (accumulated)
    reconciler.applyDelta(2, {
      added: [],
      updated: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Let me think about this.' },
        },
      ],
      removedIds: [],
    });

    transcript = reconciler.transcript();
    blocks = transcript.messages[0]?.contentBlocks || [];

    // Re-render with updated content
    rerender({ content: blocks, isStreaming: true });

    // Content should update live (still auto-expanded, still last block)
    await waitFor(() => {
      const viewer = screen.getByTestId('markdown-viewer');
      expect(viewer.textContent).toBe('Let me think about this.');
    });

    // Should still be expanded
    const updatedButton = screen.getByRole('button');
    expect(updatedButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('thinking block stays expanded while accumulating, collapses when text starts', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const reconciler = new ChatTranscriptReconciler();

    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });

    // Start with thinking
    reconciler.applyDelta(1, {
      added: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'thinking', id: 'msg-1:0', text: 'Reasoning...' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    let transcript = reconciler.transcript();
    const { rerender } = render(StreamingMessageContent, {
      props: { content: transcript.messages[0].contentBlocks || [], isStreaming: true },
    });

    // Should be auto-expanded (last block while streaming)
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('markdown-viewer')).toBeTruthy();

    // Add text block (thinking is no longer last)
    reconciler.applyDelta(2, {
      added: [
        {
          messageId: 'msg-1',
          role: 'assistant',
          block: { type: 'text', id: 'msg-1:1', text: 'Answer: 42.' },
        },
      ],
      updated: [],
      removedIds: [],
    });

    transcript = reconciler.transcript();
    rerender({ content: transcript.messages[0].contentBlocks || [], isStreaming: true });

    // Completed headingless thinking collapses into its disclosure when the
    // answer starts (intent-hq/intent#3753: never re-typed to inline prose).
    await waitFor(() => {
      const toggle = screen.getByRole('button', { name: 'Reasoning' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    // Wait for collapse transition to complete
    await new Promise((r) => setTimeout(r, 300));

    // Only the text block viewer stays visible (thinking collapsed)
    const viewers = screen.getAllByTestId('markdown-viewer');
    expect(viewers.map((viewer) => viewer.textContent)).toEqual(['Answer: 42.']);
  });
});
