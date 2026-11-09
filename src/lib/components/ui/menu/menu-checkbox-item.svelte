<script lang="ts">
  import type { IconWeight } from 'phosphor-svelte';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { IconDefinition } from '$lib/icons/phosphor-icons';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';
  import MenuSwitch from './menu-switch.svelte';
  import { useMenuIconColumn } from './menu-layout-context.svelte';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    closeOnSelect = false,
    indicator = 'check',
    class: className,
    icon,
    iconWeight,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.CheckboxItemProps> & {
    children?: Snippet;
    icon?: IconDefinition;
    iconWeight?: IconWeight;
    leading?: Snippet;
    indicator?: 'check' | 'switch';
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!(icon || leading));
</script>

<MenuPrimitive.CheckboxItem
  bind:ref
  bind:checked
  bind:indeterminate
  data-slot="menu-checkbox-item"
  data-menu-item
  data-selection-appearance={indicator === 'switch' && !indeterminate ? 'indicator' : undefined}
  {closeOnSelect}
  class={cn(menuItem(), className)}
  {...restProps}
>
  {#if icon || leading || reserveIcon()}
    <span
      data-slot="menu-item-leading"
      class="first-line-icon w-(--menu-icon-size)"
      aria-hidden="true"
    >
      {#if leading}
        {@render leading()}
      {:else if icon}
        <Fa {icon} weight={iconWeight} size={16} class="size-4 text-muted-foreground" />
      {/if}
    </span>
  {/if}
  {@render children?.()}
  {#if indicator === 'switch' && !indeterminate}
    <MenuSwitch {checked} />
  {:else}
    <Indicator state={indeterminate ? 'mixed' : checked ? 'checked' : 'empty'} />
  {/if}
</MenuPrimitive.CheckboxItem>
