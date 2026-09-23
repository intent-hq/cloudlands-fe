<script lang="ts">
  import { ActionMenu } from '$lib/components/patterns/action-menu';
  import { Button } from '$lib/components/ui/button';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import { toSidebarActions, findSidebarItem } from './actions';

  let {
    items,
    ariaLabel,
    open = $bindable(false),
    orientation = 'vertical',
    selection,
    class: className = '',
  }: {
    items: SidebarMenuEntry[];
    ariaLabel: string;
    open?: boolean;
    orientation?: 'horizontal' | 'vertical';
    selection?: 'single';
    class?: string;
  } = $props();

  const actions = $derived(toSidebarActions(items, selection, ariaLabel));
</script>

<ActionMenu
  {actions}
  bind:open
  align="end"
  {ariaLabel}
  onAction={(id) => findSidebarItem(items, id)?.onClick()}
>
  {#snippet trigger({ props })}
    <Button
      {...props}
      variant="plain"
      size="icon-compact"
      iconOnly
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
