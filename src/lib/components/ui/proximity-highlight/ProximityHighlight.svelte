<script lang="ts">
  import { createMergeSplit, type ProximityHover, type SelectedIndexes } from '$lib/interaction';
  import { fade, Spring, type SpringTierName } from '$lib/motion';
  import { cn } from '$lib/utils.js';
  import type { Action } from 'svelte/action';

  interface Props {
    store: ProximityHover;
    selectedIndexes?: SelectedIndexes;
    selectedClass?: string;
    hoverClass?: string;
    class?: string;
  }

  interface SpringRectOptions {
    rect: { top: number; left: number; width: number; height: number };
    tier: SpringTierName;
  }

  let {
    store,
    selectedIndexes = [],
    selectedClass = 'bg-selected',
    hoverClass = 'bg-hover',
    class: className,
  }: Props = $props();
  const mergeSplit = createMergeSplit();
  const activeRect = $derived(
    store.activeIndex === null ? undefined : store.itemRects[store.activeIndex],
  );

  $effect(() => {
    mergeSplit.update(store.itemRects, selectedIndexes);
  });

  const springRect: Action<HTMLElement, SpringRectOptions> = (node, options) => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const top = new Spring(options.rect.top, options.tier);
    const left = new Spring(options.rect.left, options.tier);
    const width = new Spring(options.rect.width, options.tier);
    const height = new Spring(options.rect.height, options.tier);
    const disposeEffect = $effect.root(() => {
      $effect(() => {
        node.style.transform = `translate3d(${left.current}px, ${top.current}px, 0)`;
        node.style.width = `${width.current}px`;
        node.style.height = `${height.current}px`;
      });
    });

    const setRect = (next: SpringRectOptions) => {
      void top.set(next.rect.top);
      void left.set(next.rect.left);
      void width.set(next.rect.width);
      void height.set(next.rect.height);
    };
    const reduce = () => media.matches && setRect(options);
    media.addEventListener('change', reduce);

    return {
      update(next) {
        options = next;
        setRect(next);
      },
      destroy() {
        media.removeEventListener('change', reduce);
        disposeEffect();
      },
    };
  };
</script>

<div aria-hidden="true" class={cn('pointer-events-none absolute inset-0', className)}>
  {#each mergeSplit.groups as group (group.id)}
    <div
      class={cn('absolute', selectedClass)}
      style="border-radius: var(--radius-small)"
      use:springRect={{ rect: group.rect, tier: 'moderate' }}
      out:fade={{ tier: 'moderate' }}
    ></div>
  {/each}

  {#key store.sessionId}
    {#if activeRect}
      <div
        class={cn('absolute', hoverClass)}
        style="border-radius: var(--radius-small)"
        use:springRect={{ rect: activeRect, tier: 'fast' }}
        out:fade={{ tier: 'fast' }}
      ></div>
    {/if}
  {/key}
</div>
