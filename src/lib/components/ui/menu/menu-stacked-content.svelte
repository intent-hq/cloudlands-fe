<script lang="ts">
  import type { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import CommandItem from './menu-command-item.svelte';
  import Content from './menu-content.svelte';
  import Separator from './menu-separator.svelte';
  import SubContent from './menu-sub-content.svelte';
  import SubTrigger from './menu-sub-trigger.svelte';
  import Sub from './menu-sub.svelte';
  import Label from './menu-label.svelte';
  import { DropdownMenu } from 'bits-ui';
  import type { StackedMenuGroup, StackedMenuItem } from './menu-stacked-content.types';
  import { ShortcutChip } from '$lib/components/ui/kbd';

  let {
    groups,
    class: className,
    submenuClass,
    ...restProps
  }: Omit<MenuPrimitive.ContentProps, 'children'> & {
    groups: StackedMenuGroup[];
    submenuClass?: string;
    portal?: boolean;
    portalProps?: MenuPrimitive.PortalProps;
  } = $props();

  function visibleItems(items: StackedMenuItem[]): StackedMenuItem[] {
    return items.flatMap((item) => {
      if (item.when === false) return [];
      if (!item.items || item.content) return [item];
      const children = visibleItems(item.items);
      return children.length ? [{ ...item, items: children }] : [];
    });
  }

  const visibleGroups = $derived(
    groups
      .map((group) => ({ ...group, items: visibleItems(group.items) }))
      .filter((group) => group.items.length > 0),
  );
</script>

{#snippet renderItems(items: StackedMenuItem[])}
  {#each items as item (item.id)}
    {#if item.items?.length || item.content}
      <Sub>
        <SubTrigger icon={item.icon} disabled={item.disabled} class={item.class}>
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if item.shortcut}
            <span class="ml-5 flex h-lh shrink-0 items-center" aria-hidden="true"
              ><ShortcutChip>{item.shortcut}</ShortcutChip></span
            >
          {/if}
        </SubTrigger>
        <SubContent class={submenuClass}>
          {#if item.content}
            {@render item.content()}
          {:else if item.items}
            {@render renderItems(item.items)}
          {/if}
        </SubContent>
      </Sub>
    {:else}
      <CommandItem
        icon={item.icon}
        label={item.label}
        shortcut={item.shortcut}
        disabled={item.disabled}
        destructive={item.destructive}
        class={item.class}
        onSelect={item.onSelect}
      />
    {/if}
  {/each}
{/snippet}

<Content class={cn('w-60', className)} {...restProps}>
  {#each visibleGroups as group, index (group.id)}
    {#if index > 0}
      <Separator />
    {/if}
    <DropdownMenu.Group aria-label={group.label} data-slot="menu-stack-group">
      {#if group.label}
        <Label>{group.label}</Label>
      {/if}
      {@render renderItems(group.items)}
    </DropdownMenu.Group>
  {/each}
</Content>
