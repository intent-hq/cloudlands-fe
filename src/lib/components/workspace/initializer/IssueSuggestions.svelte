<script lang="ts" module>
  import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
  import type { SentryIssueResult } from '$lib/store/slices/sentry-auth/sentry-auth-types';
  import { createLogger } from '$lib/utils/client-logger';

  const preloadLogger = createLogger('IssueSuggestions:preload');

  // Cache configuration
  const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  // Cache structure for each source
  interface IssueCache<T> {
    data: T;
    timestamp: number;
  }

  interface GitHubIssueLocal {
    id: string;
    number: number;
    title: string;
    url: string;
    state: 'open' | 'closed';
    owner: string;
    repo: string;
    body?: string;
    author?: string;
    assignee?: string;
    labels?: string;
    createdAt?: string;
    updatedAt?: string;
  }

  interface GitHubPRLocal {
    id: string;
    number: number;
    title: string;
    url: string;
    state: 'open' | 'closed' | 'merged' | 'draft';
    owner: string;
    repo: string;
    body?: string;
    authorLogin?: string;
    authorName?: string;
    assignees?: string[];
    sourceBranch?: string;
    targetBranch?: string;
    createdAt?: string;
    updatedAt?: string;
  }

  // Module-level cache (persists across component mounts, but not page refreshes)
  const issueCache: {
    linear?: IssueCache<{ assigned: LinearIssueResult[]; created: LinearIssueResult[] }>;
    sentry?: IssueCache<SentryIssueResult[]>;
    github?: IssueCache<{ issues: GitHubIssueLocal[]; key: string }>;
  } = {};

  // Per-filter cache for GitHub PRs (keyed by repo + filter)
  type PRFilterType = 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
  const githubPRCache: Map<string, { data: GitHubPRLocal[]; timestamp: number }> = new Map();
  const PR_CACHE_DURATION_MS = 60000; // 1 minute

  function getPRCacheKey(owner: string, repo: string, filter: PRFilterType): string {
    return `${owner}/${repo}:${filter}`;
  }

  function getCachedPRs(owner: string, repo: string, filter: PRFilterType): GitHubPRLocal[] | null {
    const key = getPRCacheKey(owner, repo, filter);
    const cached = githubPRCache.get(key);
    if (cached && Date.now() - cached.timestamp < PR_CACHE_DURATION_MS) {
      return cached.data;
    }
    return null;
  }

  function setCachedPRs(
    owner: string,
    repo: string,
    filter: PRFilterType,
    data: GitHubPRLocal[],
  ): void {
    const key = getPRCacheKey(owner, repo, filter);
    githubPRCache.set(key, { data, timestamp: Date.now() });
  }

  function isCacheValid<T>(cache: IssueCache<T> | undefined): cache is IssueCache<T> {
    if (!cache) return false;
    return Date.now() - cache.timestamp < CACHE_DURATION_MS;
  }

  // Track if preloading is already in progress to avoid duplicate requests
  let isPreloading = false;

  /**
   * Preload Linear and Sentry issues in the background.
   * Call this early (e.g., when the parent component mounts) to have issues ready
   * before the user opens the issue picker.
   */
  export async function preloadIssues(): Promise<void> {
    // Skip if already preloading or cache is still valid
    if (isPreloading) {
      preloadLogger.debug('Preload already in progress, skipping');
      return;
    }

    const linearCacheValid = isCacheValid(issueCache.linear);
    const sentryCacheValid = isCacheValid(issueCache.sentry);

    if (linearCacheValid && sentryCacheValid) {
      preloadLogger.debug('Cache is valid for both Linear and Sentry, skipping preload');
      return;
    }

    isPreloading = true;
    preloadLogger.debug('Starting issues preload');

    try {
      // Dynamic imports to avoid circular dependencies
      const [{ linearAuthClient }, { sentryAuthClient }] = await Promise.all([
        import('$features/linear-auth/renderer/linear-auth.client'),
        import('$features/sentry-auth/renderer/sentry-auth.client'),
      ]);

      // Initialize auth stores and fetch issues in parallel
      const preloadTasks: Promise<void>[] = [];

      // Preload Linear issues if cache is invalid
      if (!linearCacheValid) {
        preloadTasks.push(
          (async () => {
            try {
              const linearAuthState = await linearAuthClient.getAuthState(true);
              if (!linearAuthState.isAuthenticated) {
                preloadLogger.debug('Linear not authenticated, skipping preload');
                return;
              }

              const [assignedIssues, createdIssues] = await Promise.all([
                linearAuthClient.fetchMyIssues('assigned'),
                linearAuthClient.fetchMyIssues('created'),
              ]);

              issueCache.linear = {
                data: { assigned: assignedIssues, created: createdIssues },
                timestamp: Date.now(),
              };

              preloadLogger.debug('Preloaded Linear issues', {
                assigned: assignedIssues.length,
                created: createdIssues.length,
              });
            } catch (error) {
              preloadLogger.error('Failed to preload Linear issues', error as Error);
            }
          })(),
        );
      }

      // Preload Sentry issues if cache is invalid
      if (!sentryCacheValid) {
        preloadTasks.push(
          (async () => {
            try {
              const authState = await sentryAuthClient.getAuthState();
              if (!authState.isAuthenticated) {
                preloadLogger.debug('Sentry not authenticated, skipping preload');
                return;
              }

              const issues = await sentryAuthClient.fetchIssues();

              issueCache.sentry = {
                data: issues,
                timestamp: Date.now(),
              };

              preloadLogger.debug('Preloaded Sentry issues', { count: issues.length });
            } catch (error) {
              preloadLogger.error('Failed to preload Sentry issues', error as Error);
            }
          })(),
        );
      }

      await Promise.all(preloadTasks);
      preloadLogger.debug('Preload complete');
    } catch (error) {
      preloadLogger.error('Preload failed', error as Error);
    } finally {
      isPreloading = false;
    }
  }
</script>

