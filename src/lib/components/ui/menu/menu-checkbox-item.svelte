<script lang="ts">
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { menuItem } from './menu-recipes';
  import Indicator from './menu-indicator.svelte';
  import { useMenuIconColumn } from './menu-layout-context.svelte';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    closeOnSelect = false,
    indicator = 'check',
    class: className,
    leading,
    children,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.CheckboxItemProps> & {
    children?: Snippet;
    leading?: Snippet;
    indicator?: 'check' | 'switch';
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!leading);
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
  {#if leading || reserveIcon()}
    <span
      data-slot="menu-item-leading"
      class="first-line-icon w-(--menu-icon-size)"
      aria-hidden="true"
    >
      {@render leading?.()}
    </span>
  {/if}
  {@render children?.()}
  {#if indicator === 'switch' && !indeterminate}
    <span
      data-slot="menu-switch"
      class="ml-auto flex h-lh shrink-0 items-center"
      aria-hidden="true"
    >
      <span
        data-state={checked ? 'checked' : 'unchecked'}
        class="relative block h-3.5 w-6 rounded-full bg-muted-foreground/25 transition-colors duration-spring-fast ease-spring-fast data-[state=checked]:bg-foreground/80 motion-reduce:transition-none"
      >
        <span
          class={cn(
            'absolute top-0.5 left-0.5 size-2.5 rounded-full bg-popover transition-transform duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            checked && 'translate-x-2.5',
          )}
        ></span>
      </span>
    </span>
  {:else}
    <Indicator state={indeterminate ? 'mixed' : checked ? 'checked' : 'empty'} />
  {/if}
</MenuPrimitive.CheckboxItem>
