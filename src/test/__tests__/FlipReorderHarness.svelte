<script lang="ts">
  import { flip } from 'svelte/animate';

  let { items, revision }: { items: string[]; revision: number } = $props();

  let marker: HTMLOutputElement | undefined = $state();

  // Mirrors a component effect that must keep re-running after an animated reorder.
  $effect(() => {
    if (marker) marker.dataset.revision = String(revision);
  });
</script>

<ul>
  {#each items as item (item)}
    <li data-item={item} animate:flip>{item}</li>
  {/each}
</ul>
<output bind:this={marker} data-testid="effect-revision"></output>
