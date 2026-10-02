import type { IconDefinition } from '$lib/icons/phosphor-icons';
import type { Snippet } from 'svelte';

export interface StackedMenuItem {
  id: string;
  label: string;
  icon?: IconDefinition;
  shortcut?: string;
  disabled?: boolean;
  when?: boolean;
  destructive?: boolean;
  class?: string;
  onSelect?: (event: Event) => void;
  items?: StackedMenuItem[];
  /** @deprecated Custom menu rows only; rich controls belong in a Popover. */
  content?: Snippet;
}

export interface StackedMenuGroup {
  id: string;
  label?: string;
  items: StackedMenuItem[];
}
