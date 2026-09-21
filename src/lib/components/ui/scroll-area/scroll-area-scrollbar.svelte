<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
  import type { WithoutChild } from '$lib/utils.js';

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
  class={className}
  forceMount
  {...restProps}
>
  {@render children?.()}
  <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" />
</ScrollAreaPrimitive.Scrollbar>
