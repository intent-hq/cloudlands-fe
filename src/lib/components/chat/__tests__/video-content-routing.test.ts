/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

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

const block = (value: unknown) => value as ContentBlock;

describe('agent video renderer routing', () => {
  it('routes static inline video output to the internal video block', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const { container } = render(MessageContent, {
      props: {
        content: [block({ type: 'file', data: 'bXA0', mimeType: 'video/mp4' })],
        role: 'assistant',
      },
    });

    expect(container.querySelector('[data-message-content-block="video"]')).toBeTruthy();
    expect(screen.getAllByTestId('chat-video-snapshot')).toHaveLength(1);
  });

  it('mounts the internal video block for standalone video markdown', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const { container } = render(MessageContent, {
      props: {
        content: [
          block({
            type: 'text',
            text: '![demo](intent://local/file/.demo-artifacts/demo.webm)',
          }),
        ],
        role: 'assistant',
        workspaceId: 'workspace-1',
      },
    });

    expect(container.querySelector('[data-chat-video]')).toBeTruthy();
  });

  it.each([true, false])(
    'routes streaming renderer output when isStreaming=%s',
    async (isStreaming) => {
      const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
      const { container } = render(StreamingMessageContent, {
        props: {
          content: [
            block({ type: 'resource_link', uri: 'https://media.example/restored-recording.m4v' }),
          ],
          role: 'assistant',
          isStreaming,
        },
      });

      expect(container.querySelector('[data-message-content-block="video"]')).toBeTruthy();
      expect(screen.getAllByTestId('chat-video-snapshot')).toHaveLength(1);
    },
  );

  it('keeps user video files on the existing non-video route', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const { container } = render(MessageContent, {
      props: {
        content: [block({ type: 'file', data: 'bXA0', mimeType: 'video/mp4' })],
        role: 'user',
      },
    });

    expect(container.querySelector('[data-message-content-block="video"]')).toBeNull();
    expect(container.querySelector('[data-message-content-block="file"]')).toBeTruthy();
  });

  it('renders nested tool-result videos in static and streaming transcripts', async () => {
    const nested = block({
      type: 'tool_result',
      tool_use_id: 'tool-1',
      output: [{ type: 'resource_link', uri: 'https://media.example/tool-result.mp4' }],
    });
    const MessageContent = (await import('../MessageContent.svelte')).default;
    render(MessageContent, { props: { content: [nested], role: 'assistant' } });
    expect(screen.getAllByTestId('chat-video-snapshot')).toHaveLength(1);
    cleanup();

    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    render(StreamingMessageContent, {
      props: {
        content: [block({ type: 'tool_use', id: 'tool-1', name: 'record', input: {} }), nested],
        role: 'assistant',
        isStreaming: true,
      },
    });
    expect(screen.getAllByTestId('chat-video-snapshot')).toHaveLength(1);
  });

  it('deduplicates repeated normalized video sources', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    render(MessageContent, {
      props: {
        content: [
          block({ type: 'resource_link', uri: 'https://media.example/repeated.mp4' }),
          block({ type: 'resource_link', uri: 'https://media.example/repeated.mp4' }),
        ],
        role: 'assistant',
      },
    });

    expect(screen.getAllByTestId('chat-video-snapshot')).toHaveLength(1);
  });
});
