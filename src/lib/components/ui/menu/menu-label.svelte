<script lang="ts">
  import type { IconWeight } from 'phosphor-svelte';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { IconDefinition } from '$lib/icons/phosphor-icons';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { cn } from '$lib/utils.js';
  import type { WithoutChildrenOrChild } from '$lib/utils.js';
  import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';
  import { useMenuIconColumn } from './menu-layout-context.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    icon,
    iconWeight,
    ...restProps
  }: WithoutChildrenOrChild<MenuPrimitive.GroupHeadingProps> & {
    children?: Snippet;
    icon?: IconDefinition;
    iconWeight?: IconWeight;
  } = $props();
  const reserveIcon = useMenuIconColumn(() => !!icon);
</script>

<MenuPrimitive.GroupHeading
  bind:ref
  data-slot="menu-label"
  class={cn(
    OPTION_LIST_ROW_CLASS,
    'flex items-start gap-2 font-medium text-muted-foreground',
    className,
  )}
  {...restProps}
>
  {#if icon || reserveIcon()}
    <span
      data-slot="menu-item-leading"
      class="flex h-lh w-4 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {#if icon}
        <Fa {icon} weight={iconWeight} size="xs" class="size-4 text-muted-foreground opacity-70" />
      {/if}
    </span>
  {/if}
  {@render children?.()}
</MenuPrimitive.GroupHeading>
