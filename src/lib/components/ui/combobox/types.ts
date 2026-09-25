export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: unknown;
  data?: unknown;
  class?: string;
}

export interface ComboboxGroup {
  separatorBefore?: boolean;
  /** Retain the heading and option identities while hiding a group's rows until searched. */
  collapsed?: boolean;
  key: string;
  label: string;
  options: ComboboxOption[];
  icon?: unknown;
  data?: unknown;
}
