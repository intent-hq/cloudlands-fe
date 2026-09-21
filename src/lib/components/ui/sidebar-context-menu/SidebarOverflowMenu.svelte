<script lang="ts">
  import {
    ActionMenu,
    defineActions,
    type ActionDefinition,
  } from '$lib/components/patterns/action-menu';
  import { Button } from '$lib/components/ui/button';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import {
    isSeparator,
    type SidebarMenuEntry,
    type SidebarMenuItem,
  } from '$lib/components/ui/sidebar-context-menu/types';

  let {
    items,
    ariaLabel,
    open = $bindable(false),
    orientation = 'vertical',
    class: className = '',
  }: {
    items: SidebarMenuEntry[];
    ariaLabel: string;
    open?: boolean;
    orientation?: 'horizontal' | 'vertical';
    class?: string;
  } = $props();

  function toActions(entries: readonly SidebarMenuEntry[]): ActionDefinition[] {
    let group = 0;
    return entries.flatMap((entry) => {
      if (isSeparator(entry)) {
        group += 1;
        return [];
      }
      return [
        {
          id: entry.id,
          label: entry.label,
          icon: entry.icon,
          destructive: entry.destructive,
          disabled: entry.disabled,
          checked: entry.checked,
          group: String(group),
          children: entry.submenu ? toActions(entry.submenu) : undefined,
        },
      ];
    });
  }

  function findItem(entries: readonly SidebarMenuEntry[], id: string): SidebarMenuItem | undefined {
    for (const entry of entries) {
      if (isSeparator(entry)) continue;
      if (entry.id === id) return entry;
      const child = entry.submenu ? findItem(entry.submenu, id) : undefined;
      if (child) return child;
    }
    return undefined;
  }

  const actions = $derived(defineActions(toActions(items)));
</script>

<ActionMenu
  {actions}
  bind:open
  align="end"
  {ariaLabel}
  onAction={(id) => findItem(items, id)?.onClick()}
>
  {#snippet trigger({ props })}
    <Button
      {...props}
      variant="plain"
      type="button"
      class={className}
      aria-label={ariaLabel}
      onclick={(event) => {
        event.stopPropagation();
        (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
      }}
      oncontextmenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {#if orientation === 'horizontal'}
        <span aria-hidden="true">⋯</span>
      {:else}
        <KebabIcon class="size-3.5" />
      {/if}
    </Button>
  {/snippet}
</ActionMenu>
