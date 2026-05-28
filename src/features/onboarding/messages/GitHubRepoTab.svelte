<script lang="ts">
  /**
   * GitHubRepoTab — GitHub repository clone for onboarding.
   *
   * URL input + clone path picker, with a live list of the user's own
   * repositories sourced from the `github-repos` Redux slice and a
   * debounced global GitHub repo search powered by `github-repo-search`.
   *
   * The owner/repo input drives two things at once:
   *   1. A client-side filter over the cached list of the user's own repos
   *      (zero network per keystroke).
   *   2. A debounced global search dispatch. The `githubRepoSearchSaga` uses
   *      typed-redux-saga's `debounce(300ms, ...)` effect so rapid keystrokes
   *      coalesce into a single network round-trip and the latest query wins.
   *
   * Components never call IPC directly, per `src/lib/store/AGENTS.md`.
   */
  import { onMount } from 'svelte';
  import { cn } from '$lib/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { shell } from '$lib/electron-bridge';
  import Input from '$lib/components/ui/input/input.svelte';
  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { initializeGitHubAuth } from '$lib/store/slices/github-auth/github-auth-slice';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import {
  loadGithubRepos,
  type GithubRepoItem,
} from '$lib/store/slices/github-repos/github-repos-slice';
  import {
  selectGithubRepos,
  selectGithubReposError,
  selectGithubReposLoaded,
  selectGithubReposLoading,
} from '$lib/store/slices/github-repos/github-repos-selectors';
  import { searchGithubRepos } from '$lib/store/slices/github-repo-search/github-repo-search-slice';
  import {
  selectGithubRepoSearchLastQuery,
  selectGithubRepoSearchLoading,
  selectGithubRepoSearchResults,
} from '$lib/store/slices/github-repo-search/github-repo-search-selectors';
  import { selectWorkspaceInitializerDefaultParentPath } from '$lib/store/slices/workspace-initializer/workspace-initializer-selectors';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import {
  faArrowUpRightFromSquare,
  faFolder,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('GitHubRepoTab');

  interface Props {
    githubUrl: string;
    clonePath: string;
    onGithubUrlChange: (url: string) => void;
    onClonePathChange: (path: string) => void;
    /** Called when user presses Enter - should select AND advance to next step */
    onSelectAndAdvance?: (url: string) => void;
  }

  // Submit/continue is handled by the unified button at the bottom of the
  // onboarding flow (see `+page.svelte`). This tab only collects data.
  let { githubUrl, clonePath, onGithubUrlChange, onClonePathChange, onSelectAndAdvance }: Props =
    $props();

  const dispatch = getDispatch();
  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const repos$ = selectGithubRepos();
  const reposLoading$ = selectGithubReposLoading();
  const reposError$ = selectGithubReposError();
  const reposLoaded$ = selectGithubReposLoaded();
  const searchResults$ = selectGithubRepoSearchResults();
  const searchLoading$ = selectGithubRepoSearchLoading();
  const searchLastQuery$ = selectGithubRepoSearchLastQuery();
  const defaultParentPath$ = selectWorkspaceInitializerDefaultParentPath();

  let githubInput = $state(githubUrl.replace(/^https?:\/\/github\.com\//, ''));

  /**
   * Auto-focus the GitHub URL input when this tab becomes active. The parent
   * uses {#key activeTab}, so this component re-mounts on every tab switch
   * and the onMount below fires each time.
   */
  let githubInputRef = $state<HTMLInputElement | null>(null);

  /**
   * Client-side filter over the cached repo list. We match on the full
   * `owner/name` string so typing an org prefix or a repo substring both
   * work. Empty query returns the whole list unchanged. Filtering lives in
   * the component (not a selector) because it depends on ephemeral input
   * state that does not belong in Redux.
   */
  const filteredRepos = $derived.by<GithubRepoItem[]>(() => {
    const all = $repos$;
    if (!all.length) return [];
    const q = githubInput.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
  });

  /**
   * Global search results, deduped against the user's own repos so a repo
   * the user already owns doesn't appear twice. We also drop any result
   * whose normalized `id` exactly matches the current input — it's already
   * displayed in the owned-repos list above (or would be if they owned it).
   */
  const discoverResults = $derived.by<GithubRepoItem[]>(() => {
    if ($searchLastQuery$ !== githubInput.trim()) return [];
    const results = $searchResults$;
    if (!results.length) return [];
    const ownedIds = new Set($repos$.map((r) => r.id));
    return results.filter((r) => !ownedIds.has(r.id));
  });

  /**
   * Single unified list: the user's own repos (filtered by the current
   * input) followed by deduped global search results. One list, one
   * styling — matches LocalRepoTab and keeps keyboard navigation simple.
   */
  const combinedRepos = $derived.by<GithubRepoItem[]>(() => {
    return [...filteredRepos, ...discoverResults];
  });

  // Keyboard navigation state for the combined listbox
  let focusedIndex = $state(0);
  let listContainerRef = $state<HTMLDivElement | null>(null);

  // Reset the selection whenever the visible list changes (new search
  // results, new filter, re-login, etc.) so keyboard focus never points
  // at a stale index past the end of the list.
  $effect(() => {
    combinedRepos; // track
    focusedIndex = 0;
  });

  // Scroll the currently focused option into view only on keyboard navigation.
  let focusedViaKeyboard = $state(false);
  $effect(() => {
    const idx = focusedIndex;
    if (!focusedViaKeyboard || !listContainerRef) return;
    const option = listContainerRef.querySelector<HTMLElement>(`#github-repo-option-${idx}`);
    option?.scrollIntoView({ block: 'nearest' });
    focusedViaKeyboard = false;
  });

  /** GitHub avatar URL helper — matches LocalRepoTab. */
  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  /** Arrow-key navigation and Enter-to-select over the combined list. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedViaKeyboard = true;
      focusedIndex = Math.min(focusedIndex + 1, combinedRepos.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedViaKeyboard = true;
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      const repo = combinedRepos[focusedIndex];
      if (repo) {
        e.preventDefault();
        handleSelectRepo(repo);
        if (onSelectAndAdvance) {
          onSelectAndAdvance(`https://github.com/${repo.owner}/${repo.name}`);
        }
      }
    }
  }

  /** Default base directory for cloned repos, hydrated through Redux persistence. */
  const defaultCloneBase = $derived($defaultParentPath$ || '~/Developer');

  function handleInputChange(value: string) {
    // Strip full URL prefix if user pastes a full URL
    let cleaned = value.replace(/^https?:\/\/github\.com\//, '');
    // Remove trailing .git
    cleaned = cleaned.replace(/\.git$/, '');
    githubInput = cleaned;

    if (cleaned) {
      onGithubUrlChange(`https://github.com/${cleaned}`);

      // Auto-fill clone path when input looks like owner/repo
      const parts = cleaned.split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const repoName = parts[1].split(/[?#]/)[0]; // strip query/hash
        if (repoName) {
          onClonePathChange(defaultCloneBase);
        }
      }
    } else {
      onGithubUrlChange('');
    }

    // Global GitHub search — the saga debounces at 300ms via typed-redux-saga's
    // `debounce` effect, so we can dispatch freely on every keystroke. Short
    // queries are short-circuited inside the saga, which means an empty input
    // also tidies up the search slice without any extra logic here.
    dispatch(searchGithubRepos(cleaned));
  }

  function handlePaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted.includes('github.com/')) {
      e.preventDefault();
      handleInputChange(pasted);

      // Auto-select if the pasted URL resolves to a known repo
      const cleaned = pasted
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
      const parts = cleaned.split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const owner = parts[0].toLowerCase();
        const name = parts[1].split(/[?#]/)[0].toLowerCase();
        const match = $repos$.find(
          (r) => r.owner.toLowerCase() === owner && r.name.toLowerCase() === name,
        );
        if (match) {
          handleSelectRepo(match);
          if (onSelectAndAdvance) {
            onSelectAndAdvance(`https://github.com/${match.owner}/${match.name}`);
          }
        }
      }
    }
  }

  async function handleSelectCloneFolder() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('dialog:open', {
          directory: true,
          title: 'Select Clone Destination',
          createDirectory: true,
        });
        if (
          result?.success &&
          result?.data &&
          !result.data.canceled &&
          result.data.filePaths?.length > 0
        ) {
          onClonePathChange(result.data.filePaths[0]);
        }
      }
    } catch (err) {
      logger.error('Failed to select clone folder', err);
    }
  }

  /** Click-to-select from the repo list. Notifies the parent of the
   *  selection without changing the search input so the user can keep
   *  browsing. Also auto-fills the clone path with a sensible default. */
  function handleSelectRepo(repo: GithubRepoItem) {
    const path = `${repo.owner}/${repo.name}`;
    onGithubUrlChange(`https://github.com/${path}`);
    onClonePathChange(defaultCloneBase);
  }

  /** User-initiated refresh. The saga also auto-reloads when auth state
   *  flips to authenticated, so we only need an explicit dispatch here. */
  function refreshRepos() {
    dispatch(loadGithubRepos());
  }

  /**
   * Open a URL in the system browser via Electron's `shell.openExternal`.
   * Used by the external-link button so users can preview the repo on
   * github.com before committing to cloning it. We stopPropagation on the
   * click event so clicking the link inside a repo list row doesn't also
   * trigger that row's own select handler.
   */
  function openInBrowser(url: string, e: Event) {
    e.stopPropagation();
    if (!url) return;
    shell.open(url).catch((err) => logger.error('Failed to open external URL', err));
  }

  onMount(() => {
    // Make sure the store has a fresh snapshot of GitHub auth state. The
    // github-repos saga watches this selector via takeLatestFromSelector, so
    // the initial repo load happens automatically once we become authenticated.
    dispatch(initializeGitHubAuth());
    githubInputRef?.focus();
  });
</script>

<div class="space-y-3">
  <div class="w-full flex space-between items-center">
    <p class="text-base text-muted-foreground pb-3 flex-1">Clone a repository from GitHub.</p>
  </div>
  <!--
    Top row: GitHub URL input + clone destination picker, horizontally
    stacked. The two controls share a single row so picking a repo and
    picking where it goes feels like one decision rather than two
    disconnected steps. `items-stretch` keeps both children the same
    height regardless of which one has the taller content.
  -->
  <div class="flex items-stretch gap-2">
    <div
      class="flex-1 flex items-center rounded-lg py-1 border border-border/50 bg-card/50 overflow-hidden"
    >
      <Fa icon={faGithub} class="ml-3 text-muted-foreground" />
      <span class="text-sm pl-1.5 shrink-0 select-none text-muted-foreground">github.com/</span>
      <Input
        bind:ref={githubInputRef}
        type="text"
        value={githubInput}
        oninput={(e) => handleInputChange(e.currentTarget.value)}
        onpaste={handlePaste}
        onkeydown={handleKeydown}
        noFocusStyle
        class="border-0 bg-transparent! shadow-none focus-visible:ring-0 text-sm"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="github-repo-list"
        aria-expanded={combinedRepos.length > 0}
        aria-activedescendant={combinedRepos[focusedIndex]
          ? `github-repo-option-${focusedIndex}`
          : undefined}
      />
    </div>
  </div>

  <!--
    Single unified repository list — combines the user's own repos
    (filtered by the URL input) with deduped global search results.
    Visual styling matches LocalRepoTab so the two onboarding tabs feel
    like the same control. `role="listbox"` + `role="option"` makes the
    list an accessible combobox popup driven from the URL input above.
  -->
  {#if !$isAuthenticated$}
    <GitHubAuthBanner message="Sign in with GitHub to see your repositories" />
  {:else if $reposError$}
    <div
      class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive-foreground space-y-2"
    >
      <p>Couldn't load repositories: {$reposError$}</p>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 cursor-pointer hover:no-underline"
        onclick={refreshRepos}
      >
        <Fa icon={faSpinner} size="xs" />
        <span>Try again</span>
      </button>
    </div>
  {:else}
    <div
      bind:this={listContainerRef}
      id="github-repo-list"
      role="listbox"
      aria-label="GitHub repositories"
      class="max-h-70 overflow-y-auto -mx-1 px-1"
    >
      {#if combinedRepos.length > 0}
        <div class="divide-y divide-border/10">
          {#each combinedRepos as repo, index (repo.id)}
            {@const isFocused = index === focusedIndex}
            {@const isCommitted = githubUrl === `https://github.com/${repo.owner}/${repo.name}`}
            <button
              type="button"
              id="github-repo-option-{index}"
              role="option"
              aria-selected={isCommitted}
              class="group/row w-full flex items-center gap-3 py-2.5 px-3 text-left rounded-lg transition-colors cursor-pointer
                {isCommitted ? 'bg-foreground text-background pl-2.5' : ''}
                {isFocused && !isCommitted ? 'bg-muted/40' : ''}
                {!isFocused && !isCommitted ? 'hover:bg-muted/30' : ''}"
              onclick={() => {
                handleSelectRepo(repo);
                githubInputRef?.focus();
              }}
              onmousemove={() => (focusedIndex = index)}
            >
              <img
                src={getGitHubAvatarUrl(repo.owner, 32)}
                alt={repo.owner}
                class="w-6 h-6 rounded-full shrink-0"
                loading="lazy"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
              <div class="flex-1 min-w-0">
                <div
                  class={cn('flex items-center text-sm font-medium truncate', isCommitted ? 'text-background' : 'text-foreground')}
                >
                  <div class={cn('mr-1', isCommitted ? 'text-background/60' : 'text-subtle')}>
                    {repo.owner} /
                  </div>
                  {repo.name}
                </div>
              </div>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                role="link"
                tabindex="-1"
                class="p-1 rounded shrink-0 transition-colors cursor-pointer {isCommitted
                  ? 'text-background/0 group-hover/row:text-background/60 hover:!text-background /* a11y-ignore */'
                  : 'text-muted-foreground/0 group-hover/row:text-muted-foreground hover:!text-foreground hover:bg-muted/40 /* a11y-ignore */'}"
                onclick={(e) => openInBrowser(`https://github.com/${repo.owner}/${repo.name}`, e)}
                onkeydown={(e) => {
                  if (e.key === 'Enter')
                    openInBrowser(`https://github.com/${repo.owner}/${repo.name}`, e);
                }}
                title="Open {repo.owner}/{repo.name} on github.com"
                aria-label="Open {repo.owner}/{repo.name} on github.com"
              >
                <Fa icon={faArrowUpRightFromSquare} size="xs" />
              </span>
            </button>
          {/each}
        </div>
      {:else if $reposLoading$ && !$reposLoaded$}
        <div class="py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span>Loading your repositories…</span>
        </div>
      {:else if githubInput.trim() && $searchLoading$}
        <div class="py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span>Searching GitHub for "{githubInput.trim()}"…</span>
        </div>
      {:else if githubInput.trim()}
        <div class="py-4 text-center text-sm text-muted-foreground">
          No repositories match "{githubInput.trim()}"
        </div>
      {:else}
        <div class="py-4 text-center text-sm text-muted-foreground">
          No repositories found on your GitHub account
        </div>
      {/if}
    </div>
  {/if}
</div>

<!--
      Store location picker — horizontally stacked with the URL input.
      Compact one-line layout so it fits in the row without dominating
      the space. Clicking opens a native folder dialog via Electron.
    -->
<button
  type="button"
  class="mt-6 flex items-center gap-2 px-3 rounded-lg transition-colors cursor-pointer text-left shrink-0"
  onclick={handleSelectCloneFolder}
  aria-label="Choose clone destination folder"
  title="Where to clone the repository"
>
  <Fa icon={faFolder} class="text-subtle/50 shrink-0 -mb-px" size={20} />
  <span class="text-sm text-muted-foreground whitespace-nowrap">Store the repository in</span>
  <span
    class="text-sm font-medium truncate max-w-40 {clonePath
      ? 'text-foreground'
      : 'text-muted-foreground'}"
  >
    {clonePath ? clonePath.replace(/^\/Users\/[^/]+/, '~') : 'Select folder'}
  </span>
</button>
