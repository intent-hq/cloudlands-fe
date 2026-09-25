<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  let scaled = $state(true);
</script>

<Button onclick={() => (scaled = !scaled)}>Toggle scale</Button>
<div
  style:transform={scaled ? 'scale(0.8)' : 'none'}
  style="transform-origin: top left; width: 288.5px"
  class="m-8"
>
  <div class="relative border border-border p-2 max-h-40 overflow-y-auto" data-testid="scaled-list">
    <ListHighlight />
    <div class="grid gap-2">
      {#each ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'] as label, index}
        <Button
          class="w-full justify-start"
          data-menu-item
          data-selected={index === 1 ? '' : undefined}>{label}</Button
        >
      {/each}
    </div>
  </div>
</div>
