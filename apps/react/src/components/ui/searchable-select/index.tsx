// Source: ui/searchable-select/searchable-select.svelte.
import { m } from '$shared/paraglide/messages.js';
import { Combobox, type ComboboxOption, type ComboboxProps } from '@/components/ui/combobox';

export type SearchableSelectProps = Omit<
  ComboboxProps,
  'ariaLabel' | 'value' | 'defaultValue' | 'onChange' | 'onSearch' | 'multiple' | 'groups'
> & {
  ariaLabel?: string;
  value?: string;
  defaultValue?: string;
  onSearch?: (query: string) => Promise<ComboboxOption[]> | ComboboxOption[];
  onChange?: (value: string) => void;
};

export function SearchableSelect({
  ariaLabel,
  placeholder = m.ui_searchableSelect_select_placeholder(),
  searchPlaceholder = m.ui_searchableSelect_search_placeholder(),
  onChange,
  ...props
}: SearchableSelectProps) {
  return (
    <Combobox
      {...props}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      ariaLabel={ariaLabel ?? placeholder}
      portal={false}
      onChange={(value) => {
        if (typeof value === 'string') onChange?.(value);
      }}
    />
  );
}

export default SearchableSelect;
