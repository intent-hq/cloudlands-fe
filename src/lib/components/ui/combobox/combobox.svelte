<script lang="ts">
  import { flushSync, onDestroy, untrack, type Snippet } from 'svelte';
  import { Combobox as ComboboxPrimitive } from 'bits-ui';
  import { Button } from '$lib/components/ui/button';
  import { Indicator } from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import type { ComboboxGroup, ComboboxOption } from './types';
  import { m } from '$shared/paraglide/messages.js';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  import { menuItem, menuOverlay } from '../menu/menu-recipes';
  import { clampSurface, setSurface, useSurface } from '$lib/components/ui/surface-context';
  import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { textEntryControlClasses, textEntryHeight } from '../text-entry';
  import { OVERLAY_VIEWPORT_GUTTER } from '$lib/components/ui/overlay-positioning';

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
    class?: string;
    inputClass?: string;
    inputRef?: HTMLInputElement | null;
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
    onsearcherror?: (error: unknown, query: string) => void;
    onchange?: (value: string | string[], option?: ComboboxOption) => void;
    /** Accepted user activation, including reselecting the current single value. */
    oncommit?: (value: string | string[], option: ComboboxOption) => void;
    onopenchange?: (open: boolean) => void;
  }

  type StaticContentChildProps = { props: Record<string, unknown> };
  type OptionChildProps = StaticContentChildProps & { selected: boolean };
  type ContentChildProps = StaticContentChildProps & {
    wrapperProps: Record<string, unknown>;
  };

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
    staticPosition = false,
    side = 'bottom',
    ariaLabel,
    ariaLabelledby,
    ariaDescribedby,
    placeholder = m.ui_combobox_selectOption_placeholder(),
    searchPlaceholder = m.ui_combobox_searchOptions_placeholder(),
    emptyText = m.ui_combobox_noOptions_message(),
    errorText = m.ui_combobox_searchFailed_error(),
    retryText = m.ui_combobox_retry_label(),
    class: className = '',
    inputClass = '',
    inputRef = $bindable(null),
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
    onsearcherror,
    onchange,
    oncommit,
    onopenchange,
  }: Props = $props();

  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const contextSize = useSize();
  const resolvedSize = $derived(size ?? contextSize);
  const inputId = `${uid}-input`;
  const labelId = `${uid}-label`;
  const listboxId = `${uid}-listbox`;
  const accessibleLabelId = $derived(ariaLabelledby || labelId);

  let retryRef = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let viewportRef = $state<HTMLDivElement | null>(null);
  let query = $state('');
  let singleValue = $state('');
  let multipleValue = $state<string[]>([]);
  let searchedGroups = $state<ComboboxGroup[] | null>(null);
  let searching = $state(false);
  let searchFailed = $state(false);
  const busy = $derived(loading || searching);
  let selectedLabels = $state<Record<string, string>>({});
  let highlightedOption: ComboboxOption | null = null;
  let touchReselection: ComboboxOption | null = null;
  let searchGeneration = 0;
  onDestroy(() => {
    searchGeneration += 1;
  });
  const baseGroups = $derived(
    groups.length > 0 ? groups : [{ key: 'options', label: '', options }],
  );
  const customOption = $derived.by<ComboboxOption | null>(() => {
    const customValue = query.trim();
    if (!allowCustom || !customValue) return null;
    const exists = [...baseGroups, ...(searchedGroups ?? [])]
      .flatMap((group) => group.options)
      .some(
        (option) =>
          option.value.toLowerCase() === customValue.toLowerCase() ||
          option.label.toLowerCase() === customValue.toLowerCase(),
      );
    return exists ? null : { value: customValue, label: customValue };
  });
  const normalizedGroups = $derived.by(() => {
    const source = searchedGroups ?? baseGroups;
    // Offer creation only after search can rule out an existing result. Mounting
    // it enabled also lets Bits establish its initial keyboard highlight.
    if (!customOption || busy) return source;
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
    return normalizedGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => optionMatchesQuery(option)),
      }))
      .filter((group) => group.options.length > 0);
  });
  const hasOptions = $derived(filteredGroups.some((group) => group.options.length > 0));
  const ownedGroupIds = $derived(
    loading
      ? undefined
      : filteredGroups
          .map((group, index) => (group.collapsed && !query.trim() ? '' : `${uid}-group-${index}`))
          .filter(Boolean)
          .join(' ') || undefined,
  );
  const selectedInputValue = $derived.by(() => {
    if (displayValue !== undefined) return displayValue;
    const selectedValues = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return selectedValues
      .map(
        (selectedValue) =>
          baseGroups
            .flatMap((group) => group.options)
            .find((option) => option.value === selectedValue)?.label ??
          selectedLabels[selectedValue] ??
          selectedValue,
      )
      .filter(Boolean)
      .join(', ');
  });
  const visibleInputValue = $derived(open ? query : selectedInputValue);
  $effect(() => {
    const nextValue = typeof value === 'string' ? value : '';
    if (nextValue !== singleValue) singleValue = nextValue;
  });

  $effect(() => {
    const nextValue = Array.isArray(value) ? value : [];
    if (
      nextValue.length !== multipleValue.length ||
      nextValue.some((item, index) => item !== multipleValue[index])
    ) {
      multipleValue = [...nextValue];
    }
  });

  $effect(() => {
    const selectedValues = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const available = [...baseGroups, ...(searchedGroups ?? [])].flatMap((group) => group.options);
    const previous = untrack(() => selectedLabels);
    selectedLabels = Object.fromEntries(
      selectedValues.map((selectedValue) => [
        selectedValue,
        available.find((option) => option.value === selectedValue)?.label ??
          previous[selectedValue] ??
          selectedValue,
      ]),
    );
  });

  $effect(() => {
    if (!open) untrack(resetSearch);
  });

  function resetSearch() {
    searchGeneration += 1;
    const hadQuery = query !== '';
    query = '';
    searchedGroups = null;
    searching = false;
    searchFailed = false;
    if (hadQuery) onquerychange?.('');
  }

  function handleFocus() {
    touchReselection = null;
    if (disabled) return;
    if (!open) {
      resetSearch();
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
    touchReselection = null;
    query = (event.currentTarget as HTMLInputElement).value;
    open = true;
    onquerychange?.(query);
    void runSearch(query);
    // Bits chooses its highlighted DOM candidate after this handler. Render the
    // filtered rows first so immediate Enter cannot accept the previous result.
    flushSync();
    // A previously scrolled viewport can briefly exclude every filtered row
    // from Bits' fully-visible candidate scan. A new query starts at the top.
    if (viewportRef) viewportRef.scrollTop = 0;
  }

  async function runSearch(nextQuery: string) {
    const generation = ++searchGeneration;
    touchReselection = null;
    searchFailed = false;
    searchedGroups = null;
    if (!onsearch || !nextQuery.trim()) {
      searching = false;
      return;
    }
    searching = true;
    try {
      const results = await onsearch(nextQuery);
      if (generation !== searchGeneration) return;
      searchedGroups =
        results.length > 0 && 'options' in results[0]
          ? (results as ComboboxGroup[])
          : [{ key: 'search-results', label: '', options: results as ComboboxOption[] }];
    } catch (error) {
      if (generation !== searchGeneration) return;
      searchFailed = true;
      onsearcherror?.(error, nextQuery);
    } finally {
      if (generation === searchGeneration) searching = false;
    }
  }

  function retrySearch() {
    inputRef?.focus();
    void runSearch(query);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open || event.isComposing) return;
    if (searchFailed && event.key === 'Tab' && !event.shiftKey && retryRef) {
      event.preventDefault();
      retryRef.focus();
    } else if (event.key === 'Enter' && searchFailed) {
      event.preventDefault();
      retrySearch();
    } else if (event.key === 'Enter') {
      const activeId = inputRef?.getAttribute('aria-activedescendant');
      const activeOption = activeId ? inputRef?.ownerDocument.getElementById(activeId) : null;
      if (
        busy ||
        !hasOptions ||
        !activeOption ||
        !viewportRef?.contains(activeOption) ||
        activeOption.getAttribute('aria-disabled') === 'true'
      ) {
        // Bits otherwise closes a single picker even when nothing was accepted.
        event.preventDefault();
      }
    }
  }

  function handleRetryKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') inputRef?.focus();
    if (event.key !== 'Tab') return;
    inputRef?.focus();
    if (event.shiftKey) event.preventDefault();
    else {
      open = false;
      handleOpenChange(false);
    }
  }

  function reselectedOption(option: ComboboxOption | null) {
    if (busy) return null;
    return open && !multiple && !disabled && option && !option.disabled && value === option.value
      ? option
      : null;
  }

  function handleInputKeydown(event: KeyboardEvent, primitiveHandler: unknown) {
    touchReselection = null;
    const reselected =
      event.key === 'Enter' && !event.isComposing && !busy && !searchFailed
        ? reselectedOption(highlightedOption)
        : null;
    if (typeof primitiveHandler === 'function') primitiveHandler(event);
    if (reselected && !open) oncommit?.(reselected.value, reselected);
  }

  function handleOptionPointerUp(
    event: PointerEvent,
    option: ComboboxOption,
    primitiveHandler: unknown,
  ) {
    touchReselection = null;
    // Do not let Bits close/reset the query or arm its deferred native touch click
    // while the displayed base options are waiting to be replaced by search results.
    if (busy) {
      event.preventDefault();
      return;
    }
    const reselected = !event.defaultPrevented ? reselectedOption(option) : null;
    if (typeof primitiveHandler === 'function') primitiveHandler(event);
    if (!reselected) return;
    if (!open) oncommit?.(reselected.value, reselected);
    // Bits defers non-iOS touch acceptance until the following native click.
    else if (event.pointerType === 'touch') touchReselection = reselected;
  }

  function handleOptionClick(option: ComboboxOption) {
    const reselected = touchReselection;
    touchReselection = null;
    if (busy) return;
    // Closing can restore cached option objects before the delegated click runs.
    // Match the stable value, retaining the accepted search result's metadata.
    if (reselected && reselected.value === option.value && !open) {
      oncommit?.(reselected.value, reselected);
    }
  }

  function rememberSelection(nextValue: string | string[]) {
    const selectedValues = Array.isArray(nextValue) ? nextValue : [nextValue];
    const available = normalizedGroups.flatMap((group) => group.options);
    selectedLabels = Object.fromEntries(
      selectedValues.map((selectedValue) => [
        selectedValue,
        available.find((option) => option.value === selectedValue)?.label ??
          selectedLabels[selectedValue] ??
          selectedValue,
      ]),
    );
  }

  function handleSingleChange(nextValue: string) {
    if (busy) return;
    const option = normalizedGroups
      .flatMap((group) => group.options)
      .find((option) => option.value === nextValue);
    rememberSelection(nextValue);
    value = nextValue;
    resetSearch();
    onchange?.(nextValue, option);
    if (option) oncommit?.(nextValue, option);
  }

  function handleMultipleChange(nextValue: string[]) {
    if (busy) return;
    const previous = Array.isArray(value) ? value : [];
    const option = normalizedGroups
      .flatMap((group) => group.options)
      .find((option) => previous.includes(option.value) !== nextValue.includes(option.value));
    rememberSelection(nextValue);
    value = nextValue;
    resetSearch();
    onchange?.(nextValue);
    if (option) oncommit?.(nextValue, option);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetSearch();
    onopenchange?.(nextOpen);
  }

  function withoutListboxSemantics(props: Record<string, unknown>) {
    const {
      role: _role,
      tabindex: _tabindex,
      'aria-multiselectable': _multi,
      ...contentProps
    } = props;
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
      allowDeselect={false}
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
    bind:ref={inputRef}
    id={inputId}
    aria-labelledby={accessibleLabelId}
    aria-describedby={ariaDescribedby}
    aria-busy={busy}
    aria-controls={open ? listboxId : undefined}
    aria-invalid={invalid || undefined}
    placeholder={open ? searchPlaceholder : placeholder}
    onfocus={handleFocus}
    onclick={handleFocus}
    oninput={handleInput}
    onkeydown={handleKeydown}
    data-size={resolvedSize}
    class={cn(
      'type-caption text-foreground placeholder:text-muted-foreground w-full min-w-0 rounded-(--radius-medium) border px-3',
      textEntryControlClasses,
      'focus-visible:outline-solid focus-visible:-outline-offset-2',
      textEntryHeight(resolvedSize),
      invalid && 'border-danger ring-1 ring-danger/25',
      inputClass,
    )}
  >
    {#snippet child({ props })}
      <input
        {...props}
        value={visibleInputValue}
        onkeydown={(event) => handleInputKeydown(event, props.onkeydown)}
      />
    {/snippet}
  </ComboboxPrimitive.Input>
  {#snippet contentBody()}
    {#if header || headerAction}
      <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {#if header}<span class="type-caption min-w-0 truncate font-medium text-muted-foreground"
            >{header}</span
          >{/if}
        {#if headerAction}<div class="ml-auto">{@render headerAction()}</div>{/if}
      </div>
    {/if}
    {#if busy}
      <div class="type-body px-3 py-2 text-muted-foreground" role="status">
        {m.ui_combobox_loadingOptions_message()}
      </div>
    {:else if searchFailed}
      <div class="flex items-center gap-2 px-3 py-2">
        <span class="type-body text-muted-foreground" role="status">{errorText}</span>
        <Button
          bind:ref={retryRef}
          variant="ghost"
          size="sm"
          onclick={retrySearch}
          onkeydown={handleRetryKeydown}>{retryText}</Button
        >
      </div>
    {:else if !hasOptions}
      <div class="type-body px-3 py-2 text-muted-foreground" role="status">{emptyText}</div>
    {/if}
    <ComboboxPrimitive.Viewport
      class="{OPTION_LIST_CONTAINER_CLASS} max-h-72 overscroll-contain overflow-y-auto"
    >
      {#snippet child({ props: viewportProps })}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (named scroll region needs keyboard scrolling when controls are outside the listbox) -->
        <div
          {...viewportProps}
          bind:this={viewportRef}
          id={groupAction ? undefined : listboxId}
          role={groupAction ? 'region' : 'listbox'}
          aria-multiselectable={!groupAction && multiple ? true : undefined}
          aria-labelledby={accessibleLabelId}
          aria-busy={busy}
          tabindex="0"
        >
          <ListHighlight />
          {#if groupAction}
            <!-- Own only option groups, not the interleaved interactive headings. -->
            <div
              id={listboxId}
              role="listbox"
              aria-labelledby={accessibleLabelId}
              aria-multiselectable={multiple || undefined}
              aria-busy={busy}
              aria-owns={ownedGroupIds}
              class="sr-only"
            ></div>
          {/if}
          {#if !loading}
            {#each filteredGroups as group, groupIndex (group.key)}
              {#if group.separatorBefore && groupIndex > 0}
                <ComboboxPrimitive.Separator decorative class="my-1 border-t border-border" />
              {/if}
              <ComboboxPrimitive.Group id={`${uid}-group-${groupIndex}`}>
                {#snippet child({ props: groupProps })}
                  {#if group.label}
                    <div class="type-caption px-2 py-1.5 font-medium text-muted-foreground">
                      <ComboboxPrimitive.GroupHeading class="inline">
                        <span>{group.label}</span>
                        {#if groupDescription}{@render groupDescription(group)}{/if}
                      </ComboboxPrimitive.GroupHeading>
                      {#if groupAction}{@render groupAction(group)}{/if}
                    </div>
                  {/if}
                  <div {...groupProps}>
                    {#each group.collapsed && !query.trim() ? [] : group.options as option (option.value)}
                      {#snippet optionChild({ props, selected }: OptionChildProps)}
                        <div
                          {...props}
                          onpointerup={(event) =>
                            handleOptionPointerUp(event, option, props.onpointerup)}
                          onclick={() => handleOptionClick(option)}
                          aria-disabled={busy || option.disabled || undefined}
                          data-slot="combobox-option-motion"
                        >
                          <span class="min-w-0 flex-1 truncate">
                            {option === customOption
                              ? m.ui_combobox_useCustom_label({ value: option.label })
                              : option.label}
                          </span>
                          {#if optionDescription}
                            {@render optionDescription(option)}
                          {:else if option.description}
                            <span
                              class="type-caption max-w-1/2 shrink-0 truncate text-muted-foreground"
                            >
                              {option.description}
                            </span>
                          {/if}
                          <Indicator
                            state={selected ? 'checked' : 'empty'}
                            data-slot="combobox-item-check"
                            class={selected ? 'opacity-100' : 'opacity-0'}
                          />
                          {#if optionActions}{@render optionActions(option)}{/if}
                        </div>
                      {/snippet}
                      <ComboboxPrimitive.Item
                        value={option.value}
                        label={option.label}
                        disabled={busy || option.disabled || !optionMatchesQuery(option)}
                        data-menu-item
                        class={cn(menuItem(), option.class)}
                        child={optionChild}
                        onHighlight={() => (highlightedOption = option)}
                        onUnhighlight={() => {
                          if (highlightedOption === option) highlightedOption = null;
                        }}
                      />
                    {/each}
                  </div>
                {/snippet}
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
  {/snippet}

  <!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
  {#snippet staticContentChild({ props }: StaticContentChildProps)}
    {@const contentProps = withoutListboxSemantics(props)}
    <div {...contentProps}>
      {@render contentBody()}
    </div>
  {/snippet}

  <!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
  {#snippet contentChild({ props, wrapperProps }: ContentChildProps)}
    {@const contentProps = withoutListboxSemantics(props)}
    <div {...wrapperProps}>
      <div {...contentProps}>
        {@render contentBody()}
      </div>
    </div>
  {/snippet}

  {#if staticPosition}
    <ComboboxPrimitive.ContentStatic
      preventScroll={false}
      data-static-position
      data-surface-level={surface}
      class={cn(menuOverlay(), 'w-full max-h-72 rounded-(--radius-medium)', contentClass)}
      style="max-width: calc(100vw - var(--space-4));"
      child={staticContentChild}
    />
  {:else}
    <ComboboxPrimitive.Portal disabled={!portal}>
      <ComboboxPrimitive.Content
        {side}
        sideOffset={4}
        collisionPadding={OVERLAY_VIEWPORT_GUTTER}
        data-surface-level={surface}
        class={cn(
          menuOverlay(),
          'w-(--bits-combobox-anchor-width) max-h-72 rounded-(--radius-medium)',
          contentClass,
        )}
        style="max-width: calc(100vw - var(--space-4));"
        child={contentChild}
      />
    </ComboboxPrimitive.Portal>
  {/if}
{/snippet}
