import type { Snippet } from 'svelte';

export type ListKey = string | number;
export type SelectionMode = false | 'single' | 'multi';

export interface ListRowContext<T> {
  item: T;
  index: number;
  selected: boolean;
  highlighted: boolean;
}

export interface RowAction {
  label: string;
  icon: Snippet;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface DataListItem {
  key: ListKey;
  label: string;
  value?: string;
  description?: string;
}
