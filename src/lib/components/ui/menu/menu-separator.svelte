<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenuPrimitive.SeparatorProps = $props();
</script>

<MenuPrimitive.Separator
  bind:ref
  data-slot="menu-separator"
  class={cn('-mx-1 my-1.5 h-px bg-border', className)}
  {...restProps}
/>
