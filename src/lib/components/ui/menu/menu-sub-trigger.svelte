<script lang="ts">
  import type { IconWeight } from 'phosphor-svelte';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { getContext, type Snippet } from 'svelte';
  import { SUBMENU_CONTEXT, type SubmenuContext } from './submenu-context';
  import type { IconDefinition } from '$lib/icons/phosphor-icons';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    icon,
    iconWeight,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.SubTriggerProps> & {
    children?: Snippet;
    icon?: IconDefinition;
    iconWeight?: IconWeight;
  } = $props();

  const context = getContext<SubmenuContext | undefined>(SUBMENU_CONTEXT);
  $effect(() => {
    if (context) context.trigger = ref;
    return () => {
      if (context) context.trigger = null;
    };
  });
</script>

<MenuPrimitive.SubTrigger
  bind:ref
  data-slot="menu-sub-trigger"
  data-menu-item
  class={cn(menuItem(), className)}
  {...restProps}
>
  {#if icon}
    <span data-slot="menu-item-leading" class="size-4 shrink-0" aria-hidden="true">
      <Fa {icon} weight={iconWeight} size={16} class="size-4 text-muted-foreground opacity-70" />
    </span>
  {/if}
  {@render children?.()}
  <Indicator state="submenu" />
</MenuPrimitive.SubTrigger>
