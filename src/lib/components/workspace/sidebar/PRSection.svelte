<script lang="ts">
  /**
   * PRSection - Pull request creation, push/pull/sync, force push, rebase, connect remote, PR list
   * Manages all PR-related UI state and handlers.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
  import { selectExecutorState } from '$lib/store/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    executeBackgroundAgent,
    cancelExecution,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import {
    refreshRequested,
  } from '$lib/store/slices/file-tracking/file-tracking-slice';
  import {
    refreshPRStatusRequested,
  } from '$lib/store/slices/pr-status/pr-status-slice';
  import { gitCache } from '$features/git/git-cache';
  import { gitClient } from '$features/git/git.client';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import {
    selectGitAhead,
    selectGitBehind,
  } from '$lib/store/slices/git/git-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import { initializeGitHubAuth } from '$lib/store/slices/github-auth/github-auth-slice';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { handleLink } from '$features/navigation/link-handler';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import {
    setSidebarCreatePRWhenReady,
    setGitOperationFlag,
    refreshAcceptChangesStatus,
  } from '$lib/store/slices/transient-ui/transient-ui-slice';
  import {
    selectSidebarChangesState,
    selectAcceptChangesState,
    selectPostMergeState,
    selectGitOperationFlags,
  } from '$lib/store/slices/transient-ui/transient-ui-selectors';
  import {
    selectWorkspaceById,
  } from '$lib/store/slices/workspace/workspace-selectors';
  import {
    clearOlderCommits as ftClearOlderCommits,
  } from '$lib/store/slices/file-tracking/file-tracking-slice';
  import { workspaceClient } from '$lib/store/slices/workspace/utils/workspace.client';
  import { addTerminal, openTerminalOverlay } from '$lib/store/slices/terminals/terminals-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { toast } from '$lib/components/ui/toast';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import { track, trackGitOp, getFileExtension } from '$lib/services/analytics';
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
  import { tick } from 'svelte';
  import { readable, writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import {
    aggregatePRFiles,
  } from './sidebar-changes-utils';
  import TimelineDivider from './TimelineDivider.svelte';
  import TimelineSection from './TimelineSection.svelte';

  const dispatch = getDispatch();

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
    hasUnstaged,
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
    commitMessage,
    hasUnpushedCommits,
    unpushedCount,
    hasPushedCommits,
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
    onOpenChange,
    mergePanelContent,
  }: Props = $props();

  // Redux selectors
  const workspaceIdStore = writable('');
  $effect(() => { workspaceIdStore.set(workspaceId); });

  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const sidebarChangesState$ = selectSidebarChangesState(workspaceIdStore);
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
  const createPRWhenReady = $derived($sidebarChangesState$.createPRWhenReady);

  // Post-merge state
  const aheadOfTrunk = $derived($postMergeState$.aheadOfTrunk);
  const behindTrunk = $derived($postMergeState$.behindTrunk);
  const hasConflicts = $derived($postMergeState$.hasConflicts);

  // Panel layout manager
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // PR files derived from pushed commits
  const prFiles = $derived(aggregatePRFiles(pushedCommits));
  const prTotalAdditions = $derived(prFiles.reduce((sum, f) => sum + f.additions, 0));
  const prTotalDeletions = $derived(prFiles.reduce((sum, f) => sum + f.deletions, 0));

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
    return selectWorkspaceById.select(getReduxStore().getState(), workspaceId);
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
    track('Opened File', {
      workspace_id: workspaceId,
      file_extension: getFileExtension(relativePath),
      source: 'sidebar',
    });
  }

  // --- PR Handlers ---
  async function handleRefreshPRStatus() {
    if (isRefreshingPR) return;
    dispatch(setGitOperationFlag(workspaceId, 'isRefreshingPR', true));
    await tick();
    try {
      if (!$githubAuthIsAuthenticated$) {
        dispatch(initializeGitHubAuth());
      }
      if (!$githubAuthIsAuthenticated$) {
        pendingActionAfterAuth = 'refresh-pr';
        toast.info('Connect to GitHub using the banner below');
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
      getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      dispatch(refreshPRStatusRequested(workspaceId, true, true));
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 300));
      dispatch(setGitOperationFlag(workspaceId, 'isRefreshingPR', false));
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
      dispatch(initializeGitHubAuth());
    }
    if (!$githubAuthIsAuthenticated$) {
      pendingActionAfterAuth = 'create-pr';
      pendingPRWorkspaceId = wsId;
      toast.info('Connect to GitHub using the banner below');
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
      trackGitOp('create-pr', { workspaceId: wsId, success: result.success, trigger: 'manual' });
      if (result.success) {
        prTitle = '';
        prDescription = '';
        prDrawerOpen = false;
      } else if (result.needsAuth) {
        pendingActionAfterAuth = 'create-pr';
        pendingPRWorkspaceId = wsId;
        toast.info('Connect to GitHub using the banner below');
      } else {
        toast.error(result.error || 'Failed to create pull request');
      }
    } catch {
      trackGitOp('create-pr', { workspaceId: wsId, success: false, trigger: 'manual' });
      toast.error('Failed to create pull request');
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
      dispatch(cancelExecution(workspaceId, 'pr'));
    } else {
      const workspace = getCurrentWorkspace();
      if (workspace) {
        dispatch(
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
    dispatch(cancelExecution(workspaceId, 'pr'));
    dispatch(setSidebarCreatePRWhenReady(workspaceId, false));
  }

  function toggleCreatePRWhenReady() {
    dispatch(setSidebarCreatePRWhenReady(workspaceId, !createPRWhenReady));
  }

  function viewPRThoughtProcess(e?: MouseEvent) {
    if (prAgentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId: prAgentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }

  async function handlePushAllUnpushed() {
    if (!workspaceId || commits.length === 0) return;
    const newestUnpushedHash = commits[0].hash;
    dispatch(setGitOperationFlag(workspaceId, 'isPushing', true));
    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push', {
        targetBranch: $workspace$?.branch,
        upToCommitHash: newestUnpushedHash,
      });
      trackGitOp('push', {
        workspaceId, success: result.success, trigger: 'manual',
        commitCount: commits.length, hasPr: pullRequests.length > 0,
      });
      if (result.success) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        try {
          await Promise.all([
            Promise.resolve(getReduxStore().dispatch(loadGitStatus(workspaceId, true))),
            getReduxStore().dispatch(refreshRequested(workspaceId)),
          ]);
        } catch { /* Refresh failed but push succeeded */ }
      } else {
        toast.error(result.error || 'Failed to push');
      }
    } catch {
      trackGitOp('push', { workspaceId, success: false, trigger: 'manual' });
      toast.error('Failed to push commits');
    } finally {
      dispatch(setGitOperationFlag(workspaceId, 'isPushing', false));
    }
  }

  async function handleForcePush() {
    dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', true));
    try {
      const result = await gitClient.push(workspaceId as WorkspaceId, undefined, true);
      if (result.ok) {
        toast.warning('Force push completed');
        forcePushDrawerOpen = false;
        gitCache.invalidate(`git-status-${workspaceId}`);
        Promise.all([
          Promise.resolve(getReduxStore().dispatch(loadGitStatus(workspaceId, true))),
          getReduxStore().dispatch(refreshRequested(workspaceId)),
        ]);
      } else {
        toast.error(result.error || 'Force push failed');
      }
    } catch (error) {
      logger.error('Force push failed', error as Error);
      toast.error('Force push failed');
    } finally {
      dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', false));
    }
  }

  async function handleRebaseOntoTrunk() {
    if (!workspaceId) return;
    const capturedWsId = workspaceId;
    dispatch(setGitOperationFlag(capturedWsId, 'isRebasing', true));
    try {
      const result = await AcceptChangesClient.execute(
        capturedWsId as WorkspaceId,
        'rebase-onto-trunk',
      );
      if (workspaceId !== capturedWsId) return;
      if (result.success) {
        dispatch(ftClearOlderCommits(workspaceId));
        if (result.result?.newBaseSha) {
          try {
            await persistWorkspaceChanges({ baseCommitSha: result.result.newBaseSha });
          } catch {
            console.error('Failed to update baseCommitSha after rebase onto trunk');
          }
        }
        gitCache.invalidate(`git-status-${capturedWsId}`);
        await Promise.all([
          Promise.resolve(getReduxStore().dispatch(loadGitStatus(capturedWsId, true))),
          getReduxStore().dispatch(refreshRequested(capturedWsId)),
        ]);
        dispatch(refreshAcceptChangesStatus(capturedWsId));
        toast.success(`Rebased onto ${trunkBranch}`);
      } else {
        const mainError = result.error || 'Rebase failed';
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
      toast.error(`Rebase failed: ${(error as Error).message}`);
    } finally {
      dispatch(setGitOperationFlag(capturedWsId, 'isRebasing', false));
    }
  }

  async function handlePull() {
    dispatch(setGitOperationFlag(workspaceId, 'isPulling', true));
    try {
      const result = await gitClient.pull(workspaceId as WorkspaceId);
      if (result.ok) {
        toast.success('Pulled remote commits successfully');
        gitCache.invalidateWorkspace(workspaceId as WorkspaceId);
        getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      } else {
        toast.error(`Failed to pull: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Pull failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      dispatch(setGitOperationFlag(workspaceId, 'isPulling', false));
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
      toast.success('Remote added successfully');
      dispatch(refreshAcceptChangesStatus(workspaceId));
      connectRemote.drawerOpen = false;
      connectRemote.url = '';
    } catch (error) {
      toast.error(`Failed to add remote: ${(error as Error).message}`);
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
    }
    expandedPRs = newSet;
  }

  async function handlePRFileClick(filePath: string) {
    logger.info('[handlePRFileClick] File clicked in PR', { filePath });
    if (!workspaceId || !$workspace$) return;
    try {
      const baseRef = $workspace$.baseRef || 'main';
      const [oldContentResult, newContentResult] = await Promise.all([
        window.electronAPI?.invoke('git:show-file', {
          workspaceId, filePath, ref: baseRef,
        }) as Promise<{ success: boolean; data?: string; error?: string }>,
        window.electronAPI?.invoke('git:show-file', {
          workspaceId, filePath, ref: 'HEAD',
        }) as Promise<{ success: boolean; data?: string; error?: string }>,
      ]);
      const oldContent = oldContentResult?.success ? oldContentResult.data || '' : '';
      const newContent = newContentResult?.success ? newContentResult.data || '' : '';
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
      window.dispatchEvent(
        new CustomEvent('workspace:open-diff', {
          detail: { change, workspaceId },
        }),
      );
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
        Push {unpushedCount} Commit{unpushedCount === 1 ? '' : 's'}
      </DividerButton>
    {:else if (!hasOpenPR && !(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)) || (!hasOpenPR && hasNewWorkAfterMerge)}
      <!-- Show Create PR + Merge buttons when no open PR and not post-merge -->
      <div class="w-full flex gap-1">
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? 'No staged changes or commits to create PR from'
            : ''}
          onclick={() => {
            const wasOpen = prDrawerOpen;
            prDrawerOpen = !prDrawerOpen;
            if (prDrawerOpen) onMergeDrawerToggle(false);
            if (!wasOpen) {
              track('Opened PR Creator', { workspace_id: workspaceId });
            }
          }}
          expanded={prDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          Create PR
        </DividerButton>
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? 'No staged changes or commits to merge'
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen) prDrawerOpen = false;
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          Merge
        </DividerButton>
      </div>
      <DividerPanel open={prDrawerOpen}>
        {#if !$githubAuthIsAuthenticated$}
          <GitHubAuthBanner
            onSuccess={() => {}}
          />
        {:else}
          {@const stagedDescription = hasStaged
            ? `${stagedChanges.length} staged file${stagedChanges.length === 1 ? '' : 's'}`
            : ''}
          {@const commitDescription = hasCommits
            ? `${allCommits.length} commit${allCommits.length === 1 ? '' : 's'}`
            : ''}
          {@const prParts = [stagedDescription, commitDescription].filter(Boolean)}
          {#if prParts.length > 0}
            <p class="text-xs text-subtle">
              {prParts.join(' and ')} will be included in this PR.
            </p>
          {/if}

          <!-- Title -->
          {#if !isGeneratingPR}
            <div>
              <span class="text-xs text-subtle mb-1 block">Title</span>
              <input
                type="text"
                class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                placeholder="PR title..."
                bind:value={prTitle}
              />
            </div>
          {/if}

          <!-- Description -->
          <div>
            <span class="text-xs text-subtle mb-1 block">Description</span>
            <div class="relative">
              <Textarea
                value={prDescription}
                oninput={(e) => (prDescription = (e.target as HTMLTextAreaElement).value)}
                placeholder="Describe your changes..."
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
            <span class="text-xs text-subtle mb-1 block">Target Branch</span>
            <BranchSelector
              variant="default"
              value={targetBranch}
              {repoPath}
              {repoType}
              onchange={(e) => {
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
                (isGeneratingPR && createPRWhenReady)}
            >
              {#if isCreatingPR || (isGeneratingPR && createPRWhenReady)}
                <Fa icon={faSpinner} size="xs" class="animate-spin" />
                <span>{isCreatingPR ? 'Creating PR...' : 'Preparing...'}</span>
              {:else}
                <Fa icon={faCodePullRequest} size="xs" class="opacity-50" />
                <span>Create PR</span>
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
                  <span class="mr-1">Auto-fill</span>
                  <Fa icon={faStop} size="xs" />
                </Button>
                {#if prAgentId}
                  <Button
                    variant="outline"
                    size="icon-xs"
                    class="rounded-none h-7!"
                    onclick={viewPRThoughtProcess}
                    tooltip="View thought process"
                    tooltipSide="top"
                    tooltipDelayDuration={0}
                  >
                    <Fa icon={faEye} size="xs" />
                  </Button>
                {/if}
                <Button
                  variant={createPRWhenReady ? 'default' : 'outline'}
                  size="xs"
                  class="rounded-l-none border-l-0"
                  onclick={toggleCreatePRWhenReady}
                >
                  {#if createPRWhenReady}
                    <Fa icon={faCheck} size="xs" />
                  {/if}
                  Create PR when done
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
                  <span>Auto-fill</span>
                </Button>
                {#if prAgentId}
                  <Button
                    variant="outline"
                    size="icon-xs"
                    class="rounded-l-none border-l-0 h-7!"
                    onclick={viewPRThoughtProcess}
                    tooltip="View thought process"
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
        Pull {behindCount} Commit{behindCount === 1 ? '' : 's'}
        <Fa icon={faArrowDown} size="xs" class="text-ghost rotate-180" />
      </DividerButton>
    {:else if !isDiverged && !isBehind}
      <span
        class="relative z-20 text-xs text-subtle flex items-center gap-1 py-1.5 px-3 rounded-md bg-background"
      >
        <Fa icon={faCheck} size="xs" />
        <span>Synced</span>
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
        Rebase onto {trunkBranch}
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
        Force Push
      </DividerButton>
      <DividerPanel open={forcePushDrawerOpen}>
        <p class="text-xs text-subtle">
          Your local <span class="font-medium">{$workspace$?.branch || 'branch'}</span> is {$gitAheadStore ?? 0}
          commit{($gitAheadStore ?? 0) === 1 ? '' : 's'} ahead and {$gitBehindStore ?? 0} commit{($gitBehindStore ?? 0) === 1 ? '' : 's'} behind
          <span class="font-medium">origin/{$workspace$?.branch || 'branch'}</span>. Force
          pushing will overwrite the GitHub version with your local commits.
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
              <span>Pushing...</span>
            {:else}
              <span>Force Push</span>
            {/if}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onclick={() => { forcePushDrawerOpen = false; }}
          >
            Cancel
          </Button>
        </div>
      </DividerPanel>
    {/if}
  </TimelineDivider>

  <!-- PULL REQUESTS SECTION -->
  {#if hasPRs}
    <div transition:slide={{ duration: 200 }}>
      <TimelineSection title="Pull Requests" active={hasPRs} activeColor="bg-purple-500">
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
                ? 'Refresh PR status'
                : 'Connect to GitHub'}
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
              message="Connect to GitHub"
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
              {@const hasPRFiles = prFiles.length > 0}
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
                      title="Toggle file list"
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
                      <span class="text-ui text-purple-500 font-medium">Merged</span>
                    {:else if pr.status === 'closed'}
                      <span class="text-ui text-red-500 font-medium">Closed</span>
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
                      tooltip="Open in browser"
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
            ? 'No staged changes or commits to merge'
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen) connectRemote.drawerOpen = false;
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          Merge
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
          Connect Remote
        </DividerButton>
      </div>
    {:else if hasOpenPR}
      <DividerButton
        tooltipContents={!hasStaged && !hasCommits
          ? 'No staged changes or commits to merge'
          : ''}
        onclick={() => {
          onMergeDrawerToggle(!mergeDrawerOpen);
        }}
        expanded={mergeDrawerOpen}
        disabled={!hasStaged && !hasCommits}
      >
        Merge
      </DividerButton>
    {/if}
    <DividerPanel open={connectRemote.drawerOpen}>
      <p class="text-xs text-subtle">
        Add a git remote to enable pushing and pull requests.
      </p>
      <div>
        <span class="text-xs text-subtle mb-1 block">Remote URL</span>
        <input
          type="text"
          class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
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
            <span>Adding...</span>
          {:else}
            <Fa icon={faLink} size="xs" class="opacity-50" />
            <span>Add Remote</span>
          {/if}
        </Button>
      </div>
      <p class="text-xs text-subtle">
        Don't have a repo?
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
          Create one on GitHub
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