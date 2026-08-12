<script lang="ts">
  import Combobox, { type ComboboxOption } from '../combobox';
  import { m } from '$shared/paraglide/messages.js';

  interface Option extends ComboboxOption {
    icon?: unknown;
  }

  interface Props {
    value?: string;
    options?: Option[];
    placeholder?: string;
    searchPlaceholder?: string;
    disabled?: boolean;
    loading?: boolean;
    allowCustom?: boolean;
    onSearch?: (query: string) => Promise<Option[]>;
    onChange?: (value: string) => void;
    class?: string;
  }

  let {
    value = $bindable(''),
    options = [],
    placeholder = m.ui_searchableSelect_select_placeholder(),
    searchPlaceholder = m.ui_searchableSelect_search_placeholder(),
    disabled = false,
    loading = false,
    allowCustom = false,
    onSearch,
    onChange,
    class: className = '',
  }: Props = $props();

  function handleChange(nextValue: string | string[]) {
    if (typeof nextValue === 'string') onChange?.(nextValue);
  }
</script>

<Combobox
  bind:value
  {options}
  {placeholder}
  {searchPlaceholder}
  {disabled}
  {loading}
  {allowCustom}
  onsearch={onSearch}
  class={className}
  ariaLabel={placeholder}
  portal={false}
  onchange={handleChange}
/>
