<script lang="ts">
  import { onMount } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import { cn } from '$lib/utils.js';
  import { setCardGroup } from './card-group-context';

  let {
    orientation = 'card',
    columns = 1,
    border = 'none',
    separated = false,
    divided = true,
    fluidHover = true,
    selected = -1,
    children,
    class: className,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> & {
    orientation?: 'card' | 'inline';
    columns?: number;
    border?: 'none' | 'outlined';
    separated?: boolean;
    divided?: boolean;
    fluidHover?: boolean;
    selected?: number;
  } = $props();
  let element: HTMLDivElement;
  let hover = $state.raw<ProximityHover | null>(null);
  setCardGroup({
    get orientation() {
      return orientation;
    },
    get border() {
      return border;
    },
    get separated() {
      return separated;
    },
  });

  onMount(() => {
    const instance = createProximityHover(element, { axis: 'xy' });
    hover = instance;
    let count = 0;
    const sync = () => {
      for (let index = 0; index < count; index++) instance.registerItem(index, null);
      const cards = element.querySelectorAll<HTMLElement>(':scope > [data-slot=card]');
      count = cards.length;
      cards.forEach((card, index) => instance.registerItem(index, card));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true });
    return () => {
      observer.disconnect();
      instance.destroy();
    };
  });
</script>

<div
  bind:this={element}
  data-slot="card-group"
  data-separated={separated || undefined}
  data-divided={(divided && !separated) || undefined}
  class={cn(
    'relative isolate grid min-w-0 overflow-hidden rounded-(--radius-large)',
    separated && 'gap-3',
    border === 'outlined' && !separated && 'border border-border',
    className,
  )}
  style:grid-template-columns="repeat({Math.max(1, Math.floor(columns))}, minmax(0, 1fr))"
  {...restProps}
>
  {#if hover}<ProximityHighlight
      store={hover}
      hoverClass={fluidHover ? 'bg-hover' : 'bg-transparent'}
      selectedIndexes={selected < 0 ? [] : [selected]}
    />{/if}
  {@render children?.()}
</div>

<style>
  [data-divided] > :global([data-slot='card']) {
    border-radius: 0;
    box-shadow:
      1px 0 0 hsl(var(--border)),
      0 1px 0 hsl(var(--border));
  }
</style>
