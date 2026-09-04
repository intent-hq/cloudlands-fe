<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Combobox as ComboboxPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import type { ComboboxGroup, ComboboxOption } from './types';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    value?: string | string[];
    options?: ComboboxOption[];
    groups?: ComboboxGroup[];
    multiple?: boolean;
    open?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    loading?: boolean;
    portal?: boolean;
    side?: 'top' | 'bottom';
    ariaLabel: string;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    class?: string;
    inputClass?: string;
    contentClass?: string;
    displayValue?: string;
    allowCustom?: boolean;
    header?: string;
    headerAction?: Snippet;
    footer?: Snippet;
    optionDescription?: Snippet<[ComboboxOption]>;
    optionActions?: Snippet<[ComboboxOption]>;
    groupDescription?: Snippet<[ComboboxGroup]>;
    groupAction?: Snippet<[ComboboxGroup]>;
    onsearch?: (
      query: string,
    ) => ComboboxOption[] | ComboboxGroup[] | Promise<ComboboxOption[] | ComboboxGroup[]>;
    onquerychange?: (query: string) => void;
    onchange?: (value: string | string[]) => void;
    onopenchange?: (open: boolean) => void;
  }

  let {
    value = $bindable(),
    options = [],
    groups = [],
    multiple = false,
    open = $bindable(false),
    disabled = false,
    invalid = false,
    loading = false,
    portal = true,
    side = 'bottom',
    ariaLabel,
    placeholder = m.ui_combobox_selectOption_placeholder(),
    searchPlaceholder = m.ui_combobox_searchOptions_placeholder(),
    emptyText = m.ui_combobox_noOptions_message(),
    class: className = '',
    inputClass = '',
    contentClass = '',
    displayValue,
    allowCustom = false,
    header = '',
    headerAction,
    footer,
    optionDescription,
    optionActions,
    groupDescription,
    groupAction,
    onsearch,
    onquerychange,
    onchange,
    onopenchange,
  }: Props = $props();

  let query = $state('');
  let singleValue = $state('');
  let multipleValue = $state<string[]>([]);
  let searchedGroups = $state<ComboboxGroup[] | null>(null);
  let searching = $state(false);
  let searchGeneration = 0;
  const baseGroups = $derived(
    groups.length > 0 ? groups : [{ key: 'options', label: '', options }],
  );
  const customOption = $derived.by<ComboboxOption | null>(() => {
    const customValue = query.trim();
    if (!allowCustom || !customValue) return null;
    const exists = baseGroups
      .flatMap((group) => group.options)
      .some((option) => option.value === customValue || option.label === customValue);
    return exists ? null : { value: customValue, label: customValue };
  });
  const normalizedGroups = $derived.by(() => {
    const source = searchedGroups ?? baseGroups;
    if (!customOption) return source;
    return [
      ...source,
      { key: 'custom', label: '', options: [customOption] satisfies ComboboxOption[] },
    ];
  });
  const items = $derived(
    normalizedGroups
      .flatMap((group) => group.options)
      .map(({ value, label, disabled }) => ({
        value,
        label,
        disabled,
      })),
  );
  const filteredGroups = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return normalizedGroups;
    return normalizedGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          `${option.label} ${option.description ?? ''}`.toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter((group) => group.options.length > 0);
  });
  const hasOptions = $derived(filteredGroups.some((group) => group.options.length > 0));
  const selectedInputValue = $derived.by(() => {
    if (displayValue !== undefined) return displayValue;
    const selectedValues = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return selectedValues
      .map(
        (selectedValue) =>
          baseGroups
            .flatMap((group) => group.options)
            .find((option) => option.value === selectedValue)?.label ?? selectedValue,
      )
      .filter(Boolean)
      .join(', ');
  });
  const visibleInputValue = $derived(open ? query : selectedInputValue);
  $effect(() => {
    if (typeof value === 'string' && value !== singleValue) singleValue = value;
  });

  $effect(() => {
    if (
      Array.isArray(value) &&
      (value.length !== multipleValue.length ||
        value.some((item, index) => item !== multipleValue[index]))
    ) {
      multipleValue = [...value];
    }
  });

  function handleFocus() {
    if (disabled) return;
    query = '';
    searchedGroups = null;
    if (!open) {
      open = true;
      onopenchange?.(true);
    }
  }

  function handleInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    open = true;
    onquerychange?.(query);
    void runSearch(query);
  }

  async function runSearch(nextQuery: string) {
    const generation = ++searchGeneration;
    if (!onsearch || !nextQuery) {
      searchedGroups = null;
      searching = false;
      return;
    }
    searching = true;
    const results = await Promise.resolve(onsearch(nextQuery));
    if (generation !== searchGeneration) return;
    searchedGroups =
      results.length > 0 && 'options' in results[0]
        ? (results as ComboboxGroup[])
        : [{ key: 'search-results', label: '', options: results as ComboboxOption[] }];
    searching = false;
  }

  function handleSingleChange(nextValue: string) {
    value = nextValue;
    query = '';
    onchange?.(nextValue);
  }

  function handleMultipleChange(nextValue: string[]) {
    value = nextValue;
    query = '';
    onchange?.(nextValue);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      query = '';
      searchedGroups = null;
      searching = false;
      searchGeneration += 1;
    }
    onopenchange?.(nextOpen);
  }
