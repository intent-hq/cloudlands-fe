<script lang="ts">
  import type { IconWeight } from 'phosphor-svelte';
  import type { IconDefinition } from '$lib/icons/phosphor-icons';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import Item from './menu-item.svelte';
  import { ShortcutChip } from '$lib/components/ui/kbd';

  let {
    icon,
    iconWeight,
    label,
    shortcut,
    destructive = false,
    ...restProps
  }: Omit<MenuPrimitive.ItemProps, 'children'> & {
    icon?: IconDefinition;
    iconWeight?: IconWeight;
    label: string;
    shortcut?: string;
    destructive?: boolean;
  } = $props();
</script>

{#snippet leading()}
  {#if icon}
    <Fa {icon} weight={iconWeight} size={16} class="size-4 text-muted-foreground opacity-70" />
  {/if}
{/snippet}

<Item
  {destructive}
  leading={icon ? leading : undefined}
  {...restProps}
  data-slot="menu-command-item"
>
  <span class="min-w-0 flex-1 truncate">{label}</span>
  {#if shortcut}
    <span class="ml-5" aria-hidden="true"><ShortcutChip>{shortcut}</ShortcutChip></span>
  {/if}
</Item>
