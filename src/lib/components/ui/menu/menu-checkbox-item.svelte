<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.CheckboxItemProps> & {
    children?: Snippet;
  } = $props();
</script>

<MenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  bind:indeterminate
  data-slot="menu-checkbox-item"
  class={cn(
    'type-body relative flex min-h-7 cursor-default select-none items-center rounded-md py-1 pl-8 pr-2 outline-none',
    'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[state=checked]:bg-accent/60 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
    className,
  )}
  {...restProps}
>
  <span
    class="absolute left-2 flex size-4 items-center justify-center text-primary"
    aria-hidden="true"
  >
    {indeterminate ? '−' : checked ? '✓' : ''}
  </span>
  {@render children?.()}
</MenuPrimitive.CheckboxItem>
