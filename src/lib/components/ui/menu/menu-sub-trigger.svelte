<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: MenuPrimitive.SubTriggerProps = $props();
</script>

<MenuPrimitive.SubTrigger
  bind:ref
  data-slot="menu-sub-trigger"
  class={cn(
    'type-body flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 outline-none',
    'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  <span class="ml-auto" aria-hidden="true">›</span>
</MenuPrimitive.SubTrigger>
