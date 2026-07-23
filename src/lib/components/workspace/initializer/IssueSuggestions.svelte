<script lang="ts" module>
  import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
  import type { SentryIssueResult } from '$store/renderer/slices/sentry-auth/sentry-auth-types';
  import { createLogger } from '$lib/utils/client-logger';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { invoke } from '$shared/generated/ipc-client';

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

  // Module-level cache (persists across component mounts, but not page refreshes).
  // Only holds the initial unfiltered first page (+ its nextToken cursor).
  const issueCache: {
    linear?: IssueCache<{
      assigned: LinearIssueResult[];
      created: LinearIssueResult[];
      assignedNextToken: string | null;
      createdNextToken: string | null;
    }>;
    sentry?: IssueCache<{ issues: SentryIssueResult[]; nextToken: string | null }>;
    github?: IssueCache<{ issues: GitHubIssueLocal[]; nextToken: string | null; key: string }>;
  } = {};

  // Per-filter cache for GitHub PRs (keyed by repo + filter)
  type PRFilterType = 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
  const githubPRCache: Map<
    string,
    { data: GitHubPRLocal[]; nextToken: string | null; timestamp: number }
  > = new Map();
  const PR_CACHE_DURATION_MS = 60000; // 1 minute

  function getPRCacheKey(owner: string, repo: string, filter: PRFilterType): string {
    return `${owner}/${repo}:${filter}`;
  }

  function getCachedPRs(
    owner: string,
    repo: string,
    filter: PRFilterType,
  ): { data: GitHubPRLocal[]; nextToken: string | null } | null {
    const key = getPRCacheKey(owner, repo, filter);
    const cached = githubPRCache.get(key);
    if (cached && Date.now() - cached.timestamp < PR_CACHE_DURATION_MS) {
      return { data: cached.data, nextToken: cached.nextToken };
    }
    return null;
  }

  function setCachedPRs(
    owner: string,
    repo: string,
    filter: PRFilterType,
    data: GitHubPRLocal[],
    nextToken: string | null,
  ): void {
    const key = getPRCacheKey(owner, repo, filter);
    githubPRCache.set(key, { data, nextToken, timestamp: Date.now() });
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

              const [assignedPage, createdPage] = await Promise.all([
                linearAuthClient.fetchMyIssuesPage('assigned'),
                linearAuthClient.fetchMyIssuesPage('created'),
              ]);

              issueCache.linear = {
                data: {
                  assigned: assignedPage.issues,
                  created: createdPage.issues,
                  assignedNextToken: assignedPage.nextToken,
                  createdNextToken: createdPage.nextToken,
                },
                timestamp: Date.now(),
              };

              preloadLogger.debug('Preloaded Linear issues', {
                assigned: assignedPage.issues.length,
                created: createdPage.issues.length,
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

              const page = await sentryAuthClient.fetchIssuesPage();

              issueCache.sentry = {
                data: { issues: page.issues, nextToken: page.nextToken },
                timestamp: Date.now(),
              };

              preloadLogger.debug('Preloaded Sentry issues', { count: page.issues.length });
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
  /* eslint-disable max-lines */
  import {
  onMount,
  onDestroy,
  untrack,
} from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faPlus,
  faSearch,
  faSync,
} from '@fortawesome/free-solid-svg-icons';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
  import { handleLink } from '$features/navigation/link-handler';
  import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
  import {
  selectGitHubAuthIsAuthenticated,
  selectGitHubAuthIsAuthenticating,
} from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { startGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { startLinearAuth } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import { selectLinearIsAuthenticating } from '$store/renderer/slices/linear-auth/linear-auth-selectors';

  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { connectSentry } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';
  import {
  selectSentryIsConnecting,
  selectSentryError,
} from '$store/renderer/slices/sentry-auth/sentry-auth-selectors';
  import Header from '$lib/components/ui/Header.svelte';

  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import {
  createPagedSource,
  createTrailingDebouncer,
  type PagedSourceState,
} from './issue-paging';

  const logger = createLogger('ContextPicker');
  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const githubAuthIsAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const linearIsAuthenticating$ = selectLinearIsAuthenticating();
  const sentryIsConnecting$ = selectSentryIsConnecting();
  const sentryError$ = selectSentryError();

  // Inline Sentry auth form state
  let sentryShowForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');

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
    /** Lock to a specific source tab (hides the source tab bar) */
    initialSource?: ContextSource;
    /** Hide the internal source tabs when another parent surface manages source selection */
    hideSourceTabs?: boolean;
    /** Optional PR filter to apply when source is github-prs */
    prFilter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
  }

  let {
    onSelect,
    repositoryOwner,
    repositoryName,
    initiallyExpanded = false,
    hideToggle = false,
    initialSource,
    hideSourceTabs = false,
    prFilter,
  }: Props = $props();

  // Panel state
  let isOpen = $state(initiallyExpanded);
  let searchQuery = $state('');
  let activeSource = $state<ContextSource>(initialSource ?? 'linear');

  function emptyPage<T>(): PagedSourceState<T> {
    return { items: [], nextToken: null, isFetching: false, isLoadingMore: false };
  }

  // Last query committed to the server per source (after debounce)
  let committedQueries = $state<Record<ContextSource, string>>({
    linear: '',
    sentry: '',
    'github-issues': '',
    'github-prs': '',
  });

  // Linear state - grouped by relationship; paged via createPagedSource
  let linearAssignedPage = $state(emptyPage<LinearIssueResult>());
  let linearCreatedPage = $state(emptyPage<LinearIssueResult>());
  let linearSearchPage = $state(emptyPage<LinearIssueResult>());
  // Non-empty committed Linear query switches Linear to search-results mode
  let linearActiveQuery = $state('');
  const linearAssignedIssues = $derived(linearAssignedPage.items);
  const linearCreatedIssues = $derived(linearCreatedPage.items);
  const linearSearchResults = $derived(linearSearchPage.items);
  const linearSearchMode = $derived(linearActiveQuery !== '');
  let isLoadingLinear = $state(false);
  let isRefreshingLinear = $state(false);
  let isLinearAuthenticated = $state(false);

  // Sentry state
  let sentryPage = $state(emptyPage<SentryIssueResult>());
  const sentryIssues = $derived(sentryPage.items);
  let isLoadingSentry = $state(false);
  let isRefreshingSentry = $state(false);
  let isSentryAuthenticated = $state(false);

  // GitHub state (GitHubIssueLocal interface is defined in module script above)
  let githubIssuesPage = $state(emptyPage<GitHubIssueLocal>());
  const githubIssues = $derived(githubIssuesPage.items);
  let isLoadingGitHub = $state(false);
  let isRefreshingGitHub = $state(false);
  let isGitHubAuthenticated = $state(false);

  // GitHub PRs state
  let githubPRsPage = $state(emptyPage<GitHubPRLocal>());
  const githubPRs = $derived(githubPRsPage.items);
  let isLoadingGitHubPRs = $state(false);
  let _isRefreshingGitHubPRs = $state(false);

  // GitHub PR filter - uses GitHub search API @me filter
  let githubPRFilter = $state<'all' | 'assigned' | 'created' | 'review-requested' | 'involves'>(
    prFilter ?? 'all',
  );

  // Paged sources: one per list. Each owns items + nextToken + in-flight
  // bookkeeping and mirrors its state into the $state page objects above.
  const linearAssignedPager = createPagedSource<LinearIssueResult>({
    getId: (issue) => issue.id,
    fetchPage: async (_query, token) => {
      const page = await linearAuthClient.fetchMyIssuesPage(
        'assigned',
        token ? { nextToken: token } : undefined,
      );
      return { items: page.issues, nextToken: page.nextToken };
    },
    onChange: (s) => (linearAssignedPage = s),
    onError: (error) => logger.error('Failed to load Linear assigned issues', error as Error),
  });

  const linearCreatedPager = createPagedSource<LinearIssueResult>({
    getId: (issue) => issue.id,
    fetchPage: async (_query, token) => {
      const page = await linearAuthClient.fetchMyIssuesPage(
        'created',
        token ? { nextToken: token } : undefined,
      );
      return { items: page.issues, nextToken: page.nextToken };
    },
    onChange: (s) => (linearCreatedPage = s),
    onError: (error) => logger.error('Failed to load Linear created issues', error as Error),
  });

  const linearSearchPager = createPagedSource<LinearIssueResult>({
    getId: (issue) => issue.id,
    fetchPage: async (query, token) => {
      const page = await linearAuthClient.searchIssuesPage(
        query,
        token ? { nextToken: token } : undefined,
      );
      return { items: page.issues, nextToken: page.nextToken };
    },
    onChange: (s) => (linearSearchPage = s),
    onError: (error) => logger.error('Failed to search Linear issues', error as Error),
  });

  const sentryPager = createPagedSource<SentryIssueResult>({
    getId: (issue) => issue.id,
    fetchPage: async (query, token) => {
      const page = query
        ? await sentryAuthClient.searchIssuesPage(
            query,
            undefined,
            token ? { nextToken: token } : undefined,
          )
        : await sentryAuthClient.fetchIssuesPage(token ? { nextToken: token } : undefined);
      return { items: page.issues, nextToken: page.nextToken };
    },
    onChange: (s) => (sentryPage = s),
    onError: (error) => logger.error('Failed to load Sentry issues', error as Error),
  });

  const githubIssuesPager = createPagedSource<GitHubIssueLocal>({
    getId: (issue) => issue.id,
    fetchPage: (query, token) => fetchGitHubIssuesPage(query, token),
    onChange: (s) => (githubIssuesPage = s),
    onError: (error) => logger.error('Failed to load GitHub issues', error as Error),
  });

  const githubPRsPager = createPagedSource<GitHubPRLocal>({
    getId: (pr) => pr.id,
    fetchPage: (query, token) => fetchGitHubPRsPage(githubPRFilter, query, token),
    onChange: (s) => (githubPRsPage = s),
    onError: (error) => logger.error('Failed to load GitHub PRs', error as Error),
  });

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

  // Instant pre-filter over already-loaded rows while the debounced server
  // search is pending. Server results replace the list once the query commits.
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

  // The instant pre-filter only applies while the typed query hasn't produced
  // server results yet (debounce pending or first-page fetch in flight). Once
  // the server results for the query arrive, they are shown unfiltered —
  // server matches may hit fields (e.g. issue body) the client filter can't
  // see. (activeIsFetching is a lazily-evaluated $derived declared below.)
  const preFilterActive = $derived.by(
    () => searchQuery.trim() !== committedQueries[activeSource] || activeIsFetching,
  );

  // Filter Linear issues - group by Assigned to me, Created by me (excluding already shown)
  const filteredLinearAssigned = $derived(
    linearAssignedIssues
      .filter((issue) => !selectedLinearTeam || issue.teamKey === selectedLinearTeam)
      .filter((issue) => !preFilterActive || matchesSearch(issue.title, issue.identifier)),
  );

  // Created issues, excluding ones already in assigned
  const filteredLinearCreated = $derived.by(() => {
    const assignedIds = new Set(linearAssignedIssues.map((i) => i.id));
    return linearCreatedIssues
      .filter((issue) => !assignedIds.has(issue.id))
      .filter((issue) => !selectedLinearTeam || issue.teamKey === selectedLinearTeam)
      .filter((issue) => !preFilterActive || matchesSearch(issue.title, issue.identifier));
  });

  // Linear server-side search results (search mode)
  const filteredLinearSearch = $derived(
    linearSearchResults.filter(
      (issue) => !selectedLinearTeam || issue.teamKey === selectedLinearTeam,
    ),
  );

  // Filter Sentry issues based on project filter (+ instant pre-filter)
  const filteredSentryIssues = $derived(
    sentryIssues
      .filter((issue) => !selectedSentryProject || issue.projectSlug === selectedSentryProject)
      .filter((issue) => !preFilterActive || matchesSearch(issue.title, issue.shortId)),
  );

  // GitHub issues (+ instant pre-filter)
  const filteredGitHubIssues = $derived(
    githubIssues.filter(
      (issue) => !preFilterActive || matchesSearch(issue.title, `#${issue.number}`),
    ),
  );

  // GitHub PRs (+ instant pre-filter) - API handles author/assignee filtering
  const filteredGitHubPRs = $derived(
    githubPRs.filter((pr) => !preFilterActive || matchesSearch(pr.title, `#${pr.number}`)),
  );

  // Show GitHub PRs based on active source
  const visibleGitHubPRs = $derived(activeSource === 'github-prs' ? filteredGitHubPRs : []);

  // Show issues based on active source; in search mode Linear shows the
  // server-side search results as a single flat list instead of the groups
  const visibleLinearAssigned = $derived(
    activeSource === 'linear' && !linearSearchMode ? filteredLinearAssigned : [],
  );

  const visibleLinearCreated = $derived(
    activeSource === 'linear' && !linearSearchMode ? filteredLinearCreated : [],
  );

  const visibleLinearSearch = $derived(
    activeSource === 'linear' && linearSearchMode ? filteredLinearSearch : [],
  );

  // Combined for hasVisibleIssues check
  const visibleLinearIssues = $derived([
    ...visibleLinearAssigned,
    ...visibleLinearCreated,
    ...visibleLinearSearch,
  ]);

  // Show Sentry issues based on active source
  const visibleSentryIssues = $derived(activeSource === 'sentry' ? filteredSentryIssues : []);

  // Show GitHub issues based on active source
  const visibleGitHubIssues = $derived(
    activeSource === 'github-issues' ? filteredGitHubIssues : [],
  );

  // Infinite scroll: whether the active source has more pages / is appending
  const activeHasMore = $derived.by(() => {
    switch (activeSource) {
      case 'linear':
        return linearSearchMode
          ? linearSearchPage.nextToken !== null
          : linearAssignedPage.nextToken !== null || linearCreatedPage.nextToken !== null;
      case 'sentry':
        return sentryPage.nextToken !== null;
      case 'github-issues':
        return githubIssuesPage.nextToken !== null;
      case 'github-prs':
        return githubPRsPage.nextToken !== null;
    }
  });

  const activeIsLoadingMore = $derived.by(() => {
    switch (activeSource) {
      case 'linear':
        return linearSearchMode
          ? linearSearchPage.isLoadingMore
          : linearAssignedPage.isLoadingMore || linearCreatedPage.isLoadingMore;
      case 'sentry':
        return sentryPage.isLoadingMore;
      case 'github-issues':
        return githubIssuesPage.isLoadingMore;
      case 'github-prs':
        return githubPRsPage.isLoadingMore;
    }
  });

  // First-page fetch in flight for the active source (e.g. a committed search)
  const activeIsFetching = $derived.by(() => {
    switch (activeSource) {
      case 'linear':
        return linearSearchMode
          ? linearSearchPage.isFetching
          : linearAssignedPage.isFetching || linearCreatedPage.isFetching;
      case 'sentry':
        return sentryPage.isFetching;
      case 'github-issues':
        return githubIssuesPage.isFetching;
      case 'github-prs':
        return githubPRsPage.isFetching;
    }
  });

  // Check if any source is refreshing in background; also spins while a
  // committed server-side search is in flight for the active source
  const isRefreshing = $derived(
    isRefreshingLinear ||
      isRefreshingSentry ||
      isRefreshingGitHub ||
      (searchQuery !== '' && activeIsFetching),
  );

  function loadMoreActiveSource() {
    switch (activeSource) {
      case 'linear':
        if (linearSearchMode) {
          linearSearchPager.loadMore();
        } else {
          linearAssignedPager.loadMore();
          linearCreatedPager.loadMore();
        }
        break;
      case 'sentry':
        sentryPager.loadMore();
        break;
      case 'github-issues':
        githubIssuesPager.loadMore();
        break;
      case 'github-prs':
        githubPRsPager.loadMore();
        break;
    }
  }

  // IntersectionObserver sentinel at the bottom of the results list
  let sentinelEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = sentinelEl;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreActiveSource();
        }
      },
      { root: el.parentElement, rootMargin: '100px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  });

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

  // Check if a GitHub source is active but no repo has been provided. We use
  // this to suppress the "No pull requests found for owner/repo" empty state
  // (which would otherwise render as "No pull requests found for /" when the
  // owner/repo are missing). The "Select a GitHub repository" hint below
  // already handles this case more usefully.
  const isFilteredByMissingGitHubRepo = $derived(
    (activeSource === 'github-issues' || activeSource === 'github-prs') &&
      (!repositoryOwner || !repositoryName),
  );

  async function loadLinearIssues() {
    try {
      const linearAuthState = await linearAuthClient.getAuthState(true);
      isLinearAuthenticated = linearAuthState.isAuthenticated;

      if (!isLinearAuthenticated) return;

      // Check cache and populate immediately if valid
      const cached =
        isCacheValid(issueCache.linear) &&
        (issueCache.linear.data.assigned.length > 0 || issueCache.linear.data.created.length > 0)
          ? issueCache.linear.data
          : null;

      if (cached) {
        linearAssignedPager.seed(cached.assigned, cached.assignedNextToken);
        linearCreatedPager.seed(cached.created, cached.createdNextToken);
        isRefreshingLinear = true;
      } else {
        isLoadingLinear = true;
      }

      // Fetch both assigned and created issues for grouping
      await Promise.all([linearAssignedPager.refresh(''), linearCreatedPager.refresh('')]);

      // Update cache (initial unfiltered page only)
      issueCache.linear = {
        data: {
          assigned: linearAssignedPager.state.items,
          created: linearCreatedPager.state.items,
          assignedNextToken: linearAssignedPager.state.nextToken,
          createdNextToken: linearCreatedPager.state.nextToken,
        },
        timestamp: Date.now(),
      };

      logger.debug('Loaded Linear issues', {
        assigned: linearAssignedPager.state.items.length,
        created: linearCreatedPager.state.items.length,
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
      const cached =
        isCacheValid(issueCache.sentry) && issueCache.sentry.data.issues.length > 0
          ? issueCache.sentry.data
          : null;

      if (cached) {
        sentryPager.seed(cached.issues, cached.nextToken);
        isRefreshingSentry = true;
      } else {
        isLoadingSentry = true;
      }

      await sentryPager.refresh('');

      // Update cache (initial unfiltered page only); skip if a search
      // superseded this load while it was in flight
      if (committedQueries['sentry'] === '') {
        issueCache.sentry = {
          data: { issues: sentryPager.state.items, nextToken: sentryPager.state.nextToken },
          timestamp: Date.now(),
        };
      }

      logger.debug('Loaded Sentry issues', { count: sentryPager.state.items.length });
    } catch (error) {
      logger.error('Failed to load Sentry issues', error as Error);
    } finally {
      isLoadingSentry = false;
      isRefreshingSentry = false;
    }
  }

  // Fetch and map one page of GitHub issues (search API with is:issue filter)
  async function fetchGitHubIssuesPage(query: string, token: string | null) {
    if (!repositoryOwner || !repositoryName) {
      return { items: [] as GitHubIssueLocal[], nextToken: null };
    }
    const response = await invoke<any>('git-tracking:search-github-issues', {
      owner: repositoryOwner,
      repo: repositoryName,
      options: {
        state: 'open',
        per_page: 20,
        filter: 'all',
        ...(query ? { query } : {}),
        ...(token ? { nextToken: token } : {}),
      },
    });
    if (!response?.success) {
      throw new Error(response?.error ?? 'Failed to search GitHub issues');
    }
    const items: GitHubIssueLocal[] = (response.data ?? []).map(
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
    return {
      items,
      nextToken: typeof response.nextToken === 'string' ? response.nextToken : null,
    };
  }

  async function loadGitHubIssues() {
    try {
      logger.debug('Loading GitHub issues - checking auth state');
      // Read the current auth state without dispatching initializeGitHubAuth(),
      // which would trigger a store update and re-trigger the $effect that calls
      // this function, causing an infinite loop (effect_update_depth_exceeded).
      // Auth initialization is handled by the components that manage GitHub auth
      // (GitHubAuthBanner, GitHubAuthConnection, etc.).
      isGitHubAuthenticated = selectGitHubAuthIsAuthenticated.select(appStore.state);

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

      if (isElectronPlatform()) {
        const cacheKey = `${repositoryOwner}/${repositoryName}`;
        const query = committedQueries['github-issues'];
        const cached =
          query === '' &&
          isCacheValid(issueCache.github) &&
          issueCache.github.data.key === cacheKey &&
          issueCache.github.data.issues.length > 0
            ? issueCache.github.data
            : null;

        if (cached) {
          githubIssuesPager.seed(cached.issues, cached.nextToken);
          isRefreshingGitHub = true;
        } else {
          isLoadingGitHub = true;
        }

        try {
          await githubIssuesPager.refresh(query);

          // Update cache (initial unfiltered page only)
          if (query === '') {
            issueCache.github = {
              data: {
                issues: githubIssuesPager.state.items,
                nextToken: githubIssuesPager.state.nextToken,
                key: cacheKey,
              },
              timestamp: Date.now(),
            };
          }

          logger.debug('Loaded GitHub issues', {
            count: githubIssuesPager.state.items.length,
          });
        } finally {
          isLoadingGitHub = false;
          isRefreshingGitHub = false;
        }
      }
    } catch (error) {
      logger.error('Failed to initialize GitHub', error as Error);
    }
  }

  // Fetch and map one page of PRs for a specific filter
  async function fetchGitHubPRsPage(filter: PRFilterType, query: string, token: string | null) {
    if (!repositoryOwner || !repositoryName) {
      return { items: [] as GitHubPRLocal[], nextToken: null };
    }
    const owner = repositoryOwner;
    const repo = repositoryName;
    const response = await invoke<any>('git-tracking:search-pull-requests', {
      owner,
      repo,
      options: {
        state: 'open',
        per_page: 50,
        filter,
        ...(query ? { query } : {}),
        ...(token ? { nextToken: token } : {}),
      },
    });
    if (!response?.success) {
      throw new Error(response?.error ?? 'Failed to search pull requests');
    }
    const items: GitHubPRLocal[] = (response.data ?? []).map(
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
    return {
      items,
      nextToken: typeof response.nextToken === 'string' ? response.nextToken : null,
    };
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
        const page = await fetchGitHubPRsPage(filter, '', null);
        setCachedPRs(owner, repo, filter, page.items, page.nextToken);
        logger.debug('Prefetched GitHub PRs', { filter, count: page.items.length });
      } catch (err) {
        // Silently fail prefetch - it's just optimization
        logger.debug('Failed to prefetch PRs', { filter, error: err });
      }
    }
  }

  async function loadGitHubPRs(
    filter: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves' = githubPRFilter,
  ) {
    try {
      if (!isGitHubAuthenticated) {
        return;
      }

      if (!repositoryOwner || !repositoryName) {
        logger.debug('No repository context, skipping GitHub PRs fetch');
        return;
      }

      if (isElectronPlatform()) {
        // 1. Check cache first - show cached data immediately for snappy UI
        const query = committedQueries['github-prs'];
        const cachedPRs =
          query === '' ? getCachedPRs(repositoryOwner, repositoryName, filter) : null;
        if (cachedPRs) {
          githubPRsPager.seed(cachedPRs.data, cachedPRs.nextToken);
          // Still refresh in background, but user sees data instantly
          _isRefreshingGitHubPRs = true;
        } else {
          isLoadingGitHubPRs = true;
        }

        try {
          // 2. Fetch fresh data (pager reads githubPRFilter at call time)
          await githubPRsPager.refresh(query);

          // 3. Update cache (initial unfiltered page only)
          if (query === '') {
            setCachedPRs(
              repositoryOwner,
              repositoryName,
              filter,
              githubPRsPager.state.items,
              githubPRsPager.state.nextToken,
            );
            // 4. Prefetch other filters in background for instant switching
            prefetchOtherPRFilters(filter, repositoryOwner, repositoryName);
          }
          logger.debug('Loaded GitHub PRs', {
            count: githubPRsPager.state.items.length,
            filter,
          });
        } finally {
          isLoadingGitHubPRs = false;
          _isRefreshingGitHubPRs = false;
        }
      }
    } catch (error) {
      logger.error('Failed to load GitHub PRs', error as Error);
    }
  }

  // Debounced server-side search: typing schedules a commit; the commit
  // updates committedQueries and triggers a fresh first-page fetch for the
  // active source. Empty query restores the default listing.
  const SEARCH_DEBOUNCE_MS = 300;
  const searchDebouncer = createTrailingDebouncer(SEARCH_DEBOUNCE_MS);

  function commitSearch(source: ContextSource, query: string) {
    committedQueries[source] = query;
    switch (source) {
      case 'linear':
        linearActiveQuery = query;
        if (query) {
          void linearSearchPager.refresh(query);
        } else {
          // Assigned/created pagers still hold the default listing
          linearSearchPager.reset();
        }
        break;
      case 'sentry':
        if (query) {
          void sentryPager.refresh(query);
        } else {
          void loadSentryIssues();
        }
        break;
      case 'github-issues':
        if (query) {
          void githubIssuesPager.refresh(query);
        } else {
          void loadGitHubIssues();
        }
        break;
      case 'github-prs':
        if (query) {
          void githubPRsPager.refresh(query);
        } else {
          void loadGitHubPRs(githubPRFilter);
        }
        break;
    }
  }

  $effect(() => {
    const source = activeSource;
    const query = searchQuery.trim();
    if (query === committedQueries[source]) {
      searchDebouncer.cancel();
      return;
    }
    searchDebouncer.schedule(() => commitSearch(source, query));
  });

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

    if (!sourceBranch && isElectronPlatform()) {
      try {
        const response = await invoke<any>('git-tracking:get-pull-request', {
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
    // Drop any pending debounced search
    searchDebouncer.cancel();
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
        <!-- Source tabs with issue count (hidden when controlled externally) -->
        {#if !hideSourceTabs}
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
        {/if}
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
        {:else if !hasVisibleIssues && !isFilteredByUnauthenticatedSource() && !isFilteredByMissingGitHubRepo}
          <div class="px-3 py-3 text-sm text-subtle text-center">
            {#if searchQuery}
              No issues match "{searchQuery}"
            {:else if activeSource === 'github-issues'}
              No issues found for <button
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/issues`, {
                    workspaceId:
                      selectActiveWorkspaceId.select(appStore.state) ?? undefined,
                  });
                }}
                class="underline underline-offset-2 decoration-muted-foreground/20 cursor-pointer"
                >{repositoryOwner}/{repositoryName}</button
              >
            {:else if activeSource === 'github-prs'}
              No pull requests found for <button
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/pulls`, {
                    workspaceId:
                      selectActiveWorkspaceId.select(appStore.state) ?? undefined,
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
              <Header size={6} class="px-3 pt-2 pb-1">Assigned to me</Header>
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
                        <span class="text-xs font-medium text-subtle">{issue.identifier}</span>
                        {#if issue.state}
                          <span class="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-subtle"
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
            {/if}

            <!-- Created by me -->
            {#if visibleLinearCreated.length > 0}
              <Header size={6} class="px-3 pt-3 pb-1">Created by me</Header>
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
                        <span class="text-xs font-medium text-subtle">{issue.identifier}</span>
                        {#if issue.state}
                          <span class="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-subtle"
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
            {/if}

            <!-- Server-side search results (flat list) -->
            {#each visibleLinearSearch as issue (issue.id)}
              <TooltipRich
                side="top"
                align="start"
                delayDuration={400}
                maxWidth="36rem"
                disableHoverableContent={true}
                open={openTooltipId === `linear-search-${issue.id}`}
                onOpenChange={(open) => handleTooltipOpenChange(`linear-search-${issue.id}`, open)}
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
                      <span class="text-xs font-medium text-subtle">{issue.identifier}</span>
                      {#if issue.state}
                        <span class="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-subtle"
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
                <span class="text-xs text-subtle shrink-0">{issue.projectName}</span>
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
                  <span class="text-xs font-medium text-subtle shrink-0">#{issue.number}</span>
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
                    <span class="text-xs font-medium text-subtle">#{issue.number}</span>
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
                  <span class="text-xs font-medium text-subtle shrink-0">#{pr.number}</span>
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

          <!-- Infinite scroll: loading-more spinner + sentinel -->
          {#if activeIsLoadingMore}
            <div class="flex items-center justify-center gap-2 px-3 py-2 text-xs text-subtle">
              <Fa icon={faSync} class="w-2.5 h-2.5 animate-spin" />
              <span>Loading more…</span>
            </div>
          {/if}
          {#if activeHasMore && !activeIsLoadingMore}
            <div bind:this={sentinelEl} class="h-px shrink-0" aria-hidden="true"></div>
          {/if}
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
              disabled={$linearIsAuthenticating$}
              onclick={() => appStore.dispatch(startLinearAuth())}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {$linearIsAuthenticating$ ? 'Connecting…' : 'Connect'}
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
              disabled={$githubAuthIsAuthenticating$}
              onclick={() => appStore.dispatch(startGitHubAuth())}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {$githubAuthIsAuthenticating$ ? 'Connecting…' : 'Connect'}
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
        <!-- Show repository hint when authenticated but no repo selected -->
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && isGitHubAuthenticated && !repositoryOwner}
          <div class="px-3 py-1.5 text-xs text-subtle bg-muted/20">
            Select a GitHub repository to see {activeSource === 'github-prs'
              ? 'pull requests'
              : 'issues'}
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
          <div class="border-t border-border/20" transition:slide={{ duration: 150 }}>
            {#if !sentryShowForm}
              <div class="flex items-center justify-between px-3 py-2 text-sm">
                <div class="flex items-center gap-2">
                  <SentryIcon class="w-3.5 h-3.5 text-ghost" />
                  <span class="text-subtle">Connect Sentry to see your issues</span>
                </div>
                <button
                  type="button"
                  onclick={() => (sentryShowForm = true)}
                  class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer"
                >
                  Connect
                </button>
              </div>
            {:else}
              <div class="px-3 py-2 space-y-2" transition:slide={{ duration: 150 }}>
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    class="flex-1 min-w-0 bg-background/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:opacity-40"
                    placeholder="Organization slug"
                    bind:value={sentryOrg}
                  />
                  <input
                    type="password"
                    class="flex-1 min-w-0 bg-background/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:opacity-40"
                    placeholder="API token (sntrys_…)"
                    bind:value={sentryToken}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' && sentryOrg.trim() && sentryToken.trim()) {
                        appStore.dispatch(connectSentry(sentryOrg.trim(), sentryToken.trim()));
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={$sentryIsConnecting$ || !sentryOrg.trim() || !sentryToken.trim()}
                    onclick={() =>
                      appStore.dispatch(connectSentry(sentryOrg.trim(), sentryToken.trim()))}
                    class="shrink-0 text-xs text-primary hover:text-primary/80 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {$sentryIsConnecting$ ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
                {#if $sentryError$}
                  <p class="text-xs text-destructive">{$sentryError$}</p>
                {/if}
                <p class="text-xs text-subtle opacity-50">
                  Create a token at
                  <button
                    type="button"
                    onclick={() =>
                      handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
                        workspaceId:
                          selectActiveWorkspaceId.select(appStore.state) ?? undefined,
                      })}
                    class="underline cursor-pointer hover:opacity-100"
                  >
                    sentry.io
                  </button>
                  with scopes: <span class="font-mono">org:read, project:read, event:read</span>
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