<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faPlus, faSearch, faSync } from '@fortawesome/free-solid-svg-icons';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
  import { handleLink } from '$features/navigation/link-handler';
  import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import { initializeGitHubAuth } from '$lib/store/slices/github-auth/github-auth-slice';
  import { getDispatch } from '$lib/store/utils/utils';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import Header from '$lib/components/ui/Header.svelte';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';

  const logger = createLogger('ContextPicker');
  const issueDispatch = getDispatch();
  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();

  type ContextSource = 'linear' | 'github-issues' | 'github-prs' | 'sentry';

  /** Metadata for hover cards - contains author, assignee, labels, etc. */
  export interface IssueMetadata {
    author?: string;
    assignee?: string;
    state?: string;
    priority?: string;
    labels?: string;
    project?: string;
    createdAt?: string;
    updatedAt?: string;
    // Sentry-specific
    level?: string;
    count?: string;
    userCount?: string;
    culprit?: string;
    // GitHub PR-specific
    sourceBranch?: string;
    targetBranch?: string;
  }

  export interface IssueSelectionData {
    type: 'linear' | 'github' | 'sentry';
    identifier: string;
    title: string;
    url?: string;
    teamKey?: string;
    /** Sentry project name */
    projectName?: string;
    /** Description/body text for the issue */
    description?: string;
    /** Additional metadata for hover cards */
    metadata?: IssueMetadata;
  }

  interface Props {
    onSelect?: (text: string, metadata?: IssueSelectionData) => void;
    /** GitHub repository owner (e.g., "augmentcode") */
    repositoryOwner?: string;
    /** GitHub repository name (e.g., "augment") */
    repositoryName?: string;
    /** Start with the panel expanded (default: false) */
    initiallyExpanded?: boolean;
    /** Hide the toggle button - useful when embedded in a portal */
    hideToggle?: boolean;
  }

  let {
    onSelect,
    repositoryOwner,
    repositoryName,
    initiallyExpanded = false,
    hideToggle = false,
  }: Props = $props();

  // Panel state
  let isOpen = $state(initiallyExpanded);
  let searchQuery = $state('');
  let activeSource = $state<ContextSource>('linear');

  // Linear state - grouped by relationship
  let linearAssignedIssues = $state<LinearIssueResult[]>([]);
  let linearCreatedIssues = $state<LinearIssueResult[]>([]);
  let isLoadingLinear = $state(false);
  let isRefreshingLinear = $state(false);
  let isLinearAuthenticated = $state(false);

  // Sentry state
  let sentryIssues = $state<SentryIssueResult[]>([]);
  let isLoadingSentry = $state(false);
  let isRefreshingSentry = $state(false);
  let isSentryAuthenticated = $state(false);

  // GitHub state (GitHubIssueLocal interface is defined in module script above)
  let githubIssues = $state<GitHubIssueLocal[]>([]);
  let isLoadingGitHub = $state(false);
  let isRefreshingGitHub = $state(false);
  let isGitHubAuthenticated = $state(false);

  // GitHub PRs state
  let githubPRs = $state<GitHubPRLocal[]>([]);
  let isLoadingGitHubPRs = $state(false);
  let isRefreshingGitHubPRs = $state(false);

  // GitHub PR filter - uses GitHub search API @me filter
  let githubPRFilter = $state<'all' | 'assigned' | 'created' | 'review-requested' | 'involves'>(
    'all',
  );

  // Tooltip state - track which tooltip is open to close on scroll or when another opens
  let openTooltipId = $state<string | null>(null);

  // Filter state - null means "All"
  let selectedSentryProject = $state<string | null>(null);
  let selectedLinearTeam = $state<string | null>(null);

  // Extract unique Sentry projects from loaded issues
  const sentryProjects = $derived.by(() => {
    const projectMap = new Map<string, string>();
    for (const issue of sentryIssues) {
      if (issue.projectSlug && issue.projectName) {
        projectMap.set(issue.projectSlug, issue.projectName);
      }
    }
    return Array.from(projectMap.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Extract unique Linear teams from loaded issues
  const linearTeams = $derived.by(() => {
    const teamMap = new Map<string, string>();
    for (const issue of [...linearAssignedIssues, ...linearCreatedIssues]) {
      if (issue.teamKey && issue.teamName) {
        teamMap.set(issue.teamKey, issue.teamName);
      }
    }
    return Array.from(teamMap.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Check if any source is refreshing in background
  const isRefreshing = $derived(isRefreshingLinear || isRefreshingSentry || isRefreshingGitHub);

  function handleTooltipOpenChange(id: string, open: boolean) {
    if (open) {
      openTooltipId = id;
    } else if (openTooltipId === id) {
      openTooltipId = null;
    }
  }

  function handleResultsScroll() {
    // Close any open tooltip when scrolling
    openTooltipId = null;
  }

  // Watch for GitHub auth state changes (e.g., after user connects via Settings)
  $effect(() => {
    const storeIsAuth = $githubAuthIsAuthenticated$;
    if (storeIsAuth && !isGitHubAuthenticated) {
      // Auth completed (e.g., user connected via Settings)
      isGitHubAuthenticated = true;
      // Issues will be loaded by the repo context $effect
    }
  });

  // Helper to filter issues by search query
  function matchesSearch(title: string, identifier: string) {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return title.toLowerCase().includes(query) || identifier.toLowerCase().includes(query);
  }

  // Helper to format relative time
  function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  // Filter Linear issues - group by Assigned to me, Created by me (excluding already shown)
  const filteredLinearAssigned = $derived(
    linearAssignedIssues
      .filter((issue) => !selectedLinearTeam || issue.teamKey === selectedLinearTeam)
      .filter((issue) => matchesSearch(issue.title, issue.identifier)),
  );

  // Created issues, excluding ones already in assigned
  const filteredLinearCreated = $derived.by(() => {
    const assignedIds = new Set(linearAssignedIssues.map((i) => i.id));
    return linearCreatedIssues
      .filter((issue) => !assignedIds.has(issue.id))
      .filter((issue) => !selectedLinearTeam || issue.teamKey === selectedLinearTeam)
      .filter((issue) => matchesSearch(issue.title, issue.identifier));
  });

  // Filter Sentry issues based on search and project filter
  const filteredSentryIssues = $derived(
    sentryIssues
      .filter((issue) => !selectedSentryProject || issue.projectSlug === selectedSentryProject)
      .filter(
        (issue) =>
          !searchQuery ||
          issue.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          issue.shortId.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
  );

  // Filter GitHub issues based on search
  const filteredGitHubIssues = $derived(
    githubIssues.filter(
      (issue) =>
        !searchQuery ||
        issue.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `#${issue.number}`.includes(searchQuery.toLowerCase()),
    ),
  );

  // Filter GitHub PRs based on search and filter type
  // Filter PRs by search query only - API handles author/assignee filtering
  const filteredGitHubPRs = $derived.by(() => {
    return githubPRs.filter(
      (pr) =>
        !searchQuery ||
        pr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `#${pr.number}`.includes(searchQuery.toLowerCase()),
    );
  });

  // Show GitHub PRs based on active source
  const visibleGitHubPRs = $derived(
    activeSource === 'github-prs' ? filteredGitHubPRs.slice(0, 20) : [],
  );

  // Show issues based on active source
  const visibleLinearAssigned = $derived(
    activeSource === 'linear' ? filteredLinearAssigned.slice(0, 10) : [],
  );

  const visibleLinearCreated = $derived(
    activeSource === 'linear' ? filteredLinearCreated.slice(0, 10) : [],
  );

  // Combined for hasVisibleIssues check
  const visibleLinearIssues = $derived([...visibleLinearAssigned, ...visibleLinearCreated]);

  // Show Sentry issues based on active source
  const visibleSentryIssues = $derived(
    activeSource === 'sentry' ? filteredSentryIssues.slice(0, 20) : [],
  );

  // Show GitHub issues based on active source
  const visibleGitHubIssues = $derived(
    activeSource === 'github-issues' ? filteredGitHubIssues.slice(0, 20) : [],
  );

  // Check if we're loading anything
  const isLoading = $derived(
    isLoadingLinear || isLoadingSentry || isLoadingGitHub || isLoadingGitHubPRs,
  );

  // Check if we have any visible issues
  const hasVisibleIssues = $derived(
    visibleLinearIssues.length > 0 ||
      visibleSentryIssues.length > 0 ||
      visibleGitHubIssues.length > 0 ||
      visibleGitHubPRs.length > 0,
  );

  // Check if current filter has no auth - used to hide "No issues available"
  const isFilteredByUnauthenticatedSource = $derived(() => {
    if (
      (activeSource === 'github-issues' || activeSource === 'github-prs') &&
      !isGitHubAuthenticated
    )
      return true;
    if (activeSource === 'sentry' && !isSentryAuthenticated) return true;
    if (activeSource === 'linear' && !isLinearAuthenticated) return true;
    return false;
  });

  async function loadLinearIssues() {
    try {
      const linearAuthState = await linearAuthClient.getAuthState(true);
      isLinearAuthenticated = linearAuthState.isAuthenticated;

      if (!isLinearAuthenticated) return;

      // Check cache and populate immediately if valid
      const hasCachedData =
        isCacheValid(issueCache.linear) &&
        (issueCache.linear.data.assigned.length > 0 || issueCache.linear.data.created.length > 0);

      if (hasCachedData) {
        linearAssignedIssues = issueCache.linear!.data.assigned;
        linearCreatedIssues = issueCache.linear!.data.created;
        isRefreshingLinear = true;
      } else {
        isLoadingLinear = true;
      }

      // Fetch both assigned and created issues for grouping
      const [assignedIssues, createdIssues] = await Promise.all([
        linearAuthClient.fetchMyIssues('assigned'),
        linearAuthClient.fetchMyIssues('created'),
      ]);

      linearAssignedIssues = assignedIssues;
      linearCreatedIssues = createdIssues;

      // Update cache
      issueCache.linear = {
        data: { assigned: assignedIssues, created: createdIssues },
        timestamp: Date.now(),
      };

      logger.debug('Loaded Linear issues', {
        assigned: assignedIssues.length,
        created: createdIssues.length,
      });
    } catch (error) {
      logger.error('Failed to load Linear issues', error as Error);
    } finally {
      isLoadingLinear = false;
      isRefreshingLinear = false;
    }
  }

  async function loadSentryIssues() {
    try {
      const authState = await sentryAuthClient.getAuthState();
      isSentryAuthenticated = authState.isAuthenticated;

      if (!isSentryAuthenticated) return;

      // Check cache and populate immediately if valid
      const hasCachedData = isCacheValid(issueCache.sentry) && issueCache.sentry.data.length > 0;

      if (hasCachedData) {
        sentryIssues = issueCache.sentry!.data;
        isRefreshingSentry = true;
      } else {
        isLoadingSentry = true;
      }

      const issues = await sentryAuthClient.fetchIssues();
      sentryIssues = issues;

      // Update cache
      issueCache.sentry = {
        data: issues,
        timestamp: Date.now(),
      };

      logger.debug('Loaded Sentry issues', { count: issues.length });
    } catch (error) {
      logger.error('Failed to load Sentry issues', error as Error);
    } finally {
      isLoadingSentry = false;
      isRefreshingSentry = false;
    }
  }

  async function loadGitHubIssues() {
    try {
      logger.debug('Loading GitHub issues - initializing auth store');
      issueDispatch(initializeGitHubAuth());
      isGitHubAuthenticated = selectGitHubAuthIsAuthenticated.select(getReduxStore().getState());

      logger.debug('GitHub auth state', {
        isAuthenticated: isGitHubAuthenticated,
      });

      if (!isGitHubAuthenticated) {
        logger.debug('GitHub not authenticated, skipping issues fetch');
        return;
      }

      // Use owner/repo from props, skip if not available
      if (!repositoryOwner || !repositoryName) {
        logger.debug('No repository context, skipping GitHub issues fetch', {
          repositoryOwner,
          repositoryName,
        });
        return;
      }

      if (typeof window !== 'undefined' && window.electronAPI) {
        const cacheKey = `${repositoryOwner}/${repositoryName}`;
        const hasCachedData =
          isCacheValid(issueCache.github) &&
          issueCache.github.data.key === cacheKey &&
          issueCache.github.data.issues.length > 0;

        if (hasCachedData) {
          githubIssues = issueCache.github!.data.issues;
          isRefreshingGitHub = true;
        } else {
          isLoadingGitHub = true;
        }

        try {
          // Use search API with is:issue filter to get only actual issues (not PRs)
          const response = await window.electronAPI.invoke('git-tracking:search-github-issues', {
            owner: repositoryOwner,
            repo: repositoryName,
            options: { state: 'open', per_page: 20, filter: 'all' },
          });
          if (response?.success && response.data) {
            const mappedIssues = response.data.map(
              (issue: {
                id: string;
                number: number;
                title: string;
                body?: string;
                htmlUrl: string;
                state: 'open' | 'closed';
                owner: string;
                repo: string;
                author?: { login?: string; name?: string };
                assignee?: { login?: string; name?: string };
                labels?: string[];
                createdAt?: string;
                updatedAt?: string;
              }) => ({
                id: issue.id,
                number: issue.number,
                title: issue.title,
                body: issue.body,
                url: issue.htmlUrl,
                state: issue.state,
                owner: issue.owner,
                repo: issue.repo,
                author: issue.author?.name || issue.author?.login,
                assignee: issue.assignee?.name || issue.assignee?.login,
                labels: issue.labels?.join(', '),
                createdAt: issue.createdAt,
                updatedAt: issue.updatedAt,
              }),
            );
            githubIssues = mappedIssues;

            // Update cache
            issueCache.github = {
              data: { issues: mappedIssues, key: cacheKey },
              timestamp: Date.now(),
            };

            logger.debug('Loaded GitHub issues', { count: githubIssues.length });
          }
        } catch (err) {
          logger.error('Failed to load GitHub issues', err as Error);
        } finally {
          isLoadingGitHub = false;
          isRefreshingGitHub = false;
        }
      }
    } catch (error) {
      logger.error('Failed to initialize GitHub', error as Error);
    }
  }

  // Helper to fetch and map PRs for a specific filter
  async function fetchGitHubPRsForFilter(
    filter: PRFilterType,
    owner: string,
    repo: string,
  ): Promise<GitHubPRLocal[]> {
    const response = await window.electronAPI.invoke('git-tracking:search-pull-requests', {
      owner,
      repo,
      options: { state: 'open', per_page: 50, filter },
    });

    if (response?.success && response.data) {
      return response.data.map(
        (pr: {
          id: string;
          number: number;
          title: string;
          description?: string;
          htmlUrl: string;
          state: 'open' | 'closed' | 'merged' | 'draft';
          author?: { login?: string; name?: string };
          assignees?: string[];
          sourceBranch?: string;
          targetBranch?: string;
          createdAt?: string;
          updatedAt?: string;
        }) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          body: pr.description,
          url: pr.htmlUrl,
          state: pr.state,
          owner,
          repo,
          authorLogin: pr.author?.login,
          authorName: pr.author?.name,
          assignees: pr.assignees || [],
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
        }),
      );
    }
    return [];
  }

  // Prefetch other filters in background for instant switching
  async function prefetchOtherPRFilters(currentFilter: PRFilterType, owner: string, repo: string) {
    const allFilters: PRFilterType[] = [
      'all',
      'assigned',
      'created',
      'review-requested',
      'involves',
    ];
    const otherFilters = allFilters.filter((f) => f !== currentFilter);

    // Prefetch each filter with a small delay to not overwhelm the API
    for (const filter of otherFilters) {
      // Skip if already cached
      if (getCachedPRs(owner, repo, filter)) continue;

      try {
        const prs = await fetchGitHubPRsForFilter(filter, owner, repo);
        setCachedPRs(owner, repo, filter, prs);
        logger.debug('Prefetched GitHub PRs', { filter, count: prs.length });
      } catch (err) {
        // Silently fail prefetch - it's just optimization
        logger.debug('Failed to prefetch PRs', { filter, error: err });
      }
    }
  }

  async function loadGitHubPRs(
    filter: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves' = 'all',
  ) {
    try {
      if (!isGitHubAuthenticated) {
        return;
      }

      if (!repositoryOwner || !repositoryName) {
        logger.debug('No repository context, skipping GitHub PRs fetch');
        return;
      }

      if (typeof window !== 'undefined' && window.electronAPI) {
        // 1. Check cache first - show cached data immediately for snappy UI
        const cachedPRs = getCachedPRs(repositoryOwner, repositoryName, filter);
        if (cachedPRs) {
          githubPRs = cachedPRs;
          // Still refresh in background, but user sees data instantly
          isRefreshingGitHubPRs = true;
        } else {
          isLoadingGitHubPRs = true;
        }

        try {
          // 2. Fetch fresh data
          const mappedPRs = await fetchGitHubPRsForFilter(filter, repositoryOwner, repositoryName);

          // 3. Update cache and state
          setCachedPRs(repositoryOwner, repositoryName, filter, mappedPRs);
          githubPRs = mappedPRs;
          logger.debug('Loaded GitHub PRs', { count: githubPRs.length, filter });

          // 4. Prefetch other filters in background for instant switching
          prefetchOtherPRFilters(filter, repositoryOwner, repositoryName);
        } catch (err) {
          logger.error('Failed to load GitHub PRs', err as Error);
        } finally {
          isLoadingGitHubPRs = false;
          isRefreshingGitHubPRs = false;
        }
      }
    } catch (error) {
      logger.error('Failed to load GitHub PRs', error as Error);
    }
  }

  function handleLinearIssueClick(issue: LinearIssueResult) {
    const issueText = `[${issue.identifier}] ${issue.title}`;
    const teamKey = issue.identifier.split('-')[0];
    // Map priority number to readable string
    const priorityMap: Record<number, string> = {
      0: 'No priority',
      1: 'Urgent',
      2: 'High',
      3: 'Medium',
      4: 'Low',
    };
    onSelect?.(issueText, {
      type: 'linear',
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      teamKey,
      description: issue.description,
      metadata: {
        author: issue.creator,
        assignee: issue.assignee,
        state: issue.state,
        priority:
          issue.priority !== undefined
            ? priorityMap[issue.priority] || String(issue.priority)
            : undefined,
        labels: issue.labels?.join(', '),
        project: issue.project || issue.teamName,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      },
    });
    isOpen = false;
    searchQuery = '';
  }

  function handleSentryIssueClick(issue: SentryIssueResult) {
    const issueText = `[${issue.shortId}] ${issue.title}`;
    // For Sentry, build a description from available fields
    const description = [issue.culprit, issue.value].filter(Boolean).join('\n');
    onSelect?.(issueText, {
      type: 'sentry',
      identifier: issue.shortId,
      title: issue.title,
      url: issue.url,
      projectName: issue.projectName,
      description: description || undefined,
      metadata: {
        state: issue.status,
        level: issue.level,
        count: issue.count?.toString(),
        userCount: issue.userCount?.toString(),
        culprit: issue.culprit,
        createdAt: issue.firstSeen,
        updatedAt: issue.lastSeen,
        project: issue.projectName,
      },
    });
    isOpen = false;
    searchQuery = '';
  }

  function handleGitHubIssueClick(issue: GitHubIssueLocal) {
    const issueText = `#${issue.number} ${issue.title}`;
    onSelect?.(issueText, {
      type: 'github',
      identifier: `${issue.owner}/${issue.repo}#${issue.number}`,
      title: issue.title,
      url: issue.url,
      description: issue.body,
      metadata: {
        state: issue.state,
        author: issue.author,
        labels: issue.labels,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        project: `${issue.owner}/${issue.repo}`,
      },
    });
    isOpen = false;
    searchQuery = '';
  }

  async function handleGitHubPRClick(pr: GitHubPRLocal) {
    // If we don't have branch info, fetch full PR details (single API call)
    // The search API doesn't return head_ref/base_ref, so we fetch on selection
    let sourceBranch = pr.sourceBranch;
    let targetBranch = pr.targetBranch;

    if (!sourceBranch && typeof window !== 'undefined' && window.electronAPI) {
      try {
        const response = await window.electronAPI.invoke('git-tracking:get-pull-request', {
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
        });
        if (response?.success && response.data) {
          sourceBranch = response.data.sourceBranch;
          targetBranch = response.data.targetBranch;
          logger.debug('Fetched PR branch info on selection', {
            number: pr.number,
            sourceBranch,
            targetBranch,
          });
        }
      } catch (err) {
        logger.warn('Failed to fetch PR branch info', { number: pr.number, error: err });
        // Continue without branch info - the button just won't appear
      }
    }

    const prText = `#${pr.number} ${pr.title}`;
    onSelect?.(prText, {
      type: 'github',
      identifier: `${pr.owner}/${pr.repo}#${pr.number}`,
      title: pr.title,
      url: pr.url,
      description: pr.body,
      metadata: {
        state: pr.state,
        author: pr.authorName || pr.authorLogin,
        assignee: pr.assignees?.join(', '),
        sourceBranch,
        targetBranch,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        project: `${pr.owner}/${pr.repo}`,
      },
    });
    isOpen = false;
    searchQuery = '';
  }

  function togglePanel() {
    isOpen = !isOpen;
    if (!isOpen) {
      searchQuery = '';
    }
  }

  // Track pending callbacks for cleanup
  let pendingCallbackId: number | ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    logger.debug('IssueSuggestions mounted, deferring issue loading to avoid blocking UI', {
      repositoryOwner,
      repositoryName,
    });

    // Defer API calls to avoid blocking the main thread during critical operations
    // Use requestIdleCallback if available, otherwise setTimeout with a small delay
    const deferredLoad = () => {
      pendingCallbackId = undefined;
      loadLinearIssues();
      loadSentryIssues();
      loadGitHubIssues();
      loadGitHubPRs();
    };

    if (typeof requestIdleCallback !== 'undefined') {
      pendingCallbackId = requestIdleCallback(deferredLoad, { timeout: 2000 });
    } else {
      pendingCallbackId = setTimeout(deferredLoad, 100);
    }
  });

  onDestroy(() => {
    // Cancel pending callbacks to prevent API calls on unmounted component
    if (pendingCallbackId !== undefined) {
      // Both cancelIdleCallback and clearTimeout work with numeric IDs
      // For requestIdleCallback, use cancelIdleCallback; for setTimeout, use clearTimeout
      if (typeof pendingCallbackId === 'number' && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(pendingCallbackId);
      } else {
        clearTimeout(pendingCallbackId as ReturnType<typeof setTimeout>);
      }
      pendingCallbackId = undefined;
    }
  });

  // Reload GitHub issues/PRs when repository context changes
  $effect(() => {
    // Track the deps - these must be accessed before the condition
    const owner = repositoryOwner;
    const repo = repositoryName;
    const authed = isGitHubAuthenticated;
    // Only reload if we have both and are authenticated
    if (owner && repo && authed) {
      // Use untrack to prevent infinite loop - the load functions update state
      // which would re-trigger this effect otherwise
      untrack(() => {
        loadGitHubIssues();
        loadGitHubPRs();
      });
    }
  });

  // Provider sources (not including browser - that's a separate section)
  const sources: { id: ContextSource; label: string; icon: typeof LinearIcon | null }[] = [
    { id: 'linear', label: 'Linear', icon: LinearIcon },
    { id: 'sentry', label: 'Sentry', icon: SentryIcon },
    { id: 'github-issues', label: 'GH Issues', icon: GitHubIcon },
    { id: 'github-prs', label: 'GH PRs', icon: GitHubIcon },
  ];

  // Issue counts for each source
  const linearCount = $derived(linearAssignedIssues.length + linearCreatedIssues.length);
  const sentryCount = $derived(sentryIssues.length);
  const githubIssuesCount = $derived(githubIssues.length);
  const githubPRsCount = $derived(githubPRs.length);

  function getSourceCount(sourceId: ContextSource): number {
    if (sourceId === 'linear') return linearCount;
    if (sourceId === 'sentry') return sentryCount;
    if (sourceId === 'github-issues') return githubIssuesCount;
    if (sourceId === 'github-prs') return githubPRsCount;
    return 0;
  }

  function getSearchPlaceholder(sourceId: ContextSource): string {
    switch (sourceId) {
      case 'linear':
        return 'Search Linear issues...';
      case 'sentry':
        return 'Search Sentry issues...';
      case 'github-issues':
        return 'Search GitHub issues...';
      case 'github-prs':
        return 'Search pull requests...';
      default:
        return 'Search...';
    }
  }
</script>

<div class="context-picker w-full">
  <!-- Trigger button (hidden when hideToggle is true) -->
  {#if !hideToggle}
    <button
      type="button"
      onclick={togglePanel}
      class="inline-flex items-center gap-2.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      <Fa
        icon={faPlus}
        size={11}
        class="transform transition-transform duration-200 {isOpen ? '-rotate-45' : ''}"
      />
      <span>Add context</span>
      <!-- Show all provider icons when collapsed -->
      <!-- {#if !isOpen} -->
      <div class="flex items-end gap-2 ml-1 -mb-0.5">
        <LinearIcon size={12} class="opacity-40" />
        <GitHubIcon size={12} class="opacity-80" />
        <SentryIcon size={12} class="opacity-80" />
      </div>
      <!-- {/if} -->
    </button>
  {/if}

  <!-- Expandable panel -->
  {#if isOpen}
    <div
      class="{hideToggle ? '' : ''} rounded-lg border border-border/50 bg-muted/20 overflow-hidden"
      transition:slide={{ duration: 200 }}
    >
      <!-- Search + filter bar -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <Fa icon={faSearch} class="w-3 h-3 text-ghost opacity-50" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={searchQuery}
          placeholder={getSearchPlaceholder(activeSource)}
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none"
          autofocus
        />
        <!-- Refreshing indicator -->
        {#if isRefreshing}
          <Fa icon={faSync} class="w-2.5 h-2.5 mr-1 text-ghost animate-spin" />
        {/if}
        <!-- Source tabs with issue count -->
        <div class="flex items-center gap-1 ml-auto">
          {#each sources as source}
            {@const count = getSourceCount(source.id)}
            <button
              type="button"
              onclick={() => (activeSource = source.id)}
              class="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {activeSource ===
              source.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              {source.label}
              {#if count > 0}
                <span class="text-subtle">{count}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <!-- Subtle filter bar - only show when there are multiple options -->
      {#if activeSource === 'sentry' && sentryProjects.length > 1}
        <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border/20">
          <button
            type="button"
            onclick={() => (selectedSentryProject = null)}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {selectedSentryProject ===
            null
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            All
          </button>
          {#each sentryProjects as project}
            <button
              type="button"
              onclick={() => (selectedSentryProject = project.slug)}
              class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer whitespace-nowrap {selectedSentryProject ===
              project.slug
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              {project.name}
            </button>
          {/each}
        </div>
      {/if}

      {#if activeSource === 'linear' && linearTeams.length > 1}
        <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-muted/20">
          <span class="text-xs text-subtle">Team:</span>
          <select
            bind:value={selectedLinearTeam}
            class="text-xs bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer outline-none py-0.5 pr-4 appearance-none"
            style="background-image: url('data:image/svg+xml;charset=US-ASCII,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 4 5%22><path fill=%22%236b7280%22 d=%22M2 0L0 2h4z%22 transform=%22rotate(180 2 2.5)%22/></svg>'); background-repeat: no-repeat; background-position: right 0 center; background-size: 8px;"
          >
            <option value={null}
              >All ({linearAssignedIssues.length + linearCreatedIssues.length})</option
            >
            {#each linearTeams as team}
              {@const count = [...linearAssignedIssues, ...linearCreatedIssues].filter(
                (i) => i.teamKey === team.key,
              ).length}
              <option value={team.key}>{team.name} ({count})</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- GitHub PR filter: All / Assigned / Review Requested / Created / Involves -->
      {#if activeSource === 'github-prs' && isGitHubAuthenticated}
        <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border/20 flex-wrap">
          <button
            type="button"
            onclick={() => {
              if (githubPRFilter !== 'all') {
                githubPRFilter = 'all';
                loadGitHubPRs('all');
              }
            }}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {githubPRFilter ===
            'all'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            All
          </button>
          <button
            type="button"
            onclick={() => {
              if (githubPRFilter !== 'review-requested') {
                githubPRFilter = 'review-requested';
                loadGitHubPRs('review-requested');
              }
            }}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {githubPRFilter ===
            'review-requested'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Review Requested
          </button>
          <button
            type="button"
            onclick={() => {
              if (githubPRFilter !== 'assigned') {
                githubPRFilter = 'assigned';
                loadGitHubPRs('assigned');
              }
            }}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {githubPRFilter ===
            'assigned'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Assigned
          </button>
          <button
            type="button"
            onclick={() => {
              if (githubPRFilter !== 'created') {
                githubPRFilter = 'created';
                loadGitHubPRs('created');
              }
            }}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {githubPRFilter ===
            'created'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Created
          </button>
          <button
            type="button"
            onclick={() => {
              if (githubPRFilter !== 'involves') {
                githubPRFilter = 'involves';
                loadGitHubPRs('involves');
              }
            }}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {githubPRFilter ===
            'involves'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Involves Me
          </button>
        </div>
      {/if}

      <!-- Results list -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="max-h-64 overflow-y-auto flex flex-col" onscroll={handleResultsScroll}>
        <!-- Provider issues -->
        {#if isLoading}
          <div class="space-y-1 p-2">
            {#each [1, 2, 3] as { }}
              <div class="flex items-center gap-2 px-2 py-1.5">
                <Skeleton class="h-4 w-4 rounded" />
                <Skeleton class="h-3 w-14" />
                <Skeleton class="h-3 flex-1" />
              </div>
            {/each}
          </div>
        {:else if !hasVisibleIssues && !isFilteredByUnauthenticatedSource()}
          <div class="px-3 py-3 text-sm text-subtle text-center">
            {#if searchQuery}
              No issues match "{searchQuery}"
            {:else if activeSource === 'github-issues'}
              No issues found for <button
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/issues`, {
                    workspaceId: selectActiveWorkspaceId.select(getReduxStore().getState()) ?? undefined,
                  });
                }}
                class="underline underline-offset-2 decoration-muted-foreground/20 cursor-pointer"
                >{repositoryOwner}/{repositoryName}</button
              >
            {:else if activeSource === 'github-prs'}
              No pull requests found for <button
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/pulls`, {
                    workspaceId: selectActiveWorkspaceId.select(getReduxStore().getState()) ?? undefined,
                  });
                }}
                class="underline underline-offset-2 decoration-muted-foreground/20 cursor-pointer"
                >{repositoryOwner}/{repositoryName}</button
              >
            {:else}
              No issues found
            {/if}
          </div>
        {:else}
          <!-- Linear issues - grouped -->
          {#if activeSource === 'linear'}
            <!-- Assigned to me -->
            {#if visibleLinearAssigned.length > 0}
              <Header size={6} class="px-3 pt-2 pb-1"
              >
                Assigned to me
              </Header>
              {#each visibleLinearAssigned as issue (issue.id)}
                <TooltipRich
                  side="top"
                  align="start"
                  delayDuration={400}
                  maxWidth="36rem"
                  disableHoverableContent={true}
                  open={openTooltipId === `linear-assigned-${issue.id}`}
                  onOpenChange={(open) =>
                    handleTooltipOpenChange(`linear-assigned-${issue.id}`, open)}
                >
                  {#snippet trigger()}
                    <button
                      type="button"
                      onclick={() => handleLinearIssueClick(issue)}
                      class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                    >
                      <LinearIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                      <span class="text-xs font-medium text-subtle shrink-0"
                        >{issue.identifier}</span
                      >
                      <span
                        class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                        >{issue.title}</span
                      >
                      {#if issue.updatedAt || issue.createdAt}
                        <span class="text-xs text-subtle shrink-0"
                          >{formatRelativeTime(issue.updatedAt || issue.createdAt)}</span
                        >
                      {/if}
                    </button>
                  {/snippet}
                  {#snippet content()}
                    <div class="space-y-2">
                      <div class="flex items-center gap-2">
                        <LinearIcon class="w-4 h-4 text-ghost shrink-0" />
                        <span class="text-xs font-medium text-subtle"
                          >{issue.identifier}</span
                        >
                        {#if issue.state}
                          <span
                            class="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-subtle"
                            >{issue.state}</span
                          >
                        {/if}
                      </div>
                      <div class="text-sm font-medium">{issue.title}</div>
                      {#if issue.description}
                        <div class="text-sm text-subtle line-clamp-3">
                          {issue.description}
                        </div>
                      {/if}
                      <div
                        class="flex items-center gap-2 text-xs text-subtle pt-1"
                      >
                        {#if issue.assignee}
                          <span>Assignee: {issue.assignee}</span>
                        {/if}
                        {#if issue.createdAt}
                          <span class="ml-auto">{formatRelativeTime(issue.createdAt)}</span>
                        {/if}
                      </div>
                    </div>
                  {/snippet}
                </TooltipRich>
              {/each}
            {/if}

            <!-- Created by me -->
            {#if visibleLinearCreated.length > 0}
              <Header size={6} class="px-3 pt-3 pb-1"
              >
                Created by me
              </Header>
              {#each visibleLinearCreated as issue (issue.id)}
                <TooltipRich
                  side="top"
                  align="start"
                  delayDuration={400}
                  maxWidth="36rem"
                  disableHoverableContent={true}
                  open={openTooltipId === `linear-created-${issue.id}`}
                  onOpenChange={(open) =>
                    handleTooltipOpenChange(`linear-created-${issue.id}`, open)}
                >
                  {#snippet trigger()}
                    <button
                      type="button"
                      onclick={() => handleLinearIssueClick(issue)}
                      class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                    >
                      <LinearIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                      <span class="text-xs font-medium text-subtle shrink-0"
                        >{issue.identifier}</span
                      >
                      <span
                        class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                        >{issue.title}</span
                      >
                      {#if issue.updatedAt || issue.createdAt}
                        <span class="text-xs text-subtle shrink-0"
                          >{formatRelativeTime(issue.updatedAt || issue.createdAt)}</span
                        >
                      {/if}
                    </button>
                  {/snippet}
                  {#snippet content()}
                    <div class="space-y-2">
                      <div class="flex items-center gap-2">
                        <LinearIcon class="w-4 h-4 text-ghost shrink-0" />
                        <span class="text-xs font-medium text-subtle"
                          >{issue.identifier}</span
                        >
                        {#if issue.state}
                          <span
                            class="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-subtle"
                            >{issue.state}</span
                          >
                        {/if}
                      </div>
                      <div class="text-sm font-medium">{issue.title}</div>
                      {#if issue.description}
                        <div class="text-sm text-subtle line-clamp-3">
                          {issue.description}
                        </div>
                      {/if}
                      <div
                        class="flex items-center gap-2 text-xs text-subtle pt-1"
                      >
                        {#if issue.assignee}
                          <span>Assignee: {issue.assignee}</span>
                        {/if}
                        {#if issue.createdAt}
                          <span class="ml-auto">{formatRelativeTime(issue.createdAt)}</span>
                        {/if}
                      </div>
                    </div>
                  {/snippet}
                </TooltipRich>
              {/each}
            {/if}
          {/if}

          <!-- Sentry issues -->
          {#each visibleSentryIssues as issue (issue.id)}
            <button
              type="button"
              onclick={() => handleSentryIssueClick(issue)}
              class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
              transition:slide={{ duration: 150 }}
            >
              <SentryIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
              <span class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground"
                >{issue.title}</span
              >
              {#if sentryProjects.length > 1 && !selectedSentryProject}
                <span class="text-xs text-subtle shrink-0"
                  >{issue.projectName}</span
                >
              {/if}
              {#if issue.lastSeen}
                <span class="text-xs text-subtle shrink-0"
                  >{formatRelativeTime(issue.lastSeen)}</span
                >
              {/if}
            </button>
          {/each}

          <!-- GitHub issues -->
          {#each visibleGitHubIssues as issue (issue.id)}
            <TooltipRich
              side="top"
              align="start"
              delayDuration={400}
              maxWidth="36rem"
              disableHoverableContent={true}
              open={openTooltipId === `github-${issue.id}`}
              onOpenChange={(open) => handleTooltipOpenChange(`github-${issue.id}`, open)}
            >
              {#snippet trigger()}
                <button
                  type="button"
                  onclick={() => handleGitHubIssueClick(issue)}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                >
                  <GitHubIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                  <span class="text-xs font-medium text-subtle shrink-0"
                    >#{issue.number}</span
                  >
                  <span
                    class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                    >{issue.title}</span
                  >
                  {#if issue.updatedAt || issue.createdAt}
                    <span class="text-xs text-subtle shrink-0"
                      >{formatRelativeTime(issue.updatedAt || issue.createdAt)}</span
                    >
                  {/if}
                </button>
              {/snippet}
              {#snippet content()}
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <GitHubIcon class="w-4 h-4 text-ghost shrink-0" />
                    <span class="text-xs font-medium text-subtle"
                      >#{issue.number}</span
                    >
                    {#if issue.state}
                      <span
                        class="text-xs px-1.5 py-0.5 rounded {issue.state === 'open'
                          ? 'bg-green-500/20 text-green-600'
                          : 'bg-purple-500/20 text-purple-600'}">{issue.state}</span
                      >
                    {/if}
                  </div>
                  <div class="text-sm font-medium">{issue.title}</div>
                  {#if issue.body}
                    <div class="text-sm text-subtle line-clamp-3">{issue.body}</div>
                  {/if}
                  <div class="flex items-center gap-2 text-xs text-subtle pt-1">
                    {#if issue.assignee}
                      <span>Assignee: {issue.assignee}</span>
                    {/if}
                    {#if issue.createdAt}
                      <span class="ml-auto">{formatRelativeTime(issue.createdAt)}</span>
                    {/if}
                  </div>
                </div>
              {/snippet}
            </TooltipRich>
          {/each}

          <!-- GitHub PRs -->
          {#each visibleGitHubPRs as pr (pr.id)}
            <TooltipRich
              side="top"
              align="start"
              delayDuration={400}
              maxWidth="36rem"
              disableHoverableContent={true}
              open={openTooltipId === `github-pr-${pr.id}`}
              onOpenChange={(open) => handleTooltipOpenChange(`github-pr-${pr.id}`, open)}
            >
              {#snippet trigger()}
                <button
                  type="button"
                  onclick={() => handleGitHubPRClick(pr)}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                >
                  <GitHubIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                  <span class="text-xs font-medium text-subtle shrink-0"
                    >#{pr.number}</span
                  >
                  <span
                    class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                    >{pr.title}</span
                  >
                  {#if pr.state === 'draft'}
                    <span class="text-xs text-subtle shrink-0">draft</span>
                  {/if}
                  {#if pr.updatedAt || pr.createdAt}
                    <span class="text-xs text-subtle shrink-0"
                      >{formatRelativeTime(pr.updatedAt || pr.createdAt)}</span
                    >
                  {/if}
                </button>
              {/snippet}
              {#snippet content()}
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <GitHubIcon class="w-4 h-4 text-ghost shrink-0" />
                    <span class="text-xs font-medium text-subtle">#{pr.number}</span>
                    {#if pr.state}
                      <span
                        class="text-xs px-1.5 py-0.5 rounded {pr.state === 'open'
                          ? 'bg-green-500/20 text-green-600'
                          : pr.state === 'merged'
                            ? 'bg-purple-500/20 text-purple-600'
                            : pr.state === 'draft'
                              ? 'bg-gray-500/20 text-gray-600'
                              : 'bg-red-500/20 text-red-600'}">{pr.state}</span
                      >
                    {/if}
                  </div>
                  <div class="text-sm font-medium">{pr.title}</div>
                  {#if pr.sourceBranch && pr.targetBranch}
                    <div class="text-xs text-subtle font-mono">
                      {pr.sourceBranch} → {pr.targetBranch}
                    </div>
                  {/if}
                  {#if pr.body}
                    <div class="text-sm text-subtle line-clamp-3">{pr.body}</div>
                  {/if}
                  <div class="flex items-center gap-2 text-xs text-subtle pt-1">
                    {#if pr.authorLogin}
                      <span>Author: {pr.authorName || pr.authorLogin}</span>
                    {/if}
                    {#if pr.assignees && pr.assignees.length > 0}
                      <span>Assignees: {pr.assignees.join(', ')}</span>
                    {/if}
                    {#if pr.createdAt}
                      <span class="ml-auto">{formatRelativeTime(pr.createdAt)}</span>
                    {/if}
                  </div>
                </div>
              {/snippet}
            </TooltipRich>
          {/each}
        {/if}

        <!-- Linear auth status - only show when not authenticated -->
        {#if activeSource === 'linear' && !isLoading && !isLinearAuthenticated}
          <div
            class="flex items-center justify-between px-3 py-2 text-sm border-t border-border/20"
            transition:slide={{ duration: 150 }}
          >
            <div class="flex items-center gap-2">
              <LinearIcon class="w-3.5 h-3.5 text-ghost" />
              <span class="text-subtle">Connect Linear to see your issues</span>
            </div>
            <button
              type="button"
              onclick={() => navigateToSettings({ hash: 'integrations' })}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer"
            >
              Settings
            </button>
          </div>
        {/if}

        <!-- GitHub auth status - only show when not authenticated -->
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && !isGitHubAuthenticated}
          <div
            class="flex items-center justify-between px-3 py-2 text-sm border-t border-border/20"
            transition:slide={{ duration: 150 }}
          >
            <div class="flex items-center gap-2">
              <GitHubIcon class="w-3.5 h-3.5 text-ghost" />
              <span class="text-subtle"
                >Connect GitHub to see your {activeSource === 'github-prs'
                  ? 'pull requests'
                  : 'issues'}</span
              >
            </div>
            <button
              type="button"
              onclick={() => navigateToSettings({ hash: 'integrations' })}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer"
            >
              Settings
            </button>
          </div>
        {/if}
        <!-- Show repository hint when authenticated but no repo selected -->
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && isGitHubAuthenticated && !repositoryOwner}
          <div class="px-3 py-1.5 text-xs text-subtle bg-muted/20">
            Select a GitHub repository to see {activeSource === 'github-prs'
              ? 'pull requests'
              : 'issues'}
          </div>
        {/if}

        <!-- Sentry auth status - only show when not authenticated -->
        {#if activeSource === 'sentry' && !isLoading && !isSentryAuthenticated}
          <div
            class="flex items-center justify-between px-3 py-2 text-sm border-t border-border/20"
            transition:slide={{ duration: 150 }}
          >
            <div class="flex items-center gap-2">
              <SentryIcon class="w-3.5 h-3.5 text-ghost" />
              <span class="text-subtle">Connect Sentry to see your issues</span>
            </div>
            <button
              type="button"
              onclick={() => navigateToSettings({ hash: 'integrations' })}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer"
            >
              Settings
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
