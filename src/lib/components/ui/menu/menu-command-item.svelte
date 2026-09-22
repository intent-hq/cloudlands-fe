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
    disabled = false,
    disabledReason,
    'aria-describedby': describedBy,
    ...restProps
  }: Omit<MenuPrimitive.ItemProps, 'children'> & {
    icon?: IconDefinition;
    iconWeight?: IconWeight;
    label: string;
    shortcut?: string;
    destructive?: boolean;
    disabledReason?: string;
  } = $props();
  const uid = $props.id();
  const reasonId = `${uid}-reason`;
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
  disabled={disabled || disabledReason !== undefined}
  aria-describedby={[describedBy, disabledReason ? reasonId : undefined]
    .filter(Boolean)
    .join(' ') || undefined}
  data-slot="menu-command-item"
>
  <span class="min-w-0 flex-1">
    <span class="block truncate">{label}</span>
    {#if disabledReason}
      <span id={reasonId} class="block text-muted-foreground" aria-hidden="true"
        >{disabledReason}</span
      >
    {/if}
  </span>
  {#if shortcut}
    <span class="ml-5" aria-hidden="true"><ShortcutChip>{shortcut}</ShortcutChip></span>
  {/if}
</Item>
