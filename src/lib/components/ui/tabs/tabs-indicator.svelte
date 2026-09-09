<script lang="ts">
  import type { ItemRect, ProximityHover } from '$lib/interaction';
  import type { Action } from 'svelte/action';
  import {
    createTabsIndicatorSprings,
    retargetTabsIndicator,
  } from './tabs-indicator-motion.svelte';

  let { store, selectedIndexes }: { store: ProximityHover; selectedIndexes: readonly number[] } =
    $props();
  const selectedRect = $derived(
    selectedIndexes[0] === undefined ? undefined : store.itemRects[selectedIndexes[0]],
  );

  const springRect: Action<HTMLElement, ItemRect> = (node, rect) => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const springs = createTabsIndicatorSprings(rect);
    const disposeEffect = $effect.root(() => {
      $effect(() => {
        node.style.transform = `translate3d(${springs.left.current}px, ${springs.top.current}px, 0)`;
        node.style.width = `${springs.width.current}px`;
        node.style.height = `${springs.height.current}px`;
      });
    });

    return {
      update(next) {
        retargetTabsIndicator(springs, next, media.matches);
      },
      destroy() {
        disposeEffect();
      },
    };
  };
</script>

{#if selectedRect}
  <div
    aria-hidden="true"
    data-tabs-indicator
    class="pointer-events-none absolute left-0 top-0 bg-selected shadow-(--elevation-raised)"
    style="border-radius: var(--radius-medium)"
    use:springRect={selectedRect}
  ></div>
{/if}
