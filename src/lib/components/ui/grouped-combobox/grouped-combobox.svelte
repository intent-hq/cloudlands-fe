<script lang="ts">
  import {
  onMount,
  tick,
  type Snippet,
} from 'svelte';
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
  import ChevronUpDown from '$lib/components/icons/ChevronUpDown.svelte';
  import { slide } from 'svelte/transition';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import type { GroupedOption, OptionGroup } from './types';

  interface Props {
    value?: string;
    groups?: OptionGroup[];
    placeholder?: string;
    disabled?: boolean;
    onSearch?: (query: string) => OptionGroup[];
    onChange?: (value: string, option?: GroupedOption, event?: MouseEvent) => void;
    onOpen?: () => void;
    onClose?: () => void;
    class?: string;
    triggerClass?: string;
    dropdownClass?: string;
    header?: string;
    optionDescription?: Snippet<[GroupedOption]>;
    groupDescription?: Snippet<[OptionGroup]>;
    groupAction?: Snippet<[OptionGroup]>;
    headerAction?: Snippet;
    footer?: Snippet;
    tooltip?: string | Snippet;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    defaultCollapsed?: boolean;
  }

  let {
    value = $bindable(),
    groups = [],
    placeholder = 'Select...',
    disabled = false,
    onSearch,
    onChange,
    onOpen,
    onClose,
    class: className = '',
    triggerClass = '',
    dropdownClass = '',
    header = '',
    optionDescription,
    groupDescription,
    groupAction,
    headerAction,
    footer,
    tooltip,
    tooltipSide = 'top',
    defaultCollapsed = true,
  }: Props = $props();

  let isOpen = $state(false);
  let searchQuery = $state('');
  let collapsedGroups = $state<Set<string>>(new Set());
  let selectedIndex = $state(0);

  // Svelte 5: bind:this updates the variables; use $state.raw to keep them reactive
  // without proxying DOM nodes.
  let containerRef = $state.raw<HTMLDivElement | null>(null);
  let inputRef = $state.raw<HTMLInputElement | null>(null);
  let dropdownRef = $state.raw<HTMLDivElement | null>(null);

  // Initialize collapsed state
  $effect(() => {
    if (defaultCollapsed && groups.length > 0 && collapsedGroups.size === 0) {
      // Collapse all groups except the one containing the current value
      const newCollapsed = new Set<string>();
      for (const group of groups) {
        const hasSelectedValue = group.options.some((opt) => opt.value === value);
        if (!hasSelectedValue) {
          newCollapsed.add(group.key);
        }
      }
      collapsedGroups = newCollapsed;
    }
  });

  // Get the selected option
  const selectedOption = $derived.by(() => {
    for (const group of groups) {
      const opt = group.options.find((o) => o.value === value);
      if (opt) return opt;
    }
    return undefined;
  });

  // Filtered groups based on search
  const filteredGroups = $derived.by(() => {
    if (onSearch && searchQuery) {
      return onSearch(searchQuery);
    }
    if (!searchQuery) return groups;

    const q = searchQuery.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(q) ||
            opt.description?.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.options.length > 0 || group.label.toLowerCase().includes(q));
  });

  // Build flat list for keyboard nav
  const flatOptions = $derived.by(() => {
    const items: { type: 'group' | 'option'; group: OptionGroup; option?: GroupedOption }[] = [];
    for (const group of filteredGroups) {
      items.push({ type: 'group', group });
      if (!collapsedGroups.has(group.key) || searchQuery) {
        for (const option of group.options) {
          items.push({ type: 'option', group, option });
        }
      }
    }
    return items;
  });

  function toggleGroup(key: string) {
    const newSet = new Set(collapsedGroups);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    collapsedGroups = newSet;
  }

  async function handleOpen() {
    if (disabled || isOpen) return;
    isOpen = true;
    searchQuery = '';
    onOpen?.();
    await tick();
    inputRef?.focus();
  }

  function handleClose() {
    if (!isOpen) return;
    isOpen = false;
    searchQuery = '';
    selectedIndex = 0;
    onClose?.();
  }

  function handleSelect(option: GroupedOption, event?: MouseEvent) {
    value = option.value;
    onChange?.(option.value, option, event);
    handleClose();
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
        if (selectedIndex < flatOptions.length - 1) {
          selectedIndex++;
          // Skip group headers
          while (
            selectedIndex < flatOptions.length - 1 &&
            flatOptions[selectedIndex].type === 'group'
          ) {
            selectedIndex++;
          }
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (selectedIndex > 0) {
          selectedIndex--;
          while (selectedIndex > 0 && flatOptions[selectedIndex].type === 'group') {
            selectedIndex--;
          }
        }
        break;
      case 'Enter':
        e.preventDefault();
        const item = flatOptions[selectedIndex];
        if (item?.type === 'option' && item.option) {
          handleSelect(item.option);
        } else if (item?.type === 'group') {
          toggleGroup(item.group.key);
        }
        break;
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
      case 'Tab':
        handleClose();
        break;
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
    <button
      type="button"
      onclick={handleOpen}
      onkeydown={handleKeyDown}
      {disabled}
      class={cn(
        'flex items-center justify-between w-full px-3 py-1.5 pr-7 text-sm min-w-0',
        'rounded hover:bg-background/50 focus:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
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
              oninput={(e) => (searchQuery = e.currentTarget.value)}
              onkeydown={handleKeyDown}
              placeholder={selectedOption?.label || placeholder}
              class="absolute inset-0 bg-transparent outline-none text-sm focus:outline-none! py-1.5"
              autocomplete="off"
              spellcheck={false}
            />
          {/if}
          <div
            class="truncate {value
              ? 'text-foreground font-medium'
              : 'text-muted-foreground'} {isOpen ? 'opacity-0' : ''}"
          >
            {isOpen
              ? searchQuery || selectedOption?.label || placeholder
              : selectedOption?.label || placeholder}
          </div>
        </div>
      </div>
      <ChevronUpDown class="absolute right-2 w-3.5 h-3.5 flex-none shrink-0 opacity-50" />
    </button>

    {#if isOpen}
      <div
        bind:this={dropdownRef}
        transition:slide={{ duration: 150 }}
        class={cn(
          'absolute top-full z-50 w-full mt-1',
          'bg-background border border-border rounded-md shadow-lg',
          'max-h-[70vh] overflow-hidden flex flex-col',
          dropdownClass,
        )}
        role="listbox"
      >
        {#if header || headerAction}
          <div class="shrink-0 flex items-center gap-2">
            {#if header}
              <span class="text-xs font-semibold opacity-50 uppercase tracking-wider">{header}</span
              >
            {/if}
            {#if headerAction}
              <div class="flex-1">
                {@render headerAction()}
              </div>
            {/if}
          </div>
        {/if}

        <div class="overflow-auto flex-1">
          {#if filteredGroups.length === 0}
            <div class="px-3 py-2 text-sm opacity-50">No results found</div>
          {:else}
            {#each filteredGroups as group (group.key)}
              <!-- Group Header -->
              <button
                type="button"
                onclick={() => toggleGroup(group.key)}
                class="flex items-center gap-2 w-full px-3 py-2 text-sm text-subtle cursor-pointer group/header"
              >
                {#if group.icon}
                  <Fa icon={group.icon} class="w-3 h-3" />
                {/if}
                <span class="flex-1 text-left truncate">{group.label}</span>
                {#if groupDescription}
                  {@render groupDescription(group)}
                {:else}
                  <!-- <span class="text-xs opacity-50">{group.options.length}</span> -->
                {/if}

                {#if groupAction}
                  <div
                    class=""
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    {@render groupAction(group)}
                  </div>
                {/if}

                <Fa
                  icon={faChevronLeft}
                  class="w-2.5! h-2.5! text-subtle transition-transform {collapsedGroups.has(
                    group.key,
                  ) && !searchQuery
                    ? ''
                    : '-rotate-90'}"
                />
              </button>

              <!-- Group Options -->
              {#if !collapsedGroups.has(group.key) || searchQuery}
                <div transition:slide={{ duration: 100 }}>
                  {#each group.options as option (option.value)}
                    <button
                      type="button"
                      onclick={(e) => handleSelect(option, e)}
                      class={cn(
                        'flex items-center gap-2 w-full pl-8 pr-3 py-2 text-sm text-left cursor-pointer',
                        'hover:bg-muted/50',
                        option.value === value ? 'bg-accent/10 text-accent' : 'text-foreground',
                      )}
                      role="option"
                      aria-selected={option.value === value}
                    >
                      {#if option.icon}
                        <Fa icon={option.icon} class="w-4 h-4 shrink-0" />
                      {/if}
                      <div class="flex-1 flex min-w-0">
                        <div class="flex-1 truncate font-medium">{option.label}</div>
                        {#if optionDescription}
                          {@render optionDescription(option)}
                        {:else if option.description}
                          <div class="text-xs opacity-50 truncate">{option.description}</div>
                        {/if}
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
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
  <Tooltip content={tooltip} side={tooltipSide}>
    {@render comboboxContent()}
  </Tooltip>
{:else}
  {@render comboboxContent()}
{/if}
