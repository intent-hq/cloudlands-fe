<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenuPrimitive.TriggerProps = $props();
</script>

<MenuPrimitive.Trigger
  bind:ref
  data-slot="menu-trigger"
  class={cn('outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
  {...restProps}
/>
