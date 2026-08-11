<script lang="ts">
  import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
  import { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import Fa from 'svelte-fa';
  import Item from './menu-item.svelte';

  let {
    icon,
    label,
    shortcut,
    destructive = false,
    ...restProps
  }: Omit<MenuPrimitive.ItemProps, 'children'> & {
    icon?: IconDefinition;
    label: string;
    shortcut?: string;
    destructive?: boolean;
  } = $props();
</script>

<Item {destructive} {...restProps} data-slot="menu-command-item">
  {#if icon}
    <Fa {icon} size="xs" class="w-4 shrink-0 text-muted-foreground opacity-70" />
  {/if}
  <span class="min-w-0 flex-1 truncate">{label}</span>
  {#if shortcut}
    <kbd class="type-caption ml-5 shrink-0 text-right text-muted-foreground" aria-hidden="true"
      >{shortcut}</kbd
    >
  {/if}
</Item>
