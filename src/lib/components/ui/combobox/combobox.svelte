<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Combobox as ComboboxPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils';
  import type { ComboboxGroup, ComboboxOption } from './types';
  import { m } from '$shared/paraglide/messages.js';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  import { menuItem, menuOverlay } from '../menu/menu-recipes';
  import { slide } from '$lib/motion';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { textEntryControlClasses, textEntryHeight } from '../text-entry';

  const uid = $props.id();

  interface Props {
    value?: string | string[];
    options?: ComboboxOption[];
    groups?: ComboboxGroup[];
    multiple?: boolean;
    open?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    size?: UiSize;
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
    size,
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

  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contextSize = useSize();
  const resolvedSize = $derived(size ?? contextSize);
  const inputId = `${uid}-input`;
  const labelId = `${uid}-label`;
  const listboxId = `${uid}-listbox`;

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
    if (!query.trim()) return normalizedGroups;
    return normalizedGroups.map((group) => ({
      ...group,
      options: group.options.filter((option) => optionMatchesQuery(option)),
    }));
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

  function optionMatchesQuery(option: ComboboxOption) {
    const normalizedQuery = query.trim().toLowerCase();
    return (
      !normalizedQuery ||
      `${option.label} ${option.description ?? ''}`.toLowerCase().includes(normalizedQuery)
    );
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

  function withoutListboxSemantics(props: Record<string, unknown>) {
    const { role: _role, tabindex: _tabindex, ...contentProps } = props;
    return contentProps;
  }
</script>

<div class={cn('relative w-full', className)}>
  <span id={labelId} class="sr-only">{ariaLabel}</span>
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
    id={inputId}
    aria-labelledby={labelId}
    aria-controls={open ? listboxId : undefined}
    aria-invalid={invalid || undefined}
    placeholder={open ? searchPlaceholder : placeholder}
    onfocus={handleFocus}
    oninput={handleInput}
    data-size={resolvedSize}
    class={cn(
      'type-caption text-foreground placeholder:text-muted-foreground/70 w-full min-w-0 rounded-(--radius-medium) border px-3',
      textEntryControlClasses,
      textEntryHeight(resolvedSize),
      invalid && 'border-danger ring-1 ring-danger/25',
      inputClass,
    )}
  />
  <ComboboxPrimitive.Portal disabled={!portal}>
    <ComboboxPrimitive.Content
      {side}
      sideOffset={4}
      data-surface-level={surface}
      class={cn(
        menuOverlay(),
        surfaceClasses(surface),
        'w-(--bits-combobox-anchor-width) max-h-72 rounded-(--radius-medium)',
        contentClass,
      )}
      style="max-width: calc(100vw - var(--space-4));"
    >
      {#snippet child({ props, wrapperProps })}
        {@const contentProps = withoutListboxSemantics(props)}
        <div {...wrapperProps}>
          <div {...contentProps}>
            {#if header || headerAction}
              <div
                class="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2"
              >
                {#if header}<span
                    class="type-caption min-w-0 truncate font-medium text-muted-foreground"
                    >{header}</span
                  >{/if}
                {#if headerAction}<div class="ml-auto">{@render headerAction()}</div>{/if}
              </div>
            {/if}
            <ComboboxPrimitive.Viewport class="max-h-72 overscroll-contain overflow-y-auto p-1">
              {#snippet child({ props: viewportProps })}
                <div
                  {...viewportProps}
                  id={listboxId}
                  role="listbox"
                  aria-labelledby={labelId}
                  tabindex="0"
                >
                  <ListHighlight />
                  {#if loading}
                    <div class="type-body px-3 py-2 text-muted-foreground" role="status">
                      {m.ui_combobox_loadingOptions_message()}
                    </div>
                  {:else}
                    {#if searching}
                      <div class="type-body px-3 py-2 text-muted-foreground" role="status">
                        {m.ui_combobox_loadingOptions_message()}
                      </div>
                    {/if}
                    {#if !hasOptions && groups.length === 0 && !searching}
                      <div class="type-body px-3 py-2 text-muted-foreground">{emptyText}</div>
                    {/if}
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
                          <!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
                          {#snippet optionChild({ props }: { props: Record<string, unknown> })}
                            <div
                              {...props}
                              data-slot="combobox-option-motion"
                              transition:slide={{ tier: 'fast' }}
                            >
                              <span class="min-w-0 flex-1 truncate">{option.label}</span>
                              {#if optionDescription}
                                {@render optionDescription(option)}
                              {:else if option.description}
                                <span
                                  class="type-caption max-w-1/2 shrink-0 truncate text-muted-foreground"
                                >
                                  {option.description}
                                </span>
                              {/if}
                              <span
                                data-slot="combobox-item-check"
                                class="text-primary-ink shrink-0 font-medium opacity-0 group-data-[selected]:opacity-100"
                                aria-hidden="true">✓</span
                              >
                              {#if optionActions}{@render optionActions(option)}{/if}
                            </div>
                          {/snippet}
                          <ComboboxPrimitive.Item
                            value={option.value}
                            label={option.label}
                            disabled={option.disabled || !optionMatchesQuery(option)}
                            data-menu-item
                            class={cn(
                              menuItem(),
                              'min-h-(--control-height-compact) p-1.5',
                              option.class,
                            )}
                            child={optionChild}
                          />
                        {/each}
                      </ComboboxPrimitive.Group>
                    {/each}
                  {/if}
                </div>
              {/snippet}
            </ComboboxPrimitive.Viewport>
            {#if footer}
              <div class="shrink-0 border-t border-border bg-muted/20 px-3 py-2">
                {@render footer()}
              </div>
            {/if}
          </div>
        </div>
      {/snippet}
    </ComboboxPrimitive.Content>
  </ComboboxPrimitive.Portal>
{/snippet}
