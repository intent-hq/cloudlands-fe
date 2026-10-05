<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { onMount } from 'svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();
  let container: HTMLDivElement;
  let store: ProximityHover | undefined = $state.raw();
  onMount(() => {
    const hover = createProximityHover(container);
    container.querySelectorAll('button').forEach((row, index) => hover.registerItem(index, row));
    hover.setActiveIndex(0);
    store = hover;
    return () => hover.destroy();
  });
</script>

<div
  bind:this={container}
  class="relative grid w-64 gap-1"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state="pointer-proximity keyboard-focus selected merged-selection reduced-motion"
>
  {#if store}<ProximityHighlight {store} selectedIndexes={[1, 2]} />{/if}
  {#each ['Nearest row', 'Selected row', 'Merged selection'] as label, index}
    <Button
      variant="plain"
      class="relative z-10 h-8 rounded-(--radius-small) px-2 text-left text-sm"
      onfocus={() => store?.setActiveIndex(index)}>{label}</Button
    >
  {/each}
</div>
