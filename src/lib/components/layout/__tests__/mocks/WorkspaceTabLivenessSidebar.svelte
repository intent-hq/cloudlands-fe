<script lang="ts">
  import type { Readable } from 'svelte/store';

  let { panel, onToggle }: { panel: Readable<string | null>; onToggle: () => void } = $props();
  const items = [{ id: 'all-workspaces' }];
  function isActive(id: string) {
    return $panel === id;
  }
</script>

{#each items as item (item.id)}
  {@const selected = isActive(item.id)}
  <button data-sidebar aria-pressed={selected} onclick={onToggle}>Toggle</button>
{/each}
