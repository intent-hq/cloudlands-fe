<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.RadioItemProps> & {
    children?: Snippet;
  } = $props();
</script>

{#snippet radioContent({ checked }: { checked: boolean })}
  <span
    class="absolute left-2 flex size-4 items-center justify-center text-primary"
    aria-hidden="true"
  >
    {checked ? '●' : ''}
  </span>
  {@render children?.()}
{/snippet}

<MenuPrimitive.RadioItem
  bind:ref
  children={radioContent}
  data-slot="menu-radio-item"
  class={cn(
    'type-body relative flex min-h-7 cursor-default select-none items-center rounded-md py-1 pl-8 pr-2 outline-none',
    'focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[state=checked]:bg-accent/60 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
    className,
  )}
  {...restProps}
/>
