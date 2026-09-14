<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { IconDefinition } from '$lib/icons/phosphor-icons';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';

  let {
    ref = $bindable(null),
    class: className,
    children,
    icon,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.GroupHeadingProps> & {
    children?: Snippet;
    icon?: IconDefinition;
  } = $props();
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
  <span data-slot="menu-item-leading" class="size-4 shrink-0" aria-hidden="true">
    {#if icon}
      <Fa {icon} size="xs" class="size-4 text-muted-foreground opacity-70" />
    {/if}
  </span>
  {@render children?.()}
</MenuPrimitive.GroupHeading>
