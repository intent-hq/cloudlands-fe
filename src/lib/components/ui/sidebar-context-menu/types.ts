import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

export interface SidebarMenuItem {
  id: string;
  label: string;
  icon?: IconDefinition;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface SidebarMenuSeparator {
  type: 'separator';
}

export type SidebarMenuEntry = SidebarMenuItem | SidebarMenuSeparator;

export function isSeparator(entry: SidebarMenuEntry): entry is SidebarMenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}
