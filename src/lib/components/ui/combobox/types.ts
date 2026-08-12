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
  key: string;
  label: string;
  options: ComboboxOption[];
  icon?: unknown;
  data?: unknown;
}
