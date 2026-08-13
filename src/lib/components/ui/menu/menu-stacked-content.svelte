<script lang="ts">
  import type { DropdownMenu as MenuPrimitive } from 'bits-ui';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { cn } from '$lib/utils.js';
  import CommandItem from './menu-command-item.svelte';
  import Content from './menu-content.svelte';
  import Separator from './menu-separator.svelte';
  import SubContent from './menu-sub-content.svelte';
  import SubTrigger from './menu-sub-trigger.svelte';
  import { DropdownMenu } from 'bits-ui';
  import type { StackedMenuGroup, StackedMenuItem } from './menu-stacked-content.types';

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
</script>

{#snippet renderItems(items: StackedMenuItem[])}
  {#each items as item (item.id)}
    {#if item.items?.length}
      <DropdownMenu.Sub>
        <SubTrigger disabled={item.disabled} class={item.class}>
          {#if item.icon}
            <Fa icon={item.icon} size="xs" class="w-4 shrink-0 text-muted-foreground opacity-70" />
          {/if}
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if item.shortcut}
            <kbd class="type-caption ml-5 shrink-0 text-muted-foreground" aria-hidden="true">
              {item.shortcut}
            </kbd>
          {/if}
        </SubTrigger>
        <SubContent class={submenuClass}>
          {@render renderItems(item.items)}
        </SubContent>
      </DropdownMenu.Sub>
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
  {#each groups as group, index (group.id)}
    {#if index > 0}
      <Separator />
    {/if}
    <div role="group" aria-label={group.label} data-slot="menu-stack-group">
      {#if group.label}
        <div class="type-caption px-2 pb-1 pt-1 font-medium text-muted-foreground">
          {group.label}
        </div>
      {/if}
      {@render renderItems(group.items)}
    </div>
  {/each}
</Content>
