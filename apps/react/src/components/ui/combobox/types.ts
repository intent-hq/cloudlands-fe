import type { ReactNode, Ref } from 'react';
import type { UiSize } from '@/components/ui/size-context';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: unknown;
  data?: unknown;
  className?: string;
  /** Source option metadata may still carry the framework-neutral class field. */
  class?: string;
}

export interface ComboboxGroup {
  separatorBefore?: boolean;
  collapsed?: boolean;
  key: string;
  label: string;
  options: ComboboxOption[];
  icon?: unknown;
  data?: unknown;
}

export interface ComboboxProps {
  value?: string | string[];
  defaultValue?: string | string[];
  options?: ComboboxOption[];
  groups?: ComboboxGroup[];
  multiple?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  size?: UiSize;
  loading?: boolean;
  portal?: boolean;
  staticPosition?: boolean;
  side?: 'top' | 'bottom';
  ariaLabel: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  errorText?: string;
  retryText?: string;
  className?: string;
  inputClass?: string;
  inputRef?: Ref<HTMLInputElement>;
  contentClass?: string;
  displayValue?: string;
  allowCustom?: boolean;
  header?: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  /** Null accepts already-ranked canonical results without a second text filter. */
  filterOption?: ((option: ComboboxOption, query: string) => boolean) | null;
  optionLabel?: (option: ComboboxOption) => ReactNode;
  optionDescription?: (option: ComboboxOption) => ReactNode;
  optionActions?: (option: ComboboxOption) => ReactNode;
  groupDescription?: (group: ComboboxGroup) => ReactNode;
  groupAction?: (group: ComboboxGroup) => ReactNode;
  onSearch?: (
    query: string,
  ) => ComboboxOption[] | ComboboxGroup[] | Promise<ComboboxOption[] | ComboboxGroup[]>;
  onQueryChange?: (query: string) => void;
  onSearchError?: (error: unknown, query: string) => void;
  onChange?: (value: string | string[], option?: ComboboxOption) => void;
  /** Final synchronous admission; false leaves the query and popup intact. */
  onBeforeCommit?: (option: ComboboxOption) => boolean;
  /** Accepted activation, including explicit reselection of the current value. */
  onCommit?: (value: string | string[], option: ComboboxOption) => void;
  /** A containing dialog may retain the picker while focus moves to sibling controls. */
  onBeforeOpenChange?: (
    open: boolean,
    reason: 'escape' | 'outside' | 'tab' | 'selection' | 'other',
  ) => boolean;
  onOpenChange?: (open: boolean) => void;
}
