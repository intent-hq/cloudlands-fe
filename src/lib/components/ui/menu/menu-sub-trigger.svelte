<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import { OPTION_LIST_END_SLOT_CLASS } from '$lib/styles/option-list-row';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.SubTriggerProps> & { children?: Snippet } = $props();
</script>

<MenuPrimitive.SubTrigger
  bind:ref
  data-slot="menu-sub-trigger"
  data-menu-item
  class={cn(menuItem(), className)}
  {...restProps}
>
  <span data-slot="menu-item-leading" class="size-4 shrink-0" aria-hidden="true"></span>
  {@render children?.()}
  <span data-slot="menu-sub-chevron" class={OPTION_LIST_END_SLOT_CLASS} aria-hidden="true">›</span>
</MenuPrimitive.SubTrigger>
