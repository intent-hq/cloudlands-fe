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
    children,
    ...restProps
  }: ScrollAreaPrimitive.RootProps & {
    orientation?: 'vertical' | 'horizontal' | 'both' | undefined;
    scrollbarXClasses?: string | undefined;
    scrollbarYClasses?: string | undefined;
    children?: any;
  } = $props();
</script>

<ScrollAreaPrimitive.Root
  bind:ref
  data-slot="scroll-area"
  data-orientation={orientation}
  class={cn('relative overflow-hidden', className)}
  {...restProps}
>
  <ScrollAreaPrimitive.Viewport
    data-slot="scroll-area-viewport"
    tabindex={0}
    class="size-full rounded-[inherit] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none"
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
