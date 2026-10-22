<script lang="ts">
  import { cn } from '$lib/utils';
  import { prefersReducedMotion } from '$lib/utils/reduced-motion';
  import type { ItemRect, ProximityHover } from '$lib/interaction';
  import type { Action } from 'svelte/action';
  import {
    createTabsIndicatorSprings,
    retargetTabsIndicator,
  } from './tabs-indicator-motion.svelte';

  let {
    store,
    selectedIndexes,
    variant = 'default',
  }: {
    store: ProximityHover;
    selectedIndexes: readonly number[];
    variant?: 'default' | 'icon';
  } = $props();
  const selectedRect = $derived(
    selectedIndexes[0] === undefined ? undefined : store.itemRects[selectedIndexes[0]],
  );

  const springRect: Action<HTMLElement, ItemRect> = (node, rect) => {
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
        retargetTabsIndicator(springs, next, prefersReducedMotion());
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
    data-variant={variant}
    class={cn(
      'pointer-events-none absolute left-0 top-0',
      variant === 'icon'
        ? 'bg-background'
        : 'bg-card dark:bg-surface-3 shadow-(--elevation-raised)',
    )}
    style="border-radius: var(--radius-medium)"
    use:springRect={selectedRect}
  >
    {#if variant === 'icon'}
      <span class="absolute -top-3 left-1/2 h-1 w-2 -translate-x-1/2 rounded-b-full bg-foreground"
      ></span>
    {/if}
  </div>
{/if}

<style>
  @media (forced-colors: active) {
    [data-tabs-indicator][data-variant='icon'] {
      outline: 1px solid CanvasText;
    }

    [data-tabs-indicator][data-variant='icon'] > span {
      background-color: CanvasText;
    }
  }
</style>
