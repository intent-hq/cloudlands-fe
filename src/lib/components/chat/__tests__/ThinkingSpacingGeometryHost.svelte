<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import MessageContent from '../MessageContent.svelte';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';
  import ThinkingBlock from '../ThinkingBlock.svelte';
  import type { ReasoningRenderer } from './compact-reasoning-fixtures';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  interface Props {
    showStreamingThinking?: boolean;
    regressionContent?: ContentBlock[];
    renderer?: ReasoningRenderer;
    isStreaming?: boolean;
  }

  let {
    showStreamingThinking = true,
    regressionContent,
    renderer = 'message',
    isStreaming = false,
  }: Props = $props();

  const thinking = (id: string): ContentBlock => ({
    type: 'thinking',
    id,
    text: `Thinking ${id}\n\nGeometry detail.`,
  });
  const streamingContent = $derived(
    showStreamingThinking
      ? ([
          { type: 'text', text: 'Streaming prose before reasoning' },
          thinking('streaming-thinking'),
        ] as ContentBlock[])
      : ([{ type: 'text', text: 'Streaming prose before reasoning' }] as ContentBlock[]),
  );
</script>

<section class="bg-background text-foreground">
  {#if regressionContent}
    <div data-testid="compact-reasoning-fixture">
      {#if renderer === 'message'}
        <MessageContent content={regressionContent} {isStreaming} />
      {:else}
        <StreamingMessageContent content={regressionContent} {isStreaming} />
      {/if}
    </div>
  {:else}
    <div data-testid="reasoning-disclosure-fixture">
      <ThinkingBlock
        content={'Considering task restoration\n\nCheck the saved task state before continuing.'}
      />
    </div>
    <div data-testid="streaming-boundary">
      <StreamingMessageContent content={streamingContent} isStreaming />
    </div>
  {/if}
</section>
