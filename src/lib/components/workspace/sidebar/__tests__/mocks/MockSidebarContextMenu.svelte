<script lang="ts">
   
  let { items, x, y, onClickOutside }: any = $props();
  void x; void y; void onClickOutside;
</script>

<div data-testid="sidebar-context-menu">
  {#each items ?? [] as entry, i (i)}
    {#if entry.type === 'separator'}
      <div data-testid="menu-separator"></div>
    {:else}
      <button
        data-testid="menu-item"
        data-id={entry.id}
        data-disabled={entry.disabled}
        onclick={() => entry.onClick?.()}
      >{entry.label}</button>
    {/if}
  {/each}
</div>
