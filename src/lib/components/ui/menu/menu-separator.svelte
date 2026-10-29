<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenuPrimitive.SeparatorProps = $props();
</script>

<!-- A border snaps to whole device pixels like the overlay's edge; a 1px fill can render thicker at fractional zoom. -->
<MenuPrimitive.Separator
  bind:ref
  data-slot="menu-separator"
  class={cn('-mx-1 my-1.5 border-t border-border', className)}
  {...restProps}
/>
