export type ListKey = string | number;
export type SelectionMode = false | 'single' | 'multi';

export interface ListRowContext<T> {
  item: T;
  index: number;
  selected: boolean;
  highlighted: boolean;
}

export interface DataListItem {
  key: ListKey;
  label: string;
  value?: string;
  description?: string;
}
