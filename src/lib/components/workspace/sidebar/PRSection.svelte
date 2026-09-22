<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * PRSection - Pull request creation, push/pull/sync, force push, rebase, connect remote, PR list
   * Manages all PR-related UI state and handlers.
   */
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    executeBackgroundAgent,
    cancelExecution,
  } from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
  import { ChangeStage, type CommitInfo, type TrackedChange } from '$features/file-tracking/types';
  import {
    refreshRequested,
    setSidebarCreatePRWhenReady,
    clearOlderCommits as ftClearOlderCommits,
  } from '$store/renderer/slices/changes/changes-slice';
  import { gitCache } from '$features/git/git-cache';
  import {
    addGitRemoteRequested,
    createPullRequestRequested,
    executeAcceptChangesRequested,
    loadCommitDetails,
    loadGitStatus,
    pullGitRequested,
    pushGitRequested,
    readGitFileRequested,
    refreshPullRequestRequested,
  } from '$store/renderer/slices/git/git-slice';
  import {
    selectGitAhead,
    selectGitBehind,
    selectCommitDetailsEntries,
    selectGitFileRead,
    selectGitMutationRequest,
    selectPostMergeState,
    selectGitOperationFlags,
  } from '$store/renderer/slices/git/git-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { handleLink } from '$features/navigation/link-handler';

  import {
    selectSidebarCreatePRWhenReady,
    selectAcceptChangesState,
  } from '$store/renderer/slices/changes/changes-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { updateWorkspaceRequested } from '$store/renderer/slices/workspace/workspace-slice';

  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Textarea } from '$lib/components/ui/textarea';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { logger } from '$lib/utils/client-logger';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    faArrowDown,
    faArrowsRotate,
    faArrowUpRightFromSquare,
    faCheck,
    faChevronDown,
    faCodeMerge,
    faCodePullRequest,
    faEye,
    faLink,
    faRobot,
    faStop,
  } from '@fortawesome/free-solid-svg-icons';
  import { untrack } from 'svelte';
  import { readable, writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from '$lib/motion';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import { aggregatePRFiles, getPRStatusTooltip } from './sidebar-changes-utils';
  import TimelineDivider from './TimelineDivider.svelte';
  import TimelineSection from './TimelineSection.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    activeFilePath?: string | null;
    activeFileStaged?: boolean | null;
    hasStaged: boolean;
    hasUnstaged: boolean;
    hasCommits: boolean;
    hasOpenPR: boolean;
    hasRemote: boolean;
    hasPRs: boolean;
    pullRequests: PRInfo[];
    /** PRs attributed to secondary git roots — the "Other PRs" sub-section
     * (monorepo#2053). */
    otherRootPRs?: PRInfo[];
    /** Monitor rows attributable to no known root — the "Other Tracked PRs"
     * sub-section (monorepo#2053). */
    otherTrackedPRs?: PRInfo[];
    commits: any[];
    pushedCommits: any[];
    allCommits: any[];
    stagedChanges: TrackedChange[];
    trunkBranch: string;
    targetBranch: string;
    repoPath: string;
    repoType: 'local' | 'github';
    commitMessage: string;
    hasUnpushedCommits: boolean;
    unpushedCount: number;
    hasPushedCommits: boolean;
    isDiverged: boolean;
    isBehind: boolean;
    behindCount: number;
    isMergedToTrunk: boolean;
    areAllPRsMerged: boolean;
    hasResetToTrunk: boolean;
    isContentMergedToTrunk: boolean;
    hasNewWorkAfterMerge: boolean;
    isPRMerged: boolean;
    /** Merge drawer open state for coordination */
    mergeDrawerOpen: boolean;
    onMergeDrawerToggle: (open: boolean) => void;
    onOpenFullPanel?: () => void;
    onOpenChange?: (change: TrackedChange) => void;
    /** Snippet for merge panel content */
    mergePanelContent?: import('svelte').Snippet;
    /** Render only the read-only PR list (no create-PR/push/merge dividers,
     * no local-files expansion) — the secondary-root browsing view
     * (monorepo#2053). */
    listOnly?: boolean;
  }

  let {
    workspaceId,
    activeFilePath = null,
    activeFileStaged = null,
    hasStaged,
    hasUnstaged: _hasUnstaged,
    hasCommits,
    hasOpenPR,
    hasRemote,
    hasPRs,
    pullRequests,
    otherRootPRs = [],
    otherTrackedPRs = [],
    commits,
    pushedCommits,
    allCommits,
    stagedChanges,
    trunkBranch,
    targetBranch,
    repoPath,
    repoType,
    commitMessage: _commitMessage,
    hasUnpushedCommits,
    unpushedCount,
    hasPushedCommits: _hasPushedCommits,
    isDiverged,
    isBehind,
    behindCount,
    isMergedToTrunk,
    areAllPRsMerged,
    hasResetToTrunk,
    isContentMergedToTrunk,
    hasNewWorkAfterMerge,
    isPRMerged,
    mergeDrawerOpen,
    onMergeDrawerToggle,
    onOpenFullPanel,
    onOpenChange: _onOpenChange,
    mergePanelContent,
    listOnly = false,
  }: Props = $props();

  // Redux selectors
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  // Agent attribution for monitored PR rows (PROTOCOL §6.9).
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);

  /** Display name of the agent owning a monitored PR row, if resolvable. */
  function monitorAgentName(agentId: string | undefined): string | undefined {
    if (!agentId) return undefined;
    return $workspaceAgents$.find((a) => String(a.id) === agentId)?.name;
  }
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const createPRWhenReady$ = selectSidebarCreatePRWhenReady(workspaceIdStore);
  const acceptChangesState$ = selectAcceptChangesState(workspaceIdStore);
  const postMergeState$ = selectPostMergeState(workspaceIdStore);
  const prExecState$ = selectExecutorState(workspaceIdStore, readable('pr'));
  const gitAheadStore = selectGitAhead(workspaceIdStore);
  const gitBehindStore = selectGitBehind(workspaceIdStore);
  const commitDetailsEntries$ = selectCommitDetailsEntries(workspaceIdStore);
  const prFilePathStore = writable('');
  const prOldRefStore = writable('');
  const prNewRefStore = writable('HEAD');
  const prOldFileRead$ = selectGitFileRead(workspaceIdStore, prFilePathStore, prOldRefStore);
  const prNewFileRead$ = selectGitFileRead(workspaceIdStore, prFilePathStore, prNewRefStore);
  const createPrRequest$ = selectGitMutationRequest(workspaceIdStore, readable('create-pr'));
  const rebaseRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('rebase-onto-trunk'),
  );
  const addRemoteRequest$ = selectGitMutationRequest(workspaceIdStore, readable('add-remote'));
  const pushRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('push'),
  );
  const forcePushRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('push'),
    readable('force'),
  );
  const pullRequest$ = selectGitMutationRequest(workspaceIdStore, readable('pull'));

  // Git operation flags
  const isPushing = $derived($gitOps$.isPushing);
  const isPulling = $derived($gitOps$.isPulling);
  const isForcePushing = $derived($gitOps$.isForcePushing);
  const isRebasing = $derived($gitOps$.isRebasing);
  const isRefreshingPR = $derived($gitOps$.isRefreshingPR);

  // PR generation state
  const isGeneratingPR = $derived($prExecState$.status === 'running');
  const prAgentId = $derived($prExecState$.agentId);

  // Post-merge state
  const aheadOfTrunk = $derived($postMergeState$.aheadOfTrunk);
  const behindTrunk = $derived($postMergeState$.behindTrunk);
  const hasConflicts = $derived($postMergeState$.hasConflicts);

  // Panel layout manager
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // PR files derived from pushed commits. The commit list payload is metadata-only
  // (PROTOCOL §5.19), so the saga-owned commit-detail collection supplies files.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below tracks later changes
  let prCacheWorkspaceId = workspaceId;
  $effect(() => {
    if (workspaceId !== prCacheWorkspaceId) {
      prCacheWorkspaceId = workspaceId;
      expandedPRs = new Set();
    }
  });

  const resolvedPushedCommits = $derived(
    (pushedCommits as CommitInfo[]).map((c) => {
      const details = $commitDetailsEntries$.find((entry) => entry.commitHash === c.hash)?.data;
      return c.files || !details ? c : { ...c, files: details.files };
    }),
  );
  const prFiles = $derived(aggregatePRFiles(resolvedPushedCommits));
  // Whether any pushed commit's file list is still unknown (unfetched or in
  // flight) — the chevron stays visible until we know the PR has no files.
  const prFilesUnknown = $derived(
    (pushedCommits as CommitInfo[]).some(
      (c) => !c.files && !$commitDetailsEntries$.find((entry) => entry.commitHash === c.hash)?.data,
    ),
  );
  const prTotalAdditions = $derived(prFiles.reduce((sum, f) => sum + f.additions, 0));
  const prTotalDeletions = $derived(prFiles.reduce((sum, f) => sum + f.deletions, 0));

  function fetchPRCommitFilesIfNeeded() {
    if (!workspaceId) return;
    for (const commit of pushedCommits as CommitInfo[]) {
      const entry = $commitDetailsEntries$.find(
        (candidate) => candidate.commitHash === commit.hash,
      );
      if (commit.files || entry?.loading || entry?.data) continue;
      appStore.dispatch(loadCommitDetails(workspaceId, commit.hash));
    }
  }

  // Pushed commits arriving while a PR is already expanded (a push landing
  // mid-view) get their files fetched too. Gated on user interaction; the
  // store reads are untracked so failures retry only on an explicit re-expand.
  $effect(() => {
    if (expandedPRs.size > 0 && pushedCommits.length > 0) {
      untrack(() => fetchPRCommitFilesIfNeeded());
    }
  });

  // Local state
  let prDrawerOpen = $state(false);
  let prTitle = $state('');
  let prDescription = $state('');
  let isCreatingPR = $state(false);
  let forcePushDrawerOpen = $state(false);
  let expandedPRs = $state<Set<string>>(new Set());
  let connectRemote = $state({ drawerOpen: false, url: '', adding: false });
  let pendingActionAfterAuth = $state<'create-pr' | 'refresh-pr' | null>(null);
  let pendingPRWorkspaceId: string | null = null;
  let authBannerKey = $state(0);
  let pendingCreatePrVersion = 0;
  let pendingRebaseVersion = 0;
  let pendingAddRemoteVersion = 0;
  let pendingPushVersion = 0;
  let pendingForcePushVersion = 0;
  let pendingPullVersion = 0;
  let pendingPrFile: { path: string; stats?: { additions: number; deletions: number } } | null =
    $state(null);

  $effect(() => {
    const request = $createPrRequest$;
    isCreatingPR = request?.loading ?? false;
    if (!request || request.loading || request.version !== pendingCreatePrVersion) return;
    pendingCreatePrVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(
        request.error ||
          (request.data && 'error' in request.data ? request.data.error : undefined) ||
          m.workspace_prCreator_createFailed_error(),
      );
      return;
    }
    prTitle = '';
    prDescription = '';
    prDrawerOpen = false;
  });

  $effect(() => {
    const request = $rebaseRequest$;
    if (!request || request.loading || request.version !== pendingRebaseVersion) return;
    pendingRebaseVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(
        request.error ||
          (request.data && 'error' in request.data ? request.data.error : undefined) ||
          m.workspace_prSection_rebaseFailed_error(),
      );
      return;
    }
    appStore.dispatch(ftClearOlderCommits(workspaceId));
    if ('result' in request.data && request.data.result?.newBaseSha) {
      appStore.dispatch(
        updateWorkspaceRequested(workspaceId, { baseCommitSha: request.data.result.newBaseSha }),
      );
    }
    toast.success(m.workspace_prSection_rebasedOnto_label({ branch: trunkBranch }));
  });

  $effect(() => {
    const request = $addRemoteRequest$;
    connectRemote.adding = request?.loading ?? false;
    if (!request || request.loading || request.version !== pendingAddRemoteVersion) return;
    pendingAddRemoteVersion = 0;
    if (request.error || !request.data) {
      toast.error(
        m.workspace_prSection_addRemoteFailed_error({
          error: request.error ?? m.workspace_prSection_unknownError_label(),
        }),
      );
      return;
    }
    toast.success(m.workspace_prSection_remoteAdded_label());
    connectRemote.drawerOpen = false;
    connectRemote.url = '';
  });

  $effect(() => {
    const request = $pushRequest$;
    if (!request || request.loading || request.version !== pendingPushVersion) return;
    pendingPushVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(
        request.error ||
          (request.data && 'error' in request.data ? request.data.error : undefined) ||
          m.workspace_prSection_pushFailed_error(),
      );
    }
  });

  $effect(() => {
    const request = $forcePushRequest$;
    if (!request || request.loading || request.version !== pendingForcePushVersion) return;
    pendingForcePushVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      toast.error(
        request.error ||
          (request.data && 'error' in request.data ? request.data.error : undefined) ||
          m.workspace_prSection_forcePushFailed_error(),
      );
      return;
    }
    toast.warning(m.workspace_prSection_forcePushDone_label());
    forcePushDrawerOpen = false;
    gitCache.invalidate(`git-status-${workspaceId}`);
    appStore.dispatch(loadGitStatus(workspaceId, true));
    appStore.dispatch(refreshRequested(workspaceId, true));
  });

  $effect(() => {
    const request = $pullRequest$;
    if (!request || request.loading || request.version !== pendingPullVersion) return;
    pendingPullVersion = 0;
    if (request.error || !request.data || !('success' in request.data) || !request.data.success) {
      const error =
        request.error ||
        (request.data && 'error' in request.data ? request.data.error : undefined) ||
        m.workspace_prSection_unknownError_label();
      toast.error(m.workspace_prSection_pullFailed_error({ error }));
      return;
    }
    toast.success(m.workspace_prSection_pullSuccess_label());
    gitCache.invalidateWorkspace(workspaceId as WorkspaceId);
    appStore.dispatch(loadGitStatus(workspaceId, true));
  });

  $effect(() => {
    const pending = pendingPrFile;
    const oldRead = $prOldFileRead$;
    const newRead = $prNewFileRead$;
    if (!pending || !oldRead || !newRead || oldRead.loading || newRead.loading) return;
    if (oldRead.error || newRead.error || oldRead.data === null || newRead.data === null) {
      logger.error('[handlePRFileClick] Failed to fetch file content', {
        filePath: pending.path,
        error: oldRead.error ?? newRead.error,
      });
      pendingPrFile = null;
      return;
    }
    const change: TrackedChange = {
      id: `pr-file:${pending.path}`,
      file: pending.path,
      relativePath: pending.path,
      stage: ChangeStage.Committed,
      stats: pending.stats ?? { additions: 0, deletions: 0 },
      content: { oldContent: oldRead.data, newContent: newRead.data, diff: '' },
      commitHash: 'PR',
      attribution: { timestamp: Date.now() },
    };
    pendingPrFile = null;
    appStore.dispatch(openWorkspaceDiff(workspaceId, change));
  });

  // Auto-close PR drawer when nothing to show
  $effect(() => {
    const shouldClose = prDrawerOpen && !hasStaged && !hasCommits;
    if (shouldClose) prDrawerOpen = false;
  });

  // Sync PR title/description from accept-changes state
  $effect(() => {
    const ac = $acceptChangesState$;
    if (ac.prTitle && ac.prTitle !== prTitle) {
      prTitle = ac.prTitle;
    }
    if (ac.prDescription && ac.prDescription !== prDescription) {
      prDescription = ac.prDescription;
    }
  });

  // Close drawers on workspace switch
  $effect(() => {
    void workspaceId;
    prDrawerOpen = false;
    forcePushDrawerOpen = false;
    connectRemote.drawerOpen = false;
  });

  // Helper to get current workspace
  function getCurrentWorkspace() {
    return selectWorkspaceById.select(appStore.state, workspaceId);
  }

  function handleOpenFile(relativePath: string) {
    const fileName = relativePath.split('/').pop() || relativePath;
    panelLayoutManager.openTab({
      type: 'file',
      title: fileName,
      closable: true,
      filePath: relativePath,
      workspaceId,
    });
  }

  // --- PR Handlers ---
  function handleRefreshPRStatus() {
    if (isRefreshingPR) return;
    if (!$githubAuthIsAuthenticated$) {
      appStore.dispatch(initializeGitHubAuth());
    }
    if (!$githubAuthIsAuthenticated$) {
      pendingActionAfterAuth = 'refresh-pr';
      toast.info(m.workspace_prSection_connectGithub_label());
      return;
    }
    appStore.dispatch(refreshPullRequestRequested(workspaceId));
  }

  function handleCreatePR(opts?: {
    workspaceId?: string;
    targetBranch?: string;
    prTitle?: string;
    prDescription?: string;
  }) {
    const titleToUse = (opts?.prTitle ?? prTitle).trim();
    const descriptionToUse = (opts?.prDescription ?? prDescription).trim();
    if (!titleToUse) return;
    const wsId = opts?.workspaceId ?? workspaceId;
    if (!$githubAuthIsAuthenticated$) {
      appStore.dispatch(initializeGitHubAuth());
    }
    if (!$githubAuthIsAuthenticated$) {
      pendingActionAfterAuth = 'create-pr';
      pendingPRWorkspaceId = wsId;
      toast.info(m.workspace_prSection_connectGithub_label());
      return;
    }
    pendingCreatePrVersion =
      (selectGitMutationRequest.select(appStore.state, wsId, 'create-pr')?.version ?? 0) + 1;
    appStore.dispatch(
      createPullRequestRequested(
        wsId,
        titleToUse,
        descriptionToUse,
        opts?.targetBranch ?? targetBranch,
        hasStaged,
      ),
    );
  }

  // Expose triggerCreatePR for parent auto-action coordination.
  export function triggerCreatePR(opts?: {
    workspaceId?: string;
    targetBranch?: string;
    prTitle?: string;
    prDescription?: string;
  }) {
    void handleCreatePR(opts);
  }

  async function handleAutoFillPR() {
    if (isGeneratingPR) {
      appStore.dispatch(cancelExecution(workspaceId, 'pr'));
    } else {
      const workspace = getCurrentWorkspace();
      if (workspace) {
        appStore.dispatch(
          executeBackgroundAgent(workspace.id, 'pr', {
            includeStagedFiles: hasStaged,
            includeCommitHashes: commits.map((c: any) => c.hash),
            targetBranch,
          }),
        );
      }
    }
  }

  function handleStopGeneratingPR() {
    appStore.dispatch(cancelExecution(workspaceId, 'pr'));
    appStore.dispatch(setSidebarCreatePRWhenReady(workspaceId, false));
  }

  function toggleCreatePRWhenReady() {
    appStore.dispatch(setSidebarCreatePRWhenReady(workspaceId, !$createPRWhenReady$));
  }

  function viewPRThoughtProcess(e?: MouseEvent) {
    if (prAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
          agentId: prAgentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }

  function handlePushAllUnpushed() {
    if (!workspaceId || commits.length === 0) return;
    const newestUnpushedHash = commits[0].hash;
    pendingPushVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'accept-changes', 'push')
        ?.version ?? 0) + 1;
    appStore.dispatch(
      executeAcceptChangesRequested(workspaceId, 'push', {
        targetBranch: $workspace$?.branch,
        upToCommitHash: newestUnpushedHash,
      }),
    );
  }

  function handleForcePush() {
    pendingForcePushVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'push', 'force')?.version ??
        0) + 1;
    appStore.dispatch(pushGitRequested(workspaceId, undefined, true));
  }

  function handleRebaseOntoTrunk() {
    if (!workspaceId) return;
    pendingRebaseVersion =
      (selectGitMutationRequest.select(
        appStore.state,
        workspaceId,
        'accept-changes',
        'rebase-onto-trunk',
      )?.version ?? 0) + 1;
    appStore.dispatch(executeAcceptChangesRequested(workspaceId, 'rebase-onto-trunk'));
  }

  function handlePull() {
    const repoPath = $workspace$?.worktreePath || $workspace$?.path;
    const branch = $workspace$?.branch;
    if (!repoPath || !branch) {
      toast.error(m.workspace_prSection_pullUnavailable_error());
      return;
    }
    pendingPullVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'pull')?.version ?? 0) + 1;
    appStore.dispatch(pullGitRequested(workspaceId, repoPath, branch));
  }

  function handleGitHubAuthSuccess() {
    const action = pendingActionAfterAuth;
    pendingActionAfterAuth = null;
    if ($githubAuthIsAuthenticated$) {
      if (action === 'create-pr') {
        handleCreatePR({ workspaceId: pendingPRWorkspaceId ?? undefined });
        pendingPRWorkspaceId = null;
      } else if (action === 'refresh-pr') {
        handleRefreshPRStatus();
      }
    }
  }

  function handleAddRemote() {
    if (!connectRemote.url.trim()) return;
    pendingAddRemoteVersion =
      (selectGitMutationRequest.select(appStore.state, workspaceId, 'add-remote')?.version ?? 0) +
      1;
    appStore.dispatch(addGitRemoteRequested(workspaceId, connectRemote.url.trim()));
  }

  // Expand-state key: cross-repo monitored rows can share a bare PR number
  // with the workspace PR, so key by repo-qualified identity (mirrors the
  // {#each} key).
  function prKey(pr: PRInfo): string {
    return pr.crossRepo ? `${pr.crossRepo}#${pr.number}` : String(pr.number);
  }

  // Any PR content across the three sub-sections (monorepo#2053) — the
  // section header renders when any of them has rows.
  const hasAnyPRs = $derived(hasPRs || otherRootPRs.length > 0 || otherTrackedPRs.length > 0);

  function togglePRExpanded(key: string) {
    const newSet = new Set(expandedPRs);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
      fetchPRCommitFilesIfNeeded();
    }
    expandedPRs = newSet;
  }

  function handlePRFileClick(filePath: string) {
    logger.info('[handlePRFileClick] File clicked in PR', { filePath });
    if (!workspaceId || !$workspace$) return;
    const baseRef = $workspace$.baseRef || 'main';
    const fileStats = prFiles.find((f) => f.path === filePath);
    pendingPrFile = {
      path: filePath,
      stats: { additions: fileStats?.additions ?? 0, deletions: fileStats?.deletions ?? 0 },
    };
    prFilePathStore.set(filePath);
    prOldRefStore.set(baseRef);
    prNewRefStore.set('HEAD');
    appStore.dispatch(readGitFileRequested(workspaceId, filePath, baseRef));
    appStore.dispatch(readGitFileRequested(workspaceId, filePath, 'HEAD'));
  }
