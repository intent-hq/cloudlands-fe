<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import ResponseGroup from '../ResponseGroup.svelte';
  import { OPERATIONAL_GROUP_CHILD_CONTENT_CLASS } from '../operational-disclosure-row';

  let {
    chunk = 'current chunk',
    isStreaming = true,
    lineCount = 1,
  }: { chunk?: string; isStreaming?: boolean; lineCount?: number } = $props();

  const blocks = $derived([
    { type: 'text', text: 'earlier chunk' },
    { type: 'text', text: chunk },
  ] as ContentBlock[]);
</script>

<ResponseGroup name="Working" {isStreaming} {blocks}>
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
        {#each Array.from({ length: lineCount }) as _, index}
          <div data-testid="live-stream-line">{chunk}{lineCount > 1 ? ` ${index + 1}` : ''}</div>
        {/each}
      </div>
    </div>
  {/snippet}
</ResponseGroup>
