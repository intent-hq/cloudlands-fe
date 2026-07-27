<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * PRSection - Pull request creation, push/pull/sync, force push, rebase, connect remote, PR list
   * Manages all PR-related UI state and handlers.
   */
  import { appClient } from '$lib/client';
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
  executeBackgroundAgent,
  cancelExecution,
} from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
  import {
  ChangeStage,
  type CommitFile,
  type CommitInfo,
  type TrackedChange,
} from '$features/file-tracking/types';
  import {
  refreshRequested,
  setSidebarCreatePRWhenReady,
  refreshAcceptChangesStatus,
  clearOlderCommits as ftClearOlderCommits,
} from '$store/renderer/slices/changes/changes-slice';
  import { refreshPRStatusRequested } from '$store/renderer/slices/pr-status/pr-status-slice';
  import { gitCache } from '$features/git/git-cache';
  import { gitClient } from '$features/git/git.client';
  import {
  loadGitStatus,
  setGitOperationFlag,
} from '$store/renderer/slices/git/git-slice';
  import {
  selectGitAhead,
  selectGitBehind,
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
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
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
  faSpinner,
  faStop,
} from '@fortawesome/free-solid-svg-icons';
  import { tick, untrack } from 'svelte';
  import {
  readable,
  writable,
} from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import { aggregatePRFiles } from './sidebar-changes-utils';
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
  }: Props = $props();

  // Redux selectors
  const workspaceIdStore = writable('');
  $effect(() => { workspaceIdStore.set(workspaceId); });

  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const createPRWhenReady$ = selectSidebarCreatePRWhenReady(workspaceIdStore);
  const acceptChangesState$ = selectAcceptChangesState(workspaceIdStore);
  const postMergeState$ = selectPostMergeState(workspaceIdStore);
  const prExecState$ = selectExecutorState(workspaceIdStore, readable('pr'));
  const gitAheadStore = selectGitAhead(workspaceIdStore);
  const gitBehindStore = selectGitBehind(workspaceIdStore);

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

  // PR files derived from pushed commits. The commit list payload is
  // metadata-only (`file-tracking.loadCommits` skips per-commit tree diffs,
  // PROTOCOL §5.19), so per-commit files are fetched via `git.commitDetails`
  // (§5.6) on first PR expand and merged into the aggregation. `null` marks
  // an in-flight fetch (cleared on failure so a later expand retries); the
  // cache resets on workspace switch so it can't leak across workspaces.
  let prCommitFileCache = $state<Partial<Record<string, CommitFile[] | null>>>({});
  let prCacheWorkspaceId = workspaceId;
  $effect(() => {
    if (workspaceId !== prCacheWorkspaceId) {
      prCacheWorkspaceId = workspaceId;
      prCommitFileCache = {};
      expandedPRs = new Set();
    }
  });

  const resolvedPushedCommits = $derived(
    (pushedCommits as CommitInfo[]).map((c) => {
      const cached = prCommitFileCache[c.hash];
      return c.files || !cached ? c : { ...c, files: cached };
    }),
  );
  const prFiles = $derived(aggregatePRFiles(resolvedPushedCommits));
  // Whether any pushed commit's file list is still unknown (unfetched or in
  // flight) — the chevron stays visible until we know the PR has no files.
  const prFilesUnknown = $derived(
    (pushedCommits as CommitInfo[]).some((c) => !c.files && !prCommitFileCache[c.hash]),
  );
  const prTotalAdditions = $derived(prFiles.reduce((sum, f) => sum + f.additions, 0));
  const prTotalDeletions = $derived(prFiles.reduce((sum, f) => sum + f.deletions, 0));

  function clearPRCommitFileMarker(hash: string) {
    if (prCommitFileCache[hash] === null) {
      const { [hash]: _, ...rest } = prCommitFileCache;
      prCommitFileCache = rest;
    }
  }

  function fetchPRCommitFilesIfNeeded() {
    if (!workspaceId) return;
    const requestWorkspaceId = workspaceId;
    for (const commit of pushedCommits as CommitInfo[]) {
      if (commit.files || prCommitFileCache[commit.hash] !== undefined) continue;
      prCommitFileCache = { ...prCommitFileCache, [commit.hash]: null };
      // `commitDetails` folds transport errors to `null` (no rows; a later
      // expand retries). In-flight results are dropped if the workspace
      // switched mid-request so they can't repopulate the reset cache.
      appClient.git
        .commitDetails(requestWorkspaceId, commit.hash)
        .then((result) => {
          if (workspaceId !== requestWorkspaceId) return;
          if (!result) {
            clearPRCommitFileMarker(commit.hash);
            return;
          }
          const files: CommitFile[] =
            result.fileDetails.length > 0
              ? result.fileDetails
              : result.files.map((f) => ({ path: f, additions: 0, deletions: 0 }));
          prCommitFileCache = { ...prCommitFileCache, [commit.hash]: files };
        })
        .catch((error) => {
          logger.error('Failed to fetch commit details for PR files', { hash: commit.hash, error });
          if (workspaceId !== requestWorkspaceId) return;
          clearPRCommitFileMarker(commit.hash);
        });
    }
  }

  // Pushed commits arriving while a PR is already expanded (a push landing
  // mid-view) get their files fetched too. Gated on user interaction; the
  // cache reads are untracked so cleared failure markers don't auto-refetch —
  // retries stay tied to an explicit re-expand.
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
  let expandedPRs = $state<Set<number>>(new Set());
  let connectRemote = $state({ drawerOpen: false, url: '', adding: false });
  let pendingActionAfterAuth = $state<'create-pr' | 'refresh-pr' | null>(null);
  let pendingPRWorkspaceId: string | null = null;
  let authBannerKey = $state(0);

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

  // Helper to persist workspace changes
  async function persistWorkspaceChanges(updates: Record<string, unknown>) {
    if (!workspaceId) return;
    try {
      await workspaceClient.update({ id: workspaceId as WorkspaceId, ...updates });
    } catch (error) {
      logger.error('Failed to persist workspace changes', error as Error);
    }
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
  async function handleRefreshPRStatus() {
    if (isRefreshingPR) return;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isRefreshingPR', true));
    await tick();
    try {
      if (!$githubAuthIsAuthenticated$) {
        appStore.dispatch(initializeGitHubAuth());
      }
      if (!$githubAuthIsAuthenticated$) {
        pendingActionAfterAuth = 'refresh-pr';
        toast.info(m.workspace_prSection_connectGithub_label());
        return;
      }
      try {
        const fetchResult = await gitClient.fetch(workspaceId as WorkspaceId);
        if (!fetchResult.ok) {
          logger.warn('[PRSection] Git fetch failed:', { error: fetchResult.error });
        }
      } catch (error) {
        logger.warn('[PRSection] Git fetch error:', error);
      }
      gitCache.invalidate(`git-status-${workspaceId}`);
      appStore.dispatch(loadGitStatus(workspaceId, true));
      appStore.dispatch(refreshPRStatusRequested(workspaceId, true, true));
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 300));
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isRefreshingPR', false));
    }
  }

  async function handleCreatePR(opts?: {
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
    isCreatingPR = true;
    try {
      const result = await backgroundGitActionsService.createPR({
        workspaceId: wsId,
        prTitle: titleToUse,
        prDescription: descriptionToUse,
        targetBranch: opts?.targetBranch ?? targetBranch,
        hasStaged,
      });
      if (result.success) {
        prTitle = '';
        prDescription = '';
        prDrawerOpen = false;
      } else if (result.needsAuth) {
        pendingActionAfterAuth = 'create-pr';
        pendingPRWorkspaceId = wsId;
        toast.info(m.workspace_prSection_connectGithub_label());
      } else {
        toast.error(result.error || m.workspace_prCreator_createFailed_error());
      }
    } catch {
      toast.error(m.workspace_prCreator_createFailed_error());
    } finally {
      isCreatingPR = false;
    }
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

  async function handlePushAllUnpushed() {
    if (!workspaceId || commits.length === 0) return;
    const newestUnpushedHash = commits[0].hash;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', true));
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push', {
        targetBranch: $workspace$?.branch,
        upToCommitHash: newestUnpushedHash,
      });
      if (result.success) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        try {
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
          ]);
        } catch { /* Refresh failed but push succeeded */ }
      } else {
        toast.error(result.error || m.workspace_prSection_pushFailed_error());
      }
    } catch {
      toast.error(m.workspace_prSection_pushCommitsFailed_error());
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', false));
    }
  }

  async function handleForcePush() {
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', true));
    try {
      const result = await gitClient.push(workspaceId as WorkspaceId, undefined, true);
      if (result.ok) {
        toast.warning(m.workspace_prSection_forcePushDone_label());
        forcePushDrawerOpen = false;
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
          appStore.dispatch(refreshRequested(workspaceId, true)),
        ]);
      } else {
        toast.error(result.error || m.workspace_prSection_forcePushFailed_error());
      }
    } catch (error) {
      logger.error('Force push failed', error as Error);
      toast.error(m.workspace_prSection_forcePushFailed_error());
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', false));
    }
  }

  async function handleRebaseOntoTrunk() {
    if (!workspaceId) return;
    const capturedWsId = workspaceId;
    appStore.dispatch(setGitOperationFlag(capturedWsId, 'isRebasing', true));
    try {
      const result = await AcceptChangesClient.execute(
        capturedWsId as WorkspaceId,
        'rebase-onto-trunk',
      );
      if (workspaceId !== capturedWsId) return;
      if (result.success) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        if (result.result?.newBaseSha) {
          try {
            await persistWorkspaceChanges({ baseCommitSha: result.result.newBaseSha });
          } catch {
            console.error('Failed to update baseCommitSha after rebase onto trunk');
          }
        }
        gitCache.invalidate(`git-status-${capturedWsId}`);
        await Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(capturedWsId, true))),
          appStore.dispatch(refreshRequested(capturedWsId, true)),
        ]);
        appStore.dispatch(refreshAcceptChangesStatus(capturedWsId));
        toast.success(m.workspace_prSection_rebasedOnto_label({ branch: trunkBranch }));
      } else {
        const mainError = result.error || m.workspace_prSection_rebaseFailed_error();
        const stepErrors = result.steps
          ?.filter((s) => s.status === 'failed' && s.error && s.error !== mainError)
          .map((s) => s.error);
        const detailError = stepErrors?.length
          ? `${mainError}\n${stepErrors.join('\n')}`
          : mainError;
        toast.error(detailError);
      }
    } catch (error) {
      logger.error('Rebase onto trunk failed', error as Error);
      toast.error(
        m.workspace_prSection_rebaseFailedDetail_error({ error: (error as Error).message }),
      );
    } finally {
      appStore.dispatch(setGitOperationFlag(capturedWsId, 'isRebasing', false));
    }
  }

  async function handlePull() {
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isPulling', true));
    try {
      // Daemon-backed pull (`git.pull`, PROTOCOL §5.6) via the appClient seam.
      // The wire method is path-based (repoPath + branchName), replacing the
      // retired workspace-scoped `git:pull` IPC.
      const repoPath = $workspace$?.worktreePath || $workspace$?.path;
      const branch = $workspace$?.branch;
      if (!repoPath || !branch) {
        toast.error(m.workspace_prSection_pullUnavailable_error());
        return;
      }
      const result = await appClient.git.pull(repoPath, branch);
      if (result.success) {
        toast.success(m.workspace_prSection_pullSuccess_label());
        gitCache.invalidateWorkspace(workspaceId as WorkspaceId);
        appStore.dispatch(loadGitStatus(workspaceId, true));
      } else {
        toast.error(m.workspace_prSection_pullFailed_error({ error: result.error ?? '' }));
      }
    } catch (error) {
      toast.error(
        m.workspace_prSection_pullFailedDetail_error({
          error: error instanceof Error ? error.message : m.workspace_prSection_unknownError_label(),
        }),
      );
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isPulling', false));
    }
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

  async function handleAddRemote() {
    if (!connectRemote.url.trim()) return;
    connectRemote.adding = true;
    try {
      await AcceptChangesClient.addRemote(
        workspaceId as WorkspaceId,
        connectRemote.url.trim(),
      );
      toast.success(m.workspace_prSection_remoteAdded_label());
      appStore.dispatch(refreshAcceptChangesStatus(workspaceId));
      connectRemote.drawerOpen = false;
      connectRemote.url = '';
    } catch (error) {
      toast.error(
        m.workspace_prSection_addRemoteFailed_error({ error: (error as Error).message }),
      );
    } finally {
      connectRemote.adding = false;
    }
  }

  function togglePRExpanded(prNumber: number) {
    const newSet = new Set(expandedPRs);
    if (newSet.has(prNumber)) {
      newSet.delete(prNumber);
    } else {
      newSet.add(prNumber);
      fetchPRCommitFilesIfNeeded();
    }
    expandedPRs = newSet;
  }

  async function handlePRFileClick(filePath: string) {
    logger.info('[handlePRFileClick] File clicked in PR', { filePath });
    if (!workspaceId || !$workspace$) return;
    try {
      const baseRef = $workspace$.baseRef || 'main';
      // Daemon-backed file-at-ref reads (`git.showFile`, PROTOCOL §5.6);
      // errors fold to { ok: false } inside the git client.
      const [oldContentResult, newContentResult] = await Promise.all([
        gitClient.showFile(workspaceId as WorkspaceId, filePath, baseRef),
        gitClient.showFile(workspaceId as WorkspaceId, filePath, 'HEAD'),
      ]);
      const oldContent = oldContentResult.ok ? oldContentResult.data : '';
      const newContent = newContentResult.ok ? newContentResult.data : '';
      const fileStats = prFiles.find((f) => f.path === filePath);
      const change: TrackedChange = {
        id: `pr-file:${filePath}`,
        file: filePath,
        relativePath: filePath,
        stage: ChangeStage.Committed,
        stats: {
          additions: fileStats?.additions ?? 0,
          deletions: fileStats?.deletions ?? 0,
        },
        content: { oldContent, newContent, diff: '' },
        commitHash: 'PR',
        attribution: { timestamp: Date.now() },
      };
      appStore.dispatch(openWorkspaceDiff(workspaceId, change));
    } catch (error) {
      logger.error('[handlePRFileClick] Failed to fetch file content', { error, filePath });
    }
  }
</script>

<!-- Divider with Create PR, Push Commits button, or Synced status (only when remote exists) -->
{#if hasRemote}
  <TimelineDivider>
    {#if hasOpenPR && hasUnpushedCommits && unpushedCount > 0 && !isDiverged && !isBehind}
      <!-- Show Push Commits button when open PR exists -->
      <DividerButton
        onclick={handlePushAllUnpushed}
        disabled={isPushing}
        loading={isPushing}
      >
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
          <GitHubAuthBanner
            onSuccess={() => {}}
          />
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
              <span class="text-xs text-subtle mb-1 block">{m.workspace_prCreator_titleField_label()}</span>
              <input
                type="text"
                class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                placeholder={m.workspace_prSection_prTitle_placeholder()}
                bind:value={prTitle}
              />
            </div>
          {/if}

          <!-- Description -->
          <div>
            <span class="text-xs text-subtle mb-1 block">{m.workspace_prCreator_descriptionField_label()}</span>
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
            <span class="text-xs text-subtle mb-1 block">{m.workspace_prSection_targetBranch_label()}</span>
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
              disabled={!prTitle.trim() ||
                isCreatingPR ||
                (isGeneratingPR && $createPRWhenReady$)}
            >
              {#if isCreatingPR || (isGeneratingPR && $createPRWhenReady$)}
                <Fa icon={faSpinner} size="xs" class="animate-spin" />
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
                  <Fa icon={faSpinner} size="xs" class="animate-spin" />
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
        onclick={() => { forcePushDrawerOpen = !forcePushDrawerOpen; }}
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
          {m.workspace_prSection_forcePushAheadBehind_label({
            ahead: aheadPhrase,
            behind: behindPhrase,
          })}
          <span class="font-medium"
            ><!-- i18n-ignore (git ref) -->origin/{$workspace$?.branch || 'branch'}</span
          >{m.workspace_prSection_forcePushOverwrite_after()}
        </p>
        <div class="flex items-center gap-2">
          <Button
            variant="default"
            size="xs"
            onclick={handleForcePush}
            disabled={isForcePushing}
          >
            {#if isForcePushing}
              <Fa icon={faSpinner} size="xs" class="animate-spin" />
              <span>{m.workspace_prSection_pushing_label()}</span>
            {:else}
              <span>{m.workspace_prSection_forcePush_label()}</span>
            {/if}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onclick={() => { forcePushDrawerOpen = false; }}
          >
            {m.workspace_prCreator_cancel_label()}
          </Button>
        </div>
      </DividerPanel>
    {/if}
  </TimelineDivider>

  <!-- PULL REQUESTS SECTION -->
  {#if hasPRs}
    <div transition:slide={{ duration: 200 }}>
      <TimelineSection
        title={m.workspace_prSection_pullRequests_label()}
        active={hasPRs}
        activeColor="bg-purple-500"
      >
        {#snippet action()}
          {#if hasPRs || $githubAuthIsAuthenticated$}
            <button
              type="button"
              class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
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
              <Fa
                icon={faArrowsRotate}
                class="opacity-50 text-ui {isRefreshingPR ? 'animate-spin' : ''}"
              />
            </button>
          {/if}
        {/snippet}
        {#if !$githubAuthIsAuthenticated$}
          {#key authBannerKey}
            <GitHubAuthBanner
              message={m.workspace_prSection_connectToGithub_label()}
              onSuccess={handleGitHubAuthSuccess}
              autoStart={authBannerKey > 0}
            />
          {/key}
        {/if}
        {#if hasPRs}
          <div class="space-y-0.5">
            {#each pullRequests as pr (pr.number)}
              {@const statusColor =
                pr.status === 'open'
                  ? 'text-emerald-500'
                  : pr.status === 'merged'
                    ? 'text-purple-500'
                    : pr.status === 'closed'
                      ? 'text-red-500'
                      : 'text-subtle'}
              {@const statusIcon =
                pr.status === 'merged' ? faCodeMerge : faCodePullRequest}
              {@const isPRExpanded = expandedPRs.has(pr.number)}
              {@const hasPRFiles = prFiles.length > 0 || prFilesUnknown}
              <div>
                <!-- PR header -->
                <div
                  class="relative flex items-center gap-2 py-0.5 group w-full rounded px-1 -mx-1"
                >
                  {#if hasPRFiles}
                    <Button
                      variant="ghost-light"
                      size="icon-xs"
                      class="absolute left-0.75 bg-sidebar opacity-0 group-hover:opacity-100 hover:text-foreground! -ml-1"
                      onclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        togglePRExpanded(pr.number);
                      }}
                      title={m.workspace_prSection_toggleFileList_tooltip()}
                    >
                      <Fa
                        icon={faChevronDown}
                        size={12}
                        class="text-subtle shrink-0 transition-transform {isPRExpanded
                          ? 'rotate-0'
                          : '-rotate-90'}"
                      />
                      <LineChangesBadge
                        additions={prTotalAdditions}
                        deletions={prTotalDeletions}
                        size="xs"
                      />
                    </Button>
                  {/if}

                  <Fa icon={statusIcon} size="xs" class="{statusColor} shrink-0" />
                  <button
                    type="button"
                    class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                    onclick={onOpenFullPanel}
                  >
                    <span class="text-ui text-subtle truncate flex-1">{pr.title}</span>
                    <span class="text-ui text-subtle">#{pr.number}</span>
                    {#if pr.status === 'merged'}
                      <span class="text-ui text-purple-500 font-medium">{m.workspace_prSection_merged_label()}</span>
                    {:else if pr.status === 'closed'}
                      <span class="text-ui text-red-500 font-medium">{m.workspace_prSection_closed_label()}</span>
                    {/if}
                  </button>

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
                    transition:slide={{ duration: 150 }}
                  >
                    {#each prFiles as file (file.path)}
                      <FileRow
                        {file}
                        muted={true}
                        active={activeFilePath === file.path && activeFileStaged === null}
                        onFileClick={(filePath) => {
                          handlePRFileClick(filePath).catch((error) => {
                            logger.error('Error in handlePRFileClick', { error });
                          });
                        }}
                        onOpenFile={handleOpenFile}
                      />
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </TimelineSection>
    </div>
  {/if}
{/if}


<!-- Divider with Merge button - hide when PR is already merged, when merge is in upper section, or post-merge -->
{#if !isPRMerged && (!hasRemote || hasOpenPR) && (!(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) || hasNewWorkAfterMerge)}
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
        <span class="text-xs text-subtle mb-1 block">{m.workspace_prSection_remoteUrl_label()}</span>
        <input
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
            <Fa icon={faSpinner} size="xs" class="animate-spin" />
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