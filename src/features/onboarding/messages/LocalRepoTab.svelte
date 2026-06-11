<script lang="ts">
  /**
   * LocalRepoTab — Local repository selection for onboarding.
   *
   * Shows a searchable list of recent local repos with keyboard navigation,
   * plus a folder picker button. Adapts patterns from RepoSelector.svelte
   * and CommandPalette for the onboarding flow.
   */
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { getRecentRepos } from '$lib/utils/workspace-utils';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectKnownRepos } from '$store/renderer/slices/known-repos/known-repos-selectors';
  import { invoke } from '$lib/electron-bridge';
  import { faFolder } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Input from '$lib/components/ui/input/input.svelte';
  import { cn } from '$lib/utils';

  const logger = createLogger('LocalRepoTab');

  interface Props {
    /** Path of the currently selected repo (for highlight state). */
    selectedPath?: string;
    /** Called when the user clicks a repo row or picks a folder. */
    onSelect: (path: string, scope?: string) => void;
    /** Called when user presses Enter - should select AND advance to next step */
    onSelectAndAdvance?: (path: string, scope?: string) => void;
  }

  interface DirectoryStatus {
    relativePathFromGitRoot?: string;
    isSubdirectoryOfGitRepo?: boolean;
  }

  let { selectedPath = '', onSelect, onSelectAndAdvance }: Props = $props();

  const workspaceItems$ = selectWorkspaceItems();
  const knownRepos$ = selectKnownRepos();

  let searchQuery = $state('');
  let focusedIndex = $state(0);
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let listContainerRef = $state<HTMLDivElement | null>(null);
  /** Manually picked folders (via the folder picker) that aren't in known repos. */
  let manuallyAddedPaths = $state<string[]>([]);
  /** Repos discovered from editors, CLI agents, filesystem */
  let discoveredRepos = $state<{ path: string; name: string; owner?: string }[]>([]);

  // Discover repos from editors/filesystem on mount
  onMount(() => {
    invoke<{ success: boolean; data?: { path: string; name: string; owner?: string }[] }>(
      'workspace:discover-repos',
      {},
    )
      .then((result) => {
        if (result?.success && Array.isArray(result.data)) {
          discoveredRepos = result.data;
          logger.info('Discovered repos', { count: result.data.length });
        }
      })
      .catch((err) => logger.warn('Repo discovery failed', { error: String(err) }));
  });

  // Build recent repos list
  const recentRepos = $derived.by(() => {
    const repoMap = new Map<string, { path: string; name: string; owner?: string }>();

    // Add manually picked folders first so they appear at the top
    for (const p of manuallyAddedPaths) {
      repoMap.set(p, { path: p, name: p.split('/').pop() || p });
    }

    // Add known repos from registry
    for (const repo of $knownRepos$) {
      if (repo.path && !repo.path.includes('/.clones/')) {
        repoMap.set(repo.path, {
          path: repo.path,
          name: repo.name || repo.path.split('/').pop() || 'Unknown',
          owner: repo.owner,
        });
      }
    }

    // Merge workspace-derived repos
    const wsRepos = getRecentRepos($workspaceItems$, 10);
    for (const repo of wsRepos) {
      const isLocal =
        repo.path.startsWith('/') || repo.path.startsWith('~') || repo.path.startsWith('.');
      const isLegacyClone = repo.path.includes('/.clones/');
      if (isLocal && !isLegacyClone) {
        repoMap.set(repo.path, { path: repo.path, name: repo.name, owner: repo.owner });
      }
    }

    // Merge discovered repos (lower priority — don't overwrite existing entries)
    for (const repo of discoveredRepos) {
      if (repo.path && !repo.path.includes('/.clones/') && !repoMap.has(repo.path)) {
        repoMap.set(repo.path, {
          path: repo.path,
          name: repo.name || repo.path.split('/').pop() || 'Unknown',
          owner: repo.owner,
        });
      }
    }

    return Array.from(repoMap.values());
  });

  // Filter repos based on search
  const filteredRepos = $derived.by(() => {
    if (!searchQuery.trim()) return recentRepos;
    const query = searchQuery.toLowerCase();
    return recentRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.path.toLowerCase().includes(query) ||
        (repo.owner && repo.owner.toLowerCase().includes(query)),
    );
  });

  // When the filtered list changes (search typing or the repo list
  // refreshing), move the keyboard highlight to the row matching the
  // currently committed selection if it's still visible, otherwise
  // snap back to the first row. This makes reopening the tab feel
  // continuous — the repo the user last picked stays highlighted.
  $effect(() => {
    const idx = filteredRepos.findIndex((r) => r.path === selectedPath);
    focusedIndex = idx >= 0 ? idx : 0;
  });

  // Scroll the currently focused option into view only on keyboard navigation.
  let focusedViaKeyboard = $state(false);
  $effect(() => {
    const idx = focusedIndex;
    if (!focusedViaKeyboard || !listContainerRef) return;
    const option = listContainerRef.querySelector<HTMLElement>(`#local-repo-option-${idx}`);
    option?.scrollIntoView({ block: 'nearest' });
    focusedViaKeyboard = false;
  });

  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  async function getDirectoryStatus(path: string): Promise<DirectoryStatus | null> {
    if (typeof window === 'undefined' || !window.electronAPI) return null;
    try {
      const result = await invoke<any>('file:getDirectoryStatus', { path });
      return result?.success && result.data ? result.data : null;
    } catch (err) {
      logger.warn('Failed to check directory status', { path, error: String(err) });
      return null;
    }
  }

  async function handleSelectPath(path: string, advance = false) {
    // Capture reactive prop references before the await — Svelte 5 reactive
    // proxies can become stale/non-callable after an async suspension.
    const advanceCb = onSelectAndAdvance;
    const selectCb = onSelect;
    const status = await getDirectoryStatus(path);
    const scope = status?.isSubdirectoryOfGitRepo ? status.relativePathFromGitRoot : undefined;
    if (advance && advanceCb) {
      advanceCb(path, scope);
    } else {
      selectCb(path, scope);
    }
  }

  async function handleSelectFolder() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await invoke<any>('dialog:open', {
          directory: true,
          title: 'Select Repository Folder',
          createDirectory: true,
        });
        if (
          result?.success &&
          result?.data &&
          !result.data.canceled &&
          result.data.filePaths?.length > 0
        ) {
          const pickedPath = result.data.filePaths[0];
          // Add to list if it's not already there
          if (!recentRepos.some((r) => r.path === pickedPath)) {
            manuallyAddedPaths = [pickedPath, ...manuallyAddedPaths];
          }
          await handleSelectPath(pickedPath);
        }
      }
    } catch (err) {
      logger.error('Failed to select folder', err);
    }
  }

  // Auto-focus the search input when this tab becomes active. The parent
  // uses {#key activeTab}, so this component re-mounts on every tab switch
  // and onMount fires each time.
  onMount(() => {
    searchInputRef?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedViaKeyboard = true;
      focusedIndex = Math.min(focusedIndex + 1, filteredRepos.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedViaKeyboard = true;
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter' && filteredRepos[focusedIndex]) {
      e.preventDefault();
      void handleSelectPath(filteredRepos[focusedIndex].path, true);
    }
  }
</script>

<div class="space-y-3">
  <p class="text-base text-muted-foreground pb-3">
    Pick a project from your machine. You can select any folder on disk.
  </p>
  <!--
    Search input — acts as the combobox trigger for the listbox below.
    `aria-activedescendant` points at the currently keyboard-focused
    option so screen readers announce the selection as the user arrows
    through the list without ever moving DOM focus off the input.
  -->
  <div class="relative">
    <Input
      bind:ref={searchInputRef}
      bind:value={searchQuery}
      type="text"
      placeholder="Search projects..."
      class="w-full py-5! pr-11"
      noFocusStyle
      onkeydown={handleKeydown}
      role="combobox"
      aria-autocomplete="list"
      aria-controls="local-repo-list"
      aria-expanded={filteredRepos.length > 0}
      aria-activedescendant={filteredRepos[focusedIndex]
        ? `local-repo-option-${focusedIndex}`
        : undefined}
      aria-label="Search local projects"
    />
    <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
      {#if searchQuery}
        <button
          type="button"
          class="text-muted-foreground/50 hover:text-foreground text-xs cursor-pointer p-1.5 rounded hover:bg-muted/40 transition-colors"
          onclick={() => {
            searchQuery = '';
            searchInputRef?.focus();
          }}
          aria-label="Clear search">✕</button
        >
      {/if}
      <button
        type="button"
        class="text-muted-foreground/60 hover:text-foreground cursor-pointer p-1.5 mr-0.5 rounded hover:bg-muted/40 transition-colors"
        onclick={handleSelectFolder}
        aria-label="Browse for a folder"
        title="Browse for a folder"
      >
        <Fa icon={faFolder} size="sm" />
      </button>
    </div>
  </div>

  <!--
    Repo listbox (scrollable). `role="listbox"` + per-row `role="option"`
    + `aria-selected` makes this a proper accessible combobox popup.
    Keyboard focus stays on the input; the visually highlighted row is
    driven entirely by `selectedIndex`. `onmousemove` is used instead of
    `onmouseenter` so keyboard navigation isn't hijacked the moment the
    cursor happens to be hovering a list row.
  -->
  <div
    bind:this={listContainerRef}
    id="local-repo-list"
    role="listbox"
    aria-label="Recent local projects"
    class="max-h-70 overflow-y-auto -mx-1 px-1"
  >
    {#if filteredRepos.length > 0}
      <div class="divide-y divide-border/10">
        {#each filteredRepos as repo, index (repo.path)}
          {@const isFocused = index === focusedIndex}
          {@const isCommitted = repo.path === selectedPath}
          <button
            type="button"
            id="local-repo-option-{index}"
            role="option"
            aria-selected={isCommitted}
            class={cn(
              'w-full flex items-center gap-3 py-2.5 px-3 text-left rounded-lg transition-colors cursor-pointer',
              {
                'bg-foreground text-background pl-2.5': isCommitted,
                'bg-muted/40': isFocused && !isCommitted,
                'hover:bg-muted/30': !isFocused && !isCommitted,
              },
            )}
            onclick={() => {
              void handleSelectPath(repo.path);
              searchInputRef?.focus();
            }}
            onmousemove={() => (focusedIndex = index)}
          >
            <div class="size-6 shrink-0">
              {#if repo.owner}
                <img
                  src={getGitHubAvatarUrl(repo.owner, 32)}
                  alt={repo.owner}
                  class="w-6 h-6 rounded-full shrink-0"
                  loading="lazy"
                  onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              {:else}
                <div class="w-6 h-6 flex items-center justify-center shrink-0">
                  <Fa
                    icon={faFolder}
                    class={isCommitted ? 'text-background' : 'text-muted-foreground'}
                    size={18}
                  />
                </div>
              {/if}
            </div>
            <div class="min-w-0 shrink truncate">
              <span
                class={cn('text-sm font-medium', isCommitted ? 'text-background' : 'text-foreground')}
              >
                {#if repo.owner}
                  <span class={cn('mr-1', isCommitted ? 'text-background/60' : 'text-subtle')}
                    >{repo.owner} /</span
                  >
                {/if}
                {repo.name}
              </span>
            </div>
            <div
              class={cn(
                'text-xs min-w-0 shrink-2 truncate ml-auto text-right',
                isCommitted ? 'text-background/50' : 'text-muted-foreground',
              )}
            >
              {repo.path.replace(/^\/Users\/[^/]+/, '~')}
            </div>
            <svg
              class={cn('w-4 h-4 shrink-0', isCommitted ? 'text-background/40' : 'text-ghost')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        {/each}
      </div>
    {:else if searchQuery}
      <div class="py-4 text-center text-sm text-muted-foreground">
        No projects match "{searchQuery}"
      </div>
    {:else}
      <div class="py-4 text-center text-sm text-muted-foreground">No recent projects found</div>
    {/if}
  </div>
</div>
