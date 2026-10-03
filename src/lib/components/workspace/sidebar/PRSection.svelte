<script lang="ts">
  import { untrack } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { createNativeSidebarReview } from '$features/accept-changes/native-sidebar-review.svelte';
  import NativeSidebarReview from '$features/accept-changes/components/NativeSidebarReview.svelte';
  import type { NativeSidebarReviewIntent } from '$store/renderer/slices/changes/changes-types';
  import { selectCanAdministerHost } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
  /**
   * PRSection - Pull request creation, push/pull/sync, force push, rebase, connect remote, PR list
   * Manages all PR-related UI state and handlers.
   */
  import {
    prWorkflowRequested,
    resumePRWorkflowAfterAuth,
    setPRWorkflowDrawer,
  } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
  import { selectPRWorkflow } from '$store/renderer/slices/pr-workflow/pr-workflow-selectors';
  import { selectExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    executeBackgroundAgent,
    cancelExecution,
  } from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
  import { type CommitInfo, type TrackedChange } from '$features/file-tracking/types';
  import {
    setSidebarCreatePRWhenReady,
    setPRContent,
  } from '$store/renderer/slices/changes/changes-slice';
  import {
    gitReadRequested,
    releaseGitRead,
    openGitPRFileRequested,
  } from '$store/renderer/slices/git/git-slice';
  import {
    selectGitAhead,
    selectGitBehind,
    selectPostMergeState,
    selectGitOperationFlags,
    selectGitCommitDetailsFiles,
  } from '$store/renderer/slices/git/git-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { handleLink } from '$features/navigation/link-handler';

  import {
    selectSidebarCreatePRWhenReady,
    selectAcceptChangesState,
  } from '$store/renderer/slices/changes/changes-selectors';

  import {
    selectWorkspaceById,
    selectWorkspaceListLoadedForBackend,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Textarea } from '$lib/components/ui/textarea';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
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
  import { readable, toStore } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { slide } from '$lib/motion';
  import DividerButton from './DividerButton.svelte';
  import DividerPanel from './DividerPanel.svelte';
  import { aggregatePRFiles, getPRStatusTooltip } from './sidebar-changes-utils';
  import TimelineDivider from './TimelineDivider.svelte';
  import TimelineSection from './TimelineSection.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  import {
    selectPrincipalActionContext,
    selectHostRole,
  } from '$store/renderer/slices/principal/principal-selectors';

  interface Props {
    /** Primary sidebar opts into qualified native preparation; other callers retain their existing flow. */
    nativeReview?: boolean;
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
    /** Every mutating affordance (push / create PR / merge / rebase / connect
     * remote via `accept-changes.*`, GitHub auth via `github.*`, `git.pull`,
     * force `git.push`) renders only when true; a collaborator gets the
     * read-only PR list and sync labels. */
    isOwner?: boolean;
  }

  let {
    nativeReview = false,
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
    isOwner = true,
  }: Props = $props();

  // Redux selectors
  const workspaceIdStore = toStore(() => workspaceId);
  const hostOperationContext$ = selectWorkspaceActionContext(workspaceIdStore);
  const nativeEnabled$ = selectLabsMultiplayerEnabled();
  const nativeAdmission$ = selectPrincipalActionContext();
  const canHostOperations = $derived(isOwner && !!$hostOperationContext$);
  const canAdministerHost$ = selectCanAdministerHost();

  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const admittedGuest$ = appStore.createSelector((state, id: string) => {
    const admission = selectPrincipalActionContext.select(state);
    return (
      !!selectWorkspaceById.select(state, id) &&
      selectHostRole.select(state) === 'guest' &&
      admission !== null &&
      state.workspace.capabilityContext === admission &&
      selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId)
    );
  })(workspaceIdStore);
  // Agent attribution for monitored PR rows (PROTOCOL §6.9).
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);

  /** Display name of the agent owning a monitored PR row, if resolvable. */
  function monitorAgentName(agentId: string | undefined): string | undefined {
    if (!agentId) return undefined;
    return $workspaceAgents$.find((a) => String(a.id) === agentId)?.name;
  }
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const createPRWhenReady$ = selectSidebarCreatePRWhenReady(workspaceIdStore);
  const workflow$ = selectPRWorkflow(workspaceIdStore);
  const draft$ = selectAcceptChangesState(workspaceIdStore);
  const commitFiles$ = selectGitCommitDetailsFiles(workspaceIdStore);
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
  const prCommitFileCache = $derived($commitFiles$);
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

  const readConsumer = crypto.randomUUID();
  function fetchPRCommitFilesIfNeeded() {
    if (!workspaceId) return;
    for (const commit of pushedCommits as CommitInfo[]) {
      if (commit.files || prCommitFileCache[commit.hash] !== undefined) continue;
      appStore.dispatch(
        gitReadRequested(workspaceId, `${readConsumer}:${commit.hash}`, commit.hash, {
          kind: 'commitDetails',
          commitHash: commit.hash,
        }),
      );
    }
  }

  $effect(() => {
    const wsId = workspaceId;
    // Component-owned subscription bookkeeping only; fetched data stays in Redux.
    // A refreshed array must not release reads for commits that are still present.
    let hashes = new Set<string>();
    $effect(() => {
      const nextHashes = new Set((pushedCommits as CommitInfo[]).map((commit) => commit.hash));
      for (const hash of hashes) {
        if (!nextHashes.has(hash))
          appStore.dispatch(releaseGitRead(wsId, `${readConsumer}:${hash}`, hash));
      }
      hashes = nextHashes;
    });
    return () => {
      for (const hash of hashes)
        appStore.dispatch(releaseGitRead(wsId, `${readConsumer}:${hash}`, hash));
    };
  });

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
  const prDrawerOpen = $derived($workflow$.prDrawerOpen);
  const prTitle = $derived($draft$.prTitle);
  const prDescription = $derived($draft$.prDescription);
  const isCreatingPR = $derived($workflow$.operations['create-pr']?.status === 'pending');
  const forcePushDrawerOpen = $derived($workflow$.forcePushDrawerOpen);
  let expandedPRs = $state<Set<string>>(new Set());
  let remoteUrl = $state('');
  const connectRemote = $derived({
    drawerOpen: $workflow$.connectRemoteDrawerOpen,
    url: remoteUrl,
    adding: $workflow$.operations['connect-remote']?.status === 'pending',
  });
  let authBannerKey = $state(0);

  const native = createNativeSidebarReview(() => ({
    workspaceId,
    nativeReview,
    listOnly,
    isOwner,
    hasRemote,
    hasStaged,
    hasCommits,
    hasOpenPR,
    isMergedToTrunk,
    areAllPRsMerged,
    hasResetToTrunk,
    isContentMergedToTrunk,
    hasNewWorkAfterMerge,
    prDrawerOpen,
    prTitle,
    prDescription,
    _commitMessage,
    onMergeDrawerToggle,
    canHostOperations,
    admittedGuest: $admittedGuest$,
    hostContext: $hostOperationContext$,
    admission: $nativeAdmission$,
    baseRef: $workspace$?.baseRef ?? '',
    labsEnabled: $nativeEnabled$,
  }));
  export function observeNativeRetirement() {
    return native.observeNativeRetirement();
  }
  export function triggerNativeReview(intent: NativeSidebarReviewIntent) {
    return native.triggerNativeReview(intent);
  }

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
    appStore.dispatch(prWorkflowRequested(workspaceId, { kind: 'refresh-pr', requireAuth: true }));
  }

  function handleCreatePR(opts?: {
    workspaceId?: string;
    targetBranch?: string;
    prTitle?: string;
    prDescription?: string;
  }) {
    if (native.legacyBlocked) return;
    const titleToUse = (opts?.prTitle ?? prTitle).trim();
    const descriptionToUse = (opts?.prDescription ?? prDescription).trim();
    if (!titleToUse) return;
    const wsId = opts?.workspaceId ?? workspaceId;
    appStore.dispatch(
      prWorkflowRequested(wsId, {
        kind: 'create-pr',
        prTitle: titleToUse,
        prDescription: descriptionToUse,
        targetBranch: opts?.targetBranch ?? targetBranch,
        hasStaged,
        requireAuth: true,
      }),
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
    appStore.dispatch(
      prWorkflowRequested(workspaceId, {
        kind: 'push',
        targetBranch: $workspace$?.branch,
        upToCommitHash: commits[0].hash,
      }),
    );
  }

  function handleForcePush() {
    appStore.dispatch(prWorkflowRequested(workspaceId, { kind: 'force-push' }));
  }

  function handleRebaseOntoTrunk() {
    appStore.dispatch(prWorkflowRequested(workspaceId, { kind: 'rebase', trunkBranch }));
  }

  function handlePull() {
    appStore.dispatch(prWorkflowRequested(workspaceId, { kind: 'pull' }));
  }

  function handleGitHubAuthSuccess() {
    appStore.dispatch(resumePRWorkflowAfterAuth(workspaceId));
  }

  function handleAddRemote() {
    if (!connectRemote.url.trim()) return;
    appStore.dispatch(
      prWorkflowRequested(workspaceId, {
        kind: 'connect-remote',
        remoteUrl: connectRemote.url.trim(),
      }),
    );
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
    if (!workspaceId || !$workspace$) return;
    const stats = prFiles.find((file) => file.path === filePath);
    appStore.dispatch(
      openGitPRFileRequested(
        workspaceId,
        filePath,
        $workspace$.baseRef || 'main',
        stats?.additions,
        stats?.deletions,
      ),
    );
  }
</script>

<NativeSidebarReview review={native} entry />

<!-- Divider with Create PR, Push Commits button, or Synced status (only when
     the primary workspace has a remote, and never in listOnly mode) -->
{#if hasRemote && !listOnly}
  <TimelineDivider>
    {#if isOwner && hasOpenPR && hasUnpushedCommits && unpushedCount > 0 && !isDiverged && !isBehind}
      <!-- Show Push Commits button when open PR exists (accept-changes.execute, owner-only) -->
      <DividerButton
        onclick={handlePushAllUnpushed}
        disabled={isPushing}
        loading={isPushing}
        data-testid="pr-push-commits-button"
      >
        {unpushedCount === 1
          ? m.workspace_prSection_pushCommit_one()
          : m.workspace_prSection_pushCommit_many({ count: formatInteger(unpushedCount) })}
      </DividerButton>
    {:else if (native.nativeIntent || (native.nativeMode ? canHostOperations : isOwner)) && (native.nativeIntent || (!hasOpenPR && !(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)) || (!hasOpenPR && hasNewWorkAfterMerge))}
      <!-- Show Create PR + Merge buttons when no open PR and not post-merge
           (accept-changes.execute / accept-changes.mergePR / github.*, owner-only) -->
      <div class="w-full flex gap-1">
        <DividerButton
          data-testid="pr-create-button"
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesForPr_tooltip()
            : ''}
          onclick={native.togglePRDrawer}
          expanded={prDrawerOpen}
          disabled={!native.nativeIntent && !hasStaged && !hasCommits}
        >
          {m.workspace_prSection_createPr_label()}
        </DividerButton>
        <DividerButton
          data-testid="pr-merge-button"
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesToMerge_tooltip()
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen) {
              appStore.dispatch(setPRWorkflowDrawer(workspaceId, 'prDrawerOpen', false));
              native.closeNative();
            }
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_merge_label()}
        </DividerButton>
      </div>
      <DividerPanel open={prDrawerOpen}>
        {#if native.nativeMode}
          <NativeSidebarReview review={native} />
        {:else if $canAdministerHost$ && !$githubAuthIsAuthenticated$}
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
                class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md placeholder:text-muted-foreground"
                placeholder={m.workspace_prSection_prTitle_placeholder()}
                bind:value={
                  () => prTitle,
                  (value) =>
                    appStore.dispatch(setPRContent(workspaceId, String(value), prDescription))
                }
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
                oninput={(e) =>
                  appStore.dispatch(
                    setPRContent(workspaceId, prTitle, (e.target as HTMLTextAreaElement).value),
                  )}
                placeholder={m.workspace_prSection_describeChanges_placeholder()}
                doesExpandToFit
                minHeight={80}
                maxHeight={200}
                readonly={isGeneratingPR}
                class="text-sm {isGeneratingPR ? 'border-primary-ink/40 bg-muted/20' : ''}"
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
    {:else if isOwner && isBehind}
      <DividerButton
        data-testid="pr-pull-button"
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
    {:else if !isDiverged && !isBehind && (isOwner || !(hasUnpushedCommits && unpushedCount > 0))}
      <span
        class="relative z-20 text-xs text-subtle flex items-center gap-1 py-1.5 px-3 rounded-md bg-background"
      >
        <Fa icon={faCheck} size="xs" />
        <span>{m.workspace_prSection_synced_label()}</span>
      </span>
    {/if}

    <!-- Rebase onto trunk (accept-changes.execute, owner-only) -->
    {#if isOwner && behindTrunk > 0 && !hasConflicts && aheadOfTrunk !== null}
      <DividerButton
        data-testid="pr-rebase-button"
        onclick={handleRebaseOntoTrunk}
        disabled={isRebasing}
        loading={isRebasing}
        showArrow={false}
      >
        {m.workspace_prSection_rebaseOnto_label({ branch: trunkBranch })}
        <Fa icon={faArrowsRotate} size="xs" class="text-muted-foreground/50" />
      </DividerButton>
    {/if}

    <!-- Force Push Section (owner-only) -->
    {#if isOwner && isDiverged}
      <DividerButton
        data-testid="pr-force-push-button"
        onclick={() => {
          appStore.dispatch(
            setPRWorkflowDrawer(workspaceId, 'forcePushDrawerOpen', !forcePushDrawerOpen),
          );
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
              appStore.dispatch(setPRWorkflowDrawer(workspaceId, 'forcePushDrawerOpen', false));
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
               (secondary-root browsing) mode (monorepo#2053). Its
               unauthenticated path starts `github.connect`, which only the
               owner may call. -->
        {#if !listOnly && isOwner && (hasAnyPRs || $githubAuthIsAuthenticated$)}
          <Button
            variant="ghost"
            type="button"
            size="icon-compact"
            iconOnly
            data-testid="pr-refresh-button"
            class="rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            onclick={() => {
              if (!$githubAuthIsAuthenticated$) {
                authBannerKey++;
              }
              handleRefreshPRStatus();
            }}
            disabled={isRefreshingPR}
            title={$githubAuthIsAuthenticated$
              ? m.workspace_prSection_refreshPrStatus_tooltip()
              : m.workspace_prSection_connectToGithub_label()}
          >
            <Fa icon={faArrowsRotate} class="opacity-50 text-ui" />
          </Button>
        {/if}
      {/snippet}
      {#snippet children()}
        {#if isOwner && !$githubAuthIsAuthenticated$}
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
                variant="ghost"
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
                    contextKey={`${workspaceId}:${prKey(pr)}`}
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
<!-- Merge / connect-remote dividers (accept-changes.*, owner-only) -->
{#if !listOnly && isOwner && !isPRMerged && (!hasRemote || hasOpenPR) && (!(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) || hasNewWorkAfterMerge)}
  <TimelineDivider>
    {#if !hasRemote}
      <div class="w-full flex gap-1">
        <DividerButton
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesToMerge_tooltip()
            : ''}
          onclick={() => {
            onMergeDrawerToggle(!mergeDrawerOpen);
            if (!mergeDrawerOpen)
              appStore.dispatch(setPRWorkflowDrawer(workspaceId, 'connectRemoteDrawerOpen', false));
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_merge_label()}
        </DividerButton>
        <DividerButton
          onclick={() => {
            appStore.dispatch(
              setPRWorkflowDrawer(
                workspaceId,
                'connectRemoteDrawerOpen',
                !connectRemote.drawerOpen,
              ),
            );
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
          class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md placeholder:text-muted-foreground"
          placeholder={m.workspace_prSection_remoteUrl_placeholder()}
          bind:value={remoteUrl}
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
          class="text-primary-ink hover:underline inline-flex items-center gap-0.5"
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
