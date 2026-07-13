<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faSearch,
  faXmark,
  faFilter,
  faChevronUp,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    onSearch: (query: string, filters: SearchFilters) => void;
    onClose: () => void;
    onNavigateResult: (direction: 'prev' | 'next') => void;
    resultCount?: number;
    currentResult?: number;
  }

  export interface SearchFilters {
    role?: 'all' | 'user' | 'assistant';
    caseSensitive?: boolean;
    regex?: boolean;
  }

  let { onSearch, onClose, onNavigateResult, resultCount = 0, currentResult = 0 }: Props = $props();

  let searchQuery = $state('');
  let showFilters = $state(false);
  let filters = $state<SearchFilters>({
    role: 'all',
    caseSensitive: false,
    regex: false,
  });

  let searchInput: HTMLInputElement;

  $effect(() => {
    // Focus input when component mounts
    searchInput?.focus();
  });

  function handleSearch() {
    onSearch(searchQuery, filters);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        onNavigateResult('prev');
      } else {
        onNavigateResult('next');
      }
    } else if (e.key === 'F3' || (e.key === 'g' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      if (e.shiftKey) {
        onNavigateResult('prev');
      } else {
        onNavigateResult('next');
      }
    }
  }

  function toggleFilter(filterName: keyof SearchFilters, value?: any) {
    if (value !== undefined) {
      filters[filterName] = value;
    } else {
      // Only toggle boolean filters
      if (filterName === 'caseSensitive' || filterName === 'regex') {
        filters[filterName] = !filters[filterName];
      }
    }
    handleSearch();
  }

  // Debounce search
  let searchTimeout: ReturnType<typeof setTimeout>;
  $effect(() => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch();
    }, 300);

    return () => clearTimeout(searchTimeout);
  });
</script>

<div
  class="fixed top-4 right-4 z-50 w-96 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-xl"
  transition:slide={{ duration: 200, easing: cubicOut }}
>
  <!-- Search Header -->
  <div class="flex items-center gap-2 p-3 border-b border-border">
    <Fa icon={faSearch} class="text-ghost" />
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      onkeydown={handleKeyDown}
      type="text"
      placeholder="Search messages..."
      class="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
    />

    <!-- Results Counter -->
    {#if resultCount > 0}
      <div class="flex items-center gap-1 text-xs text-subtle">
        <span>{currentResult + 1}/{resultCount}</span>
        <button
          onclick={() => onNavigateResult('prev')}
          class="p-1 hover:bg-muted rounded transition-colors"
          title="Previous result (Shift+Enter)"
        >
          <Fa icon={faChevronUp} size="xs" />
        </button>
        <button
          onclick={() => onNavigateResult('next')}
          class="p-1 hover:bg-muted rounded transition-colors"
          title="Next result (Enter)"
        >
          <Fa icon={faChevronDown} size="xs" />
        </button>
      </div>
    {/if}

    <!-- Filter Toggle -->
    <button
      onclick={() => (showFilters = !showFilters)}
      class="p-1.5 hover:bg-muted rounded transition-colors {showFilters ? 'bg-muted' : ''}"
      title="Toggle filters"
    >
      <Fa icon={faFilter} size="xs" class="text-ghost" />
    </button>

    <!-- Close Button -->
    <button
      onclick={onClose}
      class="p-1.5 hover:bg-muted rounded transition-colors"
      title="Close search (Esc)"
    >
      <Fa icon={faXmark} size="xs" class="text-ghost" />
    </button>
  </div>

  <!-- Filters -->
  {#if showFilters}
    <div
      class="p-3 border-b border-border space-y-2"
      transition:slide={{ duration: 150, easing: cubicOut }}
    >
      <!-- Role Filter -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-subtle w-20">Filter by:</span>
        <div class="flex gap-1">
          <button
            onclick={() => toggleFilter('role', 'all')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            All
          </button>
          <button
            onclick={() => toggleFilter('role', 'user')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'user'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            User
          </button>
          <button
            onclick={() => toggleFilter('role', 'assistant')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'assistant'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            Assistant
          </button>
        </div>
      </div>

      <!-- Options -->
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={filters.caseSensitive}
            onchange={handleSearch}
            class="w-3 h-3"
          />
          <span class="text-xs text-subtle">Case sensitive</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={filters.regex}
            onchange={handleSearch}
            class="w-3 h-3"
          />
          <span class="text-xs text-subtle">Use regex</span>
        </label>
      </div>
    </div>
  {/if}

  <!-- Keyboard Shortcuts Help -->
  <div class="px-3 py-2 text-xs text-subtle bg-muted/30">
    <div class="flex gap-4">
      <span>Enter: Next</span>
      <span>Shift+Enter: Previous</span>
      <span>Esc: Close</span>
    </div>
  </div>
</div>
