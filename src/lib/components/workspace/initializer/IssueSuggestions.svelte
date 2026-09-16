<script lang="ts" module>
  import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
  import type { SentryIssueResult } from '$store/renderer/slices/sentry-auth/sentry-auth-types';
  import { formatInteger, formatRelativeTime as formatRelative } from '$lib/i18n/format';
  import { store as preloadStore } from '$store/renderer/store';
  import { initializeLinearAuth as initializeLinearAuthForPreload } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import { initializeSentryAuth as initializeSentryAuthForPreload } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';
  import { loadIssueSuggestionsRequested as preloadIssueSuggestionsRequested } from '$store/renderer/slices/issue-suggestions/issue-suggestions-slice';

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

  /**
   * Preload Linear and Sentry issues in the background.
   * Call this early (e.g., when the parent component mounts) to have issues ready
   * before the user opens the issue picker.
   */
  export function preloadIssues(): void {
    preloadStore.dispatch(initializeLinearAuthForPreload());
    preloadStore.dispatch(initializeSentryAuthForPreload());
    preloadStore.dispatch(preloadIssueSuggestionsRequested('linear-assigned', {}));
    preloadStore.dispatch(preloadIssueSuggestionsRequested('linear-created', {}));
    preloadStore.dispatch(preloadIssueSuggestionsRequested('sentry', {}));
  }
</script>

