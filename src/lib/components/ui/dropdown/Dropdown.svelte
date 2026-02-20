<script lang="ts">
  import { onMount, onDestroy, tick, type Snippet } from 'svelte';
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faCheck, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
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
  }

  let {
    value = $bindable(),
    options = [],
    groups = [],
    placeholder = 'Select...',
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
  }: Props = $props();

  // For portal positioning, we need to track trigger position
  let triggerRef = $state.raw<HTMLButtonElement | null>(null);
  let portalContentRef = $state.raw<HTMLDivElement | null>(null);
  let portalStyle = $state('');

  let searchValue = $state('');
  let containerRef = $state.raw<HTMLDivElement | null>(null);
  let inputRef = $state.raw<HTMLInputElement | null>(null);

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

  // Filter options based on search
  const filteredOptions = $derived.by(() => {
    if (!searchValue) return options;
    const query = searchValue.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) || opt.description?.toLowerCase().includes(query),
    );
  });

  // Filter groups based on search
  const filteredGroups = $derived.by(() => {
    if (!searchValue) return groups;
    const query = searchValue.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(query) ||
            opt.description?.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.options.length > 0);
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
    open = true;
    onopenchange?.(true);

    // Calculate portal position if using portal
    if (portal && triggerRef) {
      updatePortalPosition();
    }

    await tick();
    if (searchable) {
      inputRef?.focus();
    }
  }

  function updatePortalPosition() {
    if (!triggerRef || !open || !portal) return;
    const rect = triggerRef.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const padding = 8; // Minimum padding from viewport edge
    const spaceBelow = viewportHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;
    const estimatedDropdownHeight = 300; // max-h-[300px] + some padding

    // If not enough space below, position above the trigger
    if (spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow) {
      // Position above - dropdown will grow upward, constrained to available space
      const maxHeight = Math.min(estimatedDropdownHeight, spaceAbove);
      portalStyle = `position: fixed; bottom: ${viewportHeight - rect.top + 4}px; left: ${rect.left}px; min-width: ${rect.width}px; max-height: ${maxHeight}px;`;
    } else {
      // Position below (default), constrained to available space
      const maxHeight = Math.min(estimatedDropdownHeight, spaceBelow);
      portalStyle = `position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px; min-width: ${rect.width}px; max-height: ${maxHeight}px;`;
    }
  }

  function handleClose() {
    if (!open) return;
    open = false;
    searchValue = '';
    openSubmenu = null;
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

  // Handle keyboard
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
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
      <!-- Header -->
      {#if header}
        <div class={cn('border-b border-border', headerClass)}>
          {@render header()}
        </div>
      {/if}

      <!-- Search Input -->
      {#if searchable}
        <div class="border-b border-border w-full">
          <input
            bind:this={inputRef}
            type="text"
            class="w-full bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground/50 outline-none border-none ring-0 focus:ring-0! focus:outline-none!"
            {placeholder}
            value={searchValue}
            oninput={(e) => (searchValue = e.currentTarget.value)}
            onkeydown={handleKeyDown}
          />
        </div>
      {/if}

      <!-- Options -->
      <div class="max-h-[300px] overflow-y-auto py-1x">
        {#if groups.length > 0}
          <!-- Grouped options -->
          {#each filteredGroups as group, groupIndex (group.key)}
            <div>
              {#if groupHeader}
                {@render groupHeader({ group })}
              {:else if group.label}
                <div
                  class="px-3 {groupIndex === 0
                    ? ''
                    : 'pt-3 border-t border-border'} py-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider"
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
          {#if empty}
            {@render empty()}
          {:else}
            <div class="px-2 py-4 text-center text-sm text-muted-foreground">No results found</div>
          {/if}
        {/if}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="border-t border-border px-2 py-2.5">
          {@render footer()}
        </div>
      {/if}
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
      <!-- Header -->
      {#if header}
        <div class={cn('border-b border-border shrink-0', headerClass)}>
          {@render header()}
        </div>
      {/if}

      <!-- Search Input -->
      {#if searchable}
        <div class="border-b border-border w-full shrink-0">
          <input
            bind:this={inputRef}
            type="text"
            class="w-full bg-transparent px-2.5 py-2 text-sm placeholder:text-muted-foreground/50 outline-none border-none ring-0 focus:ring-0! focus:outline-none!"
            {placeholder}
            value={searchValue}
            oninput={(e) => (searchValue = e.currentTarget.value)}
            onkeydown={handleKeyDown}
          />
        </div>
      {/if}

      <!-- Options -->
      <div class="flex-1 min-h-0 overflow-y-auto py-1x">
        {#if groups.length > 0}
          <!-- Grouped options -->
          {#each filteredGroups as group, groupIndex (group.key)}
            <div>
              {#if groupHeader}
                {@render groupHeader({ group })}
              {:else if group.label}
                <div
                  class="px-3 {groupIndex === 0
                    ? ''
                    : 'pt-3 border-t border-border'} py-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider"
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
          {#if empty}
            {@render empty()}
          {:else}
            <div class="px-2 py-4 text-center text-sm text-muted-foreground">No results found</div>
          {/if}
        {/if}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="border-t border-border shrink-0">
          {@render footer()}
        </div>
      {/if}
    </div>
  </Portal>
{/if}

{#snippet optionItem(option: DropdownOption)}
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
        onclick={(e) => handleSelect(option, e)}
        disabled={option.disabled}
        class={cn(
          'relative flex items-center gap-1.5 px-3 py-2 text-sm w-full text-left',
          'cursor-pointer select-none transition-colors',
          'hover:bg-muted/40 focus:bg-muted/40 focus:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          option.class,
        )}
        role={option.type === 'submenu' ? 'menuitem' : 'option'}
        aria-selected={option.type !== 'submenu' ? isSelected(option.value) : undefined}
        aria-haspopup={option.type === 'submenu' ? 'menu' : undefined}
        aria-expanded={option.type === 'submenu' ? openSubmenu === option.value : undefined}
      >
        {#if item}
          {@render item({ option, selected: isSelected(option.value), highlighted: false })}
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
            <Fa icon={option.icon} class="h-4 w-4 shrink-0 text-muted-foreground" />
          {/if}

          <!-- Label & Description (inline) -->
          <div class="flex-1 min-w-0 truncate">
            <span>{option.label}</span>
            {#if option.description}
              <span class="text-muted-foreground"> · {option.description}</span>
            {/if}
          </div>

          <!-- End label (like "default") -->
          {#if option.endLabel}
            <span class="text-[10px] text-muted-foreground/60">{option.endLabel}</span>
          {/if}

          <!-- Shortcut -->
          {#if option.shortcut}
            <span class="text-xs text-muted-foreground/60">{option.shortcut}</span>
          {/if}

          <!-- Submenu arrow -->
          {#if option.type === 'submenu'}
            <Fa icon={faChevronRight} class="h-3 w-3 shrink-0 text-muted-foreground" />
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
            {#each option.children as child (child.value)}
              {@render optionItem(child)}
            {/each}
          </div>
        </Portal>
      {/if}
    </div>
  {/if}
{/snippet}
