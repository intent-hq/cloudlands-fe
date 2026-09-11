<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.GroupHeadingProps> & { children?: Snippet } = $props();
</script>

<MenuPrimitive.GroupHeading
  bind:ref
  data-slot="menu-label"
  class={cn(
    OPTION_LIST_ROW_CLASS,
    'flex items-center gap-2 font-medium text-muted-foreground',
    className,
  )}
  {...restProps}
>
  <span data-slot="menu-item-leading" class="size-4 shrink-0" aria-hidden="true"></span>
  {@render children?.()}
</MenuPrimitive.GroupHeading>