<script lang="ts">
  /* eslint-disable max-lines */
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { slide } from '$lib/motion';
  import Fa from 'svelte-fa';
  import { faChevronDown, faPlus, faSearch } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Select } from '$lib/components/ui/select';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { handleLink } from '$features/navigation/link-handler';
  import { createLogger } from '$lib/utils/client-logger';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import {
    selectGitHubAuthIsAuthenticated,
    selectGitHubAuthIsAuthenticating,
  } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { startGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
    initializeLinearAuth,
    startLinearAuth,
  } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import {
    selectLinearIsAuthenticated,
    selectLinearIsAuthenticating,
  } from '$store/renderer/slices/linear-auth/linear-auth-selectors';

  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import {
    connectSentry,
    initializeSentryAuth,
  } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';
  import {
    selectSentryIsConnecting,
    selectSentryError,
    selectSentryIsAuthenticated,
  } from '$store/renderer/slices/sentry-auth/sentry-auth-selectors';
  import Header from '$lib/components/ui/Header.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { createTrailingDebouncer } from './issue-paging';
  import {
    loadIssueSuggestionsRequested,
    setContextSourcePreference,
  } from '$store/renderer/slices/issue-suggestions/issue-suggestions-slice';
  import {
    selectGitHubIssueSuggestions,
    selectGitHubPullRequestDetail,
    selectGitHubPullRequestSuggestions,
    selectGitHubRelatedRepos,
    selectLinearAssignedSuggestions,
    selectLinearCreatedSuggestions,
    selectLinearSearchSuggestions,
    selectLastUsedContextSource,
    selectSentrySuggestions,
  } from '$store/renderer/slices/issue-suggestions/issue-suggestions-selectors';
  import {
    orderProviders,
    orderSources,
    resolveActiveSource,
    type ContextSourceProvider,
  } from './context-source-preference';
  import type {
    ContextSource,
    GitHubRepoRef,
  } from '$store/renderer/slices/issue-suggestions/issue-suggestions-types';

  const logger = createLogger('ContextPicker');
  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const githubAuthIsAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const linearIsAuthenticated$ = selectLinearIsAuthenticated();
  const linearIsAuthenticating$ = selectLinearIsAuthenticating();
  const sentryIsAuthenticated$ = selectSentryIsAuthenticated();
  const sentryIsConnecting$ = selectSentryIsConnecting();
  const sentryError$ = selectSentryError();
  const linearAssignedResult$ = selectLinearAssignedSuggestions();
  const linearCreatedResult$ = selectLinearCreatedSuggestions();
  const linearSearchResult$ = selectLinearSearchSuggestions();
  const sentryResult$ = selectSentrySuggestions();
  const lastUsedSource$ = selectLastUsedContextSource();

  // Inline Sentry auth form state
  let sentryShowForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');

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

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;

  // Panel state
  // svelte-ignore state_referenced_locally - intentional initial capture; prop only seeds the open state
  let isOpen = $state(initiallyExpanded);
  let searchQuery = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  // Last source the user actually selected an item from (persisted preference)
  const lastUsedSource = $derived($lastUsedSource$);
  // svelte-ignore state_referenced_locally - intentional initial capture; initialSource/lastUsedSource only seed the active tab
  let activeSource = $state<ContextSource>(
    initialSource ??
      resolveActiveSource({ github: false, linear: false, sentry: false }, $lastUsedSource$),
  );
  // Once the user explicitly picks a tab, auth resolution must not override it
  let userSelectedTab = $state(false);

  function markSourceUsed(source: ContextSource) {
    appStore.dispatch(setContextSourcePreference(source));
  }

  // Last query committed to the server per source (after debounce)
  let committedQueries = $state<Record<ContextSource, string>>({
    linear: '',
    sentry: '',
    'github-issues': '',
    'github-prs': '',
  });
  // GitHub PR filter - uses GitHub search API @me filter
  // svelte-ignore state_referenced_locally - intentional initial capture; prop only seeds the filter default
  let githubPRFilter = $state<'all' | 'assigned' | 'created' | 'review-requested' | 'involves'>(
    prFilter ?? 'all',
  );
  let pendingGitHubPR = $state<{ pr: GitHubPRLocal; version: number } | null>(null);
  const repositoryOwner$ = toStore(() => repositoryOwner ?? '');
  const repositoryName$ = toStore(() => repositoryName ?? '');
  const githubIssueQuery$ = toStore(() => committedQueries['github-issues']);
  const githubPrQuery$ = toStore(() => committedQueries['github-prs']);
  const githubPrFilter$ = toStore(() => githubPRFilter);
  const githubRelatedReposResult$ = selectGitHubRelatedRepos(repositoryOwner$, repositoryName$);
  const relatedRepos = $derived(
    $githubRelatedReposResult$.items.map(({ owner, repo }) => ({ owner, repo })),
  );
  const relatedReposKey = $derived(
    relatedRepos.map(({ owner, repo }) => `${owner}/${repo}`).join(','),
  );
  const relatedRepos$ = toStore(() => relatedRepos);
  const githubIssuesResult$ = selectGitHubIssueSuggestions(
    repositoryOwner$,
    repositoryName$,
    relatedRepos$,
    githubIssueQuery$,
  );
  const githubPrsResult$ = selectGitHubPullRequestSuggestions(
    repositoryOwner$,
    repositoryName$,
    relatedRepos$,
    githubPrFilter$,
    githubPrQuery$,
  );
  const pendingPrOwner$ = toStore(() => pendingGitHubPR?.pr.owner ?? '');
  const pendingPrRepo$ = toStore(() => pendingGitHubPR?.pr.repo ?? '');
  const pendingPrNumber$ = toStore(() => pendingGitHubPR?.pr.number ?? 0);
  const githubPrDetailResult$ = selectGitHubPullRequestDetail(
    pendingPrOwner$,
    pendingPrRepo$,
    pendingPrNumber$,
  );

  // Linear state - grouped by relationship and rendered from Redux results.
  const linearAssignedPage = $derived($linearAssignedResult$);
  const linearCreatedPage = $derived($linearCreatedResult$);
  const linearSearchPage = $derived($linearSearchResult$);
  // Non-empty committed Linear query switches Linear to search-results mode
  let linearActiveQuery = $state('');
  const linearAssignedIssues = $derived(linearAssignedPage.items);
  const linearCreatedIssues = $derived(linearCreatedPage.items);
  const linearSearchResults = $derived(linearSearchPage.items);
  const linearSearchMode = $derived(linearActiveQuery !== '');
  const isLoadingLinear = $derived(
    (linearAssignedPage.isFetching && linearAssignedPage.items.length === 0) ||
      (linearCreatedPage.isFetching && linearCreatedPage.items.length === 0),
  );
  const isRefreshingLinear = $derived(
    (linearAssignedPage.isFetching && linearAssignedPage.items.length > 0) ||
      (linearCreatedPage.isFetching && linearCreatedPage.items.length > 0),
  );
  const isLinearAuthenticated = $derived($linearIsAuthenticated$);

  // Sentry state
  const sentryPage = $derived($sentryResult$);
  const sentryIssues = $derived(sentryPage.items);
  const isLoadingSentry = $derived(sentryPage.isFetching && sentryPage.items.length === 0);
  const isRefreshingSentry = $derived(sentryPage.isFetching && sentryPage.items.length > 0);
  const isSentryAuthenticated = $derived($sentryIsAuthenticated$);

  // GitHub state (GitHubIssueLocal interface is defined in module script above)
  const githubIssuesPage = $derived($githubIssuesResult$);
  const githubIssues = $derived(githubIssuesPage.items);
  const isLoadingGitHub = $derived(
    githubIssuesPage.isFetching && githubIssuesPage.items.length === 0,
  );
  const isRefreshingGitHub = $derived(
    githubIssuesPage.isFetching && githubIssuesPage.items.length > 0,
  );
  let isGitHubAuthenticated = $state(false);

  // GitHub PRs state
  const githubPRsPage = $derived($githubPrsResult$);
  const githubPRs = $derived(githubPRsPage.items);
  const isLoadingGitHubPRs = $derived(githubPRsPage.isFetching && githubPRsPage.items.length === 0);

  const showRepoLabels = $derived(relatedRepos.length > 0);
  const repoLabels = $derived.by(() => {
    const labels = new Map<string, string>();
    if (!repositoryOwner || !repositoryName) return labels;
    const inPlay: GitHubRepoRef[] = [
      { owner: repositoryOwner, repo: repositoryName },
      ...relatedRepos,
    ];
    const nameCounts = new Map<string, number>();
    for (const ref of inPlay) nameCounts.set(ref.repo, (nameCounts.get(ref.repo) ?? 0) + 1);
    for (const ref of inPlay) {
      const key = `${ref.owner}/${ref.repo}`;
      labels.set(key, (nameCounts.get(ref.repo) ?? 0) > 1 ? key : ref.repo);
    }
    return labels;
  });
  const relatedReposCountLabel = $derived(
    relatedRepos.length === 1
      ? m.workspace_issueSuggestions_moreRepos_one({ count: formatInteger(relatedRepos.length) })
      : m.workspace_issueSuggestions_moreRepos_many({ count: formatInteger(relatedRepos.length) }),
  );

  function repoLabelFor(owner: string, repo: string): string {
    return repoLabels.get(`${owner}/${repo}`) ?? `${owner}/${repo}`;
  }

  function reposRequestOption(): { repos?: GitHubRepoRef[] } {
    return relatedRepos.length > 0 ? { repos: relatedRepos } : {};
  }

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

  // Trigger label for the Linear team filter select
  const selectedLinearTeamLabel = $derived.by(() => {
    const allLabel = m.workspace_issueSuggestions_allWithCount_label({
      count: linearAssignedIssues.length + linearCreatedIssues.length,
    });
    if (!selectedLinearTeam) return allLabel;
    const team = linearTeams.find((t) => t.key === selectedLinearTeam);
    if (!team) return allLabel;
    const count = [...linearAssignedIssues, ...linearCreatedIssues].filter(
      (i) => i.teamKey === team.key,
    ).length;
    return `${team.name} (${count})`;
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

  $effect(() => {
    if ($linearIsAuthenticated$) untrack(loadLinearIssues);
  });

  $effect(() => {
    if ($sentryIsAuthenticated$) untrack(loadSentryIssues);
  });

  // Instant pre-filter over already-loaded rows while the debounced server
  // search is pending. Server results replace the list once the query commits.
  // Trimmed to match the query that will be committed (see the search $effect).
  function matchesSearch(title: string, identifier: string) {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return title.toLowerCase().includes(query) || identifier.toLowerCase().includes(query);
  }

  // Helper to format relative time
  function formatRelativeTime(dateString: string | undefined): string {
    if (!dateString) return '';
    return formatRelative(dateString, { style: 'narrow' });
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
          if (linearSearchPage.nextToken && !linearSearchPage.isLoadingMore) {
            appStore.dispatch(
              loadIssueSuggestionsRequested(
                'linear-search',
                { query: linearActiveQuery, nextToken: linearSearchPage.nextToken },
                true,
              ),
            );
          }
        } else {
          if (linearAssignedPage.nextToken && !linearAssignedPage.isLoadingMore) {
            appStore.dispatch(
              loadIssueSuggestionsRequested(
                'linear-assigned',
                { nextToken: linearAssignedPage.nextToken },
                true,
              ),
            );
          }
          if (linearCreatedPage.nextToken && !linearCreatedPage.isLoadingMore) {
            appStore.dispatch(
              loadIssueSuggestionsRequested(
                'linear-created',
                { nextToken: linearCreatedPage.nextToken },
                true,
              ),
            );
          }
        }
        break;
      case 'sentry':
        if (sentryPage.nextToken && !sentryPage.isLoadingMore) {
          appStore.dispatch(
            loadIssueSuggestionsRequested(
              'sentry',
              {
                ...(committedQueries.sentry ? { query: committedQueries.sentry } : {}),
                nextToken: sentryPage.nextToken,
              },
              true,
            ),
          );
        }
        break;
      case 'github-issues':
        if (githubIssuesPage.nextToken && !githubIssuesPage.isLoadingMore) {
          appStore.dispatch(
            loadIssueSuggestionsRequested(
              'github-issues',
              {
                owner: repositoryOwner,
                repo: repositoryName,
                ...reposRequestOption(),
                ...(committedQueries['github-issues']
                  ? { query: committedQueries['github-issues'] }
                  : {}),
                nextToken: githubIssuesPage.nextToken,
              },
              true,
            ),
          );
        }
        break;
      case 'github-prs':
        if (githubPRsPage.nextToken && !githubPRsPage.isLoadingMore) {
          appStore.dispatch(
            loadIssueSuggestionsRequested(
              'github-prs',
              {
                owner: repositoryOwner,
                repo: repositoryName,
                ...reposRequestOption(),
                filter: githubPRFilter,
                ...(committedQueries['github-prs']
                  ? { query: committedQueries['github-prs'] }
                  : {}),
                nextToken: githubPRsPage.nextToken,
              },
              true,
            ),
          );
        }
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

  function loadLinearIssues() {
    if (!isLinearAuthenticated) return;
    if (!linearAssignedPage.isFetching) {
      appStore.dispatch(loadIssueSuggestionsRequested('linear-assigned', {}));
    }
    if (!linearCreatedPage.isFetching) {
      appStore.dispatch(loadIssueSuggestionsRequested('linear-created', {}));
    }
  }

  function loadSentryIssues() {
    if (!isSentryAuthenticated || sentryPage.isFetching) return;
    appStore.dispatch(loadIssueSuggestionsRequested('sentry', {}));
  }

  function loadGitHubIssues() {
    isGitHubAuthenticated = selectGitHubAuthIsAuthenticated.select(appStore.state);
    if (
      !isGitHubAuthenticated ||
      !repositoryOwner ||
      !repositoryName ||
      !isElectronPlatform() ||
      githubIssuesPage.isFetching
    ) {
      return;
    }
    const query = committedQueries['github-issues'];
    appStore.dispatch(
      loadIssueSuggestionsRequested('github-issues', {
        owner: repositoryOwner,
        repo: repositoryName,
        ...reposRequestOption(),
        ...(query ? { query } : {}),
      }),
    );
  }

  function loadGitHubPRs(
    filter: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves' = githubPRFilter,
  ) {
    if (
      !isGitHubAuthenticated ||
      !repositoryOwner ||
      !repositoryName ||
      !isElectronPlatform() ||
      githubPRsPage.isFetching
    ) {
      return;
    }
    const query = committedQueries['github-prs'];
    appStore.dispatch(
      loadIssueSuggestionsRequested('github-prs', {
        owner: repositoryOwner,
        repo: repositoryName,
        ...reposRequestOption(),
        filter,
        ...(query ? { query } : {}),
      }),
    );
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
          appStore.dispatch(loadIssueSuggestionsRequested('linear-search', { query }));
        }
        break;
      case 'sentry':
        appStore.dispatch(loadIssueSuggestionsRequested('sentry', query ? { query } : {}));
        break;
      case 'github-issues':
        loadGitHubIssues();
        break;
      case 'github-prs':
        loadGitHubPRs(githubPRFilter);
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
    markSourceUsed('linear');
    const issueText = `[${issue.identifier}] ${issue.title}`;
    const teamKey = issue.identifier.split('-')[0];
    // Map priority number to readable string
    const priorityMap: Record<number, string> = {
      0: m.workspace_issueSuggestions_priorityNone_label(),
      1: m.workspace_issueSuggestions_priorityUrgent_label(),
      2: m.workspace_issueSuggestions_priorityHigh_label(),
      3: m.workspace_issueSuggestions_priorityMedium_label(),
      4: m.workspace_issueSuggestions_priorityLow_label(),
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
    markSourceUsed('sentry');
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
    markSourceUsed('github-issues');
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

  function selectGitHubPR(
    pr: GitHubPRLocal,
    sourceBranch = pr.sourceBranch,
    targetBranch = pr.targetBranch,
  ) {
    markSourceUsed('github-prs');
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

  function handleGitHubPRClick(pr: GitHubPRLocal) {
    if (pr.sourceBranch || !isElectronPlatform()) {
      selectGitHubPR(pr);
      return;
    }
    pendingGitHubPR = { pr, version: $githubPrDetailResult$.version };
    appStore.dispatch(
      loadIssueSuggestionsRequested('github-pr-detail', {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
      }),
    );
  }

  $effect(() => {
    const pending = pendingGitHubPR;
    const result = $githubPrDetailResult$;
    if (!pending || result.isFetching || result.version <= pending.version) return;
    const detail = result.items[0];
    pendingGitHubPR = null;
    selectGitHubPR(
      pending.pr,
      detail?.sourceBranch ?? pending.pr.sourceBranch,
      detail?.targetBranch ?? pending.pr.targetBranch,
    );
  });

  function togglePanel() {
    isOpen = !isOpen;
    if (!isOpen) {
      searchQuery = '';
    }
  }

  // Focus the search input whenever the panel opens (including an initially
  // expanded mount). `isOpen` is the only tracked dependency — the input ref
  // is read inside the tick() callback — so tab switches or list updates
  // while the panel is open never re-steal focus.
  $effect(() => {
    if (!isOpen) return;
    void tick().then(() => searchInputEl?.focus({ preventScroll: true }));
  });

  // Track pending callbacks for cleanup
  let pendingCallbackId: number | ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    appStore.dispatch(initializeLinearAuth());
    appStore.dispatch(initializeSentryAuth());
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

  let requestedRelatedRepoKey = '';

  // Resolve related repos once per primary repo in this component. Successful
  // Redux results are reused across mounts; failed lookups are retried.
  $effect(() => {
    const owner = repositoryOwner;
    const repo = repositoryName;
    const authed = isGitHubAuthenticated;
    const result = $githubRelatedReposResult$;
    const key = owner && repo ? `${owner}/${repo}` : '';
    if (!owner || !repo || !authed || !isElectronPlatform()) {
      requestedRelatedRepoKey = '';
      return;
    }
    if (requestedRelatedRepoKey === key || (result.version > 0 && !result.error)) return;
    requestedRelatedRepoKey = key;
    appStore.dispatch(loadIssueSuggestionsRequested('github-related-repos', { owner, repo }));
  });

  // Reload GitHub issues/PRs when repository context or the resolved repo set changes.
  $effect(() => {
    // Track the deps - these must be accessed before the condition
    const owner = repositoryOwner;
    const repo = repositoryName;
    const authed = isGitHubAuthenticated;
    relatedReposKey;
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

  // Provider sources (not including browser - that's a separate section),
  // ordered by last-used provider first, then connected, then alphabetical
  const SOURCE_TAB_META: Record<ContextSource, { label: string; icon: typeof LinearIcon | null }> =
    {
      linear: { label: 'Linear', icon: LinearIcon },
      sentry: { label: 'Sentry', icon: SentryIcon },
      'github-issues': { label: 'GH Issues', icon: GitHubIcon },
      'github-prs': { label: 'GH PRs', icon: GitHubIcon },
    };
  const PROVIDER_ICONS: Record<ContextSourceProvider, typeof LinearIcon> = {
    github: GitHubIcon,
    linear: LinearIcon,
    sentry: SentryIcon,
  };
  const PROVIDER_ICON_CLASSES: Record<ContextSourceProvider, string> = {
    github: 'opacity-80',
    linear: 'opacity-40',
    sentry: 'opacity-80',
  };
  const providerConnections = $derived({
    github: isGitHubAuthenticated,
    linear: isLinearAuthenticated,
    sentry: isSentryAuthenticated,
  });
  const orderedProviders = $derived(orderProviders(providerConnections, lastUsedSource));
  const sources = $derived(
    orderSources(providerConnections, lastUsedSource).map((id) => ({ id, ...SOURCE_TAB_META[id] })),
  );

  // Once auth state resolves, fall back to the first connected provider's source
  // when the persisted source's provider is not connected. Skipped when the
  // source is locked via initialSource, the user explicitly picked a tab, or a
  // search is in progress (a non-empty query pins the pane so it can't jump
  // out from under the user mid-search; untracked so typing doesn't re-run
  // this effect).
  $effect(() => {
    const connections = providerConnections;
    const last = lastUsedSource;
    if (initialSource || userSelectedTab) return;
    if (untrack(() => searchQuery.trim() !== '')) return;
    const desired = resolveActiveSource(connections, last);
    if (desired !== untrack(() => activeSource)) {
      activeSource = desired;
    }
  });

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
        return m.workspace_issueSuggestions_searchLinear_placeholder();
      case 'sentry':
        return m.workspace_issueSuggestions_searchSentry_placeholder();
      case 'github-issues':
        return m.workspace_issueSuggestions_searchGithubIssues_placeholder();
      case 'github-prs':
        return m.workspace_issueSuggestions_searchPullRequests_placeholder();
      default:
        return m.workspace_issueSuggestions_search_placeholder();
    }
  }
</script>

{#snippet relatedReposBadge()}
  <TooltipRich side="top" align="start" delayDuration={300} maxWidth="24rem">
    {#snippet trigger()}
      <span
        class="px-1.5 py-0.5 text-xs rounded-full bg-muted/60 text-subtle whitespace-nowrap cursor-default"
        >{relatedReposCountLabel}</span
      >
    {/snippet}
    {#snippet content()}
      <div class="space-y-1">
        <div class="text-xs text-subtle">
          {m.workspace_issueSuggestions_alsoSearching_label()}
        </div>
        {#each relatedRepos as related (`${related.owner}/${related.repo}`)}
          <div class="text-xs font-mono">{related.owner}/{related.repo}</div>
        {/each}
      </div>
    {/snippet}
  </TooltipRich>
{/snippet}

<div class="context-picker w-full">
  <!-- Trigger button (hidden when hideToggle is true) -->
  {#if !hideToggle}
    <Button
      variant="plain"
      type="button"
      onclick={togglePanel}
      class="inline-flex items-center gap-2.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      <Fa
        icon={faPlus}
        size={11}
        class="transform transition-transform duration-200 {isOpen ? '-rotate-45' : ''}"
      />
      <span>{m.workspace_issueSuggestions_addContext_label()}</span>
      <!-- Show all provider icons when collapsed -->
      <!-- {#if !isOpen} -->
      <div class="flex items-end gap-2 ml-1 -mb-0.5">
        {#each orderedProviders as provider (provider)}
          {@const ProviderIcon = PROVIDER_ICONS[provider]}
          <ProviderIcon size={12} class={PROVIDER_ICON_CLASSES[provider]} />
        {/each}
      </div>
      <!-- {/if} -->
    </Button>
  {/if}

  <!-- Expandable panel -->
  {#if isOpen}
    <div
      class="{hideToggle ? '' : ''} rounded-lg border border-border bg-muted/20 overflow-hidden"
      transition:slide={{ tier: 'moderate' }}
    >
      <!-- Search + filter bar -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Fa icon={faSearch} class="w-3 h-3 text-ghost opacity-50" />
        <Input
          bind:ref={searchInputEl}
          type="text"
          bind:value={searchQuery}
          placeholder={getSearchPlaceholder(activeSource)}
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none"
        />
        <!-- Refreshing indicator -->
        {#if isRefreshing}
          <IntentMarkLoader size={10} class="mr-1 text-ghost" />
        {/if}
        <!-- Source tabs with issue count (hidden when controlled externally) -->
        {#if !hideSourceTabs}
          <div class="flex items-center gap-1 ml-auto">
            {#each sources as source (source.id)}
              {@const count = getSourceCount(source.id)}
              <Button
                variant="plain"
                type="button"
                onclick={() => {
                  userSelectedTab = true;
                  activeSource = source.id;
                }}
                class="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {activeSource ===
                source.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'}"
              >
                {source.label}
                {#if count > 0}
                  <span class="text-subtle">{count}</span>
                {/if}
              </Button>
            {/each}
          </div>
        {/if}
      </div>

      {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && showRepoLabels && repositoryOwner && repositoryName}
        <div class="flex items-center gap-1.5 px-3 py-1.5 border-b border-border text-xs">
          <GitHubIcon class="w-3 h-3 text-ghost shrink-0 opacity-50" />
          <span class="text-subtle truncate">{repositoryOwner}/{repositoryName}</span>
          {@render relatedReposBadge()}
        </div>
      {/if}

      <!-- Subtle filter bar - only show when there are multiple options -->
      {#if activeSource === 'sentry' && sentryProjects.length > 1}
        <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border">
          <Button
            variant="plain"
            type="button"
            onclick={() => (selectedSentryProject = null)}
            class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer {selectedSentryProject ===
            null
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {m.workspace_issueSuggestions_all_label()}
          </Button>
          {#each sentryProjects as project}
            <Button
              variant="plain"
              type="button"
              onclick={() => (selectedSentryProject = project.slug)}
              class="px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer whitespace-nowrap {selectedSentryProject ===
              project.slug
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              {project.name}
            </Button>
          {/each}
        </div>
      {/if}

      {#if activeSource === 'linear' && linearTeams.length > 1}
        <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
          <span class="text-xs text-subtle">{m.workspace_issueSuggestions_team_label()}</span>
          <Select.Root
            value={selectedLinearTeam ?? ''}
            onchange={(value) => (selectedLinearTeam = value || null)}
          >
            <Select.Trigger
              variant="ghost"
              class="w-auto gap-1 px-1! py-0.5! text-xs! text-muted-foreground hover:text-foreground"
            >
              <span class="truncate">{selectedLinearTeamLabel}</span>
              <Fa icon={faChevronDown} size={8} class="opacity-50 shrink-0" />
            </Select.Trigger>
            <Select.Content portal class="max-h-[300px] min-w-[10rem]">
              <Select.Item value="" class="text-xs! py-1.5!">
                <span class="truncate"
                  >{m.workspace_issueSuggestions_allWithCount_label({
                    count: linearAssignedIssues.length + linearCreatedIssues.length,
                  })}</span
                >
              </Select.Item>
              {#each linearTeams as team (team.key)}
                {@const count = [...linearAssignedIssues, ...linearCreatedIssues].filter(
                  (i) => i.teamKey === team.key,
                ).length}
                <Select.Item value={team.key} class="text-xs! py-1.5!">
                  <span class="truncate">{team.name} ({count})</span>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <!-- GitHub PR filter: All / Assigned / Review Requested / Created / Involves -->
      {#if activeSource === 'github-prs' && isGitHubAuthenticated}
        <div class="flex items-center gap-1 px-3 py-1.5 border-b border-border flex-wrap">
          <Button
            variant="plain"
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
            {m.workspace_issueSuggestions_all_label()}
          </Button>
          <Button
            variant="plain"
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
            {m.workspace_issueSuggestions_reviewRequested_label()}
          </Button>
          <Button
            variant="plain"
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
            {m.workspace_issueSuggestions_assigned_label()}
          </Button>
          <Button
            variant="plain"
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
            {m.workspace_issueSuggestions_created_label()}
          </Button>
          <Button
            variant="plain"
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
            {m.workspace_issueSuggestions_involvesMe_label()}
          </Button>
        </div>
      {/if}

      <!-- Results list -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="max-h-[min(16rem,35dvh)] overflow-y-auto flex flex-col"
        onscroll={handleResultsScroll}
      >
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
        {:else if activeIsFetching && !hasVisibleIssues}
          <!-- Committed server search in flight with nothing to pre-filter -->
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
              {m.workspace_issueSuggestions_noIssuesMatch_label({ query: searchQuery })}
            {:else if activeSource === 'github-issues'}
              {m.workspace_issueSuggestions_noIssuesFoundFor_before()}
              <Button
                variant="plain"
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/issues`, {
                    workspaceId: workspaceId as WorkspaceId | undefined,
                  });
                }}
                class="underline underline-offset-2 decoration-muted-foreground/20 cursor-pointer"
                >{repositoryOwner}/{repositoryName}</Button
              >
              {#if showRepoLabels}
                {@render relatedReposBadge()}
              {/if}
            {:else if activeSource === 'github-prs'}
              {m.workspace_issueSuggestions_noPullRequestsFoundFor_before()}
              <Button
                variant="plain"
                onclick={() => {
                  handleLink(`https://github.com/${repositoryOwner}/${repositoryName}/pulls`, {
                    workspaceId: workspaceId as WorkspaceId | undefined,
                  });
                }}
                class="underline underline-offset-2 decoration-muted-foreground/20 cursor-pointer"
                >{repositoryOwner}/{repositoryName}</Button
              >
              {#if showRepoLabels}
                {@render relatedReposBadge()}
              {/if}
            {:else}
              {m.workspace_issueSuggestions_noIssuesFound_label()}
            {/if}
          </div>
        {:else}
          <!-- Linear issues - grouped -->
          {#if activeSource === 'linear'}
            <!-- Assigned to me -->
            {#if visibleLinearAssigned.length > 0}
              <Header size={6} class="px-3 pt-2 pb-1"
                >{m.workspace_issueSuggestions_assignedToMe_label()}</Header
              >
              {#each visibleLinearAssigned as issue (issue.id)}
                <TooltipRich
                  class="flex w-full min-w-0"
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
                    <Button
                      variant="plain"
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
                    </Button>
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
                          <span
                            >{m.workspace_issueSuggestions_assignee_label({
                              assignee: issue.assignee,
                            })}</span
                          >
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
                >{m.workspace_issueSuggestions_createdByMe_label()}</Header
              >
              {#each visibleLinearCreated as issue (issue.id)}
                <TooltipRich
                  class="flex w-full min-w-0"
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
                    <Button
                      variant="plain"
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
                    </Button>
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
                          <span
                            >{m.workspace_issueSuggestions_assignee_label({
                              assignee: issue.assignee,
                            })}</span
                          >
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
                class="flex w-full min-w-0"
                side="top"
                align="start"
                delayDuration={400}
                maxWidth="36rem"
                disableHoverableContent={true}
                open={openTooltipId === `linear-search-${issue.id}`}
                onOpenChange={(open) => handleTooltipOpenChange(`linear-search-${issue.id}`, open)}
              >
                {#snippet trigger()}
                  <Button
                    variant="plain"
                    type="button"
                    onclick={() => handleLinearIssueClick(issue)}
                    class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                  >
                    <LinearIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                    <span class="text-xs font-medium text-subtle shrink-0">{issue.identifier}</span>
                    <span
                      class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                      >{issue.title}</span
                    >
                    {#if issue.updatedAt || issue.createdAt}
                      <span class="text-xs text-subtle shrink-0"
                        >{formatRelativeTime(issue.updatedAt || issue.createdAt)}</span
                      >
                    {/if}
                  </Button>
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
                        <span
                          >{m.workspace_issueSuggestions_assignee_label({
                            assignee: issue.assignee,
                          })}</span
                        >
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
            <div class="w-full" transition:slide={{ tier: 'moderate' }}>
              <Button
                variant="plain"
                type="button"
                onclick={() => handleSentryIssueClick(issue)}
                class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
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
              </Button>
            </div>
          {/each}

          <!-- GitHub issues -->
          {#each visibleGitHubIssues as issue (issue.id)}
            <TooltipRich
              class="flex w-full min-w-0"
              side="top"
              align="start"
              delayDuration={400}
              maxWidth="36rem"
              disableHoverableContent={true}
              open={openTooltipId === `github-${issue.id}`}
              onOpenChange={(open) => handleTooltipOpenChange(`github-${issue.id}`, open)}
            >
              {#snippet trigger()}
                <Button
                  variant="plain"
                  type="button"
                  onclick={() => handleGitHubIssueClick(issue)}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                >
                  <GitHubIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                  <span class="text-xs font-medium text-subtle shrink-0"
                    >{#if showRepoLabels}{repoLabelFor(
                        issue.owner,
                        issue.repo,
                      )}{/if}#{issue.number}</span
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
                </Button>
              {/snippet}
              {#snippet content()}
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <GitHubIcon class="w-4 h-4 text-ghost shrink-0" />
                    <span class="text-xs font-medium text-subtle"
                      >{#if showRepoLabels}{repoLabelFor(
                          issue.owner,
                          issue.repo,
                        )}{/if}#{issue.number}</span
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
                      <span
                        >{m.workspace_issueSuggestions_assignee_label({
                          assignee: issue.assignee,
                        })}</span
                      >
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
              class="flex w-full min-w-0"
              side="top"
              align="start"
              delayDuration={400}
              maxWidth="36rem"
              disableHoverableContent={true}
              open={openTooltipId === `github-pr-${pr.id}`}
              onOpenChange={(open) => handleTooltipOpenChange(`github-pr-${pr.id}`, open)}
            >
              {#snippet trigger()}
                <Button
                  variant="plain"
                  type="button"
                  onclick={() => handleGitHubPRClick(pr)}
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 transition-colors group cursor-pointer"
                >
                  <GitHubIcon class="w-3.5 h-3.5 text-ghost shrink-0 opacity-50" />
                  <span class="text-xs font-medium text-subtle shrink-0"
                    >{#if showRepoLabels}{repoLabelFor(pr.owner, pr.repo)}{/if}#{pr.number}</span
                  >
                  <span
                    class="text-sm truncate flex-1 text-foreground/80 group-hover:text-foreground min-w-0"
                    >{pr.title}</span
                  >
                  {#if pr.state === 'draft'}
                    <span class="text-xs text-subtle shrink-0"
                      >{m.workspace_issueSuggestions_draft_label()}</span
                    >
                  {/if}
                  {#if pr.updatedAt || pr.createdAt}
                    <span class="text-xs text-subtle shrink-0"
                      >{formatRelativeTime(pr.updatedAt || pr.createdAt)}</span
                    >
                  {/if}
                </Button>
              {/snippet}
              {#snippet content()}
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <GitHubIcon class="w-4 h-4 text-ghost shrink-0" />
                    <span class="text-xs font-medium text-subtle"
                      >{#if showRepoLabels}{repoLabelFor(pr.owner, pr.repo)}{/if}#{pr.number}</span
                    >
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
                      <span
                        >{m.workspace_issueSuggestions_author_label({
                          author: pr.authorName || pr.authorLogin,
                        })}</span
                      >
                    {/if}
                    {#if pr.assignees && pr.assignees.length > 0}
                      <span
                        >{m.workspace_issueSuggestions_assignees_label({
                          assignees: pr.assignees.join(', '),
                        })}</span
                      >
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
              <IntentMarkLoader size={10} />
              <span>{m.workspace_issueSuggestions_loadingMore_label()}</span>
            </div>
          {/if}
          {#if activeHasMore && !activeIsLoadingMore}
            <div bind:this={sentinelEl} class="h-px shrink-0" aria-hidden="true"></div>
          {/if}
        {/if}

        <!-- Linear auth status - only show when not authenticated -->
        {#if activeSource === 'linear' && !isLoading && !isLinearAuthenticated}
          <div
            class="flex items-center justify-between px-3 py-2 text-sm border-t border-border"
            transition:slide={{ tier: 'moderate' }}
          >
            <div class="flex items-center gap-2">
              <LinearIcon class="w-3.5 h-3.5 text-ghost" />
              <span class="text-subtle">{m.workspace_issueSuggestions_connectLinear_label()}</span>
            </div>
            <Button
              variant="plain"
              type="button"
              disabled={$linearIsAuthenticating$}
              onclick={() => appStore.dispatch(startLinearAuth())}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {$linearIsAuthenticating$
                ? m.workspace_issueSuggestions_connecting_label()
                : m.workspace_issueSuggestions_connect_label()}
            </Button>
          </div>
        {/if}

        <!-- GitHub auth status - only show when not authenticated -->
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && !isGitHubAuthenticated}
          <div
            class="flex items-center justify-between px-3 py-2 text-sm border-t border-border"
            transition:slide={{ tier: 'moderate' }}
          >
            <div class="flex items-center gap-2">
              <GitHubIcon class="w-3.5 h-3.5 text-ghost" />
              <span class="text-subtle"
                >{activeSource === 'github-prs'
                  ? m.workspace_issueSuggestions_connectGithubPrs_label()
                  : m.workspace_issueSuggestions_connectGithubIssues_label()}</span
              >
            </div>
            <Button
              variant="plain"
              type="button"
              disabled={$githubAuthIsAuthenticating$}
              onclick={() => appStore.dispatch(startGitHubAuth())}
              class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {$githubAuthIsAuthenticating$
                ? m.workspace_issueSuggestions_connecting_label()
                : m.workspace_issueSuggestions_connect_label()}
            </Button>
          </div>
        {/if}
        <!-- Show repository hint when authenticated but no repo selected -->
        {#snippet repositoryHint()}
          <div class="px-3 py-1.5 text-xs text-subtle bg-muted/20">
            {activeSource === 'github-prs'
              ? m.workspace_issueSuggestions_selectRepoPrs_label()
              : m.workspace_issueSuggestions_selectRepoIssues_label()}
          </div>
        {/snippet}
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && isGitHubAuthenticated && !repositoryOwner}
          {@render repositoryHint()}
        {/if}
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && isGitHubAuthenticated && !repositoryOwner}
          {@render repositoryHint()}
        {/if}
        {#if (activeSource === 'github-issues' || activeSource === 'github-prs') && !isLoading && isGitHubAuthenticated && !repositoryOwner}
          {@render repositoryHint()}
        {/if}

        <!-- Sentry auth status - only show when not authenticated -->
        {#if activeSource === 'sentry' && !isLoading && !isSentryAuthenticated}
          <div class="border-t border-border" transition:slide={{ tier: 'moderate' }}>
            {#if !sentryShowForm}
              <div class="flex items-center justify-between px-3 py-2 text-sm">
                <div class="flex items-center gap-2">
                  <SentryIcon class="w-3.5 h-3.5 text-ghost" />
                  <span class="text-subtle"
                    >{m.workspace_issueSuggestions_connectSentry_label()}</span
                  >
                </div>
                <Button
                  variant="plain"
                  type="button"
                  onclick={() => (sentryShowForm = true)}
                  class="text-primary hover:text-primary/80 transition-colors font-medium cursor-pointer"
                >
                  {m.workspace_issueSuggestions_connect_label()}
                </Button>
              </div>
            {:else}
              <div class="px-3 py-2 space-y-2" transition:slide={{ tier: 'moderate' }}>
                <div class="flex items-center gap-2">
                  <Input
                    type="text"
                    class="flex-1 min-w-0 bg-background/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:opacity-40"
                    placeholder={m.workspace_issueSuggestions_organizationSlug_placeholder()}
                    bind:value={sentryOrg}
                  />
                  <Input
                    type="password"
                    class="flex-1 min-w-0 bg-background/50 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring placeholder:opacity-40"
                    placeholder={m.workspace_issueSuggestions_apiToken_placeholder()}
                    bind:value={sentryToken}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' && sentryOrg.trim() && sentryToken.trim()) {
                        appStore.dispatch(connectSentry(sentryOrg.trim(), sentryToken.trim()));
                      }
                    }}
                  />
                  <Button
                    variant="plain"
                    type="button"
                    disabled={$sentryIsConnecting$ || !sentryOrg.trim() || !sentryToken.trim()}
                    onclick={() =>
                      appStore.dispatch(connectSentry(sentryOrg.trim(), sentryToken.trim()))}
                    class="shrink-0 text-xs text-primary hover:text-primary/80 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {$sentryIsConnecting$
                      ? m.workspace_issueSuggestions_connecting_label()
                      : m.workspace_issueSuggestions_connect_label()}
                  </Button>
                </div>
                {#if $sentryError$}
                  <p class="text-xs text-danger">{$sentryError$}</p>
                {/if}
                <p class="text-xs text-subtle opacity-50">
                  {m.workspace_issueSuggestions_createTokenAt_label()}
                  <Button
                    variant="plain"
                    type="button"
                    onclick={() =>
                      handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
                        workspaceId: workspaceId as WorkspaceId | undefined,
                      })}
                    class="underline cursor-pointer hover:opacity-100"
                  >
                    <!-- i18n-ignore (domain name) -->
                    sentry.io
                  </Button>
                  {m.workspace_issueSuggestions_withScopes_label()}
                  <!-- i18n-ignore (API scope names) -->
                  <span class="font-mono">org:read, project:read, event:read</span>
                </p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
