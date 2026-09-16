<script lang="ts">
  /* eslint-disable max-lines */
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Select } from '$lib/components/ui/select';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { toast } from '$lib/components/ui/toast';
  import { debugConfig } from '$lib/config/debug';
  import {
    connectGitHubForInitializerRequested,
    loadWorkspaceInitializerGitHubBranches,
    searchWorkspaceInitializerGitHubBranches,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    loadGitBranches,
    readGitBranchStatusRequested,
  } from '$store/renderer/slices/git/git-slice';
  import { parseGitHubUrl } from '$lib/utils/workspace-validation';

  import { setWorkspaceInitializerBranchForRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { selectWorkspaceInitializerBranchByRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { selectWorkspaceInitializerGitHubBranchListing } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import {
    selectGitBranchStatus,
    selectGitBranchStatusError,
    selectGitBranchStatusLoading,
    selectGitRepoBranches,
    selectGitRepoBranchesError,
    selectGitRepoBranchesLoading,
  } from '$store/renderer/slices/git/git-selectors';
  import {
    selectGitHubAuthError,
    selectGitHubAuthIsAuthenticated,
    selectGitHubAuthIsAuthenticating,
  } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    isolationNoun,
    resolveEffectiveIsolationMode,
    type IsolationMode,
  } from './isolation-mode';
  import { isWorkspaceSlug } from '$shared/services/workspace-slug';
  import { m } from '$shared/paraglide/messages.js';
  import {
    faCheck,
    faChevronDown,
    faChevronLeft,
    faCloud,
    faExclamationTriangle,
    faRotate,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { tick } from 'svelte';
  import { derived, writable } from 'svelte/store';
  import { slide } from '$lib/motion';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('BranchSelector');
  const branchByRepo$ = selectWorkspaceInitializerBranchByRepo();
  const repoPathStore = writable('');
  const branchStatusNameStore = writable('');
  const githubOwnerStore = writable('');
  const githubRepoStore = writable('');
  const githubSearchPrefixStore = writable('');
  const gitBranches$ = derived(
    [
      selectGitRepoBranches(repoPathStore),
      selectGitRepoBranchesLoading(repoPathStore),
      selectGitRepoBranchesError(repoPathStore),
    ],
    ([data, loading, error]) => ({ data, loading, error }),
  );
  const gitBranchStatus$ = derived(
    [
      selectGitBranchStatus(repoPathStore, branchStatusNameStore),
      selectGitBranchStatusLoading(repoPathStore, branchStatusNameStore),
      selectGitBranchStatusError(repoPathStore, branchStatusNameStore),
    ],
    ([data, loading, error]) => ({ data, loading, error }),
  );
  const cachedGithubBranches$ = selectWorkspaceInitializerGitHubBranchListing(
    githubOwnerStore,
    githubRepoStore,
    writable('cached'),
  );
  const freshGithubBranches$ = selectWorkspaceInitializerGitHubBranchListing(
    githubOwnerStore,
    githubRepoStore,
    writable(''),
  );
  const searchedGithubBranches$ = selectWorkspaceInitializerGitHubBranchListing(
    githubOwnerStore,
    githubRepoStore,
    githubSearchPrefixStore,
  );
  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const githubAuthIsAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const githubAuthError$ = selectGitHubAuthError();

  $effect(() => {
    repoPathStore.set(repoPath);
  });

  /** Status of the branch relative to its upstream */
  export interface BranchStatus {
    /** Number of commits the branch is behind its upstream */
    behind: number;
    /** Whether there are uncommitted changes in the working directory */
    hasUncommittedChanges: boolean;
    /** The currently checked out branch in the repo */
    currentBranch: string;
    /** Whether the selected branch is the currently checked out branch */
    isCurrentBranch: boolean;
    /** Whether we're currently fetching status */
    isLoading: boolean;
  }

  /** Snapshot of a successfully loaded branch list */
  export interface BranchListInfo {
    branches: string[];
    remoteBranches: string[];
    defaultBranch: string;
    currentBranch: string;
  }

  interface Props {
    variant?: 'default' | 'ghost' | 'underline';
    value?: string;
    repoPath: string;
    repoType: 'local' | 'github';
    githubUrl?: string;
    disabled?: boolean;
    dropUp?: boolean;
    portal?: boolean;
    triggerClass?: string;
    hasTriggerIcon?: boolean;
    description?: string;
    /** Whether to skip the isolated checkout (worktree or CoW clone) and work directly on current branch */
    skipIsolation?: boolean;
    /** Suggested branch (e.g. from a PR) - highlights picker when different from selected */
    suggestedBranch?: string;
    /** Callback when the skip-isolation option is toggled */
    onSkipIsolationChange?: (skipIsolation: boolean) => void;
    /** Callback when GitHub auth state changes (for private repos) */
    onGitHubAuthNeededChange?: (authNeeded: 'none' | 'not-authenticated' | 'no-access') => void;
    /** Callback when branch status changes (behind count and unstaged changes) */
    onBranchStatusChange?: (status: BranchStatus) => void;
    /** Callback when the branch list has been fetched successfully */
    onBranchesLoaded?: (info: BranchListInfo) => void;
    onchange?: (event: CustomEvent<{ branch: string }>) => void;
    /** Whether to show the uncommitted changes indicator (default: false) */
    showUncommittedIndicator?: boolean;
    showTriggerChevron?: boolean;
    triggerChevronClass?: string;
    triggerContentClass?: string;
  }

  let {
    variant = 'underline',
    value = '',
    repoPath,
    repoType,
    githubUrl,
    disabled = false,
    dropUp = false,
    portal = true,
    triggerClass,
    hasTriggerIcon = true,
    description,
    skipIsolation = false,
    suggestedBranch,
    onSkipIsolationChange,
    onGitHubAuthNeededChange,
    onBranchStatusChange,
    onBranchesLoaded,
    onchange,
    showUncommittedIndicator = false,
    showTriggerChevron = false,
    triggerChevronClass = 'ml-2 opacity-50',
    triggerContentClass = 'gap-0.75',
  }: Props = $props();

  // State
  let internalSelectedBranch = $state('');
  let branches: string[] = $state([]);
  let remoteBranches: string[] = $state([]); // Remote-only branches (not in local)
  let showRemoteBranches = $state(false); // Whether to show remote branches section
  let isLoadingRemote = $state(false); // Loading state for remote branches
  let hasAttemptedRemoteFetch = $state(false); // Track if we've already tried fetching remote branches
  let defaultBranch = $state('');
  let currentBranch = $state(''); // Track the current branch separately
  let isLoading = $state(false);
  let error: string | null = $state(null);
  let searchValue = $state('');
  const debouncedSearchValue = $derived(searchValue.trim());
  // Server-side prefix search (GitHub repos only): branches matching the
  // typed prefix beyond the daemon's first page (`github.branches.list`
  // `prefix` param, PROTOCOL §5.27). Merged into the displayed list; the
  // unfiltered `branches` state stays untouched so clearing the search
  // restores today's first-page view.
  let githubSearchBranches: string[] = $state([]);
  let explicitBranchSelectionRevision = 0;
  let pendingGithubSelection: {
    autoSelectedBranch: string;
    valueBeforePaint: string;
    savedBranchBeforePaint: string;
    explicitSelectionRevision: number;
  } | null = null;
  // Using 'any' because this binds to a Svelte Input component, not a native HTMLInputElement
  // The Input component exports focus() and select() methods that we use
  let searchInputElement: any = $state(null);
  let isOpen = $state(false); // Track dropdown open state
  let isDropdownMounting = $state(false); // Show skeleton while dropdown content mounts
  let containerEl: HTMLDivElement | undefined = $state(); // Container for positioning
  let triggerEl: HTMLButtonElement | null = $state(null); // Focus target after a selection closes the content

  // GitHub auth state for private repos
  type GitHubAuthNeeded = 'none' | 'not-authenticated' | 'no-access';
  let githubAuthNeeded: GitHubAuthNeeded = $state('none');
  let isConnectingGitHub = $state(false);

  // Effective isolated-checkout mode (worktree vs CoW clone) for creation copy.
  // Re-resolves when workspace items hydrate (cowSupported is read off them).
  const workspaceItemsForIsolation$ = selectWorkspaceItems();
  let isolationMode = $state<IsolationMode>('worktree');
  $effect(() => {
    void resolveEffectiveIsolationMode($workspaceItemsForIsolation$).then(
      (mode) => (isolationMode = mode),
    );
  });
  const isolationLabel = $derived(isolationNoun(isolationMode));

  // Whole-sentence message split around the styled branch name so translators
  // control word order; '\u0000' marks the branch slot.
  const workDirectlyParts = $derived(
    m.workspace_branchSelector_workDirectlyOnBranch_label({ branch: '\u0000' }).split('\u0000'),
  );

  // Branch status state - managed internally and exposed via callback
  let branchStatusBehind = $state(0);
  let branchStatusHasUncommittedChanges = $state(false);
  let branchStatusIsLoading = $state(false);
  // Track which branch we're fetching status for to prevent race conditions
  let pendingStatusBranch = $state<string | null>(null);

  // Notify parent when GitHub auth state changes (with previous-value guard)
  let lastNotifiedGithubAuth: GitHubAuthNeeded | null = null;
  $effect(() => {
    if (
      typeof onGitHubAuthNeededChange === 'function' &&
      githubAuthNeeded !== lastNotifiedGithubAuth
    ) {
      lastNotifiedGithubAuth = githubAuthNeeded;
      try {
        onGitHubAuthNeededChange(githubAuthNeeded);
      } catch (e) {
        logger.error('Error in onGitHubAuthNeededChange callback', e);
      }
    }
  });

  // Use value prop as source of truth when provided, otherwise use internal state
  const selectedBranch = $derived(value || internalSelectedBranch);

  // Derived: whether the selected branch is the currently checked out branch
  const isCurrentBranch = $derived(selectedBranch === currentBranch && currentBranch !== '');

  // Notify parent when branch status changes.
  // Read individual state values directly instead of a $derived object literal,
  // so Svelte can track each primitive and only re-fire when a value actually changes.
  // Use a previous-value guard to avoid re-notifying when the callback prop
  // reference changes but the status values are identical (prevents
  // effect_update_depth_exceeded when inline function props are recreated).
  let lastNotifiedBranchStatus: {
    behind: number;
    hasUncommittedChanges: boolean;
    currentBranch: string;
    isCurrentBranch: boolean;
    isLoading: boolean;
  } | null = null;
  $effect(() => {
    if (typeof onBranchStatusChange === 'function' && selectedBranch) {
      const behind = branchStatusBehind;
      const uncommitted = branchStatusHasUncommittedChanges;
      const current = currentBranch;
      const isCurrent = isCurrentBranch;
      const loading = branchStatusIsLoading;

      // Skip notification if values haven't changed
      if (
        lastNotifiedBranchStatus &&
        lastNotifiedBranchStatus.behind === behind &&
        lastNotifiedBranchStatus.hasUncommittedChanges === uncommitted &&
        lastNotifiedBranchStatus.currentBranch === current &&
        lastNotifiedBranchStatus.isCurrentBranch === isCurrent &&
        lastNotifiedBranchStatus.isLoading === loading
      ) {
        return;
      }

      const status: BranchStatus = {
        behind,
        hasUncommittedChanges: uncommitted,
        currentBranch: current,
        isCurrentBranch: isCurrent,
        isLoading: loading,
      };
      lastNotifiedBranchStatus = status;
      try {
        onBranchStatusChange(status);
      } catch (e) {
        logger.error('Error in onBranchStatusChange callback', e);
      }
    }
  });

  // Track previous values to detect changes (non-reactive to avoid triggering effects)
  let previousRepoPath = '';
  let previousRepoType: 'local' | 'github' = 'local';
  let previousGithubUrl: string | undefined = undefined;

  /**
   * Get the saved branch for a specific repo from Redux hydrated persistence.
   * This ensures we use the correct saved branch for the current repo,
   * not a stale value from a previous repo.
   */
  function getSavedBranchForRepo(targetRepoPath: string): string {
    if (!debugConfig.get('enableFormPersistence')) {
      return '';
    }
    return $branchByRepo$[targetRepoPath] || '';
  }

  function saveBranchForRepo(targetRepoPath: string, branch: string) {
    if (debugConfig.get('enableFormPersistence') && targetRepoPath) {
      appStore.dispatch(setWorkspaceInitializerBranchForRepo(targetRepoPath, branch));
    }
  }

  // Update internal state when value prop changes
  // Track previous repo path to detect repo changes in value effect
  let lastRepoPathForValueEffect = '';

  $effect(() => {
    logger.debug('Value prop effect triggered', { value, repoPath, internalSelectedBranch });

    // Detect if repo changed since last value effect run
    const repoChanged = repoPath !== lastRepoPathForValueEffect;
    lastRepoPathForValueEffect = repoPath;

    if (value) {
      logger.debug('Setting internalSelectedBranch from value prop', { value });
      internalSelectedBranch = value;
    } else if (repoChanged) {
      // When repo changes and value is empty, clear internalSelectedBranch
      // The repo change effect will set it to the saved branch (if any)
      logger.debug('Repo changed and value is empty, clearing internalSelectedBranch');
      internalSelectedBranch = '';
    }
  });

  let cachedListingApplied = false;
  let lastHandledGitBranches: typeof $gitBranches$.data = null;
  let lastHandledCachedListing: typeof $cachedGithubBranches$ | undefined;
  let lastHandledFreshListing: typeof $freshGithubBranches$ | undefined;
  let lastHandledLoadError = '';
  let gitSelectionApplied = false;

  function branchLoadDebugOptions(): [boolean, number] {
    const cacheEnabled = Boolean(debugConfig.get('enableBranchCaching'));
    const networkDelayMs = debugConfig.get('simulateSlowNetwork')
      ? Number(debugConfig.get('networkDelay')) || 0
      : 0;
    return [cacheEnabled, networkDelayMs];
  }

  function requestBranches(forceRefresh = false) {
    const [cacheEnabled, networkDelayMs] = branchLoadDebugOptions();
    const parsed = parseGithubOwnerRepo();
    if (repoType === 'github' || parsed) {
      if (!parsed) {
        handleBranchLoadError(m.workspace_validation_invalidGithubUrl_error(), 'github');
        return;
      }
      githubOwnerStore.set(parsed.owner);
      githubRepoStore.set(parsed.repo);
      appStore.dispatch(
        loadWorkspaceInitializerGitHubBranches(
          parsed.owner,
          parsed.repo,
          forceRefresh,
          cacheEnabled,
          networkDelayMs,
        ),
      );
      return;
    }
    appStore.dispatch(loadGitBranches(repoPath, true, forceRefresh, cacheEnabled, networkDelayMs));
  }

  // Fetch branches when repo changes
  $effect(() => {
    // Capture current values (read these first to establish dependencies)
    const currentRepoPath = repoPath;
    const currentRepoType = repoType;
    const currentGithubUrl = githubUrl;

    // Detect if we need to refetch (repo changed, or type/url changed for same repo)
    const repoChanged = currentRepoPath !== previousRepoPath;
    const typeChanged = currentRepoType !== previousRepoType;
    const urlChanged = currentGithubUrl !== previousGithubUrl;

    // Check if anything actually changed
    const needsRefetch = repoChanged || (currentRepoPath && (typeChanged || urlChanged));

    // Update previous values BEFORE any async operations
    previousRepoPath = currentRepoPath;
    previousRepoType = currentRepoType;
    previousGithubUrl = currentGithubUrl;

    // Only refetch if something meaningful changed
    if (needsRefetch) {
      pendingGithubSelection = null;
      if (currentRepoPath) {
        // Try to load saved branch for this repo if persistence is enabled.
        const savedBranch = getSavedBranchForRepo(currentRepoPath);

        // Clear previous selection when repo changes
        logger.debug('Repo changed - resetting branch', {
          previousRepoPath,
          currentRepoPath,
          savedBranch,
          previousInternalBranch: internalSelectedBranch,
        });
        internalSelectedBranch = savedBranch;
        defaultBranch = '';
        currentBranch = '';
        branches = [];
        remoteBranches = [];
        showRemoteBranches = false;
        hasAttemptedRemoteFetch = false; // Reset so we can fetch for new repo
        githubAuthNeeded = 'none'; // Reset auth state for new repo
        githubSearchBranches = []; // Drop prefix-search results from the previous repo
        error = null;
        cachedListingApplied = false;
        lastHandledGitBranches = null;
        lastHandledCachedListing = undefined;
        lastHandledFreshListing = undefined;
        lastHandledLoadError = '';
        gitSelectionApplied = false;
        resetBranchStatus(); // Reset stale branch status from previous repo
        clearSearch(); // A typed filter belongs to the previous repo's branch list

        requestBranches();
      } else {
        branches = [];
        internalSelectedBranch = '';
        defaultBranch = '';
        isLoading = false;
      }
    }
  });

  function notifyBranchesLoaded() {
    if (typeof onBranchesLoaded !== 'function') return;
    try {
      onBranchesLoaded({
        branches: [...branches],
        remoteBranches: [...remoteBranches],
        defaultBranch,
        currentBranch,
      });
    } catch (e) {
      logger.error('Error in onBranchesLoaded callback', e);
    }
  }

  /**
   * GitHub-path selection order: value prop, then the repo's saved branch,
   * then the default branch, then the first available branch. Shared by the
   * cached-first paint and the authoritative GitHub API path.
   */
  function applyGithubBranchSelection() {
    // If value prop is provided, trust it (e.g., for remote branches like origin/...)
    if (value) {
      // Value prop is the source of truth - don't override it
      setInternalBranch(value);
      return;
    }
    // Look up saved branch for THIS repo from Redux (not from stale selectedBranch)
    const savedBranchForRepo = getSavedBranchForRepo(repoPath);
    if (
      savedBranchForRepo &&
      (branches.includes(savedBranchForRepo) || remoteBranches.includes(savedBranchForRepo))
    ) {
      // Saved branch exists (in local or remote branches), use it
      setInternalBranch(savedBranchForRepo);
    } else if (defaultBranch) {
      // Repo metadata remains authoritative when the default is beyond the first page.
      setInternalBranch(defaultBranch);
    } else {
      // Last resort: use first available branch
      setInternalBranch(branches[0]);
    }
  }

  function handleBranchLoadError(message: string, effectiveRepoType: 'local' | 'github') {
    if (!message || message === lastHandledLoadError) return;
    lastHandledLoadError = message;
    isLoading = false;
    branches = [];

    if (/not configured|not authenticated/i.test(message)) {
      githubAuthNeeded = 'not-authenticated';
      error = null;
      return;
    }
    if (effectiveRepoType === 'github' && /404|not found/i.test(message)) {
      githubAuthNeeded = 'no-access';
      error = m.workspace_branchSelector_noAccess_error();
    } else if (
      message.includes('Git is not installed') || // i18n-ignore (error-message sniffing)
      message.includes('ENOENT') ||
      message.includes('spawn git')
    ) {
      error = m.workspace_branchSelector_gitNotInstalled_error();
    } else if (message.includes('rate limit')) {
      error = m.workspace_branchSelector_rateLimit_error();
    } else if (message.includes('404') || message.includes('not found')) {
      error = m.workspace_branchSelector_repoNotFound_error();
    } else if (message.includes('network') || message.includes('fetch')) {
      error = m.workspace_branchSelector_network_error();
    } else if (message.includes('permission') || message.includes('denied')) {
      error = m.workspace_branchSelector_permissionDenied_error();
    } else {
      error = message || m.workspace_branchSelector_fetchBranchesFailed_error();
    }
    toast.error(error);
  }

  $effect(() => {
    const result = $gitBranches$;
    if (repoType === 'github' || parseGithubOwnerRepo()) return;
    isLoading = result.loading;
    if (result.loading) {
      error = null;
      lastHandledLoadError = '';
      return;
    }
    if (result.error) {
      handleBranchLoadError(result.error, 'local');
      isLoadingRemote = false;
      return;
    }
    if (!result.data || result.data === lastHandledGitBranches) return;
    lastHandledGitBranches = result.data;
    branches = result.data.branches;
    remoteBranches = result.data.remoteBranches;
    defaultBranch = result.data.defaultBranch || '';
    currentBranch = result.data.currentBranch || '';
    isLoadingRemote = false;

    const savedBranch = getSavedBranchForRepo(repoPath);
    const preferred = value
      ? value
      : savedBranch && (branches.includes(savedBranch) || remoteBranches.includes(savedBranch))
        ? savedBranch
        : currentBranch && branches.includes(currentBranch)
          ? currentBranch
          : defaultBranch && branches.includes(defaultBranch)
            ? defaultBranch
            : branches[0];
    if (preferred && (!gitSelectionApplied || internalSelectedBranch !== preferred)) {
      setInternalBranch(preferred);
      gitSelectionApplied = true;
    }
    notifyBranchesLoaded();
  });

  $effect(() => {
    const listing = $cachedGithubBranches$;
    if (!listing || listing.loading || listing.error || listing.branches.length === 0) return;
    if ($freshGithubBranches$ && !$freshGithubBranches$.loading) return;
    if (listing === lastHandledCachedListing) return;
    lastHandledCachedListing = listing;
    branches = listing.branches;
    defaultBranch = listing.defaultBranch || '';
    isLoading = false;
    cachedListingApplied = true;
    if (!pendingGithubSelection) {
      const savedBranchBeforePaint = getSavedBranchForRepo(repoPath);
      const valueBeforePaint = value;
      const selectionRevision = explicitBranchSelectionRevision;
      applyGithubBranchSelection();
      pendingGithubSelection = {
        autoSelectedBranch: internalSelectedBranch,
        valueBeforePaint,
        savedBranchBeforePaint,
        explicitSelectionRevision: selectionRevision,
      };
    }
    notifyBranchesLoaded();
  });

  $effect(() => {
    const listing = $freshGithubBranches$;
    if (!listing) return;
    if (listing.loading) {
      isLoading = !cachedListingApplied;
      error = null;
      lastHandledLoadError = '';
      return;
    }
    if (listing.error) {
      handleBranchLoadError(listing.error, 'github');
      return;
    }
    if (listing === lastHandledFreshListing) return;
    lastHandledFreshListing = listing;
    isLoading = false;
    githubAuthNeeded = 'none';
    branches = listing.branches;
    defaultBranch = listing.defaultBranch || '';

    if (branches.length > 0) {
      const cachedSelection = pendingGithubSelection;
      if (cachedSelection && !cachedSelection.valueBeforePaint) {
        if (
          explicitBranchSelectionRevision === cachedSelection.explicitSelectionRevision &&
          (!value || value === cachedSelection.autoSelectedBranch)
        ) {
          const saved = cachedSelection.savedBranchBeforePaint;
          const preferred =
            saved && branches.includes(saved) ? saved : defaultBranch || branches[0];
          if (internalSelectedBranch !== preferred) setInternalBranch(preferred);
        }
      } else {
        applyGithubBranchSelection();
      }
    }
    pendingGithubSelection = null;
    notifyBranchesLoaded();
  });

  /**
   * Fetch remote branches for local repos.
   * This is called on-demand when user clicks "Show remote branches".
   */
  function fetchRemoteBranches() {
    if (!repoPath || repoType !== 'local') return;
    if (isLoadingRemote || hasAttemptedRemoteFetch) return; // Prevent duplicate requests

    isLoadingRemote = true;
    hasAttemptedRemoteFetch = true; // Mark that we've attempted to fetch
    const [cacheEnabled, networkDelayMs] = branchLoadDebugOptions();
    appStore.dispatch(loadGitBranches(repoPath, true, true, cacheEnabled, networkDelayMs));
  }

  /**
   * Toggle showing remote branches - fetches them if not already loaded
   */
  function toggleRemoteBranches() {
    showRemoteBranches = !showRemoteBranches;
    if (
      showRemoteBranches &&
      remoteBranches.length === 0 &&
      !isLoadingRemote &&
      !hasAttemptedRemoteFetch
    ) {
      fetchRemoteBranches();
    }
  }

  /**
   * Fetch branch status (behind count and unstaged changes) for a branch.
   * Updates internal state and notifies parent via the branch status notification effect.
   * Only works for local repos with a valid repoPath.
   */
  function fetchBranchStatus(branchName: string) {
    // Only fetch status for local repos with valid path and branch
    if (!branchName || !repoPath || repoType !== 'local') {
      // Reset status for non-local repos
      branchStatusBehind = 0;
      branchStatusHasUncommittedChanges = false;
      branchStatusIsLoading = false;
      return;
    }

    // Track which branch we're fetching to prevent race conditions
    pendingStatusBranch = branchName;
    branchStatusIsLoading = true;

    if (!isElectronPlatform()) {
      branchStatusBehind = 0;
      branchStatusHasUncommittedChanges = false;
      branchStatusIsLoading = false;
      return;
    }
    branchStatusNameStore.set(branchName);
    appStore.dispatch(readGitBranchStatusRequested(repoPath, branchName));
  }

  $effect(() => {
    const result = $gitBranchStatus$;
    const branchName = pendingStatusBranch;
    if (!branchName) return;
    branchStatusIsLoading = result.loading;
    if (result.loading) return;
    if (result.error || !result.data) {
      branchStatusBehind = 0;
      branchStatusHasUncommittedChanges = false;
      return;
    }
    branchStatusBehind = result.data.behind ?? 0;
    branchStatusHasUncommittedChanges =
      branchName === currentBranch ? (result.data.hasUncommittedChanges ?? false) : false;
  });

  /**
   * Reset branch status state - called when repo changes
   */
  function resetBranchStatus() {
    branchStatusBehind = 0;
    branchStatusHasUncommittedChanges = false;
    branchStatusIsLoading = false;
    pendingStatusBranch = null;
  }

  /**
   * Set the branch internally AND notify the parent via onchange.
   * This ensures the parent component's state stays in sync with auto-selected defaults.
   * Also fetches branch status for the selected branch.
   */
  function setInternalBranch(branchName: string) {
    internalSelectedBranch = branchName;
    // Never reset the search here: this runs when a background fetch settles,
    // which can be while the user is typing a filter they are about to commit
    // with Enter. Only an explicit selection or a repo change clears it.
    // Notify parent so form validation knows about the auto-selected default
    logger.debug('setInternalBranch called', {
      branchName,
      hasOnchange: typeof onchange === 'function',
    });
    try {
      if (typeof onchange === 'function') {
        logger.debug('Calling onchange with branch', { branchName });
        onchange(new CustomEvent('change', { detail: { branch: branchName } }));
      }
    } catch (e) {
      logger.error('Error in onchange callback', e);
    }

    // Persist auto-selected/default branches the same way explicit selections are persisted.
    saveBranchForRepo(repoPath, branchName);

    // Fetch branch status for the newly selected branch
    fetchBranchStatus(branchName);
  }

  /**
   * Select a branch - called when user explicitly picks a branch.
   * This triggers onchange to notify parent components.
   * Also turns off skipIsolation since selecting a branch implies creating an isolated checkout.
   * Fetches branch status for the selected branch.
   */
  function selectBranch(branch: string, keepSkipIsolation = false) {
    explicitBranchSelectionRevision++;
    internalSelectedBranch = branch;
    clearSearch();
    try {
      if (typeof onchange === 'function') {
        onchange(new CustomEvent('change', { detail: { branch } }));
      }
    } catch (e) {
      logger.error('Error in onchange callback', e);
    }

    // Turn off skipIsolation when explicitly selecting a branch (unless keepSkipIsolation is true)
    // Selecting a branch from the list means user wants an isolated checkout off that branch
    if (!keepSkipIsolation && skipIsolation && typeof onSkipIsolationChange === 'function') {
      try {
        onSkipIsolationChange(false);
      } catch (e) {
        logger.error('Error in onSkipIsolationChange callback', e);
      }
    }

    // Save via Redux if persistence is enabled (per-repo branch only).
    saveBranchForRepo(repoPath, branch);

    // Fetch branch status for the newly selected branch
    fetchBranchStatus(branch);

    closeMenu();
  }

  /**
   * Close the dropdown and hand keyboard focus back to the trigger when it
   * was actually open. Every programmatic close goes through here so the
   * search input / toggle unmount never strands focus on <body>.
   */
  function closeMenu() {
    const wasOpen = isOpen;
    isOpen = false;
    if (wasOpen) void restoreTriggerFocus();
  }

  /**
   * Closing the content unmounts whatever held focus inside it (the search
   * input on the Enter path), which would otherwise drop focus to <body>.
   * Mirrors the Escape handling in select-content.svelte.
   */
  async function restoreTriggerFocus() {
    await tick();
    if (!isOpen && triggerEl?.isConnected) triggerEl.focus({ preventScroll: true });
  }

  function handleManualInput(value: string) {
    searchValue = value;
    const prefix = value.trim();
    githubSearchBranches = [];
    githubSearchPrefixStore.set(prefix);
    const parsed = parseGithubOwnerRepo();
    if (repoType === 'github' && parsed) {
      appStore.dispatch(
        searchWorkspaceInitializerGitHubBranches(parsed.owner, parsed.repo, prefix),
      );
    }
  }

  /**
   * Reset the search box AND its debounced mirror — a pending debounce tick
   * or a lingering debounced value would otherwise keep the filtered view
   * (and the server-side prefix results) active behind a blank search field.
   */
  function clearSearch() {
    searchValue = '';
    githubSearchBranches = [];
    githubSearchPrefixStore.set('');
    const parsed = parseGithubOwnerRepo();
    if (repoType === 'github' && parsed) {
      appStore.dispatch(searchWorkspaceInitializerGitHubBranches(parsed.owner, parsed.repo, ''));
    }
  }

  function handleRefresh() {
    githubAuthNeeded = 'none'; // Reset auth state
    requestBranches(true);
  }

  /**
   * Handle connecting to GitHub for private repo access
   */
  function handleConnectGitHub() {
    isConnectingGitHub = true;
    error = null;

    appStore.dispatch(connectGitHubForInitializerRequested());
  }

  $effect(() => {
    if (!isConnectingGitHub) return;
    if ($githubAuthIsAuthenticating$) return;
    if ($githubAuthIsAuthenticated$) {
      isConnectingGitHub = false;
      githubAuthNeeded = 'none';
      handleRefresh();
      return;
    }
    if ($githubAuthError$) {
      logger.error('Failed to connect GitHub', $githubAuthError$);
      isConnectingGitHub = false;
      error = $githubAuthError$ || m.workspace_branchSelector_githubConnectFailed_error();
    }
  });

  // State for collapsible sections
  let workspaceBranchesCollapsed = $state(true);
  let dependabotBranchesCollapsed = $state(true);

  // Track previous open state to detect transitions
  let prevIsOpen = false;

  // Pre-effect runs BEFORE DOM updates - set skeleton state before render
  $effect.pre(() => {
    // When transitioning from closed to open with many branches, show skeleton
    if (isOpen && !prevIsOpen && branches.length > 10) {
      isDropdownMounting = true;
    }
    prevIsOpen = isOpen;
  });

  // Track previous open state for detecting open transitions in the regular effect
  let prevIsOpenForEffect = false;

  // Regular effect runs after render - clear skeleton and focus input
  $effect(() => {
    if (isDropdownMounting) {
      // Clear skeleton after a couple frames to allow content to render smoothly
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isDropdownMounting = false;
        });
      });
    }

    if (isOpen) {
      // Detect open transition to avoid re-running on every dependency change
      const justOpened = !prevIsOpenForEffect;

      // Focus input
      requestAnimationFrame(() => {
        // Escape can close the menu before this queued frame runs.
        if (isOpen && searchInputElement) {
          searchInputElement.focus();
          searchInputElement.select();
        }
      });

      if (justOpened) {
        // Refresh branch status when dropdown opens to clear stale indicators
        if (selectedBranch && repoType === 'local') {
          fetchBranchStatus(selectedBranch);
        }
      }

      // Background prefetch remote branches when dropdown opens (for local repos)
      // This way they're already loaded or loading when user clicks to expand
      if (
        repoType === 'local' &&
        remoteBranches.length === 0 &&
        !isLoadingRemote &&
        !hasAttemptedRemoteFetch
      ) {
        fetchRemoteBranches();
      }
    }
    prevIsOpenForEffect = isOpen;
  });

  // Auto-expand collapsed sections when searching and there are matches
  $effect(() => {
    if (debouncedSearchValue) {
      // Auto-expand workspace branches if there are matches
      if (workspaceBranches.length > 0) {
        workspaceBranchesCollapsed = false;
      }
      // Auto-expand remote branches if there are matches
      if (filteredRemoteBranches.length > 0) {
        showRemoteBranches = true;
      }
    }
  });

  /**
   * Owner/repo for the prefix search — the same GitHub URL (or shorthand
   * `owner/repo` repoPath) parsing fetchBranches applies.
   */
  function parseGithubOwnerRepo(): { owner: string; repo: string } | null {
    // `||` (not `??`): fetchBranches treats an empty githubUrl as absent and
    // reconstructs it from a shorthand repoPath (lines 541-546) — match that.
    const url =
      githubUrl ||
      (repoPath && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(repoPath)
        ? `https://github.com/${repoPath}`
        : undefined);
    return url ? parseGitHubUrl(url) : null;
  }

  $effect(() => {
    const listing = $searchedGithubBranches$;
    if (!debouncedSearchValue || !listing || listing.loading || listing.error) {
      githubSearchBranches = [];
      return;
    }
    githubSearchBranches = listing.branches;
  });

  // Helper to identify Dependabot branches
  function isDependabotBranch(branch: string): boolean {
    return branch.startsWith('dependabot/');
  }

  // Helper to identify workspace branches
  function isWorkspaceBranch(branch: string): boolean {
    // Workspace branches follow various patterns:
    // NEW: adjective-animal format (e.g., amber-forest) or adjective-animal-N (e.g., amber-forest-2)
    //      Uses isWorkspaceSlug() which validates against actual adjective/animal dictionaries
    // LEGACY: adjective-animal-xxxx format (e.g., amber-forest-a7x2) - still supported
    // - workspace-{hash} (e.g., workspace-abc123)
    // - + workspace-{hash} (e.g., + workspace-def456) - note the space after +
    // - + ws/ws_{hash} (e.g., + ws/ws_214af59c4df3432f9c88fb55d6a8e)
    // - workspace/ws_{hash} (e.g., workspace/ws_e98cefa1e7044b0693feca14f)
    // - workspace-{timestamp}-{random} (e.g., workspace-1234567890123-abc123)
    // - {base}-{timestamp}-{random} where timestamp is 13 digits
    // - ws/{hash} or ws_{hash} patterns

    // Trim the branch name to handle any leading/trailing spaces
    const trimmedBranch = branch.trim();

    // Remove worktree marker if present (+ prefix)
    const branchName = trimmedBranch.startsWith('+ ') ? trimmedBranch.substring(2) : trimmedBranch;

    // Check for workspace slug pattern (e.g., "amber-forest" or "amber-forest-2")
    // This validates against the actual adjective/animal dictionaries to avoid false positives
    if (isWorkspaceSlug(branchName)) {
      return true;
    }

    // Check if it starts with + (which indicates a worktree branch)
    if (branch.startsWith('+ ')) {
      // Remove the '+ ' prefix and check the rest
      const withoutPlus = branch.substring(2);
      if (
        withoutPlus.startsWith('workspace') ||
        withoutPlus.startsWith('ws/') ||
        withoutPlus.startsWith('ws_')
      ) {
        return true;
      }
    }

    // Check if it starts with workspace patterns (without +)
    if (
      branchName.startsWith('workspace-') ||
      branchName.startsWith('workspace/') ||
      branchName.startsWith('ws/') ||
      branchName.startsWith('ws_')
    ) {
      return true;
    }

    // Check for timestamp pattern (13 digits followed by random string)
    const timestampPattern = /-\d{13}-[a-z0-9]+$/;
    if (timestampPattern.test(branchName)) {
      return true;
    }

    return false;
  }

  // View source for the dropdown lists: the unfiltered first page merged
  // with the server-side prefix-search results, deduped (first-page branches
  // keep their listing order). The `branches` state stays untouched so
  // clearing the search restores today's first-page view.
  const displayBranches = $derived(
    githubSearchBranches.length > 0
      ? [...branches, ...githubSearchBranches.filter((b) => !branches.includes(b))]
      : branches,
  );

  // Separate regular, dependabot, and workspace branches
  const regularBranches = $derived(
    displayBranches
      .filter(
        (b) =>
          !isWorkspaceBranch(b) &&
          !isDependabotBranch(b) &&
          b.toLowerCase().includes(debouncedSearchValue.toLowerCase()),
      )
      .sort((a, b) => {
        // Sort branches: current branch first, then default branch, then alphabetically
        if (a === currentBranch) return -1;
        if (b === currentBranch) return 1;
        if (a === defaultBranch) return -1;
        if (b === defaultBranch) return 1;
        return a.localeCompare(b);
      }),
  );

  const dependabotBranches = $derived(
    displayBranches
      .filter(
        (b) =>
          isDependabotBranch(b) && b.toLowerCase().includes(debouncedSearchValue.toLowerCase()),
      )
      .sort((a, b) => a.localeCompare(b)), // Simple alphabetical sort for dependabot branches
  );

  const workspaceBranches = $derived(
    displayBranches
      .filter(
        (b) => isWorkspaceBranch(b) && b.toLowerCase().includes(debouncedSearchValue.toLowerCase()),
      )
      .sort((a, b) => {
        // Try to sort by timestamp if present, otherwise alphabetically
        const getTimestamp = (branch: string) => {
          const match = branch.match(/(\d{13})/);
          return match ? parseInt(match[1]) : null;
        };

        const timestampA = getTimestamp(a);
        const timestampB = getTimestamp(b);

        // If both have timestamps, sort by timestamp (newer first)
        if (timestampA && timestampB) {
          return timestampB - timestampA;
        }

        // If only one has timestamp, put it first
        if (timestampA && !timestampB) return -1;
        if (!timestampA && timestampB) return 1;

        // Otherwise sort alphabetically
        return a.localeCompare(b);
      }),
  );

  // Filter remote branches by search
  const filteredRemoteBranches = $derived(
    remoteBranches
      .filter((b) => b.toLowerCase().includes(debouncedSearchValue.toLowerCase()))
      .sort((a, b) => a.localeCompare(b)),
  );
