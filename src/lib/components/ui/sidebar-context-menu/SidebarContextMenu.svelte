<script lang="ts">
  import { ActionMenu } from '$lib/components/patterns/action-menu';
  import * as m from '$shared/paraglide/messages.js';
  import type { SidebarMenuEntry } from './types';
  import { toSidebarActions, findSidebarItem } from './actions';

  interface Props {
    x: number;
    y: number;
    items: SidebarMenuEntry[];
    onClickOutside?: () => void;
    ariaLabel?: string;
    returnFocus?: HTMLElement | null;
    selection?: 'single';
  }

  let {
    x,
    y,
    items,
    onClickOutside,
    ariaLabel = m.ui_menu_actions_ariaLabel(),
    returnFocus,
    selection,
  }: Props = $props();
  const actions = $derived(toSidebarActions(items, selection, ariaLabel));
</script>

<ActionMenu
  {actions}
  {ariaLabel}
  contextMenu={{ x, y, returnFocus }}
  onAction={(id) => findSidebarItem(items, id)?.onClick()}
  onOpenChange={(open) => {
    if (!open) onClickOutside?.();
  }}
/>
