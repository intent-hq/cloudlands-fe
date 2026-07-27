<script lang="ts">
  import {
  onMount,
  onDestroy,
  tick,
  type Snippet,
} from 'svelte';
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import {
  faCheck,
  faChevronDown,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import Portal from '../Portal.svelte';
  import type {
    DropdownOption,
    DropdownGroup,
    DropdownItemProps,
    DropdownGroupProps,
    DropdownTriggerVariant,
    DropdownTriggerSize,
  } from './types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    /** Current value - string for single, string[] for multiple */
    value?: string | string[];
    /** Flat list of options (use this OR groups, not both) */
    options?: DropdownOption[];
    /** Grouped options */
    groups?: DropdownGroup[];
    /** Placeholder text for search input */
    placeholder?: string;
    /** Whether to use a portal to render content (useful when inside overflow:hidden containers) */
    portal?: boolean;
    /** Whether search is enabled */
    searchable?: boolean;
    /** Selection mode */
    multiple?: boolean;
    /** Whether the dropdown is disabled */
    disabled?: boolean;
    /** Open state */
    open?: boolean;
    /** Trigger variant */
    variant?: DropdownTriggerVariant;
    /** Trigger size */
    size?: DropdownTriggerSize;
    /** Custom class for the root */
    class?: string;
    /** Custom class for the trigger */
    triggerClass?: string;
    /** Custom class for the content/popover */
    contentClass?: string;
    /** Custom class for the header */
    headerClass?: string;
    /** Called when value changes */
    onchange?: (value: string | string[], event?: MouseEvent) => void;
    /** Called when open state changes */
    onopenchange?: (open: boolean) => void;
    /** Custom trigger snippet */
    trigger?: Snippet<[{ open: boolean; value: string | string[] | undefined }]>;
    /** Custom item rendering */
    item?: Snippet<[DropdownItemProps]>;
    /** Custom group header rendering */
    groupHeader?: Snippet<[DropdownGroupProps]>;
    /** Header content (e.g., description text) */
    header?: Snippet;
    /** Footer content (e.g., "Create new..." action) */
    footer?: Snippet;
    /** Empty state when no results */
    empty?: Snippet;
    /** Fallback value to highlight when the current value doesn't match any option */
    defaultHighlightValue?: string;
  }

  let {
    value = $bindable(),
    options = [],
    groups = [],
    placeholder = m.ui_dropdown_select_placeholder(),
    portal = false,
    searchable = true,
    multiple = false,
    disabled = false,
    open = $bindable(false),
    variant = 'default',
    size = 'md',
    class: className = '',
    triggerClass = '',
    contentClass = '',
    headerClass = '',
    onchange,
    onopenchange,
    trigger,
    item,
    groupHeader,
    header,
    footer,
    empty,
    defaultHighlightValue,
  }: Props = $props();

  // For portal positioning, we need to track trigger position
  let triggerRef = $state.raw<HTMLButtonElement | null>(null);
  let portalContentRef = $state.raw<HTMLDivElement | null>(null);
  let portalStyle = $state('');
  let searchValue = $state('');
  let containerRef = $state.raw<HTMLDivElement | null>(null);
  let inputRef = $state.raw<HTMLInputElement | null>(null);

  // Keyboard navigation state
  let highlightedIndex = $state(-1);

  // Track which submenu is currently open (by option value)
  let openSubmenu = $state<string | null>(null);
  // Track submenu position
  let submenuStyle = $state('');

  // Flatten groups into options if groups are provided
  const allOptions = $derived.by(() => {
    if (groups.length > 0) {
      return groups.flatMap((g) => g.options);
    }
    return options;
  });

  /** Deduplicate options by value, keeping the first occurrence */
  function deduplicateOptions(opts: DropdownOption[]): DropdownOption[] {
    const seen = new Set<string>();
    return opts.filter((opt) => {
      if (seen.has(opt.value)) return false;
      seen.add(opt.value);
      return true;
    });
  }

  // Filter options based on search
  const filteredOptions = $derived.by(() => {
    if (!searchValue) return deduplicateOptions(options);
    const terms = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return deduplicateOptions(options);
    return deduplicateOptions(
      options.filter((opt) => {
        const haystack = `${opt.label} ${opt.description ?? ''}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    );
  });

  // Filter groups based on search
  const filteredGroups = $derived.by(() => {
    if (!searchValue)
      return groups.map((g) => ({ ...g, options: deduplicateOptions(g.options) }));
    const terms = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0)
      return groups.map((g) => ({ ...g, options: deduplicateOptions(g.options) }));
    return groups
      .map((group) => ({
        ...group,
        options: deduplicateOptions(
          group.options.filter((opt) => {
            const haystack =
              `${group.label ?? ''} ${opt.label} ${opt.description ?? ''}`.toLowerCase();
            return terms.every((term) => haystack.includes(term));
          }),
        ),
      }))
      .filter((group) => group.options.length > 0);
  });

  // Flat list of selectable options (for keyboard navigation indexing)
  const selectableOptions = $derived.by(() => {
    if (groups.length > 0) {
      return filteredGroups.flatMap((g) =>
        g.options.filter((o) => o.type !== 'separator' && o.type !== 'submenu' && !o.disabled),
      );
    }
    return filteredOptions.filter(
      (o) => o.type !== 'separator' && o.type !== 'submenu' && !o.disabled,
    );
  });

  /** Find the index in selectableOptions that matches value or defaultHighlightValue */
  function findHighlightIndex(): number {
    let idx = -1;
    if (typeof value === 'string') {
      idx = selectableOptions.findIndex((o) => o.value === value);
    } else if (Array.isArray(value) && value.length === 1) {
      const first = value[0];
      if (first != null) {
        idx = selectableOptions.findIndex((o) => o.value === first);
      }
    }
    if (idx < 0 && defaultHighlightValue) {
      idx = selectableOptions.findIndex((o) => o.value === defaultHighlightValue);
    }
    return idx >= 0 ? idx : 0;
  }

  // Set highlight when dropdown opens, search changes, or options update
  $effect(() => {
    // Track dependencies
    const currentSearch = searchValue;
    selectableOptions; // track options changes

    if (!open) return;

    if (currentSearch) {
      highlightedIndex = 0;
      scrollHighlightedIntoView();
      return;
    }

    const idx = findHighlightIndex();
    highlightedIndex = idx;

    if (idx > 0) {
      scrollHighlightedIntoView();
    }
  });

  // Get display label for current value
  const displayLabel = $derived.by(() => {
    if (!value) return undefined;
    if (Array.isArray(value)) {
      if (value.length === 0) return undefined;
      if (value.length === 1) {
        const firstValue = value[0];
        return allOptions.find((o) => o.value === firstValue)?.label;
      }
      return `${value.length} selected`;
    }
    return allOptions.find((o) => o.value === value)?.label;
  });

  async function handleOpen() {
    if (disabled || open) return;

    // Pre-compute highlight so the first render is correct
    highlightedIndex = findHighlightIndex();

    open = true;
    onopenchange?.(true);

    if (portal && triggerRef) {
      updatePortalPosition();
    }

    await tick();

    scrollHighlightedIntoView();

    if (searchable) {
      inputRef?.focus();
    }
  }

  function updatePortalPosition() {
    if (!triggerRef || !open || !portal) return;
    const rect = triggerRef.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8; // Minimum padding from viewport edge
    const spaceBelow = viewportHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;
    const estimatedDropdownHeight = 300; // max-h-[300px] + some padding

    // Clamp horizontal position so dropdown doesn't overflow the viewport
    const dropdownWidth = portalContentRef?.offsetWidth ?? 432;
    const left = Math.max(padding, Math.min(rect.left, viewportWidth - dropdownWidth - padding));

    // If not enough space below, position above the trigger
    if (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow) {
      // Position above - dropdown will grow upward, constrained to available space
      const maxHeight = Math.min(estimatedDropdownHeight, spaceAbove);
      portalStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; left: ${left}px; min-width: ${rect.width}px; max-height: ${maxHeight}px;`;
    } else {
      // Position below (default), constrained to available space
      const maxHeight = Math.min(estimatedDropdownHeight, spaceBelow);
      portalStyle = `position: fixed; top: ${rect.bottom + 4}px; left: ${left}px; min-width: ${rect.width}px; max-height: ${maxHeight}px;`;
    }
  }

  function handleClose() {
    if (!open) return;
    open = false;
    searchValue = '';
    openSubmenu = null;
    highlightedIndex = -1;
    onopenchange?.(false);
  }

  function handleSelect(option: DropdownOption, event?: MouseEvent) {
    if (option.disabled) return;

    // Handle separator - do nothing
    if (option.type === 'separator') return;

    // Handle submenu - toggle submenu visibility
    if (option.type === 'submenu' && option.children?.length) {
      // Submenus are handled by hover, clicking does nothing
      return;
    }

    // Handle custom onclick handler
    if (option.onclick) {
      option.onclick();
      handleClose();
      return;
    }

    // Handle toggle type
    if (option.type === 'toggle') {
      // For toggles, we just call the onclick and let the parent handle state
      onchange?.(option.value, event);
      // Don't close on toggle
      return;
    }

    if (multiple) {
      const currentValues = Array.isArray(value) ? value : value ? [value] : [];
      const isSelected = currentValues.includes(option.value);
      const newValues = isSelected
        ? currentValues.filter((v) => v !== option.value)
        : [...currentValues, option.value];
      value = newValues;
      onchange?.(newValues, event);
    } else {
      value = option.value;
      onchange?.(option.value, event);
      handleClose();
    }
  }

  // Handle submenu hover
  function handleSubmenuEnter(option: DropdownOption, event: MouseEvent) {
    if (option.type === 'submenu' && option.children?.length) {
      openSubmenu = option.value;
      // Position submenu to the right of the parent item
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      submenuStyle = `position: fixed; top: ${rect.top}px; left: ${rect.right + 4}px;`;
    }
  }

  function handleSubmenuLeave(event: MouseEvent) {
    // Only close if not moving to the submenu itself
    const relatedTarget = event.relatedTarget as HTMLElement;
    if (!relatedTarget?.closest('[data-submenu]')) {
      openSubmenu = null;
    }
  }

  function isSelected(optionValue: string): boolean {
    if (Array.isArray(value)) {
      return value.includes(optionValue);
    }
    return value === optionValue;
  }

  // Handle clicks outside
  function handleClickOutside(e: MouseEvent) {
    if (!containerRef || !open) return;
    const target = e.target as Node;
    // Check if click is inside container or inside portal content
    const isInsideContainer = containerRef.contains(target);
    const isInsidePortal = portalContentRef?.contains(target) ?? false;
    if (!isInsideContainer && !isInsidePortal) {
      handleClose();
    }
  }

  // Scroll highlighted option into view
  function scrollHighlightedIntoView() {
    tick().then(() => {
      const container = portalContentRef ?? containerRef;
      if (!container || highlightedIndex < 0) return;
      const options = container.querySelectorAll('[role="option"]');
      const el = options[highlightedIndex] as HTMLElement | undefined;
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  // Handle keyboard
  function handleKeyDown(e: KeyboardEvent) {
    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        if (selectableOptions.length > 0) {
          highlightedIndex = Math.min(highlightedIndex + 1, selectableOptions.length - 1);
          scrollHighlightedIntoView();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (selectableOptions.length > 0) {
          highlightedIndex = Math.max(highlightedIndex - 1, 0);
          scrollHighlightedIntoView();
        }
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (highlightedIndex >= 0 && highlightedIndex < selectableOptions.length) {
          handleSelect(selectableOptions[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        break;
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    // Listen for scroll (with capture to catch scrolling in any container) and resize
    window.addEventListener('scroll', updatePortalPosition, true);
    window.addEventListener('resize', updatePortalPosition);
  });

  onDestroy(() => {
    document.removeEventListener('mousedown', handleClickOutside, true);
    window.removeEventListener('scroll', updatePortalPosition, true);
    window.removeEventListener('resize', updatePortalPosition);
  });

  // Update portal position when dropdown opens
  $effect(() => {
    if (open && portal) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => updatePortalPosition());
    }
  });

  // Size classes for trigger
  const sizeClasses: Record<DropdownTriggerSize, string> = {
    xs: 'h-6 px-2 text-xs',
    sm: 'h-8 px-2.5 text-sm',
    md: 'h-9 px-3 text-sm',
    lg: 'h-10 px-4 text-base',
  };

  // Variant classes for trigger
  const variantClasses: Record<DropdownTriggerVariant, string> = {
    default: 'border border-input bg-background hover:bg-muted/50',
    ghost: 'border-0 bg-transparent hover:bg-muted/50',
    outline: 'border border-input bg-transparent hover:bg-muted/50',
    inline: 'border-0 bg-transparent p-0 h-auto hover:text-foreground',
  };

  // Check if we have any results
  const hasResults = $derived(
    groups.length > 0 ? filteredGroups.length > 0 : filteredOptions.length > 0,
  );

  // Preserve scroll position when groups/options update while dropdown is open
  // (e.g., when a provider refreshes its models)
  $effect(() => {
    // Subscribe to reactive data that can change while open
    filteredGroups;
    filteredOptions;

    if (!open) return;

    const container = portalContentRef ?? containerRef;
    const scrollEl = container?.querySelector('[data-scroll-container]');
    if (!scrollEl) return;

    const scrollTop = scrollEl.scrollTop;
    tick().then(() => {
      if (open && scrollEl) {
        scrollEl.scrollTop = scrollTop;
      }
    });
  });
</script>

<div bind:this={containerRef} class={cn('relative inline-block', className)}>
  <!-- Trigger -->
  <button
    bind:this={triggerRef}
    type="button"
    onclick={handleOpen}
    onkeydown={handleKeyDown}
    {disabled}
    class={cn(
      'inline-flex items-center gap-2 rounded-md transition-colors cursor-pointer',
      'focus:outline-none focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      sizeClasses[size],
      variantClasses[variant],
      triggerClass,
    )}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    {#if trigger}
      {@render trigger({ open, value })}
    {:else}
      <span class="truncate text-left flex-1 {!displayLabel ? 'text-muted-foreground' : ''}">
        {displayLabel ?? placeholder}
      </span>
      <Fa icon={faChevronDown} class="h-2! w-2! opacity-50 shrink-0" />
    {/if}
  </button>

  <!-- Content (inline, no portal) -->
  {#if open && !portal}
    <div
      transition:slide={{ duration: 150 }}
      class={cn(
        'absolute top-full left-0 z-50 mt-1 min-w-full w-max',
        'overflow-hidden rounded-md border border-border',
        'bg-popover text-popover-foreground shadow-md',
        contentClass,
      )}
      role="listbox"
      tabindex="-1"
      onkeydown={handleKeyDown}
    >
      {@render dropdownContent(false)}
    </div>
  {/if}
</div>

<!-- Portal content (renders outside overflow:hidden containers) -->
{#if open && portal}
  <Portal zIndex={100}>
    <div
      bind:this={portalContentRef}
      class={cn(
        'w-max flex flex-col',
        'overflow-hidden rounded-md border border-border',
        'bg-popover text-popover-foreground shadow-md',
        contentClass,
      )}
      style={portalStyle}
      role="listbox"
      tabindex="-1"
      onkeydown={handleKeyDown}
    >
      {@render dropdownContent(true)}
    </div>
  </Portal>
{/if}

{#snippet dropdownContent(isPortal: boolean)}
  <!-- Header -->
  {#if header}
    <div class={cn('border-b border-border', isPortal && 'shrink-0', headerClass)}>
      {@render header()}
    </div>
  {/if}

  <!-- Search Input -->
  {#if searchable}
    <div class={cn('w-full', isPortal && 'shrink-0')}>
      <input
        bind:this={inputRef}
        type="text"
        class="w-full bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none border-none ring-0 focus:ring-0! focus:outline-none!"
        {placeholder}
        role="searchbox"
        aria-label={m.ui_dropdown_search_ariaLabel()}
        aria-activedescendant={highlightedIndex >= 0
          ? `dropdown-option-${highlightedIndex}`
          : undefined}
        value={searchValue}
        oninput={(e) => (searchValue = e.currentTarget.value)}
        onkeydown={handleKeyDown}
      />
    </div>
    <!-- Screen reader announcement for filtered results -->
    {#if searchValue}
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {selectableOptions.length === 1
          ? m.ui_dropdown_resultsFound_one()
          : m.ui_dropdown_resultsFound_many({ count: formatInteger(selectableOptions.length) })}
      </div>
    {/if}
  {/if}

  <!-- Options -->
  <div
    data-scroll-container
    class={cn(isPortal ? 'flex-1 min-h-0' : 'max-h-[300px]', 'overflow-y-auto pb-1')}
  >
    {#if groups.length > 0}
      <!-- Grouped options -->
      {#each filteredGroups as group, groupIndex (group.key)}
        <div>
          {#if groupHeader}
            {@render groupHeader({ group, groupIndex })}
          {:else if group.label}
            <div
              class="px-3 {groupIndex === 0
                ? ''
                : 'pt-3 border-t border-border'} py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider sticky top-0 z-10 bg-popover"
            >
              {#if group.icon}
                <Fa icon={group.icon} class="inline-block mr-1.5 h-3 w-3" />
              {/if}
              {group.label}
            </div>
          {/if}

          {#each group.options as option (option.value)}
            {@render optionItem(option)}
          {/each}
        </div>
      {/each}
    {:else}
      <!-- Flat options -->
      {#each filteredOptions as option (option.value)}
        {@render optionItem(option)}
      {/each}
    {/if}

    <!-- Empty state -->
    {#if !hasResults}
      {#if searchValue && allOptions.length > 0}
        <!-- Search yielded no results but there are options available -->
        <div class="flex flex-col items-center gap-1 py-6 px-3 text-muted-foreground">
          <span class="text-sm">{m.ui_dropdown_noResultsFor_label({ query: searchValue })}</span>
          <span class="text-xs text-subtle">{m.ui_dropdown_tryDifferentSearch_description()}</span>
        </div>
      {:else if empty}
        {@render empty()}
      {:else}
        <div class="px-2 py-4 text-center text-sm text-subtle">{m.ui_dropdown_noResults_label()}</div>
      {/if}
    {/if}
  </div>

  <!-- Footer -->
  {#if footer}
    <div class={cn('border-t border-border', isPortal ? 'shrink-0' : 'px-2 py-2.5')}>
      {@render footer()}
    </div>
  {/if}
{/snippet}

{#snippet optionItem(option: DropdownOption)}
  {@const optionIndex = selectableOptions.findIndex((o) => o.value === option.value)}
  <!-- i18n-ignore (scanner false positive: `<` comparison inside the const expression) -->
  {@const isHighlighted =
    highlightedIndex >= 0 &&
    highlightedIndex < selectableOptions.length &&
    selectableOptions[highlightedIndex]?.value === option.value}
  <!-- Separator type -->
  {#if option.type === 'separator'}
    <div class="my-1 h-px bg-border"></div>
  {:else}
    <!-- Regular option or submenu trigger -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative"
      onmouseenter={(e) => handleSubmenuEnter(option, e)}
      onmouseleave={handleSubmenuLeave}
    >
      <button
        type="button"
        id={optionIndex >= 0 ? `dropdown-option-${optionIndex}` : undefined}
        onclick={(e) => handleSelect(option, e)}
        onmouseenter={() => {
          if (optionIndex >= 0) highlightedIndex = optionIndex;
        }}
        disabled={option.disabled}
        data-highlighted={isHighlighted ? 'true' : undefined}
        style="scroll-margin-top: 32px"
        class={cn(
          'relative flex items-center gap-1.5 px-3 py-2 text-sm w-full text-left min-w-0 overflow-hidden',
          'cursor-pointer select-none transition-colors duration-100',
          'focus:bg-muted/40 focus:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          isHighlighted && 'bg-muted/40',
          option.class,
        )}
        role={option.type === 'submenu' ? 'menuitem' : 'option'}
        aria-selected={option.type !== 'submenu' ? isSelected(option.value) : undefined}
        aria-haspopup={option.type === 'submenu' ? 'menu' : undefined}
        aria-expanded={option.type === 'submenu' ? openSubmenu === option.value : undefined}
      >
        {#if item}
          {@render item({ option, selected: isSelected(option.value), highlighted: isHighlighted })}
        {:else}
          <!-- Toggle checkbox -->
          {#if option.type === 'toggle'}
            <div
              class={cn(
                'h-4 w-4 shrink-0 rounded border border-muted-foreground/30',
                'flex items-center justify-center',
                option.checked ? 'bg-primary border-primary' : 'bg-transparent',
              )}
            >
              {#if option.checked}
                <Fa icon={faCheck} class="h-2.5 w-2.5 text-primary-foreground" />
              {/if}
            </div>
          {:else if multiple}
            <!-- Checkbox for multiple select -->
            <div
              class={cn(
                'h-5 w-5 shrink-0 mr-1 rounded-md border border-muted-foreground/30',
                'flex items-center justify-center bg-transparent',
              )}
            >
              {#if isSelected(option.value)}
                <Fa icon={faCheck} class="h-3 w-3 text-foreground" />
              {/if}
            </div>
          {/if}

          <!-- Avatar -->
          {#if option.avatar}
            <img src={option.avatar} alt="" class="h-5 w-5 rounded-full shrink-0" />
          {/if}

          <!-- Icon -->
          {#if option.icon}
            <Fa icon={option.icon} class="h-4 w-4 shrink-0 text-ghost" />
          {/if}

          <!-- Label & Description (inline) -->
          <div class="flex-1 min-w-0 truncate">
            <span>{option.label}</span>
            {#if option.description}
              <span class="text-subtle"> · {option.description}</span>
            {/if}
          </div>

          <!-- End label (like "default") -->
          {#if option.endLabel}
            <span class="text-ui text-subtle">{option.endLabel}</span>
          {/if}

          <!-- Shortcut -->
          {#if option.shortcut}
            <span class="text-xs text-subtle">{option.shortcut}</span>
          {/if}

          <!-- Submenu arrow -->
          {#if option.type === 'submenu'}
            <Fa icon={faChevronRight} class="h-3 w-3 shrink-0 text-ghost" />
          {:else if !multiple && !option.type && isSelected(option.value)}
            <!-- Checkmark for single select -->
            <Fa icon={faCheck} class="h-4 w-4 shrink-0 text-foreground" />
          {/if}
        {/if}
      </button>

      <!-- Submenu (rendered in portal for proper positioning) -->
      {#if option.type === 'submenu' && option.children?.length && openSubmenu === option.value}
        <Portal zIndex={101}>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            data-submenu
            class={cn(
              'min-w-45 overflow-hidden rounded-md border border-border',
              'bg-popover text-popover-foreground shadow-md py-1',
            )}
            style={submenuStyle}
            onmouseleave={() => (openSubmenu = null)}
            role="menu"
            tabindex="-1"
          >
            {#each deduplicateOptions(option.children) as child (child.value)}
              {@render optionItem(child)}
            {/each}
          </div>
        </Portal>
      {/if}
    </div>
  {/if}
{/snippet}