</script>

{#if disabled}
  <!-- Disabled state: show non-interactive display -->
  <div class="flex items-center gap-2 text-subtle text-sm py-1">
    {#if hasTriggerIcon}
      <GitBranchIcon size={12} class="text-ghost" />
    {/if}
    <span class="truncate"
      >{selectedBranch || value || m.workspace_branchSelector_noBranchSelected_label()}</span
    >
  </div>
{:else}
  <div class="relative min-w-0" bind:this={containerEl}>
    <Select.Root bind:value={internalSelectedBranch} bind:open={isOpen}>
      <Select.Trigger
        bind:ref={triggerEl}
        {variant}
        class={`w-full text-muted-foreground ${triggerClass} ${githubAuthNeeded === 'not-authenticated' ? 'ring-1 ring-orange-400 rounded-sm' : suggestedBranch && suggestedBranch !== internalSelectedBranch ? 'ring-1 ring-primary rounded-sm' : ''}`}
      >
        <div class={`flex items-center truncate min-w-0 ${triggerContentClass}`}>
          {#if githubAuthNeeded === 'not-authenticated'}
            <Fa icon={faExclamationTriangle} class="text-orange-500" size="xs" />
          {:else if hasTriggerIcon}
            <GitBranchIcon size={12} class={'text-ghost'} />
          {/if}
          <span class="flex-1 text-left truncate min-w-0">
            {#if githubAuthNeeded === 'not-authenticated'}
              <span class="text-orange-500">{m.workspace_branchSelector_connectGithub_label()}</span
              >
            {:else if skipIsolation && selectedBranch}
              <span>{selectedBranch}</span>
              <span class="text-sm opacity-75 ml-1"
                >{m.workspace_branchSelector_noIsolation_label({ isolationLabel })}</span
              >
            {:else if selectedBranch}
              <span>{selectedBranch}</span>
            {:else if !repoPath}
              <span>{m.workspace_branchSelector_selectRepoFirst_label()}</span>
            {:else if isLoading}
              <IntentMarkLoader size={14} class="text-ghost" />
              <span class="sr-only"
                >{m.workspace_compactInitializer_waitingBranchSelection_label()}</span
              >
            {:else}
              <span>{m.workspace_branchSelector_selectBranch_label()}</span>
            {/if}
          </span>
          <!-- Branch status indicators -->
          {#if showUncommittedIndicator && !skipIsolation && selectedBranch && repoType === 'local' && !branchStatusIsLoading && branchStatusHasUncommittedChanges && isCurrentBranch}
            <div class="flex-0 flex flex-col" transition:slide={{ axis: 'x', tier: 'moderate' }}>
              <Tooltip
                content={m.workspace_branchSelector_uncommittedChanges_tooltip()}
                side="bottom"
                delayDuration={200}
              >
                <span class="w-1.5 h-1.5 ml-0.5 rounded-full bg-amber-500 cursor-help"></span>
              </Tooltip>
            </div>
          {/if}
          {#if showTriggerChevron}
            <Fa icon={faChevronDown} size={10} class={triggerChevronClass} />
          {/if}
        </div>
      </Select.Trigger>
      <Select.Content
        class="w-[400px] min-w-0 max-h-[min(600px,calc(var(--bits-select-content-available-height,100dvh)-8px))] overflow-hidden flex flex-col"
        wrapperClass="flex flex-col"
        {dropUp}
        {portal}
      >
        <!-- Header -->
        <div class="shrink-0 px-4 pt-2 pb-3">
          <h2 class="text-base font-semibold text-foreground">
            {m.workspace_branchSelector_whichBranch_label()}
          </h2>
          <p class="text-sm text-subtle mt-1">
            {description || m.workspace_branchSelector_whichBranch_description()}
          </p>
        </div>

        <!-- Suggested PR branch -->
        {#if suggestedBranch && suggestedBranch !== internalSelectedBranch}
          <Button
            variant="ghost"
            type="button"
            class="mx-2 mb-2 px-3 py-2 flex items-center gap-2 text-sm text-left rounded-md bg-primary/10 hover:bg-primary/15 border border-primary/20 transition-colors cursor-pointer"
            onclick={() => selectBranch(suggestedBranch)}
          >
            <GitBranchIcon size={14} class="text-primary-ink shrink-0" />
            <span class="flex-1 min-w-0">
              <span class="text-subtle">{m.workspace_branchSelector_usePrBranch_label()}</span>
              <strong class="text-foreground ml-1 truncate">{suggestedBranch}</strong>
            </span>
          </Button>
        {/if}

        <!-- Branch status belongs above search, not between search and results. -->
        {#if selectedBranch && repoType === 'local' && (branchStatusBehind > 0 || (showUncommittedIndicator && !skipIsolation && branchStatusHasUncommittedChanges && isCurrentBranch))}
          <div
            class="shrink-0 px-4 pb-3 text-sm text-subtle"
            transition:slide={{ axis: 'y', tier: 'moderate' }}
          >
            {#if branchStatusBehind > 0}
              <p>{m.workspace_branchSelector_pullLatest_description()}</p>
            {/if}
            {#if showUncommittedIndicator && !skipIsolation && branchStatusHasUncommittedChanges && isCurrentBranch}
              <p class={branchStatusBehind > 0 ? 'mt-1.5' : ''}>
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 align-middle"
                ></span>
                {m.workspace_branchSelector_uncommittedNotIncluded_label()}
              </p>
            {/if}
          </div>
        {/if}

        <div class="shrink-0 px-3 pb-2">
          <div class="flex gap-2">
            <Input
              bind:this={searchInputElement}
              bind:value={searchValue}
              autofocus
              placeholder={m.workspace_branchSelector_search_placeholder()}
              oninput={(e) => handleManualInput(e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter' && searchValue) {
                  e.preventDefault();
                  selectBranch(searchValue);
                }
              }}
              class="flex-1 min-w-0 border-0 bg-background text-sm"
              noFocusStyle
            />
            <Button
              onclick={handleRefresh}
              variant="ghost-light"
              size="icon"
              class="shrink-0"
              disabled={isLoading}
              aria-label={m.workspace_branchSelector_refreshBranches_ariaLabel()}
            >
              <Fa icon={faRotate} class="size-4!" />
            </Button>
          </div>
        </div>

        <div class="min-h-16 overflow-y-auto flex-1" data-testid="branch-results">
          {#if githubAuthNeeded === 'not-authenticated' && !isConnectingGitHub}
            <!-- Connect with GitHub prompt for private repos -->
            <Button
              variant="ghost"
              type="button"
              class="w-full px-3 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors cursor-pointer text-left border-l-2 border-primary bg-primary/5"
              onclick={handleConnectGitHub}
            >
              <svg class="w-5 h-5 text-ghost" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground">
                  {m.workspace_branchSelector_connectWithGithub_label()}
                </p>
                <p class="text-sm text-subtle">
                  {m.workspace_branchSelector_connectWithGithub_description()}
                </p>
              </div>
            </Button>
          {:else if isConnectingGitHub}
            <!-- Connecting to GitHub -->
            <div class="px-3 py-3 flex items-center gap-3 border-l-2 border-primary bg-primary/5">
              <IntentMarkLoader size={20} class="text-ghost" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground">
                  {m.workspace_branchSelector_connectingGithub_label()}
                </p>
                <p class="text-sm text-subtle">
                  {m.workspace_branchSelector_completeAuth_description()}
                </p>
              </div>
            </div>
          {:else if githubAuthNeeded === 'no-access'}
            <!-- User is authenticated but doesn't have access -->
            <div class="px-2 py-2 border-l-2 border-danger bg-danger-background/10">
              <div class="text-sm text-danger">
                {m.workspace_branchSelector_noAccess_error()}
              </div>
              <div class="text-sm text-subtle mt-1">
                {m.workspace_branchSelector_noAccess_description()}
              </div>
            </div>
          {:else if error}
            <div class="px-2 py-2 border-l-2 border-danger bg-danger-background/10">
              <div class="text-sm text-danger">{error}</div>
              {#if repoType === 'github'}
                <div class="text-sm text-subtle mt-1">
                  {m.workspace_branchSelector_typeManually_description()}
                </div>
              {/if}
            </div>
          {/if}

          {#if isDropdownMounting || (isLoading && branches.length === 0)}
            <div class="px-4 py-3">
              <div class="space-y-3">
                {#each [1, 2, 3, 4, 5] as { }}
                  <div class="flex items-center gap-2">
                    <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                    <div class="h-4 bg-muted rounded flex-1 animate-pulse"></div>
                  </div>
                {/each}
              </div>
            </div>
          {:else if regularBranches.length > 0 || dependabotBranches.length > 0 || workspaceBranches.length > 0 || filteredRemoteBranches.length > 0}
            <div class="px-2 pb-1">
              <!-- Regular branches -->
              {#if regularBranches.length > 0}
                <!-- <div class="text-sm text-subtle mb-1 ml-2">
              Available branches
              {#if regularBranches.length > 0}
                ({regularBranches.length})
              {/if}
            </div> -->

                {#each regularBranches as branch (branch)}
                  <Button
                    variant="ghost"
                    onclick={() => selectBranch(branch)}
                    class="w-full justify-start text-left"
                  >
                    <GitBranchIcon size={14} class="text-ghost shrink-0" />
                    <span class="text-sm truncate flex-1">{branch}</span>
                    <div class="flex items-center gap-1 ml-2 shrink-0">
                      {#if branch === currentBranch && branch !== defaultBranch}
                        <span class="text-sm text-subtle"
                          >{m.workspace_branchSelector_current_label()}</span
                        >
                      {/if}
                      {#if branch === defaultBranch}
                        <span class="text-sm text-subtle"
                          >{m.workspace_branchSelector_default_label()}</span
                        >
                      {/if}
                      {#if branch === selectedBranch}
                        <Fa icon={faCheck} class="text-primary" size="sm" />
                      {/if}
                    </div>
                  </Button>
                {/each}
              {/if}

              <!-- Dependabot branches (collapsible) -->
              {#if dependabotBranches.length > 0}
                <div class="">
                  <Button
                    variant="ghost"
                    onclick={() => (dependabotBranchesCollapsed = !dependabotBranchesCollapsed)}
                    class="w-full justify-start text-left text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Fa
                      icon={dependabotBranchesCollapsed ? faChevronLeft : faChevronDown}
                      size="xs"
                      class="mr-1"
                    />
                    {m.workspace_branchSelector_dependabotUpdates_label({
                      count: dependabotBranches.length,
                    })}
                  </Button>

                  {#if !dependabotBranchesCollapsed}
                    <div class="ml-2" transition:slide={{ axis: 'y' }}>
                      {#each dependabotBranches as branch (branch)}
                        <Button
                          variant="ghost"
                          onclick={() => selectBranch(branch)}
                          class="w-full justify-start text-left opacity-75 hover:opacity-100"
                        >
                          <GitBranchIcon size={14} class="text-ghost shrink-0" />
                          <span class="text-sm truncate flex-1"
                            >{branch.replace('dependabot/', '')}</span
                          >
                          {#if branch === selectedBranch}
                            <Fa icon={faCheck} class="text-primary" size="sm" />
                          {/if}
                        </Button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Workspace branches (collapsible) -->
              {#if workspaceBranches.length > 0}
                <div class="">
                  <Button
                    variant="ghost"
                    onclick={() => (workspaceBranchesCollapsed = !workspaceBranchesCollapsed)}
                    class="w-full justify-start text-left text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Fa
                      icon={faChevronDown}
                      size={10}
                      class="mr-1 opacity-50 transition-transform duration-200 {workspaceBranchesCollapsed
                        ? 'rotate-90'
                        : ''}"
                    />
                    {m.workspace_branchSelector_workspaceBranches_label()}
                    {#if workspaceBranches.length > 0}
                      <span class="ml-auto text-sm text-subtle">
                        {workspaceBranches.length}
                      </span>
                    {/if}
                  </Button>

                  {#if !workspaceBranchesCollapsed}
                    <div class="ml-6" transition:slide={{ axis: 'y' }}>
                      {#each workspaceBranches as branch (branch)}
                        <Button
                          variant="ghost"
                          onclick={() => selectBranch(branch)}
                          class="w-full justify-start text-left opacity-75 hover:opacity-100"
                        >
                          <GitBranchIcon size={14} class="text-ghost shrink-0" />
                          <span class="text-sm truncate flex-1">{branch}</span>
                          {#if branch === selectedBranch}
                            <Fa icon={faCheck} class="text-primary" size="sm" />
                          {/if}
                        </Button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Remote branches (for local repos only) -->
              {#if repoType === 'local'}
                <div class="">
                  <Button
                    variant="ghost"
                    onclick={toggleRemoteBranches}
                    class="w-full justify-start text-left text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Fa
                      icon={faChevronDown}
                      size={10}
                      class="mr-1 opacity-50 transition-transform duration-200 {showRemoteBranches
                        ? ''
                        : 'rotate-90'}"
                    />
                    <Fa icon={faCloud} size={10} class="mr-1 opacity-50" />
                    {m.workspace_branchSelector_remoteBranches_label()}
                    {#if isLoadingRemote}
                      <span class="inline-block w-6 h-3 bg-muted rounded animate-pulse ml-1"></span>
                    {:else if filteredRemoteBranches.length > 0}
                      ({filteredRemoteBranches.length})
                    {/if}
                  </Button>

                  {#if showRemoteBranches}
                    <div class="ml-4" transition:slide={{ axis: 'y' }}>
                      {#if isLoadingRemote}
                        <div class="px-2 py-2 space-y-2">
                          {#each [1, 2, 3] as { }}
                            <div class="flex items-center gap-2">
                              <div class="w-3.5 h-3.5 bg-muted rounded animate-pulse"></div>
                              <div class="h-4 bg-muted rounded flex-1 animate-pulse"></div>
                            </div>
                          {/each}
                        </div>
                      {:else if filteredRemoteBranches.length > 0}
                        {#each filteredRemoteBranches as branch (branch)}
                          <Button
                            variant="ghost"
                            onclick={() => selectBranch(branch)}
                            class="w-full justify-start text-left opacity-75 hover:opacity-100"
                          >
                            <GitBranchIcon size={14} class="text-ghost shrink-0" />
                            <!-- Display without origin/ prefix for cleaner UI, but keep full name in value -->
                            <span class="text-sm truncate flex-1"
                              >{branch.replace(/^origin\//, '')}</span
                            >
                            {#if branch === selectedBranch}
                              <Fa icon={faCheck} class="text-primary" size="sm" />
                            {/if}
                          </Button>
                        {/each}
                      {:else}
                        <div class="px-3 text-sm text-subtle">
                          {m.workspace_branchSelector_noRemoteBranches_label()}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {:else if searchValue && !isLoading}
            <div class="px-2 pb-1">
              <Button
                variant="ghost"
                onclick={() => selectBranch(searchValue)}
                class="w-full justify-start"
              >
                <GitBranchIcon size={14} class="text-ghost" />
                <span class="text-sm"
                  >{m.workspace_branchSelector_useBranch_label()}
                  <strong>{searchValue}</strong></span
                >
              </Button>
            </div>
          {:else if !isLoading && !error}
            <div class="px-2 py-2 text-sm text-subtle">
              {m.workspace_branchSelector_noBranchesFound_label()}
            </div>
          {/if}
        </div>

        <!-- Use current branch option (no isolated checkout) -->
        {#if typeof onSkipIsolationChange === 'function' && currentBranch}
          <div class="shrink-0 px-2 pt-2 pb-3 border-t border-border bg-popover">
            <Button
              variant="ghost"
              onclick={() => {
                const enabling = !skipIsolation;
                try {
                  onSkipIsolationChange(enabling);
                } catch (e) {
                  logger.error('Error in onSkipIsolationChange callback', e);
                }
                if (enabling) {
                  // When enabling skip isolation, select current branch (keep skipIsolation on)
                  selectBranch(currentBranch, true);
                }
                closeMenu();
              }}
              wrapContent={false}
              class="w-full h-auto flex items-start gap-3 px-2 py-1 rounded-md text-left whitespace-normal cursor-pointer"
            >
              <Checkbox
                checked={skipIsolation}
                class="-mb-1"
                onCheckedChange={() => {
                  const enabling = !skipIsolation;
                  try {
                    onSkipIsolationChange(enabling);
                  } catch (e) {
                    logger.error('Error in onSkipIsolationChange callback', e);
                  }
                  if (enabling) {
                    selectBranch(currentBranch, true);
                  }
                  closeMenu();
                }}
              />
              <div class="items-start flex-1 min-w-0 text-sm font-normal -mt-0.25">
                {workDirectlyParts[0]}<span class="font-medium">{currentBranch}</span
                >{workDirectlyParts[1]}
              </div>
            </Button>
            <div class="ml-9 text-sm text-subtle">
              {m.workspace_branchSelector_stayInFolder_description({ isolationLabel })}
            </div>
          </div>
        {/if}
      </Select.Content>
    </Select.Root>
  </div>
{/if}