</script>

<!-- Divider with Create PR, Push Commits button, or Synced status (only when
     the primary workspace has a remote, and never in listOnly mode) -->
{#if hasRemote && !listOnly}
  <TimelineDivider>
    {#if hasOpenPR && hasUnpushedCommits && unpushedCount > 0 && !isDiverged && !isBehind}
      <!-- Show Push Commits button when open PR exists -->
      <DividerButton onclick={handlePushAllUnpushed} disabled={isPushing} loading={isPushing}>
        {unpushedCount === 1
          ? m.workspace_prSection_pushCommit_one()
          : m.workspace_prSection_pushCommit_many({ count: formatInteger(unpushedCount) })}
      </DividerButton>
    {:else if (!hasOpenPR && !(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)) || (!hasOpenPR && hasNewWorkAfterMerge)}
      <!-- Show Create PR + Merge buttons when no open PR and not post-merge -->
      <div class="w-full flex gap-1">
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesForPr_tooltip()
            : ''}
          onclick={() => {
            prDrawerOpen = !prDrawerOpen;
            if (prDrawerOpen) onMergeDrawerToggle(false);
          }}
          expanded={prDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_createPr_label()}
        </DividerButton>
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesToMerge_tooltip()
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen) prDrawerOpen = false;
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_merge_label()}
        </DividerButton>
      </div>
      <DividerPanel open={prDrawerOpen}>
        {#if !$githubAuthIsAuthenticated$}
          <GitHubAuthBanner onSuccess={() => {}} />
        {:else}
          {@const stagedDescription = hasStaged
            ? stagedChanges.length === 1
              ? m.workspace_prSection_stagedFiles_one()
              : m.workspace_prSection_stagedFiles_many({
                  count: formatInteger(stagedChanges.length),
                })
            : ''}
          {@const commitDescription = hasCommits
            ? allCommits.length === 1
              ? m.workspace_prSection_commits_one()
              : m.workspace_prSection_commits_many({ count: formatInteger(allCommits.length) })
            : ''}
          {@const prParts = [stagedDescription, commitDescription].filter(Boolean)}
          {#if prParts.length > 0}
            <p class="text-xs text-subtle">
              {m.workspace_prSection_includedInPr_label({
                parts: prParts.join(m.workspace_prSection_and_separator()),
              })}
            </p>
          {/if}

          <!-- Title -->
          {#if !isGeneratingPR}
            <div>
              <span class="text-xs text-subtle mb-1 block"
                >{m.workspace_prCreator_titleField_label()}</span
              >
              <Input
                type="text"
                class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                placeholder={m.workspace_prSection_prTitle_placeholder()}
                bind:value={prTitle}
              />
            </div>
          {/if}

          <!-- Description -->
          <div>
            <span class="text-xs text-subtle mb-1 block"
              >{m.workspace_prCreator_descriptionField_label()}</span
            >
            <div class="relative">
              <Textarea
                value={prDescription}
                oninput={(e) => (prDescription = (e.target as HTMLTextAreaElement).value)}
                placeholder={m.workspace_prSection_describeChanges_placeholder()}
                doesExpandToFit
                minHeight={80}
                maxHeight={200}
                readonly={isGeneratingPR}
                class="text-sm {isGeneratingPR ? 'border-primary/40 bg-muted/20' : ''}"
              />
            </div>
          </div>

          <!-- Target Branch -->
          <div>
            <span class="text-xs text-subtle mb-1 block"
              >{m.workspace_prSection_targetBranch_label()}</span
            >
            <BranchSelector
              variant="default"
              value={targetBranch}
              {repoPath}
              {repoType}
              onchange={(_e) => {
                // targetBranch is a prop — parent handles it
              }}
            />
          </div>

          <!-- Buttons -->
          <div class="flex items-center gap-2 flex-wrap w-full">
            <Button
              variant="default"
              size="xs"
              data-testid="create-pr-button"
              onclick={() => handleCreatePR()}
              disabled={!prTitle.trim() || isCreatingPR || (isGeneratingPR && $createPRWhenReady$)}
            >
              {#if isCreatingPR || (isGeneratingPR && $createPRWhenReady$)}
                <IntentMarkLoader size={12} />
                <span
                  >{isCreatingPR
                    ? m.workspace_prSection_creatingPr_label()
                    : m.workspace_prSection_preparing_label()}</span
                >
              {:else}
                <Fa icon={faCodePullRequest} size="xs" class="opacity-50" />
                <span>{m.workspace_prSection_createPr_label()}</span>
              {/if}
            </Button>
            {#if isGeneratingPR}
              <div class="flex items-center">
                <Button
                  variant="outline"
                  size="xs"
                  class="rounded-r-none border-r-0"
                  onclick={handleStopGeneratingPR}
                >
                  <IntentMarkLoader size={12} />
                  <span class="mr-1">{m.workspace_prCreator_autoFill_label()}</span>
                  <Fa icon={faStop} size="xs" />
                </Button>
                {#if prAgentId}
                  <Button
                    variant="outline"
                    size="icon-xs"
                    class="rounded-none h-7!"
                    onclick={viewPRThoughtProcess}
                    tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
                    tooltipSide="top"
                    tooltipDelayDuration={0}
                  >
                    <Fa icon={faEye} size="xs" />
                  </Button>
                {/if}
                <Button
                  variant={$createPRWhenReady$ ? 'default' : 'outline'}
                  size="xs"
                  class="rounded-l-none border-l-0"
                  onclick={toggleCreatePRWhenReady}
                >
                  {#if $createPRWhenReady$}
                    <Fa icon={faCheck} size="xs" />
                  {/if}
                  {m.workspace_prSection_createPrWhenDone_label()}
                </Button>
              </div>
            {:else}
              <div class="flex items-center">
                <Button
                  variant="outline"
                  size="xs"
                  class={prAgentId ? 'rounded-r-none border-r-0' : ''}
                  onclick={handleAutoFillPR}
                >
                  <Fa icon={faRobot} size="xs" class="opacity-50" />
                  <span>{m.workspace_prCreator_autoFill_label()}</span>
                </Button>
                {#if prAgentId}
                  <Button
                    variant="outline"
                    size="icon-xs"
                    class="rounded-l-none border-l-0 h-7!"
                    onclick={viewPRThoughtProcess}
                    tooltip={m.workspace_prSection_viewThoughtProcess_tooltip()}
                    tooltipSide="top"
                    tooltipDelayDuration={0}
                  >
                    <Fa icon={faEye} size="xs" />
                  </Button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </DividerPanel>
      <DividerPanel open={mergeDrawerOpen}>
        {#if mergePanelContent}
          {@render mergePanelContent()}
        {/if}
      </DividerPanel>
    {:else if isBehind}
      <DividerButton
        onclick={handlePull}
        disabled={isPulling}
        loading={isPulling}
        showArrow={false}
      >
        {behindCount === 1
          ? m.workspace_prSection_pullCommit_one()
          : m.workspace_prSection_pullCommit_many({ count: formatInteger(behindCount) })}
        <Fa icon={faArrowDown} size="xs" class="text-ghost rotate-180" />
      </DividerButton>
    {:else if !isDiverged && !isBehind}
      <span
        class="relative z-20 text-xs text-subtle flex items-center gap-1 py-1.5 px-3 rounded-md bg-background"
      >
        <Fa icon={faCheck} size="xs" />
        <span>{m.workspace_prSection_synced_label()}</span>
      </span>
    {/if}

    <!-- Rebase onto trunk -->
    {#if behindTrunk > 0 && !hasConflicts && aheadOfTrunk !== null}
      <DividerButton
        onclick={handleRebaseOntoTrunk}
        disabled={isRebasing}
        loading={isRebasing}
        showArrow={false}
      >
        {m.workspace_prSection_rebaseOnto_label({ branch: trunkBranch })}
        <Fa icon={faArrowsRotate} size="xs" class="text-muted-foreground/50" />
      </DividerButton>
    {/if}

    <!-- Force Push Section -->
    {#if isDiverged}
      <DividerButton
        onclick={() => {
          forcePushDrawerOpen = !forcePushDrawerOpen;
        }}
        expanded={forcePushDrawerOpen}
        showArrow={true}
      >
        {m.workspace_prSection_forcePush_label()}
      </DividerButton>
      <DividerPanel open={forcePushDrawerOpen}>
        {@const aheadPhrase =
          ($gitAheadStore ?? 0) === 1
            ? m.workspace_prSection_commitsAhead_one()
            : m.workspace_prSection_commitsAhead_many({
                count: formatInteger($gitAheadStore ?? 0),
              })}
        {@const behindPhrase =
          ($gitBehindStore ?? 0) === 1
            ? m.workspace_prSection_commitsBehind_one()
            : m.workspace_prSection_commitsBehind_many({
                count: formatInteger($gitBehindStore ?? 0),
              })}
        <p class="text-xs text-subtle">
          {m.workspace_prSection_forcePushLocal_before()}
          <span class="font-medium"
            >{$workspace$?.branch || m.workspace_prSection_branchFallback_label()}</span
          >
          {m.workspace_prSection_forcePushAheadBehind_middle({
            ahead: aheadPhrase,
            behind: behindPhrase,
          })}
          <span class="font-medium"
            ><!-- i18n-ignore (git ref) -->origin/{$workspace$?.branch || 'branch'}</span
          >{m.workspace_prSection_forcePushOverwrite_after()}
        </p>
        <div class="flex items-center gap-2">
          <Button variant="default" size="xs" onclick={handleForcePush} disabled={isForcePushing}>
            {#if isForcePushing}
              <IntentMarkLoader size={12} />
              <span>{m.workspace_prSection_pushing_label()}</span>
            {:else}
              <span>{m.workspace_prSection_forcePush_label()}</span>
            {/if}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onclick={() => {
              forcePushDrawerOpen = false;
            }}
          >
            {m.workspace_prCreator_cancel_label()}
          </Button>
        </div>
      </DividerPanel>
    {/if}
  </TimelineDivider>
{/if}

<!-- PULL REQUESTS SECTION — outside the hasRemote guard: a selected
     secondary root (or a monitor-only row) can supply PRs even when the
     primary workspace has no remote (monorepo#2053). Primary-only
     affordances (create PR / push / merge) stay gated on hasRemote above. -->
{#if hasAnyPRs}
  <div transition:slide={{ tier: 'moderate' }}>
    <TimelineSection
      title={m.workspace_prSection_pullRequests_label()}
      active={hasAnyPRs}
      activeColor="bg-purple-500"
    >
      {#snippet action()}
        <!-- Refresh fetches/refreshes the PRIMARY workspace's git + PR
               state, so it is suppressed in the read-only listOnly
               (secondary-root browsing) mode (monorepo#2053). -->
        {#if !listOnly && (hasAnyPRs || $githubAuthIsAuthenticated$)}
          <Button
            variant="plain"
            type="button"
            size="icon-compact"
            iconOnly
            class="rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            onclick={() => {
              if (!$githubAuthIsAuthenticated$) {
                pendingActionAfterAuth = 'refresh-pr';
                authBannerKey++;
              } else {
                handleRefreshPRStatus();
              }
            }}
            disabled={isRefreshingPR}
            title={$githubAuthIsAuthenticated$
              ? m.workspace_prSection_refreshPrStatus_tooltip()
              : m.workspace_prSection_connectToGithub_label()}
          >
            {#if isRefreshingPR}
              <IntentMarkLoader size={12} class="opacity-50 text-ui" />
            {:else}
              <Fa icon={faArrowsRotate} class="opacity-50 text-ui" />
            {/if}
          </Button>
        {/if}
      {/snippet}
      {#snippet children()}
        {#if !$githubAuthIsAuthenticated$}
          {#key authBannerKey}
            <GitHubAuthBanner
              message={m.workspace_prSection_connectToGithub_label()}
              onSuccess={handleGitHubAuthSuccess}
              autoStart={authBannerKey > 0}
            />
          {/key}
        {/if}
        {#snippet prRow(pr: PRInfo, localFiles: boolean)}
          {@const statusColor =
            pr.status === 'open'
              ? 'text-emerald-500'
              : pr.status === 'merged'
                ? 'text-purple-500'
                : pr.status === 'closed'
                  ? 'text-red-500'
                  : 'text-subtle'}
          {@const statusIcon = pr.status === 'merged' ? faCodeMerge : faCodePullRequest}
          {@const isPRExpanded = expandedPRs.has(prKey(pr))}
          <!-- prFiles reflects the workspace branch PR only — monitor-only
               rows (incl. cross-repo) and the other sub-sections' rows have
               no local file data to expand. -->
          {@const hasPRFiles =
            localFiles && !pr.monitorOnly && (prFiles.length > 0 || prFilesUnknown)}
          <div>
            <!-- PR header -->
            <div
              class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
              title={getPRStatusTooltip(pr)}
            >
              {#if hasPRFiles}
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
                  onclick={(e: MouseEvent) => {
                    e.stopPropagation();
                    togglePRExpanded(prKey(pr));
                  }}
                  title={m.workspace_prSection_toggleFileList_tooltip()}
                >
                  <Fa
                    icon={faChevronDown}
                    size={12}
                    class="text-subtle shrink-0 transition-transform {isPRExpanded
                      ? 'rotate-0'
                      : 'rotate-90'}"
                  />
                  <LineChangesBadge
                    additions={prTotalAdditions}
                    deletions={prTotalDeletions}
                    size="xs"
                  />
                </Button>
              {/if}

              <Fa icon={statusIcon} size="xs" class="{statusColor} shrink-0" />
              <Button
                variant="plain"
                type="button"
                class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                onclick={onOpenFullPanel}
              >
                <span class="text-ui text-subtle truncate flex-1">
                  {#if pr.crossRepo}<span class="text-ghost"
                      >{pr.crossRepoDisplay ?? pr.crossRepo}:</span
                    >
                  {/if}{pr.title}{#if monitorAgentName(pr.monitorAgentId)}
                    <span
                      class="text-ghost"
                      title={m.workspace_prSection_monitoredBy_tooltip({
                        agent: monitorAgentName(pr.monitorAgentId) ?? '',
                      })}
                      >{m.workspace_prSection_monitoredBy_label({
                        agent: monitorAgentName(pr.monitorAgentId) ?? '',
                      })}</span
                    >
                  {/if}
                </span>
                <span class="text-ui text-subtle">#{pr.number}</span>
                {#if pr.status === 'merged'}
                  <span class="text-ui text-purple-500 font-medium"
                    >{m.workspace_prSection_merged_label()}</span
                  >
                {:else if pr.status === 'closed'}
                  <span class="text-ui text-red-500 font-medium"
                    >{m.workspace_prSection_closed_label()}</span
                  >
                {/if}
              </Button>

              <div
                class="absolute -right-1 pl-1 bg-sidebar flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Button
                  variant="ghost-light"
                  size="icon-xs"
                  class="shrink-0"
                  onclick={() =>
                    handleLink(pr.url, {
                      workspaceId: workspaceId as WorkspaceId,
                      forceExternal: true,
                    })}
                  tooltip={m.workspace_sidebar_openInBrowser_tooltip()}
                  tooltipSide="top"
                >
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                </Button>
              </div>
            </div>

            <!-- Expanded panel content - PR files -->
            {#if isPRExpanded}
              <div
                class="pl-5 pr-1.5 pb-0.5 pt-0.5 space-y-px"
                transition:slide={{ tier: 'moderate' }}
              >
                {#each prFiles as file (file.path)}
                  <FileRow
                    {file}
                    muted={true}
                    active={activeFilePath === file.path && activeFileStaged === null}
                    onFileClick={handlePRFileClick}
                    onOpenFile={handleOpenFile}
                  />
                {/each}
              </div>
            {/if}
          </div>
        {/snippet}
        {#snippet prSubDivider(label: string)}
          <!-- Labeled divider between PR sub-sections (monorepo#2053) -->
          <div class="flex items-center gap-2 pt-2 pb-1">
            <span class="text-xs text-ghost shrink-0">{label}</span>
            <div class="h-px flex-1 bg-border dark:bg-border"></div>
          </div>
        {/snippet}
        {#if hasAnyPRs}
          <div class="space-y-0.5">
            <!-- In listOnly mode the top rows belong to a secondary root —
                 read-only, no local-files expansion (monorepo#2053). -->
            {#each pullRequests as pr (prKey(pr))}
              {@render prRow(pr, !listOnly)}
            {/each}
            {#if otherRootPRs.length > 0}
              {@render prSubDivider(m.workspace_prSection_otherPullRequests_label())}
              {#each otherRootPRs as pr (prKey(pr))}
                {@render prRow(pr, false)}
              {/each}
            {/if}
            {#if otherTrackedPRs.length > 0}
              {@render prSubDivider(m.workspace_prSection_otherTrackedPullRequests_label())}
              {#each otherTrackedPRs as pr (prKey(pr))}
                {@render prRow(pr, false)}
              {/each}
            {/if}
          </div>
        {/if}
      {/snippet}
    </TimelineSection>
  </div>
{/if}

<!-- Divider with Merge button - hide when PR is already merged, when merge is in upper section, or post-merge -->
{#if !listOnly && !isPRMerged && (!hasRemote || hasOpenPR) && (!(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) || hasNewWorkAfterMerge)}
  <TimelineDivider>
    {#if !hasRemote}
      <div class="w-full flex gap-1">
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesToMerge_tooltip()
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen) connectRemote.drawerOpen = false;
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_merge_label()}
        </DividerButton>
        <DividerButton
          onclick={() => {
            connectRemote.drawerOpen = !connectRemote.drawerOpen;
            if (connectRemote.drawerOpen) onMergeDrawerToggle(false);
          }}
          expanded={connectRemote.drawerOpen}
          icon={faLink}
          arrowRight
        >
          {m.workspace_prSection_connectRemote_label()}
        </DividerButton>
      </div>
    {:else if hasOpenPR}
      <DividerButton
        tooltipContents={!hasStaged && !hasCommits
          ? m.workspace_prSection_noChangesToMerge_tooltip()
          : ''}
        onclick={() => {
          onMergeDrawerToggle(!mergeDrawerOpen);
        }}
        expanded={mergeDrawerOpen}
        disabled={!hasStaged && !hasCommits}
      >
        {m.workspace_prSection_merge_label()}
      </DividerButton>
    {/if}
    <DividerPanel open={connectRemote.drawerOpen}>
      <p class="text-xs text-subtle">
        {m.workspace_prSection_addRemote_description()}
      </p>
      <div>
        <span class="text-xs text-subtle mb-1 block">{m.workspace_prSection_remoteUrl_label()}</span
        >
        <Input
          type="text"
          class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          placeholder={m.workspace_prSection_remoteUrl_placeholder()}
          bind:value={connectRemote.url}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddRemote();
            }
          }}
        />
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <Button
          variant="default"
          size="xs"
          onclick={handleAddRemote}
          disabled={connectRemote.adding || !connectRemote.url.trim()}
        >
          {#if connectRemote.adding}
            <IntentMarkLoader size={12} />
            <span>{m.workspace_prSection_adding_label()}</span>
          {:else}
            <Fa icon={faLink} size="xs" class="opacity-50" />
            <span>{m.workspace_prSection_addRemote_label()}</span>
          {/if}
        </Button>
      </div>
      <p class="text-xs text-subtle">
        {m.workspace_prSection_noRepo_label()}
        <a
          href="https://github.com/new"
          class="text-primary hover:underline inline-flex items-center gap-0.5"
          onclick={(e) => {
            e.preventDefault();
            handleLink('https://github.com/new', {
              workspaceId: workspaceId as WorkspaceId,
              event: e,
            });
          }}
        >
          {m.workspace_prSection_createOnGithub_label()}
          <Fa icon={faArrowUpRightFromSquare} size="xs" class="opacity-70" />
        </a>
      </p>
    </DividerPanel>
    <DividerPanel open={mergeDrawerOpen}>
      {#if mergePanelContent}
        {@render mergePanelContent()}
      {/if}
    </DividerPanel>
  </TimelineDivider>
{/if}
