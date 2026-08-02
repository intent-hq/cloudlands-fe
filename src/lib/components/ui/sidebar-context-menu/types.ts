import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

export interface SidebarMenuItem {
  id: string;
  label: string;
  icon?: IconDefinition;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Marks the item as active/selected (renders a check indicator). */
  checked?: boolean;
  /** Child items rendered in a flyout submenu; `onClick` is ignored when set. */
  submenu?: SidebarMenuItem[];
}

export interface SidebarMenuSeparator {
  type: 'separator';
}

export type SidebarMenuEntry = SidebarMenuItem | SidebarMenuSeparator;

export function isSeparator(entry: SidebarMenuEntry): entry is SidebarMenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}
