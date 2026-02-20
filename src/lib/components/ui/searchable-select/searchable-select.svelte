<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faChevronDown, faSearch, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('SearchableSelect');

  interface Option {
    value: string;
    label: string;
    description?: string;
    icon?: any;
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
    placeholder = 'Select an option',
    searchPlaceholder = 'Search...',
    disabled = false,
    loading = false,
    allowCustom = false,
    onSearch,
    onChange,
    class: className = '',
  }: Props = $props();

  let isOpen = $state(false);
  let searchQuery = $state('');
  let searchResults: Option[] = $state([]);
  let selectedIndex = $state(0);
  let searchInput: HTMLInputElement | null = $state(null);
  let dropdownRef: HTMLDivElement | null = $state(null);
  let buttonRef: HTMLButtonElement | null = $state(null);
  let isSearching = $state(false);

  let filteredOptions = $derived(
    searchQuery
      ? searchResults.length > 0
        ? searchResults
        : options.filter(
            (opt) =>
              opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              opt.value.toLowerCase().includes(searchQuery.toLowerCase()),
          )
      : options,
  );

  let selectedOption = $derived(options.find((opt) => opt.value === value));
  let displayValue = $derived(selectedOption?.label || value || '');

  async function handleSearch(query: string) {
    searchQuery = query;

    if (onSearch && query) {
      isSearching = true;
      try {
        searchResults = await onSearch(query);
      } catch (error) {
        logger.error('Search failed:', error as Error);
        searchResults = [];
      } finally {
        isSearching = false;
      }
    } else {
      searchResults = [];
    }
  }

  function handleSelect(option: Option) {
    value = option.value;
    searchQuery = '';
    searchResults = [];
    isOpen = false;
    onChange?.(option.value);
  }

  function handleCustomValue() {
    if (allowCustom && searchQuery && !filteredOptions.find((opt) => opt.value === searchQuery)) {
      value = searchQuery;
      searchQuery = '';
      searchResults = [];
      isOpen = false;
      onChange?.(value);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        isOpen = true;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredOptions.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[selectedIndex]) {
          handleSelect(filteredOptions[selectedIndex]);
        } else if (allowCustom && searchQuery) {
          handleCustomValue();
        }
        break;
      case 'Escape':
        e.preventDefault();
        isOpen = false;
        searchQuery = '';
        searchResults = [];
        break;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      dropdownRef &&
      !dropdownRef.contains(e.target as Node) &&
      buttonRef &&
      !buttonRef.contains(e.target as Node)
    ) {
      isOpen = false;
      searchQuery = '';
      searchResults = [];
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  });

  $effect(() => {
    if (isOpen && searchInput) {
      searchInput.focus();
    }
  });
</script>

<div class="relative {className}">
  <button
    bind:this={buttonRef}
    type="button"
    class="w-full flex items-center justify-between px-3 py-2 text-sm bg-background border border-input rounded-md hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    {disabled}
    onclick={() => (isOpen = !isOpen)}
    onkeydown={handleKeyDown}
  >
    <span class="truncate">
      {displayValue || placeholder}
    </span>
    <Fa icon={faChevronDown} class="ml-2 h-4 w-4 opacity-50" />
  </button>

  {#if isOpen}
    <div
      bind:this={dropdownRef}
      class="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg animate-fade-in"
    >
      <div class="p-2 border-b border-border">
        <div class="relative">
          <Fa
            icon={faSearch}
            class="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <input
            bind:this={searchInput}
            type="text"
            bind:value={searchQuery}
            oninput={(e) => handleSearch(e.currentTarget.value)}
            onkeydown={handleKeyDown}
            placeholder={searchPlaceholder}
            class="w-full pl-8 pr-8 py-1.5 text-sm bg-background border border-input rounded focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {#if searchQuery}
            <button
              type="button"
              onclick={() => {
                searchQuery = '';
                searchResults = [];
                searchInput?.focus();
              }}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Fa icon={faXmark} class="h-4 w-4" />
            </button>
          {/if}
        </div>
      </div>

      <div class="max-h-60 overflow-auto p-1">
        {#if isSearching}
          <div class="px-2 py-4 text-sm text-muted-foreground text-center">Searching...</div>
        {:else if filteredOptions.length === 0}
          <div class="px-2 py-4 text-sm text-muted-foreground text-center">
            {searchQuery ? 'No results found' : 'No options available'}
            {#if allowCustom && searchQuery}
              <button
                type="button"
                onclick={handleCustomValue}
                class="block w-full mt-2 px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded"
              >
                Use "{searchQuery}"
              </button>
            {/if}
          </div>
        {:else}
          {#each filteredOptions as option, index (option.value)}
            <button
              type="button"
              onclick={() => handleSelect(option)}
              onmouseenter={() => (selectedIndex = index)}
              class="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded flex items-center gap-2
                {selectedIndex === index ? 'bg-accent text-accent-foreground' : ''}
                {value === option.value ? 'font-medium' : ''}"
            >
              {#if option.icon}
                <Fa icon={option.icon} class="h-4 w-4 opacity-50" />
              {/if}
              <div class="flex-1 min-w-0">
                <div class="truncate">{option.label}</div>
                {#if option.description}
                  <div class="text-xs text-muted-foreground truncate">
                    {option.description}
                  </div>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
