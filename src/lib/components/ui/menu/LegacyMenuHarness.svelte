<script lang="ts">
  import DropdownMenu from '../dropdown-menu.svelte';

  let { stopPropagation = false }: { stopPropagation?: boolean } = $props();
  let open = $state(false);
</script>

<DropdownMenu bind:open portal={false} align="end" side="bottom">
  {#snippet trigger({ toggle, open: isOpen })}
    <button
      type="button"
      onclick={(event) => {
        if (stopPropagation) event.stopPropagation();
        toggle();
      }}>Legacy actions {isOpen ? 'open' : 'closed'}</button
    >
  {/snippet}
  {#snippet content({ close })}
    <button type="button" role="menuitem" onclick={close}>Legacy command</button>
  {/snippet}
</DropdownMenu>

<output data-testid="legacy-open">{open}</output>
