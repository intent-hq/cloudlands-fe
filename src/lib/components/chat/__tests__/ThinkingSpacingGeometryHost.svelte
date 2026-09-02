<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import DiscussionRequestNotice from '../DiscussionRequestNotice.svelte';
  import MessageContent from '../MessageContent.svelte';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';
  import ThinkingBlock from '../ThinkingBlock.svelte';
  import { getOperationalClusterSpacingClass } from '../operational-disclosure-row';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    showStreamingThinking?: boolean;
  }

  let { theme = 'light', width = 720, zoom = 1, showStreamingThinking = true }: Props = $props();

  const thinking = (id: string): ContentBlock => ({
    type: 'thinking',
    id,
    text: `Thinking ${id}\n\nGeometry detail.`,
  });
  const firstChild = [thinking('first-child')] as ContentBlock[];
  const proseThenThinking = [
    { type: 'text', text: 'Ordinary prose before reasoning' },
    thinking('after-prose'),
  ] as ContentBlock[];
  const thinkingThenProse = [
    thinking('before-prose'),
    { type: 'text', text: 'Response after completed reasoning' },
  ] as ContentBlock[];
  const toolThenThinking = [
    { type: 'tool_use', id: 'read-first', name: 'view', input: { path: 'src/example.ts' } },
    thinking('after-tool'),
  ] as ContentBlock[];
  const consecutiveReasoning = [
    { type: 'thinking', id: 'reasoning-one', text: '# First reasoning group\n\nFirst body' },
    { type: 'thinking', id: 'reasoning-two', text: '# Second reasoning group\n\nSecond body' },
  ] as ContentBlock[];
  const streamingContent = $derived(
    showStreamingThinking
      ? ([
          { type: 'text', text: 'Streaming prose before reasoning' },
          thinking('streaming-thinking'),
        ] as ContentBlock[])
      : ([{ type: 'text', text: 'Streaming prose before reasoning' }] as ContentBlock[]),
  );
  const streamingResponseContent = [
    thinking('streaming-before-prose'),
    { type: 'text', text: 'Streaming response after reasoning' },
  ] as ContentBlock[];

  const thinkingBoundaryClass = (type: string) =>
    getOperationalClusterSpacingClass([{ type }, { type: 'thinking' }], 1);
</script>

<section class:dark={theme === 'dark'} style:width="{width}px" style:zoom>
  <div class="flex flex-col bg-background text-foreground" data-testid="thinking-spacing-host">
    <div class="flex flex-col gap-1" data-testid="attention-card-boundary">
      <div class="rounded border border-border bg-card px-3 py-2" data-testid="attention-card">
        Agent attention requested
      </div>
      <div class={thinkingBoundaryClass('attention_card')} data-thinking-boundary>
        <ThinkingBlock
          content={'Considering task restoration\n\nCheck the saved task state before continuing.'}
        />
      </div>
    </div>

    <div class="flex flex-col" data-testid="notice-boundary">
      <DiscussionRequestNotice reason="Need a decision" />
      <div class={thinkingBoundaryClass('notice')} data-thinking-boundary>
        <ThinkingBlock content="Thinking after notice" />
      </div>
    </div>

    <div data-testid="prose-boundary"><MessageContent content={proseThenThinking} /></div>
    <div data-testid="reasoning-response-boundary">
      <MessageContent content={thinkingThenProse} />
    </div>
    <div class="flex flex-col gap-1" data-testid="message-content-boundary">
      <div class="type-body" data-testid="message-content">Ordinary message content</div>
      <div class={thinkingBoundaryClass('message')} data-thinking-boundary>
        <ThinkingBlock content="Thinking after message content" />
      </div>
    </div>
    <div data-testid="first-child-boundary"><MessageContent content={firstChild} /></div>
    <div data-testid="operational-boundary"><MessageContent content={toolThenThinking} /></div>
    <div data-testid="consecutive-reasoning-boundary">
      <MessageContent content={consecutiveReasoning} />
    </div>
    <div data-testid="streaming-boundary">
      <StreamingMessageContent content={streamingContent} isStreaming />
    </div>
    <div data-testid="streaming-response-boundary">
      <StreamingMessageContent content={streamingResponseContent} isStreaming />
    </div>
  </div>
</section>
