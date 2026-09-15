<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faSearch,
    faXmark,
    faFilter,
    faChevronUp,
    faChevronDown,
  } from '@fortawesome/free-solid-svg-icons';
  import { safeDisclosureTransition } from './disclosure-motion';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';

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
  transition:safeDisclosureTransition={{ tier: 'moderate' }}
>
  <!-- Search Header -->
  <div class="flex items-center gap-2 p-3 border-b border-border">
    <Fa icon={faSearch} class="text-ghost" />
    <Input
      bind:ref={searchInput}
      bind:value={searchQuery}
      onkeydown={handleKeyDown}
      type="text"
      placeholder={m.chat_chatSearch_input_placeholder()}
      noFocusStyle
      class="h-auto flex-1 border-0 bg-transparent px-0 text-sm shadow-none placeholder:text-muted-foreground"
    />

    <!-- Results Counter -->
    {#if resultCount > 0}
      <div class="flex items-center gap-1 text-xs text-subtle">
        <span>{currentResult + 1}/{resultCount}</span>
        <Button
          variant="ghost-light"
          size="icon-xs"
          iconOnly
          onclick={() => onNavigateResult('prev')}
          class="p-1 hover:bg-muted rounded transition-colors"
          title={m.chat_chatSearch_previousResult_title()}
        >
          <Fa icon={faChevronUp} size="xs" />
        </Button>
        <Button
          variant="ghost-light"
          size="icon-xs"
          iconOnly
          onclick={() => onNavigateResult('next')}
          class="p-1 hover:bg-muted rounded transition-colors"
          title={m.chat_chatSearch_nextResult_title()}
        >
          <Fa icon={faChevronDown} size="xs" />
        </Button>
      </div>
    {/if}

    <!-- Filter Toggle -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      iconOnly
      onclick={() => (showFilters = !showFilters)}
      class="p-1.5 hover:bg-muted rounded transition-colors {showFilters ? 'bg-muted' : ''}"
      title={m.chat_chatSearch_toggleFilters_title()}
    >
      <Fa icon={faFilter} size="xs" class="text-ghost" />
    </Button>

    <!-- Close Button -->
    <Button
      variant="ghost-light"
      size="icon-sm"
      iconOnly
      onclick={onClose}
      class="p-1.5 hover:bg-muted rounded transition-colors"
      title={m.chat_chatSearch_closeSearch_title()}
    >
      <Fa icon={faXmark} size="xs" class="text-ghost" />
    </Button>
  </div>

  <!-- Filters -->
  {#if showFilters}
    <div
      class="p-3 border-b border-border space-y-2"
      transition:safeDisclosureTransition={{ tier: 'fast' }}
    >
      <!-- Role Filter -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-subtle w-20">{m.chat_chatSearch_filterBy_label()}</span>
        <div class="flex gap-1">
          <Button
            variant="plain"
            onclick={() => toggleFilter('role', 'all')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            {m.chat_chatSearch_filterAll_label()}
          </Button>
          <Button
            variant="plain"
            onclick={() => toggleFilter('role', 'user')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'user'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            {m.chat_chatSearch_filterUser_label()}
          </Button>
          <Button
            variant="plain"
            onclick={() => toggleFilter('role', 'assistant')}
            class="px-2 py-1 text-xs rounded transition-colors {filters.role === 'assistant'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'}"
          >
            {m.chat_chatSearch_filterAssistant_label()}
          </Button>
        </div>
      </div>

      <!-- Options -->
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox
            bind:checked={filters.caseSensitive}
            onCheckedChange={handleSearch}
            size="sm"
            ariaLabel={m.chat_chatSearch_caseSensitive_label()}
          />
          <span class="text-xs text-subtle">{m.chat_chatSearch_caseSensitive_label()}</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox
            bind:checked={filters.regex}
            onCheckedChange={handleSearch}
            size="sm"
            ariaLabel={m.chat_chatSearch_useRegex_label()}
          />
          <span class="text-xs text-subtle">{m.chat_chatSearch_useRegex_label()}</span>
        </label>
      </div>
    </div>
  {/if}

  <!-- Keyboard Shortcuts Help -->
  <div class="px-3 py-2 text-xs text-subtle bg-muted/30">
    <div class="flex gap-4">
      <span>{m.chat_chatSearch_enterNext_label()}</span>
      <span>{m.chat_chatSearch_shiftEnterPrevious_label()}</span>
      <span>{m.chat_chatSearch_escClose_label()}</span>
    </div>
  </div>
</div>
