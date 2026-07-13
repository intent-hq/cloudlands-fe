<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
  import {
  cn,
  type WithoutChild,
} from '$lib/utils.js';

  interface Props extends WithoutChild<ScrollAreaPrimitive.ScrollbarProps> {
    children?: any;
  }

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'vertical',
    children,
    ...restProps
  }: Props = $props();
</script>

<ScrollAreaPrimitive.Scrollbar
  bind:ref
  data-slot="scroll-area-scrollbar"
  {orientation}
  class={cn(
    'flex touch-none select-none transition-colors',
    orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
    orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <ScrollAreaPrimitive.Thumb
    data-slot="scroll-area-thumb"
    class="relative flex-1 rounded bg-muted-foreground/30 hover:bg-muted-foreground/50 transition-colors"
  />
</ScrollAreaPrimitive.Scrollbar>
