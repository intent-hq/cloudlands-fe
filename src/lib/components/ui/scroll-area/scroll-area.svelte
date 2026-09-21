<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
  import { Scrollbar } from './index.js';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'vertical',
    scrollbarXClasses = '',
    scrollbarYClasses = '',
    fadeEdges = true,
    children,
    ...restProps
  }: ScrollAreaPrimitive.RootProps & {
    orientation?: 'vertical' | 'horizontal' | 'both' | undefined;
    scrollbarXClasses?: string | undefined;
    scrollbarYClasses?: string | undefined;
    fadeEdges?: boolean;
    children?: any;
  } = $props();

  let viewport: HTMLDivElement | null = $state(null);
  let atTop = $state(true);
  let atBottom = $state(true);
  let atLeft = $state(true);
  let atRight = $state(true);

  function updateEdges() {
    if (!viewport) return;
    atTop = viewport.scrollTop <= 0;
    atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
    atLeft = viewport.scrollLeft <= 0;
    atRight = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
  }

  let fadeMask = $derived.by(() => {
    if (!fadeEdges) return undefined;
    const masks: string[] = [];
    if (orientation !== 'horizontal' && (!atTop || !atBottom)) {
      masks.push(
        `linear-gradient(to bottom, ${atTop ? 'black 0' : 'transparent 0, black 12px'}, ${atBottom ? 'black 100%' : 'black calc(100% - 12px), transparent 100%'})`,
      );
    }
    if (orientation !== 'vertical' && (!atLeft || !atRight)) {
      masks.push(
        `linear-gradient(to right, ${atLeft ? 'black 0' : 'transparent 0, black 12px'}, ${atRight ? 'black 100%' : 'black calc(100% - 12px), transparent 100%'})`,
      );
    }
    return masks.length ? masks.join(', ') : undefined;
  });

  $effect(() => {
    if (!viewport) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  });
</script>

<ScrollAreaPrimitive.Root
  bind:ref
  data-slot="scroll-area"
  data-orientation={orientation}
  class={cn('relative overflow-hidden', className)}
  type="scroll"
  {...restProps}
>
  <ScrollAreaPrimitive.Viewport
    bind:ref={viewport}
    data-slot="scroll-area-viewport"
    tabindex={0}
    class="size-full rounded-[inherit] transition-[mask-image] duration-(--motion-fast) focus-visible:outline focus-visible:-outline-offset-1 motion-reduce:transition-none"
    style={fadeMask ? `mask-image: ${fadeMask}; -webkit-mask-image: ${fadeMask};` : undefined}
    onscroll={updateEdges}
  >
    {@render children?.()}
  </ScrollAreaPrimitive.Viewport>
  {#if orientation === 'vertical' || orientation === 'both'}
    <Scrollbar orientation="vertical" class={scrollbarYClasses} />
  {/if}
  {#if orientation === 'horizontal' || orientation === 'both'}
    <Scrollbar orientation="horizontal" class={scrollbarXClasses} />
  {/if}
  <ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
