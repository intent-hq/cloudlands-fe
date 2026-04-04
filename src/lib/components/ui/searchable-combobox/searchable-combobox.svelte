<script lang="ts">
  import ChevronUpDown from '$lib/components/icons/ChevronUpDown.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/utils';
  import { onMount, tick, type Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import type { ItemActionContext, Option } from './types';

  interface Props {
    value?: string;
    options?: Option[];
    placeholder?: string;
    disabled?: boolean;
    /** Override the display label in the trigger (instead of using selected option's label) */
    triggerLabel?: string;
    onSearch?: (query: string) => Promise<Option[]> | Option[];
    onChange?: (value: string, option?: Option, event?: MouseEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onRename?: (option: Option, newName: string) => void;
    onDelete?: (option: Option) => void;
    class?: string;
    triggerClass?: string;
    dropdownClass?: string;
    inputClass?: string;
    header?: string;
    optionDescription?: Snippet<[Option]>;
    /** Snippet for rendering action buttons on each option. Receives ItemActionContext. */
    itemActions?: Snippet<[ItemActionContext]>;
    footer?: Snippet;
    tooltip?: string | Snippet;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
    /** Position dropdown above the trigger instead of below */
    dropdownPosition?: 'top' | 'bottom';
  }

  let {
    value = $bindable(),
    options = [],
    placeholder = 'Select...',
    disabled = false,
    triggerLabel,

    onSearch,
    onChange,
    onOpen,
    onClose,
    onRename,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDelete,
    class: className = '',
    triggerClass = '',
    dropdownClass = '',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    inputClass = '',
    header = '',
    optionDescription,
    itemActions,
    footer,
    tooltip,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipDelayDuration = 200,
    dropdownPosition = 'bottom',
  }: Props = $props();

  let isOpen = $state(false);
  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let filteredOptions: Option[] = $state([]);
  let isSearching = $state(false);
  let ignoreMouseEvents = $state(false);

  // Rename state
  let renamingOptionValue = $state<string | null>(null);
  let renameInputValue = $state('');
  let mousePosition = { x: 0, y: 0 };

  const effectiveIsSearching = $derived(isSearching);

  // Svelte 5: bind:this updates the variables; use $state.raw to keep them reactive
  // without proxying DOM nodes.
  let containerRef = $state.raw<HTMLDivElement | null>(null);
  let inputRef = $state.raw<HTMLInputElement | null>(null);
  let dropdownRef = $state.raw<HTMLDivElement | null>(null);
  let renameInputRef = $state.raw<HTMLInputElement | null>(null);

  // Get the selected option based on current value
  const selectedOption = $derived(options.find((opt) => opt.value === value));

  // Effective label for the trigger (triggerLabel overrides selectedOption.label)
  const effectiveTriggerLabel = $derived(triggerLabel ?? selectedOption?.label);

  // Compute filtered options based on search query
  const computeFilteredOptions = async () => {
    if (onSearch && searchQuery) {
      // Use custom search function
      isSearching = true;
      const results = await Promise.resolve(onSearch(searchQuery));
      filteredOptions = results;
      isSearching = false;
      selectedIndex = 0;
    } else if (searchQuery) {
      // Default filtering
      const query = searchQuery.toLowerCase();
      filteredOptions = options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(query) || opt.description?.toLowerCase().includes(query),
      );
      selectedIndex = 0;
    } else {
      // Show all options when no search query
      filteredOptions = options;
      selectedIndex = options.findIndex((opt) => opt.value === value);
      if (selectedIndex === -1) selectedIndex = 0;
    }
  };

  async function handleOpen() {
    if (disabled || isOpen) return;

    isOpen = true;
    searchQuery = '';

    // Initialize filtered options when opening
    filteredOptions = options;
    selectedIndex = options.findIndex((opt) => opt.value === value);

    // If no value selected or selected item is non-selectable, find first selectable item
    if (selectedIndex === -1 || options[selectedIndex]?.data?.isSelectable === false) {
      selectedIndex = 0;
      while (
        selectedIndex < options.length &&
        options[selectedIndex]?.data?.isSelectable === false
      ) {
        selectedIndex++;
      }
      if (selectedIndex >= options.length) {
        selectedIndex = 0; // Fallback to first item if no selectable items
      }
    }

    onOpen?.();

    await tick();
    if (inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  }

  function handleClose() {
    if (!isOpen) return;

    isOpen = false;
    searchQuery = '';
    filteredOptions = [];
    selectedIndex = 0;
    renamingOptionValue = null;
    renameInputValue = '';
    onClose?.();
  }

  function handleSelect(option: Option, event?: MouseEvent) {
    // Don't select if we're renaming this option
    if (renamingOptionValue === option.value) return;
    value = option.value;
    onChange?.(option.value, option, event);
    handleClose();
  }

  // --- Rename helpers ---
  async function startRename(option: Option) {
    renamingOptionValue = option.value;
    renameInputValue = option.label;
    await tick();
    renameInputRef?.focus();
    renameInputRef?.select();
  }

  function cancelRename() {
    renamingOptionValue = null;
    renameInputValue = '';
  }

  function commitRename(option: Option, newName: string) {
    if (newName.trim() && newName !== option.label) {
      onRename?.(option, newName.trim());
    }
    cancelRename();
  }

  function getItemActionContext(option: Option): ItemActionContext {
    return {
      option,
      isRenaming: renamingOptionValue === option.value,
      renameValue: renameInputValue,
      startRename: () => startRename(option),
      cancelRename,
      commitRename: (newName: string) => commitRename(option, newName),
    };
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (filteredOptions.length > 0) {
          // Temporarily ignore mouse events
          ignoreMouseEvents = true;
          setTimeout(() => {
            ignoreMouseEvents = false;
          }, 100);

          let nextIndex = selectedIndex + 1;
          // Skip non-selectable items
          while (
            nextIndex < filteredOptions.length &&
            filteredOptions[nextIndex]?.data?.isSelectable === false
          ) {
            nextIndex++;
          }
          if (nextIndex < filteredOptions.length) {
            selectedIndex = nextIndex;
            tick().then(() => scrollToSelected());
          }
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (filteredOptions.length > 0) {
          // Temporarily ignore mouse events
          ignoreMouseEvents = true;
          setTimeout(() => {
            ignoreMouseEvents = false;
          }, 100);

          let prevIndex = selectedIndex - 1;
          // Skip non-selectable items
          while (prevIndex >= 0 && filteredOptions[prevIndex]?.data?.isSelectable === false) {
            prevIndex--;
          }
          if (prevIndex >= 0) {
            selectedIndex = prevIndex;
            tick().then(() => scrollToSelected());
          }
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (
          filteredOptions[selectedIndex] &&
          filteredOptions[selectedIndex]?.data?.isSelectable !== false
        ) {
          handleSelect(filteredOptions[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
      case 'Tab':
        // Allow tab to close the dropdown
        handleClose();
        break;
    }
  }

  function scrollToSelected() {
    if (!dropdownRef) return;

    const items = dropdownRef.querySelectorAll('[data-option-index]');
    const selectedItem = items[selectedIndex] as HTMLElement;

    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Handle clicks outside
  function handleClickOutside(e: MouseEvent) {
    if (!containerRef || !isOpen) return;
    const target = e.target as Node;

    // Always close if clicking outside the container
    if (!containerRef.contains(target)) {
      handleClose();
    }
  }

  onMount(() => {
    // Use capture phase to catch events before they bubble
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('click', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('click', handleClickOutside, true);
    };
  });
</script>

{#snippet comboboxContent()}
  <div bind:this={containerRef} class={cn('relative w-full', className)}>
    <!-- Always render button for consistent structure -->
    <button
      type="button"
      onclick={handleOpen}
      onkeydown={handleKeyDown}
      {disabled}
      class={cn(
        'flex items-center justify-between w-full px-3 py-1.5 pr-7 text-sm min-w-0',
        'rounded-md',
        'hover:bg-background/50 focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        ' cursor-pointer',
        triggerClass,
      )}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
    >
      <div class="flex items-center gap-1.5 truncate flex-1 min-w-0">
        {#if selectedOption?.icon}
          <Fa icon={selectedOption.icon} size="18" class="shrink-0" />
        {/if}
        <div class="relative">
          {#if isOpen}
            <input
              bind:this={inputRef}
              type="text"
              value={searchQuery}
              oninput={(e) => {
                searchQuery = e.currentTarget.value;
                computeFilteredOptions();
              }}
              onkeydown={handleKeyDown}
              placeholder={effectiveTriggerLabel || placeholder}
              class="absolute inset-0 bg-transparent outline-none text-sm focus:outline-none! py-1.5"
              autocomplete="off"
              spellcheck={false}
            />
          {/if}
          <div
            class="truncate {value ? 'text-foreground' : 'text-muted-foreground'} {isOpen
              ? 'opacity-0'
              : ''}"
          >
            {isOpen
              ? searchQuery || effectiveTriggerLabel || placeholder
              : effectiveTriggerLabel || placeholder}
          </div>
        </div>
      </div>
      <ChevronUpDown class="absolute right-2 w-3.5 h-3.5 flex-none shrink-0 opacity-50" />
    </button>

    <!-- Dropdown -->
    {#if isOpen}
      <div
        bind:this={dropdownRef}
        transition:slide={{ duration: 150 }}
        class={cn(
          'absolute z-50 w-full',
          dropdownPosition === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          'bg-background border border-border rounded-md shadow-lg',
          'max-h-[300px] overflow-hidden flex flex-col',
          dropdownClass,
        )}
        role="listbox"
      >
        {#if header}
          <div
            class="px-3 py-2 text-xs font-semibold opacity-50 uppercase tracking-wider border-b border-border shrink-0"
          >
            {header}
          </div>
        {/if}

        <div class="overflow-auto flex-1">
          {#if effectiveIsSearching}
            <div class="px-3 py-2 text-sm opacity-50">Searching...</div>
          {:else if filteredOptions.length === 0}
            <div class="px-3 py-2 text-sm opacity-50">No results found</div>
          {:else}
            {#each filteredOptions as option, index (option.value)}
              <button
                type="button"
                data-option-index={index}
                onclick={(e) => {
                  if (option.data?.isSelectable !== false) {
                    handleSelect(option, e);
                  }
                }}
                onmouseenter={() => {
                  if (!ignoreMouseEvents) {
                    selectedIndex = index;
                  }
                }}
                onmousemove={(e) => {
                  // Track actual mouse movement
                  const newX = e.clientX;
                  const newY = e.clientY;
                  if (newX !== mousePosition.x || newY !== mousePosition.y) {
                    mousePosition = { x: newX, y: newY };
                    ignoreMouseEvents = false;
                  }
                }}
                class={cn(
                  'group flex items-center gap-2 w-full text-sm text-left font-medium',
                  option.data?.isIndented ? 'pl-8 pr-3 py-2' : 'px-3 py-2',
                  option.data?.isSelectable === false
                    ? ' opacity-50 cursor-default'
                    : 'cursor-pointer',
                  option.data?.isSelectable && selectedIndex !== index ? 'hover:bg-muted/50  ' : '',
                  selectedIndex === index && option.data?.isSelectable !== false
                    ? 'bg-muted/50'
                    : '',
                  option.value === value ? 'bg-accent/10 text-accent' : 'text-foreground',
                  option.class || '',
                )}
                role="option"
                aria-selected={option.value === value}
                disabled={option.data?.isSelectable === false}
              >
                {#if option.icon}
                  <Fa icon={option.icon} class="w-4 h-4 shrink-0" />
                {/if}
                <div class="flex-1 min-w-0">
                  {#if renamingOptionValue === option.value}
                    <!-- Inline rename input -->
                    <input
                      type="text"
                      bind:this={renameInputRef}
                      value={renameInputValue}
                      oninput={(e) => (renameInputValue = e.currentTarget.value)}
                      onkeydown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename(option, renameInputValue);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onclick={(e) => e.stopPropagation()}
                      onblur={() => commitRename(option, renameInputValue)}
                      class="w-full text-sm bg-transparent border-b border-accent outline-none focus:outline-none"
                    />
                  {:else}
                    <div class="truncate">{option.label}</div>
                  {/if}
                  {#if optionDescription && renamingOptionValue !== option.value}
                    {@render optionDescription(option)}
                  {:else if option.description && renamingOptionValue !== option.value}
                    <div class="text-xs opacity-50 truncate">
                      {option.description}
                    </div>
                  {/if}
                </div>
                {#if itemActions && renamingOptionValue !== option.value}
                  <div
                    class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    {@render itemActions(getItemActionContext(option))}
                  </div>
                {/if}
              </button>
            {/each}
          {/if}
        </div>

        {#if footer}
          <div class="border-t border-border bg-muted/30 px-3 py-2 shrink-0">
            {@render footer()}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if tooltip}
  <Tooltip
    content={tooltip}
    side={tooltipSide}
    align={tooltipAlign}
    delayDuration={tooltipDelayDuration}
  >
    {@render comboboxContent()}
  </Tooltip>
{:else}
  {@render comboboxContent()}
{/if}
