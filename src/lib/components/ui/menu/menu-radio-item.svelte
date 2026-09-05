<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';

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
    class="absolute left-2 flex size-4 items-center justify-center text-primary-ink"
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
  data-menu-item
  class={cn(menuItem({ inset: true }), className)}
  {...restProps}
/>
