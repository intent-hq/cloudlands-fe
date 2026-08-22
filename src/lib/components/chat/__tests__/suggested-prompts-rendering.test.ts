/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { ChatTranscriptReconciler } from '$lib/client/live/live-chat-client';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

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

describe('suggested prompts rendering', () => {
  it('never renders an accepted block prefix as streaming prose', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const prose = 'The work is complete.\n\n';
    const block = '<!-- suggested-prompts\nRun the tests.\nOpen the PR.\n-->';
    const { rerender } = render(StreamingMessageContent, {
      props: { content: [{ type: 'text', text: prose }], isStreaming: true },
    });

    for (let length = 1; length <= block.length; length++) {
      await rerender({
        content: [{ type: 'text', text: prose + block.slice(0, length) }],
        isStreaming: true,
      });
      expect(screen.getByTestId('markdown-viewer').textContent).toBe('The work is complete.');
      expect(document.body.textContent).not.toContain('suggested-prompts');
    }
  });

  it('uses the same split-block rules for finalization and restored history', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const split: ContentBlock[] = [
      { type: 'text', text: 'Done.\n\n<!' },
      { type: 'text', text: '-- suggested-prompts\nRun tests.\nOpen' },
      { type: 'text', text: ' PR.\n--' },
      { type: 'text', text: '>' },
    ];
    const { rerender } = render(MessageContent, { props: { content: split } });

    expect(document.body.textContent).toContain('Done.');
    expect(document.body.textContent).not.toContain('suggested-prompts');
    expect(document.body.textContent).not.toContain('Run tests.');

    const malformed = 'Done.\n\n<!-- suggested-prompts\nOnly one prompt';
    await rerender({ content: [{ type: 'text', text: malformed }], isStreaming: false });
    expect(document.body.textContent).toContain('suggested-prompts');
    expect(document.body.textContent).toContain('Only one prompt');
  });

  it('converges after duplicate and corrected full-text stream updates', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const reconciler = new ChatTranscriptReconciler();
    reconciler.applySnapshot(0, {
      agentId: 'agent-1',
      messages: [],
      truncated: false,
      totalMessages: 0,
    });
    const entity = (text: string, streamingComplete = false) => ({
      messageId: 'msg-1',
      role: 'assistant',
      block: { type: 'text', id: 'msg-1:0', text },
      streamingComplete,
    });
    const first = 'Done.\n\n<!-- suggested-prompts\nRun tests.\nOpen PR.\n-->';
    reconciler.applyDelta(1, {
      added: [entity(first)],
      updated: [],
      removedIds: [],
    });
    const { rerender } = render(StreamingMessageContent, {
      props: {
        content: reconciler.transcript().messages[0].contentBlocks ?? [],
        isStreaming: true,
      },
    });
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Done.');

    expect(reconciler.applyDelta(1, { added: [entity(first)], updated: [], removedIds: [] })).toBe(
      'stale',
    );
    const corrected = 'Done correctly.\n\n<!-- suggested-prompts\nRun tests.\nOpen PR.\n-->';
    reconciler.applyDelta(2, {
      added: [],
      updated: [entity(corrected)],
      removedIds: [],
    });
    await rerender({
      content: reconciler.transcript().messages[0].contentBlocks ?? [],
      isStreaming: true,
    });
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Done correctly.');

    reconciler.applyDelta(3, {
      added: [],
      updated: [entity(corrected, true)],
      removedIds: [],
    });
    await rerender({
      content: reconciler.transcript().messages[0].contentBlocks ?? [],
      isStreaming: false,
    });
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Done correctly.');
  });
});