</script>

<div class={cn('relative w-full', className)}>
  {#if multiple}
    <ComboboxPrimitive.Root
      type="multiple"
      bind:value={multipleValue}
      {items}
      {disabled}
      bind:open
      inputValue={visibleInputValue}
      onValueChange={handleMultipleChange}
      onOpenChange={handleOpenChange}
    >
      {@render comboboxContent()}
    </ComboboxPrimitive.Root>
  {:else}
    <ComboboxPrimitive.Root
      type="single"
      bind:value={singleValue}
      {items}
      {disabled}
      bind:open
      inputValue={visibleInputValue}
      onValueChange={handleSingleChange}
      onOpenChange={handleOpenChange}
    >
      {@render comboboxContent()}
    </ComboboxPrimitive.Root>
  {/if}
</div>

{#snippet comboboxContent()}
  <ComboboxPrimitive.Input
    aria-label={ariaLabel}
    aria-invalid={invalid || undefined}
    placeholder={open ? searchPlaceholder : placeholder}
    onfocus={handleFocus}
    oninput={handleInput}
    class={cn(
      'type-body border-border bg-card text-foreground placeholder:text-muted-foreground/70 h-(--control-height-medium) w-full min-w-0 rounded-(--radius-medium) border px-3 shadow-(--elevation-raised) outline-none transition-[border-color,background-color,box-shadow] duration-(--motion-fast)',
      'hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
      'disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border motion-reduce:transition-none',
      invalid && 'border-danger ring-1 ring-danger/25',
      inputClass,
    )}
  />
  <ComboboxPrimitive.Portal disabled={!portal}>
    <ComboboxPrimitive.Content
      {side}
      sideOffset={4}
      class={cn(
        'z-(--layer-popover) w-(--bits-combobox-anchor-width) max-h-72 overflow-hidden rounded-(--radius-medium) border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay)',
        contentClass,
      )}
      style="max-width: calc(100vw - var(--space-4));"
    >
      {#if header || headerAction}
        <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          {#if header}<span class="type-caption min-w-0 truncate font-medium text-muted-foreground"
              >{header}</span
            >{/if}
          {#if headerAction}<div class="ml-auto">{@render headerAction()}</div>{/if}
        </div>
      {/if}
      <ComboboxPrimitive.Viewport class="max-h-72 overscroll-contain overflow-y-auto p-1">
        {#if loading || searching}
          <div class="type-body px-3 py-2 text-muted-foreground" role="status">
            {m.ui_combobox_loadingOptions_message()}
          </div>
        {:else if !hasOptions && groups.length === 0}
          <div class="type-body px-3 py-2 text-muted-foreground">{emptyText}</div>
        {:else}
          {#each filteredGroups as group (group.key)}
            <ComboboxPrimitive.Group>
              {#if group.label}
                <ComboboxPrimitive.GroupHeading
                  class="type-caption px-2 py-1.5 font-medium text-muted-foreground"
                >
                  <span>{group.label}</span>
                  {#if groupDescription}{@render groupDescription(group)}{/if}
                  {#if groupAction}{@render groupAction(group)}{/if}
                </ComboboxPrimitive.GroupHeading>
              {/if}
              {#each group.options as option (option.value)}
                <ComboboxPrimitive.Item
                  value={option.value}
                  label={option.label}
                  disabled={option.disabled}
                  class={cn(
                    'group type-body flex min-h-(--control-height-compact) min-w-0 cursor-pointer items-center gap-2 rounded-(--radius-small) px-2 py-1.5 outline-none transition-colors duration-(--motion-fast) data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-accent/60 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 motion-reduce:transition-none',
                    option.class,
                  )}
                >
                  <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  {#if optionDescription}
                    {@render optionDescription(option)}
                  {:else if option.description}
                    <span class="type-caption max-w-1/2 shrink-0 truncate text-muted-foreground">
                      {option.description}
                    </span>
                  {/if}
                  <span
                    data-slot="combobox-item-check"
                    class="text-primary shrink-0 font-medium opacity-0 group-data-[selected]:opacity-100"
                    aria-hidden="true">✓</span
                  >
                  {#if optionActions}{@render optionActions(option)}{/if}
                </ComboboxPrimitive.Item>
              {/each}
            </ComboboxPrimitive.Group>
          {/each}
        {/if}
      </ComboboxPrimitive.Viewport>
      {#if footer}
        <div class="shrink-0 border-t border-border bg-muted/20 px-3 py-2">{@render footer()}</div>
      {/if}
    </ComboboxPrimitive.Content>
  </ComboboxPrimitive.Portal>
{/snippet}
