<script lang="ts">
  import { provideOperationalPanel } from '../operational-panel.svelte';
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';
  import MessageContent from '../MessageContent.svelte';

  let {
    live = false,
    nestedResult = false,
    count = 1000,
    messages = 1,
    renderer = 'streaming',
    grouped = false,
    shown = true,
    generation = 0,
    contentOverride,
    documentScroll = false,
  }: {
    live?: boolean;
    nestedResult?: boolean;
    count?: number;
    messages?: number;
    renderer?: 'streaming' | 'settled';
    grouped?: boolean;
    shown?: boolean;
    generation?: number;
    contentOverride?: ContentBlock[];
    documentScroll?: boolean;
  } = $props();
  let scrollRoot = $state<HTMLElement>();
  provideOperationalPanel(() => (documentScroll ? undefined : scrollRoot));
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(dispose);
  const content = $derived.by(() =>
    Array.from({ length: messages }, (_, message) => {
      if (contentOverride) return contentOverride;
      const rows: ContentBlock[] = Array.from({ length: count }, (_, index) => ({
        type: 'thinking',
        id: `m${message}-r${index}`,
        text: `## Inspecting ${index}\n\n## Checking ${index}`,
      }));
      if (nestedResult)
        return [
          {
            type: 'tool_result',
            id: `m${message}-result`,
            tool_use_id: 'missing',
            output: Array.from({ length: count }, (_, index) => ({
              type: 'tool_use',
              id: `m${message}-nested-${index}`,
              name: 'inspect',
              input: { path: `file-${index}` },
            })),
          },
        ] as ContentBlock[];
      return grouped
        ? ([
            { type: 'text', text: '<group:Inspection>' },
            ...rows,
            ...(live ? [] : [{ type: 'text', text: '</group:Inspection>' }]),
          ] as ContentBlock[])
        : rows;
    }),
  );
</script>

<div
  bind:this={scrollRoot}
  data-window-scroll
  style={documentScroll ? 'width:600px' : 'height:360px;width:600px;overflow:auto'}
>
  {#if shown}
    {#key generation}
      {#each content as blocks, index (index)}
        {#if renderer === 'streaming'}
          <StreamingMessageContent
            content={blocks}
            messageId={`m${index}`}
            isStreaming={live}
            isLastConversationMessage
          />
        {:else}
          <MessageContent
            content={blocks}
            messageId={`m${index}`}
            isStreaming={live}
            isLastConversationMessage
          />
        {/if}
      {/each}
    {/key}
  {/if}
</div>
