<script lang="ts">
  import DropdownMenu from '../dropdown-menu.svelte';

  let {
    stopPropagation = false,
    label = 'Legacy actions', // i18n-ignore (test fixture label)
  }: { stopPropagation?: boolean; label?: string } = $props();
  let open = $state(false);
  let actionCount = $state(0);
</script>

<DropdownMenu bind:open align="end" side="bottom">
  {#snippet trigger({ open: isOpen, props })}
    <button
      {...props}
      type="button"
      onclick={(event) => {
        if (stopPropagation) event.stopPropagation();
        (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
      }}>{label} {isOpen ? 'open' : 'closed'}</button
    >
  {/snippet}
  {#snippet content({ close })}
    <button
      type="button"
      role="menuitem"
      onclick={() => {
        actionCount += 1;
        close();
      }}>Legacy command</button
    >
  {/snippet}
</DropdownMenu>

<output data-testid="legacy-open">{open}</output>
<output data-testid="legacy-action-count">{actionCount}</output>
