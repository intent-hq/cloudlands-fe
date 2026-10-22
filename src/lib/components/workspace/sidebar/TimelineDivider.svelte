<script lang="ts">
  /**
   * TimelineDivider - A horizontal divider line with content on top
   * Used between timeline sections for action buttons
   */
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="relative my-1 w-full min-w-0">
  <div class="relative flex w-full min-w-0 flex-wrap gap-2">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>
