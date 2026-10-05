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
    ariaLabel?: string;
    ariaLabelledby?: string;
    ariaDescribedby?: string;
    emptyText?: string;
    errorText?: string;
    retryText?: string;
    onSearchError?: (error: unknown, query: string) => void;
    disabled?: boolean;
    loading?: boolean;
    allowCustom?: boolean;
    onSearch?: (query: string) => Promise<Option[]>;
    onChange?: (value: string) => void;
    class?: string;
    open?: boolean;
    staticPosition?: boolean;
  }

  let {
    value = $bindable(''),
    options = [],
    placeholder = m.ui_searchableSelect_select_placeholder(),
    searchPlaceholder = m.ui_searchableSelect_search_placeholder(),
    ariaLabel,
    ariaLabelledby,
    ariaDescribedby,
    emptyText,
    errorText,
    retryText,
    onSearchError,
    disabled = false,
    loading = false,
    allowCustom = false,
    onSearch,
    onChange,
    class: className = '',
    open = $bindable(false),
    staticPosition = false,
  }: Props = $props();

  function handleChange(nextValue: string | string[]) {
    if (typeof nextValue === 'string') onChange?.(nextValue);
  }
</script>

<Combobox
  bind:value
  bind:open
  {options}
  {placeholder}
  {searchPlaceholder}
  {disabled}
  {loading}
  {allowCustom}
  {emptyText}
  {errorText}
  {retryText}
  onsearch={onSearch}
  onsearcherror={onSearchError}
  class={className}
  ariaLabel={ariaLabel ?? placeholder}
  {ariaLabelledby}
  {ariaDescribedby}
  portal={false}
  {staticPosition}
  onchange={handleChange}
/>
