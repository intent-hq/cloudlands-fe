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

<div class="relative -ml-1 mb-6 mt-2 w-full">
  <div class="absolute -left-0.5 -right-0.5 top-[13px] h-px bg-border/50 dark:bg-border/20"></div>
  <div class="relative pl-5 flex flex-wrap gap-2 w-full">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>
