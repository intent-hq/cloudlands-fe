<script lang="ts">
  /**
   * SidebarChangesPanel - Timeline-based changes panel
   * Shows the git workflow as a vertical timeline: Unstaged → Staged → Commits → PRs
   */
  import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
  import { invoke } from '$shared/generated/ipc-client';

  import { recomputeAgentLocks } from '$store/renderer/slices/agent-lock/agent-lock-slice';
  import {
  selectStagedWorkingChanges as selectFtStagedChanges,
  selectUnstagedWorkingChanges as selectFtUnstagedChanges,
  selectFileTrackingCommits as selectFtCommits,
  selectFileTrackingLoading as selectFtLoading,
  selectFileTrackingChangesTruncated as selectFtChangesTruncated,
  selectFileTrackingTotalChangesCount as selectFtTotalChangesCount,
  selectPendingAutoAction,
  selectAcceptChangesState,
} from '$store/renderer/slices/changes/changes-selectors';
  import {
  refreshRequested,
  refreshAcceptChangesStatus,
  setPendingAutoAction,
} from '$store/renderer/slices/changes/changes-slice';
  import { refreshPRStatusRequested } from '$store/renderer/slices/pr-status/pr-status-slice';
  import { type TrackedChange } from '$features/file-tracking/types';
  import { gitCache } from '$features/git/git-cache';
  import {
  loadGitStatus,
  setPostMergeState,
  setGitOperationFlag,
} from '$store/renderer/slices/git/git-slice';
  import {
  selectGitStatus,
  selectGitAhead,
  selectGitBehind,
  selectPostMergeState,
  selectGitOperationFlags,
} from '$store/renderer/slices/git/git-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
  addTerminal,
  openTerminalOverlay,
} from '$store/renderer/slices/terminals/terminals-slice';






  import {
  selectActiveWorkspaceId,
  selectWorkspaceById,
  selectWorkspaceActivePullRequest,
} from '$store/renderer/slices/workspace/workspace-selectors';
  import { getPRDisplayTitle } from '$lib/utils/pull-request-utils';
  import { openWorkspaceLocalChanges } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';



  import { Skeleton } from '$lib/components/ui/skeleton';
  import { toast } from '$lib/components/ui/toast';

  import { syncWorkspaceSettings } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { logger } from '$lib/utils/client-logger';
  import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
  import {
  onMount,
  untrack,
} from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import {
  constructPrUrl as constructPrUrlUtil,
  computeTotalStats,
  mapWorkspacePRs,
} from './sidebar-changes-utils';
  import BranchDisplay from './BranchDisplay.svelte';
  import CommitDrawer from './CommitDrawer.svelte';
  import CommitsTimeline from './CommitsTimeline.svelte';
  import MergePanel from './MergePanel.svelte';
  import FileChangesSection from './FileChangesSection.svelte';
  import PostMergeActions from './PostMergeActions.svelte';
  import PRSection from './PRSection.svelte';
  import { store as appStore } from '$store/renderer/store';


  interface Props {
    workspaceId: string;
    /** Path of the currently active/selected file (for highlighting) */
    activeFilePath?: string | null;
    /** Whether the active file is from the staged list (true) or unstaged list (false) */
    activeFileStaged?: boolean | null;
    isAllChangesViewActive?: boolean;
    onOpenChange?: (change: TrackedChange) => void;
    onOpenFullPanel?: () => void;
    onOpenNote?: (noteId: string) => void;
    /** Callback to open the code review panel */
    onOpenCodeReview?: () => void;
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    isAllChangesViewActive = false,
    onOpenChange,
    onOpenFullPanel,
    onOpenNote,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onOpenCodeReview,
  }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const acceptChangesState$ = selectAcceptChangesState(workspaceIdStore);
  const pendingAutoAction$ = selectPendingAutoAction(workspaceIdStore);
  const postMergeState$ = selectPostMergeState(workspaceIdStore);
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);

  // Git state from Redux (reactive via workspaceIdStore)
  const gitAheadStore = selectGitAhead(workspaceIdStore);
  const gitBehindStore = selectGitBehind(workspaceIdStore);
  const gitStatusStore = selectGitStatus(workspaceIdStore);

  // File tracking from Redux
  const ftCurrentWsId$ = selectActiveWorkspaceId();
  const ftStagedChanges$ = selectFtStagedChanges(workspaceIdStore);
  const ftUnstagedChanges$ = selectFtUnstagedChanges(workspaceIdStore);
  const ftCommits$ = selectFtCommits(workspaceIdStore);
  const ftLoading$ = selectFtLoading(workspaceIdStore);
  const ftChangesTruncated$ = selectFtChangesTruncated(workspaceIdStore);
  const ftTotalChangesCount$ = selectFtTotalChangesCount(workspaceIdStore);

  const isLoading = $derived($ftLoading$ || (workspaceId && $ftCurrentWsId$ !== workspaceId));

  // Only use store data if workspace IDs match - prevents showing stale data during rapid switches
  const storeHasCorrectWorkspace = $derived($ftCurrentWsId$ === workspaceId);

  // Get data from Redux - use defensive checks for reactive updates
  // CRITICAL: Only use data when it's for the correct workspace
  const unstagedChanges = $derived(storeHasCorrectWorkspace ? ($ftUnstagedChanges$ ?? []) : []);
  const stagedChanges = $derived(storeHasCorrectWorkspace ? ($ftStagedChanges$ ?? []) : []);

  // Git status - use defensive checks for array operations during reactive updates
  const unpushedCount = $derived($gitAheadStore ?? 0);
  const allCommits = $derived($ftCommits$ ?? []);
  const commits = $derived((allCommits ?? []).filter((c) => !c.isPushed));
  const pushedCommits = $derived((allCommits ?? []).filter((c) => c.isPushed));

  // Workspace info for branch

  // Pull requests from workspace - use pullRequests array if available, else derive from activePullRequest
  // Construct the correct PR URL from repository info and PR number
  // This is more reliable than using the stored URL which may be incorrect
  const constructPrUrl = (prNumber: number, fallbackUrl?: string): string => {
    return constructPrUrlUtil(
      prNumber,
      $workspace?.repositoryOwner,
      $workspace?.repositoryName,
      fallbackUrl,
    );
  };

  const activePullRequest$ = selectWorkspaceActivePullRequest(workspaceIdStore);

  const pullRequests = $derived(
    mapWorkspacePRs(
      $workspace?.pullRequests,
      $activePullRequest$,
      constructPrUrl,
      getPRDisplayTitle,
    ),
  );
  const trunkBranch = $derived($workspace?.baseRef || 'main');
  const hasPushedCommits = $derived(pushedCommits.length > 0);

  // Truncation state - when there are more changes than we can display
  // Only show truncation warning if there are actual working changes being truncated
  // (not just when there are many committed changes)
  const rawChangesTruncated = $derived(storeHasCorrectWorkspace ? $ftChangesTruncated$ : false);
  const totalChangesCount = $derived(storeHasCorrectWorkspace ? $ftTotalChangesCount$ : 0);
  const workingChangesCount = $derived(unstagedChanges.length + stagedChanges.length);
  // Only show truncation banner if we're actually truncating working changes
  // (i.e., there are working changes AND the total exceeds what we can show)
  const changesTruncated = $derived(rawChangesTruncated && workingChangesCount > 0);
  const hiddenChangesCount = $derived(
    changesTruncated ? totalChangesCount - workingChangesCount : 0,
  );

  // Check if PR is merged - used to hide merge button
  const isPRMerged = $derived(pullRequests.length > 0 && pullRequests[0].status === 'merged');

  // Check if ALL PRs are merged - used to show archive button
  const areAllPRsMerged = $derived(
    pullRequests.length > 0 && pullRequests.every((pr) => pr.status === 'merged'),
  );

  // Check if there's an open PR - used to conditionally show Create PR vs Push Commits button
  const hasOpenPR = $derived(
    pullRequests.some((pr) => pr.status === 'open' || pr.status === 'draft'),
  );

  // Check if there are unpushed commits - commits is already filtered to unpushed only
  const hasUnpushedCommits = $derived(commits.length > 0);

  // Check if branches have diverged (need force push)
  const isDiverged = $derived($gitStatusStore?.diverged ?? false);

  // Branch state detection
  const isBehind = $derived(
    ($gitBehindStore ?? 0) > 0 && ($gitAheadStore ?? 0) === 0 && !isDiverged,
  );
  const behindCount = $derived($gitBehindStore ?? 0);

  // Note: PR status is automatically refreshed by AcceptChangesService.getStatus()
  // which fetches from GitHub and emits workspace:updated events.
  // The layout listens for these events and dispatches Redux actions to update workspace state.

  // Repository info for branch selector
  const repoPath = $derived($workspace?.repositoryPath || $workspace?.worktreePath || '');
  const repoType = $derived<'local' | 'github'>($workspace?.isRemote ? 'github' : 'local');

  // Loading states
  let isCommitting = $state(false);
  let hasLoadedForWorkspace = $state(false);
  let lastWorkspaceId: string | null = null;

  // Drawer/form states (collapsed by default)
  let commitDrawerOpen = $state(false);
  let mergeDrawerOpen = $state(false);
  let mergePanelRef: MergePanel | undefined = $state(undefined);
  let prSectionRef: PRSection | undefined = $state(undefined);
  // Post-merge state — read from Redux via selector
  const isMergedToTrunk = $derived($postMergeState$.isMergedToTrunk);
  const mergeHeadSha = $derived($postMergeState$.mergeHeadSha);
  const aheadOfTrunk = $derived($postMergeState$.aheadOfTrunk);
  const hasRemote = $derived($postMergeState$.hasRemote);
  const isContentMergedToTrunk = $derived($postMergeState$.isContentMergedToTrunk);
  const hasResetToTrunk = $derived($postMergeState$.hasResetToTrunk);

  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();

  // Git operation loading flag — used by the refresh button spinner
  const isRefreshingGitStatus = $derived($gitOps$.isRefreshingGitStatus);

  // Clear post-merge state when conditions change:
  // 1. hasResetToTrunk when PRs transition away from all-merged (e.g., new PR after reset)
  // 2. merge state when user makes new commits after an in-session merge
  $effect(() => {
    const shouldClearResetFlag = pullRequests.length > 0 && !areAllPRsMerged;
    const shouldClearMerge =
      mergeHeadSha && allCommits[0]?.hash && mergeHeadSha !== allCommits[0].hash;

    untrack(() => {
      if (shouldClearResetFlag) {
        const current = selectPostMergeState.select(appStore.state, workspaceId);
        if (current.hasResetToTrunk) {
          appStore.dispatch(setPostMergeState(workspaceId, { ...current, hasResetToTrunk: false }));
        }
      }
      if (shouldClearMerge) {
        const current = selectPostMergeState.select(appStore.state, workspaceId);
        appStore.dispatch(
          setPostMergeState(workspaceId, {
            ...current,
            isMergedToTrunk: false,
            mergeHeadSha: null,
            isContentMergedToTrunk: false,
          }),
        );
      }
    });
  });

  // Initialize GitHub auth state on mount
  onMount(() => {
    appStore.dispatch(initializeGitHubAuth());

    // Check if store is already loaded for this workspace on mount
    // This handles the case where the accordion is expanded after the store has already initialized
    const storeWsId = selectActiveWorkspaceId.select(appStore.state);
    const storeLoading = selectFtLoading.select(appStore.state, workspaceId);
    if (!storeLoading && storeWsId === workspaceId) {
      logger.debug(
        '[SidebarChangesPanel] Store already loaded on mount, setting hasLoadedForWorkspace',
        {
          workspaceId,
          storeWorkspaceId: storeWsId,
        },
      );
      hasLoadedForWorkspace = true;
    }
  });

  // Note: git:status-changed listener has been moved to the git Redux saga,
  // which listens to the IPC channel and dispatches loadGitStatus.

  // Consolidated effect for managing hasLoadedForWorkspace
  // This single effect handles both workspace changes AND load state changes
  // to avoid race conditions between separate effects
  $effect(() => {
    const storeWsId = $ftCurrentWsId$;
    const storeLoading = $ftLoading$;
    const workspaceChanged = lastWorkspaceId !== workspaceId;

    logger.debug('[SidebarChangesPanel] Checking load state', {
      workspaceId,
      storeWorkspaceId: storeWsId,
      storeLoading,
      isLoading,
      hasLoadedForWorkspace,
      workspaceChanged,
      lastWorkspaceId,
      idsMatch: storeWsId === workspaceId,
    });

    // If workspace changed, update tracking, sync settings, and reset loaded state
    if (workspaceChanged) {
      lastWorkspaceId = workspaceId;
      // Sync workspace settings for the new workspace
      appStore.dispatch(syncWorkspaceSettings(workspaceId as string));
      appStore.dispatch(recomputeAgentLocks(workspaceId as string));
      // Reset form state that is workspace-specific to prevent leaking between workspaces
      targetBranch = '';
      // Post-merge state is now read from Redux via selectPostMergeState — no manual restoration needed
      // (git operation loading flags auto-reset via Redux workspace-scoped state)
      // Clear file selection on workspace switch
      selectedFiles = new Set();
      // Reset PR discovery tracking for the new workspace so discovery can
      // run again (for PR-review workspaces on existing remote branches with no pushed commits).
      lastDiscoveredPushedCount = 0;
      hasAttemptedInitialDiscovery = false;
      // Only reset to false if the new workspace isn't already loaded
      // This prevents a brief flash when accordion is first opened for an already-loaded workspace
      if (storeLoading || storeWsId !== workspaceId) {
        hasLoadedForWorkspace = false;
      } else {
        // Workspace data is already loaded, set to true immediately
        hasLoadedForWorkspace = true;
      }
    } else if (!isLoading && storeWsId === workspaceId && !hasLoadedForWorkspace) {
      // Loading finished for current workspace
      hasLoadedForWorkspace = true;
    } else if (!storeLoading && storeWsId !== workspaceId && !hasLoadedForWorkspace) {
      // Recovery: Store completed loading for a DIFFERENT workspace than ours.
      // This can happen when stale callers (e.g., file-explorer-store during cleanup)
      // call setWorkspace() with an old workspace ID, hijacking the singleton store.
      // Re-trigger setWorkspace for our workspace to recover.
      logger.warn(
        '[SidebarChangesPanel] Store on wrong workspace, skipping recovery (activeWorkspaceId is source of truth)',
        {
          expected: workspaceId,
          actual: storeWsId,
        },
      );
    }
  });

  // Handle manual git status refresh
  async function handleRefreshGitStatus() {
    if (isRefreshingGitStatus) return;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isRefreshingGitStatus', true));
    const refreshStart = Date.now();

    // Timeout for git refresh operations (90 seconds)
    // This prevents infinite spinner if git operations hang (network issues, credentials, etc.)
    const REFRESH_TIMEOUT_MS = 90_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Invalidate cache and refresh stores
      gitCache.invalidate(`git-status-${workspaceId}`);

      // Create a timeout promise to prevent infinite spinner
      // We track the timeoutId so we can clear it when operations complete
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Git refresh timed out')),
          REFRESH_TIMEOUT_MS,
        );
      });

      // Race the refresh operations against the timeout
      await Promise.race([
        Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
          appStore.dispatch(refreshRequested(workspaceId)),
          // Also refresh aheadOfTrunk, hasRemote, and isContentMergedToTrunk for merged state detection
          Promise.resolve(appStore.dispatch(refreshAcceptChangesStatus(workspaceId))),
        ]),
        timeoutPromise,
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timed out')) {
        logger.warn(
          '[SidebarChangesPanel] Git refresh timed out - this may indicate network issues or pending credential prompts',
        );
      } else {
        logger.warn('[SidebarChangesPanel] Failed to refresh git status:', error);
      }
    } finally {
      // Clear the timeout to prevent memory leaks
      if (timeoutId) clearTimeout(timeoutId);

      // Ensure minimum visible duration for the spinner
      const elapsed = Date.now() - refreshStart;
      if (elapsed < 300) {
        await new Promise((resolve) => setTimeout(resolve, 300 - elapsed));
      }
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isRefreshingGitStatus', false));
    }
  }

  // Accept-changes status (aheadOfTrunk, hasRemote, etc.) is now fetched by
  // acceptChangesStatusSaga on workspaceMounted and refreshAcceptChangesStatus actions.

  // Track the last pushed commit count we triggered discovery for.
  // When pushed commits increase (e.g., agent pushes), we re-trigger discovery.
  // This is more robust than a one-shot boolean because it detects new pushes
  // that may have created a PR (via agent, CLI, GitHub website, etc.).
  let lastDiscoveredPushedCount = $state(0);

  // Track whether we've already attempted initial PR discovery for this workspace
  // (for workspaces on existing remote branches with no local pushed commits, e.g., PR review)
  let hasAttemptedInitialDiscovery = false;

  // Automatically discover PRs when workspace loads.
  // Re-triggers when pushed commit count changes (e.g., agent pushes new commits and creates a PR).
  // Discovery tracking (lastDiscoveredPushedCount, hasAttemptedInitialDiscovery) is reset
  // in the workspace-switch block of the consolidated load-state effect above.
  // Rate-limited by the PR status saga's built-in MIN_REFRESH_INTERVAL_MS (5s).
  $effect(() => {
    if (!hasLoadedForWorkspace) return;
    if (!$githubAuthIsAuthenticated$) return;

    const currentPushedCount = pushedCommits.length;

    if (currentPushedCount > 0) {
      if (currentPushedCount === lastDiscoveredPushedCount) return;
      lastDiscoveredPushedCount = currentPushedCount;
    } else {
      if (hasAttemptedInitialDiscovery || !hasRemote) return;
      hasAttemptedInitialDiscovery = true;
    }

    logger.debug('[SidebarChangesPanel] Auto-discovering PRs', { workspaceId });
    appStore.dispatch(refreshPRStatusRequested(workspaceId, false, false));
  });

  // Auto-close drawers when reactive conditions change
  $effect(() => {
    // Read all reactive deps outside untrack
    const shouldCloseCommit = commitDrawerOpen && !hasStaged;
    const shouldCloseMerge = mergeDrawerOpen && !hasStaged && !hasCommits;

    untrack(() => {
      if (shouldCloseCommit) commitDrawerOpen = false;
      if (shouldCloseMerge) mergeDrawerOpen = false;
    });
  });

  // Inline form states
  let commitMessage = $state('');
  let targetBranch = $state('');

  // Initialize target branch from reactive defaults
  $effect(() => {
    const shouldInitBranch = !targetBranch && trunkBranch;
    const newBranch = trunkBranch;

    untrack(() => {
      if (shouldInitBranch) targetBranch = newBranch;
    });
  });

  // Executor result handling is now in executor-result-saga.
  // The saga watches setExecutorState and updates form fields via Redux actions,
  // then dispatches pendingAutoAction for auto-commit/PR/merge workflows.

  // Sync commit message from Redux and handle pending auto-actions (executor-result-saga).
  // PRSection owns prTitle/prDescription sync internally.
  $effect(() => {
    const ac = $acceptChangesState$;
    const pending = $pendingAutoAction$;
    untrack(() => {
      if (ac.commitMessage && ac.commitMessage !== commitMessage) {
        commitMessage = ac.commitMessage;
      }

      // Handle pending auto-actions
      if (pending) {
        appStore.dispatch(setPendingAutoAction(workspaceId, null));
        if (pending.action === 'commit') {
          isCommitting = true;
          handleCommit(pending.workspaceId);
          commitDrawerOpen = false;
        } else if (pending.action === 'create-pr') {
          prSectionRef?.triggerCreatePR({
            workspaceId: pending.workspaceId,
            targetBranch: pending.targetBranch,
          });
        } else if (pending.action === 'merge') {
          if (mergePanelRef) {
            const opts = mergePanelRef.getMergeOptions();
            mergePanelRef.triggerMerge({ squash: opts.squash, localOnly: !opts.pushAfter });
          }
          mergeDrawerOpen = false;
        }
      }
    });
  });

  // Computed
  const hasUnstaged = $derived(unstagedChanges.length > 0);
  const hasStaged = $derived(stagedChanges.length > 0);
  const hasCommits = $derived(allCommits.length > 0);
  const hasPRs = $derived(pullRequests.length > 0);

  // Total files changed for "View All Changes" button
  const totalStats = $derived(computeTotalStats(unstagedChanges, stagedChanges, allCommits));
  const totalFilesChanged = $derived(totalStats.totalFilesChanged);
  const hasAnyChanges = $derived(totalFilesChanged > 0);

  // Check if workspace is "completed" - commits have been merged to trunk
  // This persists across refreshes since it's based on actual git state
  const hasNoLocalChanges = $derived(!hasUnstaged && !hasStaged && commits.length === 0);

  // Detect new work after a merge. Checks uncommitted changes, unpushed commits,
  // and pushed-but-not-PR'd commits (aheadOfTrunk). The aheadOfTrunk check is
  // guarded by !isContentMergedToTrunk because after a squash merge, aheadOfTrunk
  // is always > 0 (local SHAs differ from the squash commit) even without new work.
  const hasNewWorkAfterMerge = $derived(
    hasUnstaged ||
      hasStaged ||
      commits.length > 0 ||
      (aheadOfTrunk !== null && aheadOfTrunk > 0 && !isContentMergedToTrunk),
  );

  // Note: mergeHeadSha is ONLY set during in-session merges (see merge handlers below at lines ~2354/~2423).
  // For external merges (areAllPRsMerged, isContentMergedToTrunk), we do NOT capture mergeHeadSha
  // because detection may happen after the user made new commits, and capturing HEAD at detection
  // time would record the wrong SHA (the new commit, not the actual merge point).
  // Instead, the reset button uses isContentMergedToTrunk as a guard for external merges.

  // Open all changes in main panel
  function handleOpenAllChanges() {
    appStore.dispatch(openWorkspaceLocalChanges(workspaceId));
  }

  // Multi-select state for bulk staging/unstaging
  // Keys are "{staged}:{path}" to distinguish between same file in staged vs unstaged
  let selectedFiles = $state(new Set<string>());
  let lastClickedFile = $state<{ path: string; staged: boolean } | null>(null);
  // Focused file for keyboard navigation (separate from selection)
  let focusedFile = $state<{ path: string; staged: boolean } | null>(null);

  /** Clear all selections */
  function clearSelection() {
    selectedFiles = new Set();
  }

  // Note: selection is cleared in the consolidated load-state effect on workspace change

  // ============================================================================
  // KEYBOARD NAVIGATION (VSCode-style)
  // ============================================================================

  // Reference to the changes panel container for focus management
  let changesPanelContainer: HTMLDivElement | undefined = $state(undefined);

  // Get all files as a flat list for keyboard navigation
  // Order: unstaged files first, then staged files
  const allFilesFlat = $derived([
    ...unstagedChanges.map((c) => ({ path: c.relativePath, staged: false })),
    ...stagedChanges.map((c) => ({ path: c.relativePath, staged: true })),
  ]);

  // Get the index of the focused file in the flat list
  const focusedIndex = $derived(() => {
    if (!focusedFile) return -1;
    return allFilesFlat.findIndex(
      (f) => f.path === focusedFile!.path && f.staged === focusedFile!.staged,
    );
  });

  // Scroll focused item into view
  function scrollFocusedIntoView(path: string, staged: boolean) {
    const key = `${staged ? 'staged' : 'unstaged'}:${path}`;
    const element = changesPanelContainer?.querySelector(`[data-file-key="${key}"]`);
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Set focus to a file by index
  function setFocusedByIndex(index: number) {
    if (index >= 0 && index < allFilesFlat.length) {
      const file = allFilesFlat[index];
      focusedFile = { path: file.path, staged: file.staged };
      scrollFocusedIntoView(file.path, file.staged);
    }
  }

  // Handle keyboard navigation
  function handleChangesKeydown(e: KeyboardEvent) {
    // Don't handle if we're in an input or textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const fileCount = allFilesFlat.length;
    if (fileCount === 0) return;

    const currentIndex = focusedIndex();

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (currentIndex === -1) {
          // No focus yet, focus first item
          setFocusedByIndex(0);
        } else if (currentIndex < fileCount - 1) {
          const newIndex = currentIndex + 1;
          if (e.shiftKey) {
            // Extend selection
            extendSelectionTo(newIndex);
          } else {
            setFocusedByIndex(newIndex);
          }
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        if (currentIndex === -1) {
          // No focus yet, focus last item
          setFocusedByIndex(fileCount - 1);
        } else if (currentIndex > 0) {
          const newIndex = currentIndex - 1;
          if (e.shiftKey) {
            // Extend selection
            extendSelectionTo(newIndex);
          } else {
            setFocusedByIndex(newIndex);
          }
        }
        break;
      }

      case 'Home': {
        e.preventDefault();
        if (e.shiftKey) {
          extendSelectionTo(0);
        } else {
          setFocusedByIndex(0);
        }
        break;
      }

      case 'End': {
        e.preventDefault();
        if (e.shiftKey) {
          extendSelectionTo(fileCount - 1);
        } else {
          setFocusedByIndex(fileCount - 1);
        }
        break;
      }

      case 'Enter':
      case ' ': {
        // Open the focused file
        e.preventDefault();
        if (focusedFile) {
          const change = focusedFile.staged
            ? stagedChanges.find((c) => c.relativePath === focusedFile!.path)
            : unstagedChanges.find((c) => c.relativePath === focusedFile!.path);
          if (change) {
            handleFileClick(focusedFile.path, undefined, focusedFile.staged);
          }
        }
        break;
      }

      case 'Escape': {
        if (selectedFiles.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        break;
      }

      case 'a': {
        // Cmd/Ctrl+A to select all in current section
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          if (focusedFile) {
            selectAllInSection(focusedFile.staged);
          }
        } else {
          // Type-ahead search
          handleTypeAhead(e.key, currentIndex, fileCount);
        }
        break;
      }

      default: {
        // Type-ahead search: single printable character jumps to matching item
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          handleTypeAhead(e.key, currentIndex, fileCount);
        }
        break;
      }
    }
  }

  // Extend selection from anchor to target index
  function extendSelectionTo(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= allFilesFlat.length) return;

    const targetFile = allFilesFlat[targetIndex];
    const newSelection = new Set(selectedFiles);

    // If we have a last clicked file (anchor), select range from anchor to target
    if (lastClickedFile) {
      const anchorIndex = allFilesFlat.findIndex(
        (f) => f.path === lastClickedFile!.path && f.staged === lastClickedFile!.staged,
      );

      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);

        for (let i = start; i <= end; i++) {
          const file = allFilesFlat[i];
          const key = `${file.staged ? 'staged' : 'unstaged'}:${file.path}`;
          newSelection.add(key);
        }
      }
    } else {
      // No anchor, just add the target
      const key = `${targetFile.staged ? 'staged' : 'unstaged'}:${targetFile.path}`;
      newSelection.add(key);
      lastClickedFile = { path: targetFile.path, staged: targetFile.staged };
    }

    selectedFiles = newSelection;
    focusedFile = { path: targetFile.path, staged: targetFile.staged };
    scrollFocusedIntoView(targetFile.path, targetFile.staged);
  }

  // Select all files in a section (staged or unstaged)
  function selectAllInSection(staged: boolean) {
    const changes = staged ? stagedChanges : unstagedChanges;
    const newSelection = new Set(selectedFiles);

    for (const change of changes) {
      const key = `${staged ? 'staged' : 'unstaged'}:${change.relativePath}`;
      newSelection.add(key);
    }

    selectedFiles = newSelection;
  }

  // Type-ahead search state
  let typeAheadBuffer = '';
  let typeAheadTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleTypeAhead(key: string, currentIndex: number, fileCount: number) {
    // Clear previous timeout
    if (typeAheadTimeout) {
      clearTimeout(typeAheadTimeout);
    }

    // Add to buffer
    typeAheadBuffer += key.toLowerCase();

    // Set timeout to clear buffer after 500ms of no typing
    typeAheadTimeout = setTimeout(() => {
      typeAheadBuffer = '';
    }, 500);

    // Find matching item
    const searchStr = typeAheadBuffer;

    // Start searching from current position + 1, wrap around
    for (let offset = 1; offset <= fileCount; offset++) {
      const idx = (currentIndex + offset) % fileCount;
      const file = allFilesFlat[idx];
      const fileName = file.path.split('/').pop()?.toLowerCase() || '';

      if (fileName.startsWith(searchStr)) {
        setFocusedByIndex(idx);
        return;
      }
    }

    // If no match found with multi-char, try just the last character
    if (searchStr.length > 1) {
      const lastChar = searchStr[searchStr.length - 1];
      for (let offset = 1; offset <= fileCount; offset++) {
        const idx = (currentIndex + offset) % fileCount;
        const file = allFilesFlat[idx];
        const fileName = file.path.split('/').pop()?.toLowerCase() || '';

        if (fileName.startsWith(lastChar)) {
          setFocusedByIndex(idx);
          typeAheadBuffer = lastChar;
          return;
        }
      }
    }
  }

  // Find original TrackedChange from path
  function findChange(path: string, staged: boolean): TrackedChange | undefined {
    const list = staged ? stagedChanges : unstagedChanges;
    return list.find((c) => c.relativePath === path);
  }

  async function handleCommit(targetWorkspaceId?: string) {
    const wsId = targetWorkspaceId ?? workspaceId;
    if (!commitMessage.trim()) return;
    isCommitting = true;
    try {
      const result = await backgroundGitActionsService.commit({
        workspaceId: wsId,
        commitMessage: commitMessage.trim(),
      });

      if (result.success) {
        commitMessage = '';
        commitDrawerOpen = false;
        // Toast is handled by git:op-completed event in +layout.svelte
      } else {
        toast.error(result.error || 'Failed to commit');
      }
    } catch {
      toast.error('Failed to commit');
    } finally {
      isCommitting = false;
    }
  }

  /**
   * Opens a terminal to run the rebase command, so the user can see the output
   * and resolve any conflicts if needed.
   */
  async function openRebaseTerminal() {
    if (!workspaceId) return;

    const worktreePath = $workspace?.worktreePath || $workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error('Cannot find space path');
      return;
    }

    try {
      // Rebase command: fetch origin first, then rebase onto origin/trunk
      const rebaseCommand = `git fetch origin ${targetBranch || trunkBranch} && git rebase origin/${targetBranch || trunkBranch}`;

      // Create terminal with the rebase command
      const result = await invoke<any>('terminal:createWithCommand', {
        workspaceId,
        command: rebaseCommand,
        cwd: worktreePath,
        title: `Rebase onto ${targetBranch || trunkBranch}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        const terminalTitle = `Rebase onto ${targetBranch || trunkBranch}`;
        appStore.dispatch(addTerminal(workspaceId, result.terminalId, terminalTitle));
        appStore.dispatch(openTerminalOverlay(workspaceId, result.terminalId));

        toast.success('Rebase started in terminal', {
          description: 'After rebase completes, retry the merge.',
        });
      } else {
        toast.error(result.error || 'Failed to open terminal');
      }
    } catch (error) {
      logger.error('Failed to open rebase terminal', error as Error);
      toast.error('Failed to open terminal');
    }
  }

  function handleFileClick(path: string, _commitHash?: string, staged?: boolean) {
    const change = findChange(path, staged ?? false);
    if (change) onOpenChange?.(change);
  }

  // Determine if trunk can be changed (only before first push)
  const canChangeTrunk = $derived(!hasPushedCommits && unpushedCount === 0);

  // Track if we're in the middle of a workspace switch to disable animations
  let isWorkspaceSwitching = $state(false);
  let workspaceSwitchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Detect workspace switches and temporarily disable animations.
  // Uses $effect.pre so the flag is set BEFORE DOM updates, ensuring
  // isWorkspaceSwitching is true before FileChangesSection re-renders.
  $effect.pre(() => {
    // Read workspaceId to create dependency
    void workspaceId;

    // When workspace changes, set switching flag
    untrack(() => {
      if (workspaceSwitchTimeout) {
        clearTimeout(workspaceSwitchTimeout);
      }
      isWorkspaceSwitching = true;
      workspaceSwitchTimeout = setTimeout(() => {
        isWorkspaceSwitching = false;
        workspaceSwitchTimeout = null;
      }, 300); // Disable animations for 300ms during $workspace switch
    });
  });
</script>

<div class="flex flex-col h-full flex-1 min-h-0 max-h-full">
  <div class="flex-1 flex flex-col min-h-0">
    {#if !hasLoadedForWorkspace}
      <!-- Loading skeleton with timeline (shown during initial load or workspace switch) -->
      <div class="flex-1 overflow-y-auto pt-3 pb-20 pl-3 pr-3">
        <div class="relative">
          <div class="absolute left-0 top-2 bottom-2 w-px bg-border/30"></div>
          {#each [0, 1, 2, 3] as i (i)}
            <div class="relative pl-4 mb-4">
              <div class="absolute -left-1 top-1 w-2 h-2 rounded-full bg-muted"></div>
              <Skeleton class="h-3 w-16 mb-2" />
              {#if i < 2}
                <Skeleton class="h-5 w-full rounded mb-1" />
                <Skeleton class="h-5 w-3/4 rounded" />
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <!-- Timeline layout - always show all sections -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={changesPanelContainer}
        class="sidebar-changes-container min-h-full flex flex-col flex-1 overflow-y-auto pl-3 pr-3 outline-none"
        tabindex="0"
        role="listbox"
        aria-label="File changes"
        onkeydown={handleChangesKeydown}
      >
        <div class="branch-labels w-full flex justify-between mb-1 mt-1">
          <p class="text-subtle leading-snug text-ui">Your code lives in:</p>
          <p class="text-subtle leading-snug text-ui">and will be merged into:</p>
        </div>

        <BranchDisplay {workspaceId} {trunkBranch} {repoPath} {repoType} {canChangeTrunk} />

        <div class="flex items-center mb-4 -ml-1 gap-1.25 h-7">
          <button
            type="button"
            class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer z-10"
            onclick={handleRefreshGitStatus}
            disabled={isRefreshingGitStatus}
            title="Refresh git status"
          >
            <Fa
              icon={faArrowsRotate}
              class="text-subtle {isRefreshingGitStatus ? 'animate-spin' : ''}"
              size={10}
            />
          </button>

          <!-- View All Changes Button -->
          {#if hasAnyChanges}
            {@const isActive = isAllChangesViewActive}
            <button
              onclick={handleOpenAllChanges}
              class="flex flex-1 items-center border gap-2 pr-2 py-1.5 text-subtle rounded-sm transition-colors group cursor-pointer min-w-0 {isActive
                ? 'bg-background text-foreground border-border shadow-xs pl-2'
                : 'border-transparent'}
                "
            >
              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <!-- <Fa icon={faFolderOpen} class="opacity-30" size="xs" /> -->
                <span class="text-ui truncate min-w-0 text-left flex-1">
                  {totalFilesChanged} file{totalFilesChanged !== 1 ? 's' : ''} changed in Space
                </span>
                <!-- <LineChangesBadge additions={totalAdditions} deletions={totalDeletions} size="xs" /> -->
              </div>
            </button>
          {:else}
            <div
              class="flex flex-1 items-center gap-2 pr-2 py-1.5 text-subtle rounded-sm transition-colors group cursor-pointer min-w-0"
            >
              <span class="text-ui truncate min-w-0 text-left flex-1">No changes yet</span>
            </div>
          {/if}

          <!-- Code Review Button -->
          <!-- {#if hasAnyChanges}
            <Tooltip content="Open AI code review" side="bottom">
              <button
                onclick={handleOpenCodeReviewClick}
                class="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground rounded-sm transition-colors cursor-pointer border border-transparent hover:border-border hover:bg-background"
              >
                <Fa icon={faMagnifyingGlass} class="opacity-50" size="xs" />
                <span class="text-xs">Review</span>
              </button>
            </Tooltip>
          {/if} -->
        </div>

        <!-- Truncation warning banner -->
        {#if changesTruncated}
          <div
            class="mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-600 dark:text-amber-400"
          >
            <span class="font-medium"
              >Showing {unstagedChanges.length + stagedChanges.length} of {totalChangesCount} changes.</span
            >
            {#if hiddenChangesCount > 0}
              <span class="opacity-80">
                {hiddenChangesCount} older change{hiddenChangesCount !== 1 ? 's' : ''} hidden to improve
                performance.
              </span>
            {/if}
          </div>
        {/if}

        <div class="relative flex-1 flex flex-col pb-2 w-full">
          <!-- Vertical timeline line -->
          <div class="absolute left-1 top-2 bottom-0 w-px bg-border dark:bg-border/50"></div>

          <FileChangesSection
            {workspaceId}
            {activeFilePath}
            {activeFileStaged}
            {focusedFile}
            {isWorkspaceSwitching}
            {onOpenChange}
            {onOpenNote}
            onFileClicked={(path, staged) => {
              focusedFile = { path, staged };
              if (selectedFiles.size > 0) {
                clearSelection();
              }
              lastClickedFile = { path, staged };
            }}
          />

          <CommitDrawer
            {workspaceId}
            bind:commitMessage
            bind:isCommitting
            bind:commitDrawerOpen
            {hasStaged}
            {stagedChanges}
            onCommit={() => handleCommit()}
          />

          <!-- COMMITS SECTION -->
          <CommitsTimeline
            {workspaceId}
            {activeFilePath}
            {activeFileStaged}
            pullRequestCount={pullRequests.length}
          />

          {#snippet mergePanelContent()}
            <MergePanel
              {workspaceId}
              {hasOpenPR}
              {hasRemote}
              {pullRequests}
              {hasStaged}
              {hasCommits}
              {allCommits}
              {stagedChanges}
              {trunkBranch}
              {targetBranch}
              {repoPath}
              {repoType}
              {commitMessage}
              onCommitMessageChange={(v) => (commitMessage = v)}
              onMergeComplete={() => {
                mergeDrawerOpen = false;
              }}
              onOpenRebaseTerminal={openRebaseTerminal}
              bind:this={mergePanelRef}
            />
          {/snippet}

          <PRSection
            {workspaceId}
            {activeFilePath}
            {activeFileStaged}
            {hasStaged}
            {hasUnstaged}
            {hasCommits}
            {hasOpenPR}
            {hasRemote}
            {hasPRs}
            {pullRequests}
            {commits}
            {pushedCommits}
            {allCommits}
            {stagedChanges}
            {trunkBranch}
            {targetBranch}
            {repoPath}
            {repoType}
            {commitMessage}
            {hasUnpushedCommits}
            {unpushedCount}
            {hasPushedCommits}
            {isDiverged}
            {isBehind}
            {behindCount}
            {isMergedToTrunk}
            {areAllPRsMerged}
            {hasResetToTrunk}
            {isContentMergedToTrunk}
            {hasNewWorkAfterMerge}
            {isPRMerged}
            {mergeDrawerOpen}
            onMergeDrawerToggle={(open) => {
              mergeDrawerOpen = open;
            }}
            {onOpenFullPanel}
            {onOpenChange}
            {mergePanelContent}
            bind:this={prSectionRef}
          />

          <!-- Post-merge options - shown when workspace is completed (commits merged to trunk) -->
          {#if (isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) && (!mergeHeadSha || mergeHeadSha === allCommits[0]?.hash) && !hasNewWorkAfterMerge}
            <PostMergeActions {workspaceId} {hasNoLocalChanges} {trunkBranch} />
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .sidebar-changes-container {
    container-type: inline-size;
  }

  @container (max-width: 250px) {
    .branch-labels {
      display: none;
    }
  }
</style>
