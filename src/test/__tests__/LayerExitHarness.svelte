<script lang="ts">
  // A tooltip and a dropdown menu with real triggers, so the floating layer has an anchor
  // to position against (src/test/layer-exit.test.ts).
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';

  let {
    tooltipOpen = $bindable(false),
    menuOpen = $bindable(false),
  }: { tooltipOpen?: boolean; menuOpen?: boolean } = $props();
</script>

<Tooltip content="Browse user messages" bind:open={tooltipOpen}>
  <button type="button">Tooltip trigger</button>
</Tooltip>

<DropdownMenu bind:open={menuOpen}>
  {#snippet trigger({ props })}
    <button type="button" data-dropdown-menu-trigger {...props}>Menu trigger</button>
  {/snippet}
  {#snippet content({ close })}
    <button type="button" role="menuitem" onclick={close}>Rename</button>
  {/snippet}
</DropdownMenu>
