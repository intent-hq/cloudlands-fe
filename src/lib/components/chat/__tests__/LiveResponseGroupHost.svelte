<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import ResponseGroup from '../ResponseGroup.svelte';
  let {
    chunk = 'current chunk',
    chunkKey = undefined,
    isStreaming = true,
  }: { chunk?: string; chunkKey?: string; isStreaming?: boolean } = $props();

  const blocks = $derived([
    { type: 'text', text: 'earlier chunk' },
    { type: 'text', text: chunk },
  ] as ContentBlock[]);
</script>

<ResponseGroup name="Working" {isStreaming} {blocks} currentChildKey={chunkKey}>
  {#snippet currentChild()}
    <div data-testid="live-current-child">{chunk}</div>
  {/snippet}
  {#snippet children()}
    <div data-testid="live-history-child">earlier chunk</div>
    <div data-testid="live-history-child">{chunk}</div>
  {/snippet}
</ResponseGroup>
