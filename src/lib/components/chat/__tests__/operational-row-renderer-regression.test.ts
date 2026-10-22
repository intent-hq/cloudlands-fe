/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
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
  return createAppStoreMockModule({
    state: () => ({ userPreferences: { showReasoningBlocks: true } }),
    dispatch: vi.fn(),
  });
});

afterEach(cleanup);
warmImport(() => import('../StreamingMessageContent.svelte'));

it('bounds the initial operational mount for one message with many reasoning children', async () => {
  const Renderer = (await import('../StreamingMessageContent.svelte')).default;
  const content: ContentBlock[] = Array.from({ length: 80 }, (_, index) => ({
    type: 'thinking',
    id: `message:reasoning:${index}`,
    text: `## Inspecting item ${index}\n\n## Checking item ${index}`,
  }));
  const { container } = render(Renderer, { props: { content, isStreaming: false } });
  // This counts real ThinkingBlock / ChatOperationalRow output, not scheduler callbacks.
  // The renderer must stage even an admitted short transcript's single huge message.
  expect(container.querySelectorAll('[data-chat-operational-row]').length).toBeLessThanOrEqual(4);
});
