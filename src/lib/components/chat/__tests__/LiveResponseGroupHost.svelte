<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import { Input } from '$lib/components/ui/input';
  import ResponseGroup from '../ResponseGroup.svelte';
  import { OPERATIONAL_GROUP_CHILD_CONTENT_CLASS } from '../operational-disclosure-row';

  let {
    chunk = 'current chunk',
    isStreaming = true,
    lineCount = 1,
    burstLineCounts = [],
    editable = false,
  }: {
    chunk?: string;
    isStreaming?: boolean;
    lineCount?: number;
    burstLineCounts?: number[];
    editable?: boolean;
  } = $props();

  let burstLineCount = $state<number>();
  $effect(() => {
    const counts = burstLineCounts;
    let index = 0;
    let frame: number;
    const append = () => {
      burstLineCount = counts[index++];
      if (index < counts.length) frame = requestAnimationFrame(append);
    };
    if (counts.length) frame = requestAnimationFrame(append);
    return () => cancelAnimationFrame(frame);
  });
  const visibleLineCount = $derived(burstLineCount ?? lineCount);

  const blocks = $derived([
    { type: 'text', text: 'earlier chunk' },
    { type: 'text', text: chunk },
  ] as ContentBlock[]);
</script>

<ResponseGroup name="Working" {isStreaming} {blocks}>
  {#snippet currentChild()}
    <div class={OPERATIONAL_GROUP_CHILD_CONTENT_CLASS} data-response-group-child>
      <div data-testid="live-current-child">
        {#if editable}
          <Input aria-label="Live child input" />
        {/if}
        {#each Array.from({ length: visibleLineCount }) as _, index}
          <div data-testid="live-stream-line">
            {chunk}{visibleLineCount > 1 ? ` ${index + 1}` : ''}
          </div>
        {/each}
      </div>
    </div>
  {/snippet}
  {#snippet children()}
    <div
      class={OPERATIONAL_GROUP_CHILD_CONTENT_CLASS}
      data-testid="live-history-child"
      data-response-group-child
    >
      earlier chunk
    </div>
    <div
      class={OPERATIONAL_GROUP_CHILD_CONTENT_CLASS}
      data-testid="live-history-child"
      data-response-group-child
    >
      <div data-testid="live-current-child">
        {#if editable}
          <Input aria-label="Live child input" />
        {/if}
        {#each Array.from({ length: visibleLineCount }) as _, index}
          <div data-testid="live-stream-line">
            {chunk}{visibleLineCount > 1 ? ` ${index + 1}` : ''}
          </div>
        {/each}
      </div>
    </div>
  {/snippet}
</ResponseGroup>
