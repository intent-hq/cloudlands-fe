import type { IconDefinition } from '$lib/icons/phosphor-icons';

export interface StackedMenuItem {
  id: string;
  label: string;
  icon?: IconDefinition;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  class?: string;
  onSelect?: (event: Event) => void;
  items?: StackedMenuItem[];
}

export interface StackedMenuGroup {
  id: string;
  label?: string;
  items: StackedMenuItem[];
}
