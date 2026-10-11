// Source: src/lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte.
import { ActionMenu } from '@/components/patterns/action-menu';
import { m } from '$shared/paraglide/messages.js';
import { toSidebarActions, findSidebarItem } from './actions';
import type { SidebarMenuEntry } from './types';

export interface SidebarContextMenuProps {
  x: number;
  y: number;
  items: SidebarMenuEntry[];
  onClickOutside?: () => void;
  ariaLabel?: string;
  returnFocus?: HTMLElement | null;
  selection?: 'single';
}
export function SidebarContextMenu({
  x,
  y,
  items,
  onClickOutside,
  ariaLabel = m.ui_menu_actions_ariaLabel(),
  returnFocus,
  selection,
}: SidebarContextMenuProps) {
  return (
    <ActionMenu
      actions={toSidebarActions(items, selection, ariaLabel)}
      ariaLabel={ariaLabel}
      contextMenu={{ x, y, returnFocus }}
      onAction={(id) => findSidebarItem(items, id)?.onClick()}
      onOpenChange={(open) => {
        if (!open) onClickOutside?.();
      }}
    />
  );
}
export default SidebarContextMenu;
