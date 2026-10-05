<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { debugConfig } from '$lib/config/debug';
  import { followBottom } from '$lib/utils/smartScroll';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';

  let {
    count = 2,
    revision = 0,
    grouped = false,
    isStreaming = true,
  }: {
    count?: number;
    revision?: number;
    grouped?: boolean;
    isStreaming?: boolean;
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const originalAnimations = debugConfig.get('enableComponentTransitions');
  debugConfig.set('enableComponentTransitions', true);
  onDestroy(() => {
    debugConfig.set('enableComponentTransitions', originalAnimations);
    disposeStore();
  });

  let follow = $state(true);
  const content = $derived.by(() => {
    const tools: ContentBlock[] = Array.from({ length: count }, (_, index) => ({
      type: 'tool_use',
      id: `entry-${index}`,
      toolCallId: `call-${index}`,
      name: 'launch-process',
      input: {
        command: `printf 'revision ${revision}'`,
        description: `Inspect file ${index}, revision ${revision}`,
      },
    }));
    return grouped
      ? [{ type: 'text' as const, id: 'group-opening', text: '<group:Inspection>' }, ...tools]
      : tools;
  });
</script>

<section
  class="flex h-[480px] w-[720px] flex-col overflow-hidden bg-background text-foreground"
  data-testid="tool-entry-host"
  data-following={follow}
>
  <div
    use:followBottom={{ follow, onFollowChange: (next) => (follow = next) }}
    class="min-h-0 flex-1 overflow-y-auto"
    style="overflow-anchor: none;"
    data-testid="tool-entry-transcript"
    role="log"
  >
    {#each Array(10) as _, index}
      <div class="h-24 px-4 py-3">Historical turn {index}</div>
    {/each}
    <div class="h-12 px-4 py-3" data-testid="tool-entry-anchor">Earlier activity</div>
    <StreamingMessageContent {content} {isStreaming} />
  </div>
  <div class="h-16 shrink-0 border-t border-border" data-testid="tool-entry-composer"></div>
</section>
