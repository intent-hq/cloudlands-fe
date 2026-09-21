<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { createProximityHover, proximityItem, type ProximityHover } from '$lib/interaction';
  import type { Action } from 'svelte/action';

  let hover = $state.raw<ProximityHover>();
  let showFirst = $state(true);
  const connect: Action<HTMLElement> = (node) => {
    const store = createProximityHover(node);
    hover = store;
    return { destroy: () => store.destroy() };
  };
</script>

<section class="m-8 w-80" data-testid="highlight-lifecycle-host">
  <div use:connect class="relative flex flex-col gap-2" data-testid="rows">
    {#if hover}
      <ProximityHighlight
        store={hover}
        selectedIndexes={[1, 2]}
        hoverClass="test-hover bg-hover"
        selectedClass="test-selected bg-selected"
      />
      {#each ['Alpha', 'Beta', 'Gamma'] as label, index (label)}
        {#if index !== 0 || showFirst}
          <div use:proximityItem={{ hover, index }} data-testid={'row-' + index} class="relative">
            <Button
              class="w-full"
              variant="ghost"
              onfocus={() => hover?.setActiveIndex(index)}
              onkeydown={(event) => {
                if (index === 0 && event.key === 'Delete') showFirst = false;
              }}>{label}</Button
            >
          </div>
        {/if}
      {/each}
    {/if}
  </div>
  <Button class="mt-8" onclick={() => (showFirst = true)}>Restore first row</Button>
</section>
