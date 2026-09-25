<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Composer stand-in that renders only the `queueRegion` snippet, so tests can
   * observe where ChatPanel mounts the queued-message surfaces without the real
   * SimpleRichInput dependency tree.
   */
  let { queueRegion }: { queueRegion?: Snippet; [key: string]: unknown } = $props();

  export function focus() {}
  export function clear() {}
  export function getInlineImageContextItems() {
    return [];
  }
  export function getMentionContextItems() {
    return [];
  }
</script>

<div data-testid="mock-rich-input">
  {#if queueRegion}
    <div data-testid="mock-queue-region">{@render queueRegion()}</div>
  {/if}
</div>
