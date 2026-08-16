/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
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
});
