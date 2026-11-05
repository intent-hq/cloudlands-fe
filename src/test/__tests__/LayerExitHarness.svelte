<script lang="ts">
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';

  let { menuOpen = $bindable(false) }: { menuOpen?: boolean } = $props();
</script>

<DropdownMenu bind:open={menuOpen}>
  {#snippet trigger({ props })}
    <button type="button" data-dropdown-menu-trigger {...props}>Menu trigger</button>
  {/snippet}
  {#snippet content({ close })}
    <button type="button" role="menuitem" onclick={close}>Rename</button>
  {/snippet}
</DropdownMenu>
