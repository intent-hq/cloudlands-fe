<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faSearch, faXmark, faCodeBranch, faFolder } from '@fortawesome/free-solid-svg-icons';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';

  interface RepoMatch {
    owner: string;
    name: string;
    fullName: string;
    description?: string;
    defaultBranch?: string;
    isLocal?: boolean;
    path?: string;
  }

  interface Props {
    value?: string;
    placeholder?: string;
    onSelect?: (repo: RepoMatch) => void;
    onClear?: () => void;
    disabled?: boolean;
    class?: string;
  }

  let {
    value = $bindable(''),
    placeholder = 'Search for a repo',
    onSelect,
    onClear,
    disabled = false,
    class: className = '',
  }: Props = $props();

  let isFocused = $state(false);
  let searchResults: RepoMatch[] = $state([]);
  let selectedIndex = $state(0);
  let isSearching = $state(false);
  let inputRef: HTMLInputElement | null = $state(null);
  let dropdownRef: HTMLDivElement | null = $state(null);
  let searchTimeout: NodeJS.Timeout;

  // Mock search function - replace with actual GitHub API search
  async function searchRepositories(query: string): Promise<RepoMatch[]> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Mock data - replace with actual GitHub API call
    if (query.toLowerCase().includes('wattenberger')) {
      return [
        {
          owner: 'wattenberger',
          name: 'wattenberger-2023',
          fullName: 'wattenberger/wattenberger-2023',
          description: 'Personal website and portfolio',
          defaultBranch: 'main',
        },
        {
          owner: 'wattenberger',
          name: 'svelte-recipes',
          fullName: 'wattenberger/svelte-recipes',
          description: 'Collection of Svelte patterns and recipes',
          defaultBranch: 'main',
        },
      ];
    }

    return [];
  }

  async function handleSearch(query: string) {
    value = query;

    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (!query || query.length < 2) {
      searchResults = [];
      isSearching = false;
      return;
    }

    // Debounce search
    searchTimeout = setTimeout(async () => {
      isSearching = true;
      try {
        searchResults = await searchRepositories(query);
      } catch (error) {
        logger.error('Repository search failed:', error);
        searchResults = [];
      } finally {
        isSearching = false;
      }
    }, 300);
  }

  function handleSelect(repo: RepoMatch) {
    value = repo.fullName;
    searchResults = [];
    isFocused = false;
    onSelect?.(repo);
  }

  function handleClear() {
    value = '';
    searchResults = [];
    selectedIndex = 0;
    onClear?.();
    inputRef?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isFocused || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults[selectedIndex]) {
          handleSelect(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        searchResults = [];
        isFocused = false;
        break;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      dropdownRef &&
      !dropdownRef.contains(e.target as Node) &&
      inputRef &&
      !inputRef.contains(e.target as Node)
    ) {
      isFocused = false;
      searchResults = [];
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  });
</script>

<div class="relative {className}">
  <div class="relative">
    <Fa icon={faSearch} class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500" />
    <input
      bind:this={inputRef}
      type="text"
      bind:value
      oninput={(e) => handleSearch(e.currentTarget.value)}
      onfocus={() => (isFocused = true)}
      onkeydown={handleKeyDown}
      {placeholder}
      {disabled}
      class="w-full pl-10 pr-10 py-2.5 text-sm bg-background border border-input rounded-lg
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
             placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
    />
    {#if value}
      <button
        type="button"
        onclick={handleClear}
        class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Fa icon={faXmark} class="h-4 w-4" />
      </button>
    {/if}
  </div>

  {#if isFocused && (searchResults.length > 0 || isSearching)}
    <div
      bind:this={dropdownRef}
      class="absolute z-50 w-full mt-2 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
    >
      {#if isSearching}
        <div class="px-4 py-3 text-sm text-muted-foreground">Searching repositories...</div>
      {:else if searchResults.length > 0}
        <div class="py-2">
          <div
            class="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider"
          >
            Matches
          </div>
          {#each searchResults as repo, index (repo.fullName || `${repo.owner}/${repo.name}`)}
            <button
              type="button"
              onclick={() => handleSelect(repo)}
              onmouseenter={() => (selectedIndex = index)}
              class="w-full px-4 py-2.5 text-left hover:bg-accent transition-colors flex items-start gap-3
                {selectedIndex === index ? 'bg-accent' : ''}"
            >
              <div class="mt-0.5">
                {#if repo.isLocal}
                  <Fa icon={faFolder} class="h-4 w-4 text-blue-500" />
                {:else}
                  <Fa icon={faGithub} class="h-4 w-4 text-muted-foreground" />
                {/if}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">
                    <span class="text-muted-foreground">{repo.owner} / </span>
                    <span class="text-foreground">{repo.name}</span>
                  </span>
                </div>
                {#if repo.description}
                  <div class="text-xs text-muted-foreground mt-0.5 truncate">
                    {repo.description}
                  </div>
                {/if}
                {#if repo.defaultBranch}
                  <div class="flex items-center gap-1 mt-1">
                    <Fa icon={faCodeBranch} class="h-3 w-3 text-muted-foreground" />
                    <span class="text-xs text-muted-foreground">
                      branched off <span class="underline">{repo.defaultBranch}</span>
                    </span>
                  </div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
