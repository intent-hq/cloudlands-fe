<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { animatedHeight } from './animated-height.svelte';
  import { SidebarGroupContent } from '$lib/components/ui/sidebar';

  let {
    count = 1,
    open = false,
    contentHeight = 48,
    empty = false,
    sidebar = false,
  } = $props<{
    count?: number;
    open?: boolean;
    contentHeight?: number;
    empty?: boolean;
    sidebar?: boolean;
  }>();
</script>

<div data-testid="height-host">
  {#if sidebar}
    <SidebarGroupContent>
      <Button>Sidebar action</Button>
    </SidebarGroupContent>
  {:else}
    {#each Array(count) as _, index (index)}
      <div data-height-probe use:animatedHeight={open}>
        {#if !empty}
          <div data-height-content style:height="{contentHeight}px">Row content</div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
