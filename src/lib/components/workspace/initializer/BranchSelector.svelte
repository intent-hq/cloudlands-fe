<script lang="ts">
  /* eslint-disable max-lines */
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import GitBranchIcon from '$lib/components/icons/GitBranchIcon.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Select } from '$lib/components/ui/select';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { debugConfig } from '$lib/config/debug';
  import { createLogger } from '$lib/utils/client-logger';
  import { appClient } from '$lib/client';
  import { performanceMonitor } from '$lib/utils/performance';

  import { setWorkspaceInitializerBranchForRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { selectWorkspaceInitializerBranchByRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { isWorkspaceSlug } from '$shared/services/workspace-slug';
  import {
    faCheck,
    faChevronDown,
    faChevronRight,
    faCloud,
    faExclamationTriangle,
    faRotate,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('BranchSelector');
  const branchByRepo$ = selectWorkspaceInitializerBranchByRepo();

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
    /** Whether to skip worktree creation and work directly on current branch */
    skipWorktree?: boolean;
    /** Suggested branch (e.g. from a PR) - highlights picker when different from selected */
    suggestedBranch?: string;
    /** Callback when skip worktree option is toggled */
    onSkipWorktreeChange?: (skipWorktree: boolean) => void;
    /** Callback when GitHub auth state changes (for private repos) */
    onGitHubAuthNeededChange?: (authNeeded: 'none' | 'not-authenticated' | 'no-access') => void;
    /** Callback when branch status changes (behind count and unstaged changes) */
    onBranchStatusChange?: (status: BranchStatus) => void;
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
    skipWorktree = false,
    suggestedBranch,
    onSkipWorktreeChange,
    onGitHubAuthNeededChange,
    onBranchStatusChange,
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
  let debouncedSearchValue = $state('');
  let searchDebounceTimer: NodeJS.Timeout | null = null;
  // Using 'any' because this binds to a Svelte Input component, not a native HTMLInputElement
  // The Input component exports focus() and select() methods that we use
  let searchInputElement: any = $state(null);
  let isOpen = $state(false); // Track dropdown open state
  let isDropdownMounting = $state(false); // Show skeleton while dropdown content mounts
  let containerEl: HTMLDivElement | undefined = $state(); // Container for positioning

  // GitHub auth state for private repos
  type GitHubAuthNeeded = 'none' | 'not-authenticated' | 'no-access';
  let githubAuthNeeded: GitHubAuthNeeded = $state('none');
  let isConnectingGitHub = $state(false);

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

  // Cache for branches per repo
  const branchCache = new Map<
    string,
    {
      branches: string[];
      remoteBranches?: string[];
      default: string;
      current?: string;
      timestamp: number;
    }
  >();
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

  // Track previous values to detect changes (non-reactive to avoid triggering effects)
  let previousRepoPath = '';
  let previousRepoType: 'local' | 'github' = 'local';
  let previousGithubUrl: string | undefined = undefined;

  // Debounce timer for fetchBranches to prevent rapid repeated calls
  let fetchBranchesDebounceTimer: NodeJS.Timeout | null = null;
  const FETCH_BRANCHES_DEBOUNCE_MS = 150;

  // Track current fetch to allow cancellation
  let currentFetchAbortController: AbortController | null = null;

  // Cleanup on component destroy
  onDestroy(() => {
    // Cancel any pending debounced fetch
    if (fetchBranchesDebounceTimer) {
      clearTimeout(fetchBranchesDebounceTimer);
      fetchBranchesDebounceTimer = null;
    }
    // Cancel any in-flight fetch
    if (currentFetchAbortController) {
      currentFetchAbortController.abort();
      currentFetchAbortController = null;
    }
    // Clear search debounce timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
  });

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

  /**
   * Debounced version of fetchBranches to prevent rapid repeated calls.
   * This is important when multiple reactive updates happen in quick succession
   * (e.g., when both repoPath and repoType change at the same time).
   */
  function debouncedFetchBranches() {
    // Cancel any pending debounced fetch
    if (fetchBranchesDebounceTimer) {
      clearTimeout(fetchBranchesDebounceTimer);
    }

    // Cancel any in-flight fetch
    if (currentFetchAbortController) {
      currentFetchAbortController.abort();
      currentFetchAbortController = null;
    }

    fetchBranchesDebounceTimer = setTimeout(() => {
      fetchBranchesDebounceTimer = null;
      fetchBranches();
    }, FETCH_BRANCHES_DEBOUNCE_MS);
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
        error = null;
        resetBranchStatus(); // Reset stale branch status from previous repo

        // Use debounced fetch to prevent rapid repeated calls
        debouncedFetchBranches();
      } else {
        branches = [];
        internalSelectedBranch = '';
        defaultBranch = '';
      }
    }
  });

  async function fetchBranches() {
    if (!repoPath) return;

    // Create a new abort controller for this fetch
    const abortController = new AbortController();
    currentFetchAbortController = abortController;

    // Debug logging to diagnose branch fetching issues
    logger.debug('fetchBranches called', { repoPath, repoType, githubUrl });
    performanceMonitor.start(`fetchBranches-${repoPath}`, { repoType, githubUrl });

    // Check cache first (if caching is enabled)
    if (debugConfig.get('enableBranchCaching')) {
      const cached = branchCache.get(repoPath);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        branches = cached.branches;
        remoteBranches = cached.remoteBranches || [];
        defaultBranch = cached.default;
        currentBranch = cached.current || '';

        // Set internal state from cache - always ensure a valid branch is selected
        // If value prop is provided, trust it (e.g., for remote branches like origin/...)
        if (value) {
          // Value prop is the source of truth - don't override it
          setInternalBranch(value);
        } else {
          // Look up saved branch for THIS repo from Redux (not from stale selectedBranch)
          const savedBranchForRepo = getSavedBranchForRepo(repoPath);
          if (
            savedBranchForRepo &&
            (branches.includes(savedBranchForRepo) || remoteBranches.includes(savedBranchForRepo))
          ) {
            // Saved branch exists (in local or remote branches), use it
            setInternalBranch(savedBranchForRepo);
          } else if (currentBranch && branches.includes(currentBranch)) {
            // Fall back to current branch
            setInternalBranch(currentBranch);
          } else if (defaultBranch && branches.includes(defaultBranch)) {
            // Fall back to default branch
            setInternalBranch(defaultBranch);
          } else if (branches.length > 0) {
            // Last resort: use first available branch
            setInternalBranch(branches[0]);
          }
        }
        return;
      }
    }

    isLoading = true;
    error = null;

    // Defensive check: detect if repoPath looks like a GitHub shorthand (owner/repo)
    // This handles cases where the form state was restored but repoType/githubUrl weren't properly set
    let effectiveRepoType: 'local' | 'github' = repoType;
    let effectiveGithubUrl = githubUrl;

    // Check if repoPath matches GitHub shorthand pattern (owner/repo)
    // Must contain exactly one slash, and NOT look like a file path
    const isGitHubShorthand =
      repoPath &&
      repoPath.includes('/') &&
      !repoPath.startsWith('/') &&
      !repoPath.startsWith('~') &&
      !repoPath.startsWith('.') &&
      !repoPath.includes(':\\') &&
      repoPath.split('/').length === 2 &&
      /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(repoPath);

    if (isGitHubShorthand) {
      // This looks like a GitHub shorthand - treat it as GitHub even if repoType is wrong
      effectiveRepoType = 'github';
      if (!effectiveGithubUrl) {
        // Reconstruct the GitHub URL from the shorthand
        effectiveGithubUrl = `https://github.com/${repoPath}`;
        logger.debug('Reconstructed GitHub URL from shorthand', {
          repoPath,
          effectiveGithubUrl,
        });
      }
    }

    try {
      // Simulate network delay if enabled
      if (debugConfig.get('simulateSlowNetwork')) {
        await new Promise((resolve) => setTimeout(resolve, debugConfig.get('networkDelay') || 0));
      }

      if (effectiveRepoType === 'local') {
        // Fetch branches from the local git repo via the daemon
        // (`git.getBranches`, PROTOCOL §5.6). The live seam folds
        // transport/gate errors to null; we surface an explicit error state —
        // never a fabricated branch list.
        const result = await appClient.git.getBranches(repoPath, true);
        if (result) {
          branches = result.branches;
          remoteBranches = result.remoteBranches;
          defaultBranch = result.defaultBranch || '';
          currentBranch = result.currentBranch || '';

          // Set internal state - always ensure a valid branch is selected
          // If value prop is provided, trust it (e.g., for remote branches like origin/...)
          if (value) {
            // Value prop is the source of truth - don't override it
            setInternalBranch(value);
          } else {
            // Check if there's a saved branch for this repo
            const savedBranch = getSavedBranchForRepo(repoPath);
            if (
              savedBranch &&
              (branches.includes(savedBranch) || remoteBranches.includes(savedBranch))
            ) {
              // Saved branch exists in local or remote branches, use it
              setInternalBranch(savedBranch);
            } else if (currentBranch && branches.includes(currentBranch)) {
              // Fall back to current branch
              setInternalBranch(currentBranch);
            } else if (defaultBranch && branches.includes(defaultBranch)) {
              // Fall back to default branch
              setInternalBranch(defaultBranch);
            } else if (branches.length > 0) {
              // Last resort: use first available branch
              setInternalBranch(branches[0]);
            }
          }
        } else {
          throw new Error('Failed to fetch branches');
        }
      } else if (effectiveRepoType === 'github' && effectiveGithubUrl) {
        // Parse GitHub URL to get owner and repo
        const match = effectiveGithubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
        if (!match) {
          throw new Error('Invalid GitHub URL format');
        }
        const [, owner, repo] = match;

        // URL-only GitHub repo (no local clone to ask git): the daemon lists
        // remote branch names via `github.branches.list` and the default
        // branch via `github.repos.get` (PROTOCOL §5.27). There is no direct
        // GitHub API fallback — failures surface as an explicit error/auth
        // state, never fabricated branches.
        try {
          const listing = await appClient.integrations.githubBranches(owner, repo);
          // Check if we were aborted while waiting for the response
          if (abortController.signal.aborted) {
            logger.debug('Branch fetch aborted after response');
            return;
          }
          branches = listing.branches;
          defaultBranch = listing.defaultBranch || '';
          githubAuthNeeded = 'none';
          logger.debug('Fetched branches via daemon github.branches.list', {
            owner,
            repo,
            count: branches.length,
          });
        } catch (githubError) {
          const message =
            githubError instanceof Error ? githubError.message : String(githubError);
          // The daemon reports a missing/failed GitHub token as
          // "GitHub is not configured." (§5.27 error conventions).
          if (/not configured|not authenticated/i.test(message)) {
            githubAuthNeeded = 'not-authenticated';
            throw new Error('GITHUB_AUTH_REQUIRED');
          }
          // A 404 lookup (private repo without access, or a repo that does
          // not exist) maps to a -32602 "not found" error.
          if (/404|not found/i.test(message)) {
            githubAuthNeeded = 'no-access';
            throw new Error('GITHUB_NO_ACCESS');
          }
          throw githubError;
        }
      }

      // Cache the results (if caching is enabled)
      if (debugConfig.get('enableBranchCaching')) {
        branchCache.set(repoPath, {
          branches,
          remoteBranches,
          default: defaultBranch,
          current: currentBranch,
          timestamp: Date.now(),
        });
      }

      // For GitHub repos, ensure a valid branch is selected
      // (Local repos already handle this above)
      if (effectiveRepoType === 'github' && branches.length > 0) {
        // If value prop is provided, trust it (e.g., for remote branches like origin/...)
        if (value) {
          // Value prop is the source of truth - don't override it
          setInternalBranch(value);
        } else {
          // Look up saved branch for THIS repo from Redux (not from stale selectedBranch)
          const savedBranchForRepo = getSavedBranchForRepo(repoPath);
          if (
            savedBranchForRepo &&
            (branches.includes(savedBranchForRepo) || remoteBranches.includes(savedBranchForRepo))
          ) {
            // Saved branch exists (in local or remote branches), use it
            setInternalBranch(savedBranchForRepo);
          } else if (defaultBranch && branches.includes(defaultBranch)) {
            // Fall back to default branch
            setInternalBranch(defaultBranch);
          } else {
            // Last resort: use first available branch
            setInternalBranch(branches[0]);
          }
        }
      }
    } catch (err) {
      // Handle abort errors silently - they're expected when a new fetch starts
      if (err instanceof Error && err.name === 'AbortError') {
        logger.debug('Branch fetch aborted in outer catch (superseded by newer request)');
        return; // Exit silently - a newer fetch is in progress
      }

      // Normalize error for logging - ensure we have an Error instance
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      logger.error('Failed to fetch branches', normalizedError, {
        repoPath,
        repoType,
        githubUrl,
        effectiveRepoType,
        effectiveGithubUrl,
        githubAuthNeeded,
      });

      // Handle special GitHub auth error cases
      if (err instanceof Error) {
        if (err.message === 'GITHUB_AUTH_REQUIRED') {
          // User needs to connect with GitHub - don't show error, show connect option
          error = null;
          // githubAuthNeeded is already set to 'not-authenticated'
          return;
        } else if (err.message === 'GITHUB_NO_ACCESS') {
          // User is authenticated but doesn't have access to this repo
          error = "You don't have access to this repository.";
          // githubAuthNeeded is already set to 'no-access'
          return;
        }

        // Check if the error already has a detailed GitHub API message
        const isDetailedGitHubError =
          err.message.includes('private repo') ||
          err.message.includes('authenticate with GitHub') ||
          err.message.includes('access permissions') ||
          err.message.includes('GitHub API error');

        if (isDetailedGitHubError) {
          // Preserve the detailed GitHub error message
          error = err.message;
        } else if (
          err.message.includes('Git is not installed') ||
          err.message.includes('ENOENT') ||
          err.message.includes('spawn git')
        ) {
          error =
            "Git is not installed or not available. Please install Git and ensure it's accessible from the command line.";
        } else if (err.message.includes('rate limit')) {
          error = 'GitHub API rate limit exceeded. Please wait or enter branch manually.';
        } else if (err.message.includes('404') || err.message.includes('not found')) {
          // Generic not found - add private repo hint for GitHub repos
          if (effectiveRepoType === 'github') {
            error =
              'Repository not found. If this is a private repo, GitHub authentication is required.';
          } else {
            error = 'Repository not found. Check the path or enter branch manually.';
          }
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
          error = 'Network error. Check connection or enter branch manually.';
        } else if (err.message.includes('permission') || err.message.includes('denied')) {
          error = 'Permission denied. Check access or enter branch manually.';
        } else {
          error = err.message || 'Failed to fetch branches';
        }
      } else {
        error = 'Failed to fetch branches. You can enter a branch name manually.';
      }

      // Never fabricate branch names on failure — the error state renders and
      // the user can still type a branch name manually.
      branches = [];
    } finally {
      isLoading = false;
      performanceMonitor.end(`fetchBranches-${repoPath}`);
      // Clear the abort controller if this was the current fetch
      if (currentFetchAbortController === abortController) {
        currentFetchAbortController = null;
      }
    }
  }

  /**
   * Fetch remote branches for local repos.
   * This is called on-demand when user clicks "Show remote branches".
   */
  async function fetchRemoteBranches() {
    if (!repoPath || repoType !== 'local') return;
    if (isLoadingRemote || hasAttemptedRemoteFetch) return; // Prevent duplicate requests

    isLoadingRemote = true;
    hasAttemptedRemoteFetch = true; // Mark that we've attempted to fetch
    logger.debug('Fetching remote branches for', { repoPath });

    try {
      // Daemon-backed read (`git.getBranches`, PROTOCOL §5.6) with
      // includeRemote; the live seam folds errors to null. Remote branches are
      // optional, so a failed fetch stays silent (no error state).
      const result = await appClient.git.getBranches(repoPath, true);
      if (result) {
        // Use the separate remoteBranches field from the response (already filtered & sorted)
        remoteBranches = result.remoteBranches || [];

        // Update cache with remote branches
        if (debugConfig.get('enableBranchCaching')) {
          const cached = branchCache.get(repoPath);
          if (cached) {
            branchCache.set(repoPath, {
              ...cached,
              remoteBranches,
            });
          }
        }

        logger.debug('Fetched remote branches', { count: remoteBranches.length });
      }
    } catch (err) {
      logger.error('Failed to fetch remote branches', err);
      // Don't show error to user - remote branches are optional
    } finally {
      isLoadingRemote = false;
    }
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
  async function fetchBranchStatus(branchName: string) {
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

    logger.debug('Fetching branch status', { branchName });

    try {
      if (isElectronPlatform()) {
        // Daemon-backed read (PROTOCOL §5.6): `appClient.git.branchStatus` is
        // the new path-based wire that replaces the legacy `git:getBranchStatus`
        // Electron IPC. The live seam folds transport/gate errors to `null`,
        // so we surface a clean "no info" state without crashing on undefined.
        const result = await appClient.git.branchStatus(repoPath, branchName);

        // Only update state if this is still the branch we're interested in
        if (pendingStatusBranch !== branchName) {
          logger.debug('Ignoring stale branch status response', {
            requested: branchName,
            current: pendingStatusBranch,
          });
          return;
        }

        if (result) {
          branchStatusBehind = result.behind ?? 0;
          // Only report uncommitted changes if this is the current branch
          // (git status --porcelain reports working directory state, not branch state)
          branchStatusHasUncommittedChanges =
            branchName === currentBranch ? (result.hasUncommittedChanges ?? false) : false;

          logger.debug('Branch status fetched', {
            branchName,
            behind: branchStatusBehind,
            hasUncommittedChanges: branchStatusHasUncommittedChanges,
            currentBranch,
            isCurrentBranch: branchName === currentBranch,
          });
        } else {
          logger.warn('Failed to get branch status', { branchName, repoPath });
          // Reset on error
          branchStatusBehind = 0;
          branchStatusHasUncommittedChanges = false;
        }
      }
    } catch (err) {
      // Don't show error to user - branch status is informational
      logger.error('Failed to fetch branch status', err);
      branchStatusBehind = 0;
      branchStatusHasUncommittedChanges = false;
    } finally {
      if (pendingStatusBranch === branchName) {
        branchStatusIsLoading = false;
      }
    }
  }

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
    searchValue = '';
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
   * Also turns off skipWorktree since selecting a branch implies creating a worktree.
   * Fetches branch status for the selected branch.
   */
  function selectBranch(branch: string, keepSkipWorktree = false) {
    internalSelectedBranch = branch;
    searchValue = '';
    try {
      if (typeof onchange === 'function') {
        onchange(new CustomEvent('change', { detail: { branch } }));
      }
    } catch (e) {
      logger.error('Error in onchange callback', e);
    }

    // Turn off skipWorktree when explicitly selecting a branch (unless keepSkipWorktree is true)
    // Selecting a branch from the list means user wants to create a worktree from that branch
    if (!keepSkipWorktree && skipWorktree && typeof onSkipWorktreeChange === 'function') {
      try {
        onSkipWorktreeChange(false);
      } catch (e) {
        logger.error('Error in onSkipWorktreeChange callback', e);
      }
    }

    // Save via Redux if persistence is enabled (per-repo branch only).
    saveBranchForRepo(repoPath, branch);

    // Fetch branch status for the newly selected branch
    fetchBranchStatus(branch);

    // Close the dropdown
    isOpen = false;
  }

  function handleManualInput(value: string) {
    searchValue = value;
    // Don't auto-select, let the user choose from dropdown or press enter

    // Debounce the search value for filtering
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchValue = value;
    }, 100); // 100ms debounce for smoother experience
  }

  async function handleRefresh() {
    // Clear cache for this repo
    branchCache.delete(repoPath);
    githubAuthNeeded = 'none'; // Reset auth state
    await fetchBranches();
  }

  /**
   * Handle connecting to GitHub for private repo access
   */
  async function handleConnectGitHub() {
    isConnectingGitHub = true;
    error = null;

    try {
      const { initializeGitHubAuth, startGitHubAuth } =
        await import('$store/renderer/slices/github-auth/github-auth-slice');
      const {
        selectGitHubAuthIsAuthenticated,
        selectGitHubAuthIsAuthenticating,
        selectGitHubAuthError,
      } = await import('$store/renderer/slices/github-auth/github-auth-selectors');

      const store = appStore;

      // Initialize the auth state if not already
      store.dispatch(initializeGitHubAuth());

      // Start the auth flow
      store.dispatch(startGitHubAuth());

      // Poll Redux state for completion (saga handles the IPC polling)
      const checkAuthInterval = setInterval(async () => {
        const state = store.state;
        if (selectGitHubAuthIsAuthenticated.select(state)) {
          clearInterval(checkAuthInterval);
          isConnectingGitHub = false;
          githubAuthNeeded = 'none';
          // Refetch branches with new auth
          await handleRefresh();
        } else if (!selectGitHubAuthIsAuthenticating.select(state)) {
          // Auth was cancelled or failed
          clearInterval(checkAuthInterval);
          isConnectingGitHub = false;
          const authError = selectGitHubAuthError.select(state);
          if (authError) {
            error = authError;
          }
        }
      }, 1000);

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (isConnectingGitHub) {
            clearInterval(checkAuthInterval);
            isConnectingGitHub = false;
            error = 'GitHub connection timed out. Please try again.';
          }
        },
        5 * 60 * 1000,
      );
    } catch (err) {
      logger.error('Failed to connect GitHub', err);
      isConnectingGitHub = false;
      error = err instanceof Error ? err.message : 'Failed to connect to GitHub';
    }
  }

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
        if (searchInputElement) {
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
        // Small delay to prioritize local branches UI first
        setTimeout(() => {
          if (
            isOpen &&
            remoteBranches.length === 0 &&
            !isLoadingRemote &&
            !hasAttemptedRemoteFetch
          ) {
            fetchRemoteBranches();
          }
        }, 100);
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

  // Separate regular, dependabot, and workspace branches
  const regularBranches = $derived(
    branches
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
    branches
      .filter(
        (b) =>
          isDependabotBranch(b) && b.toLowerCase().includes(debouncedSearchValue.toLowerCase()),
      )
      .sort((a, b) => a.localeCompare(b)), // Simple alphabetical sort for dependabot branches
  );

  const workspaceBranches = $derived(
    branches
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
    <span class="truncate">{selectedBranch || value || 'No branch selected'}</span>
  </div>
{:else}
  <div class="relative min-w-0" bind:this={containerEl}>
    <Select.Root bind:value={internalSelectedBranch} bind:open={isOpen}>
      <Select.Trigger
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
              <span class="text-orange-500">Connect GitHub</span>
            {:else if skipWorktree && selectedBranch}
              <span>{selectedBranch}</span>
              <span class="text-sm opacity-75 ml-1">(no worktree)</span>
            {:else if selectedBranch}
              <span>{selectedBranch}</span>
            {:else if !repoPath}
              <span>Select a repository first</span>
            {:else if isLoading}
              <span class="inline-block h-4 w-24 bg-muted rounded animate-pulse"></span>
            {:else}
              <span>Select a branch</span>
            {/if}
          </span>
          <!-- Branch status indicators -->
          {#if showUncommittedIndicator && selectedBranch && repoType === 'local' && !branchStatusIsLoading && branchStatusHasUncommittedChanges && isCurrentBranch}
            <div class="flex-0 flex flex-col" transition:slide={{ axis: 'x', duration: 150 }}>
              <Tooltip
                content="Uncommitted changes won't be included"
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
        class="max-w-[400px] min-w-[400px] max-h-[min(600px,calc(var(--radix-popper-available-height,100vh)-16px))] overflow-hidden flex flex-col"
        {dropUp}
        {portal}
      >
        <!-- Header -->
        <div class="px-4 pt-2 pb-3">
          <h2 class="text-base font-semibold text-foreground">What branch should we start from?</h2>
          <p class="text-sm text-subtle mt-1">
            {description ||
              'Choose a branch for the Space to start from. We\'ll treat this branch as the "trunk" to merge back to.'}
          </p>
        </div>

        <!-- Suggested PR branch -->
        {#if suggestedBranch && suggestedBranch !== internalSelectedBranch}
          <button
            type="button"
            class="mx-2 mb-2 px-3 py-2 flex items-center gap-2 text-sm text-left rounded-md bg-primary/10 hover:bg-primary/15 border border-primary/20 transition-colors cursor-pointer"
            onclick={() => selectBranch(suggestedBranch)}
          >
            <GitBranchIcon size={14} class="text-primary shrink-0" />
            <span class="flex-1 min-w-0">
              <span class="text-subtle">Use PR branch</span>
              <strong class="text-foreground ml-1 truncate">{suggestedBranch}</strong>
            </span>
          </button>
        {/if}

        <div class="px-2 pb-1 pt-1 sticky -top-1 bg-background z-10">
          <div class="flex gap-2">
            <Input
              bind:this={searchInputElement}
              bind:value={searchValue}
              autofocus
              placeholder="Search or enter branch name..."
              oninput={(e) => handleManualInput(e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter' && searchValue) {
                  e.preventDefault();
                  selectBranch(searchValue);
                }
              }}
              class="flex-1 border-0 bg-sidebar"
              noFocusStyle
            />
            <Button onclick={handleRefresh} variant="ghost-light" size="icon" disabled={isLoading}>
              <Fa icon={faRotate} class={isLoading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        <!-- Branch status info -->
        {#if selectedBranch && repoType === 'local' && (branchStatusBehind > 0 || (showUncommittedIndicator && branchStatusHasUncommittedChanges && isCurrentBranch))}
          <div
            class="mx-2 mb-1 px-3 py-2 text-sm text-subtle"
            transition:slide={{ axis: 'y', duration: 150 }}
          >
            {#if branchStatusBehind > 0}
              <p>We'll pull the latest changes into your space.</p>
            {/if}
            {#if showUncommittedIndicator && branchStatusHasUncommittedChanges && isCurrentBranch}
              <p class={branchStatusBehind > 0 ? 'mt-1.5' : ''}>
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 align-middle"
                ></span>
                Uncommitted changes won't be included.
              </p>
            {/if}
          </div>
        {/if}

        <div class="overflow-y-auto flex-1 pt-2">
          {#if githubAuthNeeded === 'not-authenticated' && !isConnectingGitHub}
            <!-- Connect with GitHub prompt for private repos -->
            <button
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
                <p class="text-sm font-medium text-foreground">Connect with GitHub</p>
                <p class="text-sm text-subtle">Required to access private repositories</p>
              </div>
            </button>
          {:else if isConnectingGitHub}
            <!-- Connecting to GitHub -->
            <div class="px-3 py-3 flex items-center gap-3 border-l-2 border-primary bg-primary/5">
              <Fa icon={faSpinner} class="w-5 h-5 text-ghost animate-spin" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground">Connecting to GitHub...</p>
                <p class="text-sm text-subtle">Complete authorization in your browser</p>
              </div>
            </div>
          {:else if githubAuthNeeded === 'no-access'}
            <!-- User is authenticated but doesn't have access -->
            <div class="px-2 py-2 border-l-2 border-destructive bg-destructive/10">
              <div class="text-sm text-destructive-foreground">
                You don't have access to this repository.
              </div>
              <div class="text-sm text-subtle mt-1">
                Make sure you have permission to view this repo, or check if the URL is correct.
              </div>
            </div>
          {:else if error}
            <div class="px-2 py-2 border-l-2 border-destructive bg-destructive/10">
              <div class="text-sm text-destructive-foreground">{error}</div>
              {#if repoType === 'github'}
                <div class="text-sm text-subtle mt-1">
                  You can still type a branch name manually above.
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
                        <span class="text-sm text-subtle">current</span>
                      {/if}
                      {#if branch === defaultBranch}
                        <span class="text-sm text-subtle">default</span>
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
                      icon={dependabotBranchesCollapsed ? faChevronRight : faChevronDown}
                      size="xs"
                      class="mr-1"
                    />
                    Dependabot updates ({dependabotBranches.length})
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
                        ? '-rotate-90'
                        : ''}"
                    />
                    Workspace branches
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
                        : '-rotate-90'}"
                    />
                    <Fa icon={faCloud} size={10} class="mr-1 opacity-50" />
                    Remote branches
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
                          No additional remote branches found.
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
                <span class="text-sm">Use branch: <strong>{searchValue}</strong></span>
              </Button>
            </div>
          {:else if !isLoading && !error}
            <div class="px-2 py-2 text-sm text-subtle">
              No branches found. Either you don't have access to this repository, or it doesn't
              exist.
            </div>
          {/if}
        </div>

        <!-- Use current branch option (no worktree) -->
        {#if typeof onSkipWorktreeChange === 'function' && currentBranch}
          <div class="px-2 pt-2 pb-3 border-t border-border sticky -bottom-1 bg-background">
            <button
              onclick={() => {
                const enabling = !skipWorktree;
                try {
                  onSkipWorktreeChange(enabling);
                } catch (e) {
                  logger.error('Error in onSkipWorktreeChange callback', e);
                }
                if (enabling) {
                  // When enabling skip worktree, select current branch (keep skipWorktree on)
                  selectBranch(currentBranch, true);
                }
                isOpen = false;
              }}
              class="w-full flex items-start gap-3 px-2 py-1 rounded-md text-left cursor-pointer"
            >
              <Checkbox
                checked={skipWorktree}
                class="-mb-1"
                onCheckedChange={() => {
                  const enabling = !skipWorktree;
                  try {
                    onSkipWorktreeChange(enabling);
                  } catch (e) {
                    logger.error('Error in onSkipWorktreeChange callback', e);
                  }
                  if (enabling) {
                    selectBranch(currentBranch, true);
                  }
                  isOpen = false;
                }}
              />
              <div class="items-start flex-1 min-w-0 text-ui font-medium -mt-0.25">
                Work directly in your folder on the <span class="font-semibold"
                  >{currentBranch}</span
                > branch
              </div>
            </button>
            <div class="ml-9 text-sm text-subtle">
              Stay in your working directory (no git worktree). Make sure to stay on one branch
              while agents are running.
            </div>
          </div>
        {/if}
      </Select.Content>
    </Select.Root>
  </div>
{/if}
