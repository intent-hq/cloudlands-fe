<script module lang="ts">
  import { store } from '$store/renderer/store';
  import {
    selectRepositoryContextForDemand,
    selectNativeReviewForOwner,
    selectNativeReviewOccupancy,
  } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import {
    executionScopeKey,
    repositoryTargetKey,
    repositoryRootKey,
  } from '$shared/types/repository-context';
  import type { RepositoryContextDemand } from '$store/renderer/slices/repository-context/repository-context-types';
  import type {
    NativeReviewOwner,
    NativeReviewObservation,
  } from '$shared/types/native-review-operation';
  import type { NativeSidebarReviewIntent } from '$store/renderer/slices/changes/changes-types';

  type NativeLifetimeSnapshot = Readonly<{
    parent: NativeReviewOwner | null;
    child: NativeReviewOwner | null;
    demand: RepositoryContextDemand | null;
    host: NativeReviewOwner['hostContext'];
  }>;
  type NativeRetirementSubscription = Readonly<{
    instance: symbol;
    completion: Promise<void>;
    cancel: (reason: unknown) => void;
    release: () => void;
  }>;

  // This observer owns no command capability. Its promise is completed only by
  // the original component's normal cleanup and destruction paths.
  function createNativeRetirement(
    instance: symbol,
    read: () => NativeLifetimeSnapshot,
    isClosed: (owner: NativeReviewOwner) => boolean,
  ) {
    const copyOwner = (owner: NativeReviewOwner | null) =>
      owner ? Object.freeze({ ...owner, root: Object.freeze({ ...owner.root }) }) : null;
    const initial = read();
    const captured: NativeLifetimeSnapshot = Object.freeze({
      parent: copyOwner(initial.parent),
      child: copyOwner(initial.child),
      demand: initial.demand ? Object.freeze({ ...initial.demand }) : null,
      host: initial.host,
    });
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    let active = true;
    let settled = false;
    let demandEnded = captured.demand === null;
    const completion = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // The original promise remains rejected; observing it cannot interrupt cleanup.
    void completion.catch(() => {});
    function fail(reason: unknown) {
      if (!active || settled) return;
      settled = true;
      reject(reason);
    }
    function observe(run: () => void) {
      if (!active || settled) return;
      try {
        run();
      } catch (error) {
        fail(error);
      }
    }
    const sameOwner = (a: NativeReviewOwner | null, b: NativeReviewOwner | null) =>
      a === null
        ? b === null
        : b !== null &&
          a.attemptId === b.attemptId &&
          a.admission === b.admission &&
          a.hostContext === b.hostContext &&
          repositoryRootKey(a.root) === repositoryRootKey(b.root);
    function acknowledge(original: NativeLifetimeSnapshot) {
      for (const key of ['parent', 'child'] as const) {
        if (original[key] !== null && !sameOwner(original[key], captured[key]))
          throw new Error('Native retirement owner changed');
      }
      if (original.demand) {
        if (
          !captured.demand ||
          original.demand.workspaceId !== captured.demand.workspaceId ||
          original.demand.demandId !== captured.demand.demandId ||
          original.demand.admission !== captured.demand.admission ||
          original.host !== captured.host
        )
          throw new Error('Native retirement demand changed');
        demandEnded = true;
      }
    }
    const subscription: NativeRetirementSubscription = Object.freeze({
      instance,
      completion,
      cancel: fail,
      release() {
        fail(new Error('Native retirement observation released before completion'));
        active = false;
      },
    });
    return {
      subscription,
      cleanup<T>(originalCleanup: () => T): T {
        let original: NativeLifetimeSnapshot | undefined;
        observe(() => {
          original = read();
        });
        let result: T;
        try {
          result = originalCleanup();
        } catch (error) {
          fail(error);
          throw error;
        }
        observe(() => {
          if (original) acknowledge(original);
        });
        return result;
      },
      destroyed() {
        observe(() => {
          const remaining = read();
          if (remaining.parent || remaining.child || remaining.demand)
            throw new Error('Native retirement left component owners');
          if (
            !demandEnded ||
            [captured.parent, captured.child].some((owner) => owner && !isClosed(owner))
          )
            throw new Error('Native retirement lacks original closure');
          settled = true;
          resolve();
        });
      },
    };
  }

  const selectNativeRead = store.createSelector((state, demand: RepositoryContextDemand | null) => {
    const view = demand ? selectRepositoryContextForDemand.select(state, demand) : null;
    const entry =
      view?.status === 'ready'
        ? view.roots.find(
            (r) => r.root.kind === 'primary' && r.root.workspaceId === demand?.workspaceId,
          )
        : null;
    const selected =
      entry?.reviewSelection.outcome.state === 'resolved'
        ? entry.reviewSelection.outcome.target
        : null;
    const target =
      selected &&
      entry?.targets.some(
        (item) =>
          repositoryTargetKey(item.target) === repositoryTargetKey(selected) &&
          item.availability === 'connected',
      )
        ? selected
        : null;
    const destinationKey =
      target && view?.scope
        ? JSON.stringify([
            demand?.workspaceId,
            executionScopeKey(view.scope),
            repositoryTargetKey(target),
            entry?.branch,
          ])
        : null;
    return {
      view,
      target,
      destinationKey,
      contextKey:
        destinationKey && view?.revision
          ? JSON.stringify([destinationKey, view.revision.epoch, view.revision.sequence])
          : null,
    };
  });
  const selectNativeAttempt = store.createSelector((state, owner: NativeReviewOwner | null) =>
    owner ? selectNativeReviewForOwner.select(state, owner) : null,
  );
</script>

<script lang="ts">
  import { selectCanAdministerHost } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceHostOperationContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import { Input } from '$lib/components/ui/input';
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
  import { loadGitStatus, setGitOperationFlag } from '$store/renderer/slices/git/git-slice';
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
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Textarea } from '$lib/components/ui/textarea';
  import { notify } from '$lib/components/patterns/notify';
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
  import { tick, untrack, onDestroy } from 'svelte';
  import { readable, writable, toStore } from 'svelte/store';
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

  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
  import {
    repositoryContextDemanded,
    repositoryContextDemandEnded,
    nativeReviewConfirmRequested,
    nativeReviewCompanionRequested,
    nativeReviewReconcileRequested,
    nativeReviewEditEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import { confirm } from '$lib/components/patterns/confirm';
  import type { NativeReviewExecution } from '$shared/types/native-review';

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
  const workspaceIdStore = writable('');
  const canAdministerHost$ = selectCanAdministerHost();
  const hostOperationContext$ = selectWorkspaceHostOperationContext(workspaceIdStore);
  const canHostOperations = $derived(isOwner && $hostOperationContext$ !== null);
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
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below tracks later changes
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
  let expandedPRs = $state<Set<string>>(new Set());
  let connectRemote = $state({ drawerOpen: false, url: '', adding: false });
  let pendingActionAfterAuth = $state<'create-pr' | 'refresh-pr' | null>(null);
  let pendingPRWorkspaceId: string | null = null;
  let authBannerKey = $state(0);

  const nativeEnabled = selectLabsMultiplayerEnabled();
  const nativeAdmission = selectPrincipalAdmissionContext();
  let nativeDemand = $state.raw<RepositoryContextDemand | null>(null);
  let nativeDemandHost =
    $state<ReturnType<typeof selectWorkspaceHostOperationContext.select>>(null);
  let nativeIntent = $state.raw<NativeSidebarReviewIntent | null>(null);
  let nativeChild = $state.raw<NativeReviewOwner | null>(null);
  let nativeBranch = $state('');
  let nativeMessage = $state('');
  let nativeQueued = $state<string | null>(null);
  let nativeConfirming = $state<string | null>(null);
  let nativeParentClaimed = $state(false);
  let nativeChildClaimed = $state(false);
  let nativeChecking = $state<string | null>(null);
  let nativeReadChanged = $state(false);
  let nativeReadKey = $state<string | null>(null);
  const nativeRead = selectNativeRead(toStore(() => nativeDemand));
  const nativeParentView = selectNativeAttempt(toStore(() => nativeIntent?.owner ?? null));
  const nativeChildView = selectNativeAttempt(toStore(() => nativeChild));
  const nativeEntryWithoutOrigin = $derived(
    nativeReview && $nativeEnabled && !listOnly && isOwner && !hasRemote,
  );
  const nativeMode = $derived(
    nativeReview && $nativeEnabled && $nativeRead.target?.provider !== 'github',
  );
  const nativeCommitResult = $derived($nativeParentView?.observation?.execute);
  const nativeCanContinue = $derived(
    !!nativeIntent &&
      !nativeChild &&
      !nativeConfirming &&
      $nativeParentView?.status !== 'unavailable' &&
      nativeCommitResult?.state === 'settled' &&
      nativeCommitResult.success &&
      !$nativeParentView?.observation?.uncertain &&
      nativeCommitResult.reviewExecution?.outcome.status === 'not-attempted' &&
      nativeCommitResult.reviewExecution.gitReceipts.length === 1 &&
      nativeCommitResult.reviewExecution.gitReceipts[0].stage === 'commit',
  );

  const nativeInstance = Symbol('PRSection native lifetime');
  let nativeDestroyed = false;
  let nativeRetirement: ReturnType<typeof createNativeRetirement> | null = null;
  function readNativeLifetime(): NativeLifetimeSnapshot {
    return {
      parent: nativeIntent?.owner ?? null,
      child: nativeChild,
      demand: nativeDemand,
      host: nativeDemandHost,
    };
  }
  export function observeNativeRetirement(): NativeRetirementSubscription {
    if (nativeDestroyed) throw new Error('Original native component already destroyed');
    nativeRetirement ??= createNativeRetirement(nativeInstance, readNativeLifetime, (owner) => {
      const row = selectNativeReviewOccupancy.select(appStore.state, owner.attemptId);
      return (
        !!row &&
        row.status === 'closed' &&
        row.owner.admission === owner.admission &&
        row.owner.hostContext === owner.hostContext &&
        repositoryRootKey(row.owner.root) === repositoryRootKey(owner.root)
      );
    });
    const original = nativeRetirement;
    return Object.freeze({
      ...original.subscription,
      release() {
        original.subscription.release();
        if (nativeRetirement === original) nativeRetirement = null;
      },
    });
  }
  function closeNative() {
    if (!nativeRetirement) return closeNativeOriginal();
    return nativeRetirement.cleanup(closeNativeOriginal);
  }

  function endNativeOwners() {
    const parent = nativeIntent?.owner,
      child = nativeChild;
    nativeIntent = null;
    nativeChild = null;
    nativeQueued = null;
    nativeConfirming = null;
    nativeParentClaimed = false;
    nativeChildClaimed = false;
    nativeChecking = null;
    if (child) appStore.dispatch(nativeReviewEditEnded(child));
    if (parent) appStore.dispatch(nativeReviewEditEnded(parent));
  }
  function closeNativeOriginal() {
    endNativeOwners();
    const original = nativeDemand;
    nativeDemand = null;
    nativeDemandHost = null;
    if (original)
      appStore.dispatch(
        repositoryContextDemandEnded(original.workspaceId, original.demandId, original.admission),
      );
  }
  function startNativeRead() {
    closeNative();
    nativeReadChanged = false;
    nativeReadKey = null;
    const original = Object.freeze({
      workspaceId,
      demandId: crypto.randomUUID(),
      admission: selectPrincipalAdmissionContext.select(appStore.state),
    });
    nativeDemandHost = selectWorkspaceHostOperationContext.select(appStore.state, workspaceId);
    nativeDemand = original;
    appStore.dispatch(
      repositoryContextDemanded(original.workspaceId, original.demandId, original.admission),
    );
  }
  function togglePRDrawer() {
    prDrawerOpen = !prDrawerOpen;
    if (prDrawerOpen) {
      onMergeDrawerToggle(false);
      if (nativeReview && $nativeEnabled) {
        nativeBranch = $workspace$?.baseRef ?? '';
        nativeMessage = _commitMessage;
        if (!nativeDemand) startNativeRead();
      }
    } else closeNative();
  }
  function nativeEligible(owner: NativeReviewOwner) {
    const original = nativeIntent;
    if (
      !original ||
      (owner !== original.owner && owner !== nativeChild) ||
      !prDrawerOpen ||
      listOnly ||
      workspaceId !== owner.root.workspaceId ||
      selectWorkspaceHostOperationContext.select(appStore.state, workspaceId) !==
        owner.hostContext ||
      selectPrincipalAdmissionContext.select(appStore.state) !== owner.admission
    )
      return false;
    const read = selectNativeRead.select(appStore.state, nativeDemand);
    if (read.destinationKey !== original.destinationKey) return false;
    if (!nativeParentClaimed && read.contextKey !== original.contextKey) return false;
    return selectNativeReviewForOwner.select(appStore.state, owner)?.status === 'ready';
  }
  function prepareNativeCommit() {
    const read = selectNativeRead.select(appStore.state, nativeDemand);
    if (
      nativeIntent ||
      nativeReadChanged ||
      !hasStaged ||
      !nativeBranch.trim() ||
      !nativeMessage.trim() ||
      !prTitle.trim() ||
      read.target?.provider !== 'gitlab' ||
      !read.contextKey ||
      read.contextKey !== nativeReadKey ||
      !read.destinationKey
    )
      return;
    const admission = selectPrincipalAdmissionContext.select(appStore.state);
    const hostContext = selectWorkspaceHostOperationContext.select(appStore.state, workspaceId);
    if (!admission || !hostContext || !isOwner || listOnly) return;
    const owner: NativeReviewOwner = Object.freeze({
      root: Object.freeze({ workspaceId, kind: 'primary' }),
      attemptId: crypto.randomUUID(),
      admission,
      hostContext,
    });
    const intent: NativeSidebarReviewIntent = Object.freeze({
      owner,
      targetBranch: nativeBranch,
      commitMessage: nativeMessage,
      prTitle,
      prBody: prDescription,
      contextKey: read.contextKey,
      destinationKey: read.destinationKey,
    });
    nativeIntent = intent;
    backgroundGitActionsService.prepareNativeReview(intent);
  }
  /** The only queue consumer entry: display the original prepared first confirmation. */
  export async function triggerNativeReview(intent: NativeSidebarReviewIntent) {
    const original = nativeIntent;
    if (
      !original ||
      original.owner.attemptId !== intent.owner.attemptId ||
      original.owner.admission !== intent.owner.admission ||
      original.owner.hostContext !== intent.owner.hostContext ||
      original.owner.root.workspaceId !== intent.owner.root.workspaceId ||
      intent.owner.root.kind !== 'primary' ||
      original.contextKey !== intent.contextKey ||
      original.commitMessage !== intent.commitMessage ||
      original.prTitle !== intent.prTitle ||
      original.prBody !== intent.prBody ||
      original.targetBranch !== intent.targetBranch ||
      nativeParentClaimed ||
      nativeConfirming ||
      !nativeEligible(original.owner)
    )
      return;
    const view = selectNativeReviewForOwner.select(appStore.state, original.owner);
    if (!view?.preview?.valid) return;
    const prepared = view.preview.reviewPreparation;
    nativeConfirming = original.owner.attemptId;
    try {
      const agreed = await confirm({
        title: m.workspace_commitDrawer_commit_label(),
        description:
          (view.preview.filesCount === 1
            ? m.workspace_commitDrawer_stagedWillCommit_one()
            : m.workspace_commitDrawer_stagedWillCommit_many({
                count: formatInteger(view.preview.filesCount),
              })) +
          '\n' +
          original.commitMessage +
          '\n' +
          prepared.target.repository.projectPath +
          ' (' +
          prepared.target.repository.instanceBaseUrl +
          ')\n' +
          prepared.source.branch +
          ' → ' +
          prepared.target.branch,
        confirmLabel: m.workspace_commitDrawer_commit_label(),
        cancelLabel: m.workspace_prCreator_cancel_label(),
      });
      if (!agreed || nativeParentClaimed || !nativeEligible(original.owner)) return;
      nativeParentClaimed = true;
      appStore.dispatch(
        nativeReviewConfirmRequested(original.owner, { commitMessage: original.commitMessage }),
      );
    } finally {
      if (nativeConfirming === original.owner.attemptId) nativeConfirming = null;
    }
  }
  function prepareNativeChild() {
    const original = nativeIntent;
    if (!original || !nativeCanContinue || nativeChild || !prDrawerOpen) return;
    const child: NativeReviewOwner = Object.freeze({
      ...original.owner,
      attemptId: crypto.randomUUID(),
    });
    nativeChild = child;
    appStore.dispatch(nativeReviewCompanionRequested(original.owner, child));
  }
  async function confirmNativeChild() {
    const original = nativeIntent,
      child = nativeChild;
    if (!original || !child || nativeChildClaimed || nativeConfirming || !nativeEligible(child))
      return;
    const view = selectNativeReviewForOwner.select(appStore.state, child);
    if (!view?.preview?.valid) return;
    const prepared = view.preview.reviewPreparation;
    nativeConfirming = child.attemptId;
    try {
      const agreed = await confirm({
        title: m.native_review_confirm_title(),
        description: m.native_review_confirm_description({
          title: original.prTitle,
          project:
            prepared.target.repository.projectPath +
            ' (' +
            prepared.target.repository.instanceBaseUrl +
            ')',
          source: prepared.source.branch,
          target: prepared.target.branch,
        }),
        confirmLabel: m.workspace_prCreator_create_label(),
        cancelLabel: m.workspace_prCreator_cancel_label(),
      });
      if (!agreed || nativeChildClaimed || !nativeEligible(child)) return;
      nativeChildClaimed = true;
      appStore.dispatch(
        nativeReviewConfirmRequested(child, { prTitle: original.prTitle, prBody: original.prBody }),
      );
    } finally {
      if (nativeConfirming === child.attemptId) nativeConfirming = null;
    }
  }
  function checkNative(owner: NativeReviewOwner) {
    if (nativeChecking || !selectNativeReviewForOwner.select(appStore.state, owner)) return;
    nativeChecking = owner.attemptId;
    appStore.dispatch(nativeReviewReconcileRequested(owner));
  }
  // Resolve the original read before deciding whether a saved named remote has a native entry.
  // Origin-only status is not repository qualification or command permission.
  $effect(() => {
    const originalWorkspace = workspaceId;
    const originalAdmission = $nativeAdmission;
    const originalHost = $hostOperationContext$;
    if (!nativeEntryWithoutOrigin || !originalWorkspace || !originalAdmission || !originalHost)
      return;
    untrack(() => {
      if (!nativeDemand) startNativeRead();
    });
  });
  $effect(() => {
    const read = $nativeRead;
    if (!nativeDemand) return;
    if (!nativeReadKey && read.contextKey) nativeReadKey = read.contextKey;
    else if (nativeReadKey && read.contextKey !== nativeReadKey) nativeReadChanged = true;
    if (
      nativeIntent &&
      ((nativeParentClaimed &&
        read.view?.status === 'ready' &&
        read.destinationKey !== nativeIntent.destinationKey) ||
        (!nativeParentClaimed && nativeReadChanged))
    )
      endNativeOwners();
  });
  $effect(() => {
    const original = nativeIntent;
    if (
      nativeDemand &&
      (nativeDemand.workspaceId !== workspaceId ||
        nativeDemand.admission !== $nativeAdmission ||
        nativeDemandHost !== $hostOperationContext$ ||
        !nativeReview ||
        !$nativeEnabled ||
        listOnly ||
        !isOwner)
    )
      closeNative();
    if (
      original &&
      (workspaceId !== original.owner.root.workspaceId ||
        listOnly ||
        original.owner.admission !== $nativeAdmission ||
        original.owner.hostContext !== $hostOperationContext$)
    )
      closeNative();
  });
  $effect(() => {
    if (
      nativeIntent &&
      $nativeParentView?.status === 'ready' &&
      nativeQueued !== nativeIntent.owner.attemptId &&
      backgroundGitActionsService.enqueueNativeReview(nativeIntent)
    )
      nativeQueued = nativeIntent.owner.attemptId;
  });
  $effect(() => {
    if ($nativeParentView?.observation || $nativeChildView?.observation) nativeChecking = null;
  });
  onDestroy(() => {
    nativeDestroyed = true;
    try {
      closeNative();
      nativeRetirement?.destroyed();
    } finally {
      nativeRetirement = null;
    }
  });

  // Auto-close PR drawer when nothing to show
  $effect(() => {
    const shouldClose = prDrawerOpen && !nativeDemand && !hasStaged && !hasCommits;
    if (shouldClose) prDrawerOpen = false;
  });

  // Sync PR title/description from accept-changes state
  $effect(() => {
    const ac = $acceptChangesState$;
    if (nativeIntent) return;
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
    const operationWorkspaceId = workspaceId;
    const operationBackendId = appStore.state.connections?.windowBackendId;
    const operationContext = selectWorkspaceHostOperationContext.select(
      appStore.state,
      operationWorkspaceId,
    );
    if (!operationContext) return;
    const isCurrentOperation = () =>
      workspaceId === operationWorkspaceId &&
      selectWorkspaceHostOperationContext.select(appStore.state, operationWorkspaceId) ===
        operationContext;
    if (isRefreshingPR) return;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isRefreshingPR', true));
    try {
      await tick();
      if (!isCurrentOperation()) return;
      if (selectCanAdministerHost.select(appStore.state) && !$githubAuthIsAuthenticated$) {
        appStore.dispatch(initializeGitHubAuth());
      }
      if (selectCanAdministerHost.select(appStore.state) && !$githubAuthIsAuthenticated$) {
        pendingActionAfterAuth = 'refresh-pr';
        notify.info(m.workspace_prSection_connectGithub_label());
        return;
      }
      try {
        if (!isCurrentOperation()) return;
        const fetchResult = await gitClient.fetch(workspaceId as WorkspaceId);
        if (!fetchResult.ok) {
          logger.warn('[PRSection] Git fetch failed:', { error: fetchResult.error });
        }
      } catch (error) {
        logger.warn('[PRSection] Git fetch error:', error);
      }
      if (!isCurrentOperation()) return;
      gitCache.invalidate(`git-status-${workspaceId}`);
      appStore.dispatch(loadGitStatus(workspaceId, true));
      if (!isCurrentOperation()) return;
      appStore.dispatch(refreshPRStatusRequested(workspaceId, true, true));
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (appStore.state.connections?.windowBackendId === operationBackendId)
        appStore.dispatch(setGitOperationFlag(operationWorkspaceId, 'isRefreshingPR', false));
    }
  }

  async function handleCreatePR(opts?: {
    workspaceId?: string;
    targetBranch?: string;
    prTitle?: string;
    prDescription?: string;
  }) {
    if (
      nativeReview &&
      $nativeEnabled &&
      (nativeIntent ||
        selectNativeRead.select(appStore.state, nativeDemand).target?.provider !== 'github')
    )
      return;
    const operationWorkspaceId = opts?.workspaceId ?? workspaceId;
    const operationContext = selectWorkspaceHostOperationContext.select(
      appStore.state,
      operationWorkspaceId,
    );
    if (!operationContext) return;
    const isCurrentOperation = () =>
      workspaceId === operationWorkspaceId &&
      selectWorkspaceHostOperationContext.select(appStore.state, operationWorkspaceId) ===
        operationContext;
    const titleToUse = (opts?.prTitle ?? prTitle).trim();
    const descriptionToUse = (opts?.prDescription ?? prDescription).trim();
    if (!titleToUse) return;
    const wsId = opts?.workspaceId ?? workspaceId;
    if (!selectWorkspaceHostOperationContext.select(appStore.state, wsId)) return;
    if (selectCanAdministerHost.select(appStore.state) && !$githubAuthIsAuthenticated$) {
      appStore.dispatch(initializeGitHubAuth());
    }
    if (selectCanAdministerHost.select(appStore.state) && !$githubAuthIsAuthenticated$) {
      pendingActionAfterAuth = 'create-pr';
      pendingPRWorkspaceId = wsId;
      notify.info(m.workspace_prSection_connectGithub_label());
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
      if (!isCurrentOperation()) return;
      if (result.success) {
        prTitle = '';
        prDescription = '';
        prDrawerOpen = false;
      } else if (result.needsAuth) {
        if (selectCanAdministerHost.select(appStore.state)) {
          pendingActionAfterAuth = 'create-pr';
          pendingPRWorkspaceId = wsId;
          notify.info(m.workspace_prSection_connectGithub_label());
        } else {
          // i18n-ignore (product name)
          notify.info(m.hostExecution_missingAuthorization_description({ resource: 'GitHub' }));
        }
      } else {
        notify.error(result.error || m.workspace_prCreator_createFailed_error());
      }
    } catch {
      notify.error(m.workspace_prCreator_createFailed_error());
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
    if (!selectWorkspaceHostOperationContext.select(appStore.state, workspaceId)) return;
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
    const operationWorkspaceId = workspaceId;
    const operationContext = selectWorkspaceHostOperationContext.select(
      appStore.state,
      operationWorkspaceId,
    );
    if (!operationContext) return;
    const isCurrentOperation = () =>
      workspaceId === operationWorkspaceId &&
      selectWorkspaceHostOperationContext.select(appStore.state, operationWorkspaceId) ===
        operationContext;
    if (!workspaceId || commits.length === 0) return;
    const newestUnpushedHash = commits[0].hash;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', true));
    try {
      if (!isCurrentOperation()) return;
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'push', {
        targetBranch: $workspace$?.branch,
        upToCommitHash: newestUnpushedHash,
      });
      if (!isCurrentOperation()) return;
      if (result.success) {
        gitCache.invalidate(`git-status-${workspaceId}`);
        try {
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
          ]);
        } catch {
          /* Refresh failed but push succeeded */
        }
      } else {
        notify.error(result.error || m.workspace_prSection_pushFailed_error());
      }
    } catch {
      notify.error(m.workspace_prSection_pushCommitsFailed_error());
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isPushing', false));
    }
  }

  async function handleForcePush() {
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', true));
    try {
      const result = await gitClient.push(workspaceId as WorkspaceId, undefined, true);
      if (result.ok) {
        notify.warning(m.workspace_prSection_forcePushDone_label());
        forcePushDrawerOpen = false;
        gitCache.invalidate(`git-status-${workspaceId}`);
        await Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
          appStore.dispatch(refreshRequested(workspaceId, true)),
        ]);
      } else {
        notify.error(result.error || m.workspace_prSection_forcePushFailed_error());
      }
    } catch (error) {
      logger.error('Force push failed', error as Error);
      notify.error(m.workspace_prSection_forcePushFailed_error());
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isForcePushing', false));
    }
  }

  async function handleRebaseOntoTrunk() {
    const operationWorkspaceId = workspaceId;
    const operationContext = selectWorkspaceHostOperationContext.select(
      appStore.state,
      operationWorkspaceId,
    );
    if (!operationContext) return;
    const isCurrentOperation = () =>
      workspaceId === operationWorkspaceId &&
      selectWorkspaceHostOperationContext.select(appStore.state, operationWorkspaceId) ===
        operationContext;
    if (!workspaceId) return;
    const capturedWsId = workspaceId;
    appStore.dispatch(setGitOperationFlag(capturedWsId, 'isRebasing', true));
    try {
      if (!isCurrentOperation()) return;
      const result = await AcceptChangesClient.execute(
        capturedWsId as WorkspaceId,
        'rebase-onto-trunk',
      );
      if (workspaceId !== capturedWsId) return;
      if (!isCurrentOperation()) return;
      if (result.success) {
        appStore.dispatch(ftClearOlderCommits(workspaceId));
        if (result.result?.newBaseSha) {
          try {
            if (!isCurrentOperation()) return;
            await persistWorkspaceChanges({ baseCommitSha: result.result.newBaseSha });
          } catch {
            console.error('Failed to update baseCommitSha after rebase onto trunk');
          }
        }
        if (!isCurrentOperation()) return;
        gitCache.invalidate(`git-status-${capturedWsId}`);
        await Promise.all([
          Promise.resolve(appStore.dispatch(loadGitStatus(capturedWsId, true))),
          appStore.dispatch(refreshRequested(capturedWsId, true)),
        ]);
        appStore.dispatch(refreshAcceptChangesStatus(capturedWsId));
        notify.success(m.workspace_prSection_rebasedOnto_label({ branch: trunkBranch }));
      } else {
        const mainError = result.error || m.workspace_prSection_rebaseFailed_error();
        const stepErrors = result.steps
          ?.filter((s) => s.status === 'failed' && s.error && s.error !== mainError)
          .map((s) => s.error);
        const detailError = stepErrors?.length
          ? `${mainError}\n${stepErrors.join('\n')}`
          : mainError;
        notify.error(detailError);
      }
    } catch (error) {
      logger.error('Rebase onto trunk failed', error as Error);
      notify.error(
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
        notify.error(m.workspace_prSection_pullUnavailable_error());
        return;
      }
      const result = await appClient.git.pull(repoPath, branch);
      if (result.success) {
        notify.success(m.workspace_prSection_pullSuccess_label());
        gitCache.invalidateWorkspace(workspaceId as WorkspaceId);
        appStore.dispatch(loadGitStatus(workspaceId, true));
      } else {
        notify.error(m.workspace_prSection_pullFailed_error({ error: result.error ?? '' }));
      }
    } catch (error) {
      notify.error(
        m.workspace_prSection_pullFailedDetail_error({
          error:
            error instanceof Error ? error.message : m.workspace_prSection_unknownError_label(),
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
      await AcceptChangesClient.addRemote(workspaceId as WorkspaceId, connectRemote.url.trim());
      notify.success(m.workspace_prSection_remoteAdded_label());
      appStore.dispatch(refreshAcceptChangesStatus(workspaceId));
      connectRemote.drawerOpen = false;
      connectRemote.url = '';
    } catch (error) {
      notify.error(
        m.workspace_prSection_addRemoteFailed_error({ error: (error as Error).message }),
      );
    } finally {
      connectRemote.adding = false;
    }
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

{#snippet nativeFacts(execution: NativeReviewExecution | undefined)}
  {#if execution}
    {@const outcome = execution.outcome}
    {#each execution.gitReceipts as receipt, index (index)}
      <p class="break-all" data-native-receipt>
        {receipt.stage === 'commit'
          ? m.native_review_commitReceipt_description({ sha: receipt.commitHash })
          : m.native_review_pushReceipt_description({ sha: receipt.pushedSha })}
      </p>
    {/each}
    {#if outcome.status === 'created' || outcome.status === 'reused'}
      <p data-native-outcome={outcome.status}>
        {outcome.status === 'created'
          ? m.native_review_created_label()
          : m.native_review_reused_label()}
      </p>
      <a class="break-all" href={outcome.review.url} target="_blank" rel="noreferrer"
        >{outcome.review.title}</a
      >
      <p class="break-all">
        {outcome.review.resource.repository.projectPath} ({outcome.review.resource.repository
          .instanceBaseUrl})
      </p>
      <p>
        {m.native_review_source_label()}: {outcome.review.sourceBranch ??
          m.repository_details_unknown_label()}
      </p>
      <p>
        {m.native_review_target_label()}: {outcome.review.targetBranch ??
          m.repository_details_unknown_label()}
      </p>
    {:else if outcome.status === 'failed' || outcome.status === 'uncertain'}
      <p data-native-outcome={outcome.status}>
        {outcome.status === 'failed'
          ? m.native_review_failed_label()
          : m.native_review_uncertain_description()}
      </p>
      <p class="break-words">{outcome.message}</p>
    {/if}
    <p data-native-publication={execution.publication.state}>
      {execution.publication.state === 'included'
        ? m.native_review_included_description()
        : execution.publication.state === 'local-ahead'
          ? m.native_review_localAhead_description()
          : execution.publication.state === 'diverged'
            ? m.native_review_diverged_description()
            : execution.publication.state === 'remote-branch-missing'
              ? m.native_review_missingBranch_description()
              : m.native_review_unknownPublication_description()}
    </p>
    <p class="break-all">
      {m.native_review_localSha_label()}: {execution.publication.localHeadSha ??
        m.repository_details_unknown_label()}
    </p>
    <p class="break-all">
      {m.native_review_remoteSha_label()}: {'remoteSourceSha' in execution.publication
        ? (execution.publication.remoteSourceSha ?? m.repository_details_unknown_label())
        : m.repository_details_unknown_label()}
    </p>
  {/if}
{/snippet}

{#snippet nativeObservationDetails(observation: NativeReviewObservation)}
  {#if observation.execute}
    {@const execute = observation.execute}
    <section aria-label={m.native_review_execution_label()} class="space-y-2">
      <h3 class="font-medium">{m.native_review_execution_label()}</h3>
      {#if execute.error}<p role="alert" class="break-words">{execute.error}</p>{/if}
      {#each execute.steps as step (step.id)}
        {#if step.error}<p role="alert" class="break-words">{step.error}</p>{/if}
      {/each}
      {#if !execute.success}<p>{m.native_review_incomplete_description()}</p>{/if}
      {#if execute.reviewExecution}
        {@render nativeFacts(execute.reviewExecution)}
      {:else}<p>{m.native_review_pending_description()}</p>{/if}
    </section>
  {/if}
  {#if observation.reconciliation}
    <section aria-label={m.native_review_reconciliation_label()} class="space-y-2">
      <h3 class="font-medium">{m.native_review_reconciliation_label()}</h3>
      {#if observation.reconciliation.reviewExecution}
        {@render nativeFacts(observation.reconciliation.reviewExecution)}
      {:else}<p>{m.native_review_pending_description()}</p>{/if}
    </section>
  {/if}
{/snippet}

{#snippet nativeReviewForm()}
  <section
    class="min-w-0 space-y-3"
    aria-label={m.native_review_title_label()}
    data-native-sidebar-review
  >
    {#if !nativeDemand}<Button onclick={startNativeRead}>{m.native_review_start_label()}</Button>
    {:else if $nativeRead.view?.status === 'loading'}<p role="status">
        {m.repository_details_loading_description()}
      </p>{/if}
    {#if nativeReadChanged && !nativeParentClaimed}
      <p role="status">{m.native_review_targetContextChanged_description()}</p>
      <Button onclick={startNativeRead}>{m.native_review_start_label()}</Button>
    {/if}
    {#if nativeDemand && !$hostOperationContext$}<p role="status">
        {m.native_review_unavailable_description()}
      </p>
    {:else if nativeDemand && ($nativeRead.target?.provider === 'gitlab' || nativeIntent)}
      <label class="block text-xs text-subtle" for="sidebar-native-branch"
        >{m.native_review_target_label()}</label
      >
      <Input
        id="sidebar-native-branch"
        bind:value={nativeBranch}
        disabled={!!nativeIntent || nativeReadChanged}
      />
      <p class="text-xs text-subtle">{m.native_review_targetChoice_description()}</p>
      <label class="block text-xs text-subtle" for="sidebar-native-commit"
        >{m.workspace_mergePanel_commitMessage_label()}</label
      >
      <Input id="sidebar-native-commit" bind:value={nativeMessage} disabled={!!nativeIntent} />
      <label class="block text-xs text-subtle" for="sidebar-native-title"
        >{m.workspace_prCreator_titleField_label()}</label
      >
      <Input id="sidebar-native-title" bind:value={prTitle} disabled={!!nativeIntent} />
      <label class="block text-xs text-subtle" for="sidebar-native-body"
        >{m.workspace_prCreator_descriptionField_label()}</label
      >
      <Textarea
        id="sidebar-native-body"
        value={prDescription}
        oninput={(e) => (prDescription = e.currentTarget.value)}
        readonly={!!nativeIntent}
      />
      {#if nativeReadChanged && !nativeParentClaimed}<p role="status">
          {m.native_review_targetContextChanged_description()}
        </p>{/if}
      {#if !nativeIntent}
        <Button
          onclick={prepareNativeCommit}
          disabled={!hasStaged ||
            !nativeBranch.trim() ||
            !nativeMessage.trim() ||
            !prTitle.trim() ||
            nativeReadChanged ||
            !$hostOperationContext$}
        >
          {m.workspace_commitDrawer_commit_label()}
        </Button>
      {:else}
        {#if $nativeParentView?.preview && !nativeParentClaimed}
          <p>
            {$nativeParentView.preview.filesCount === 1
              ? m.workspace_commitDrawer_stagedWillCommit_one()
              : m.workspace_commitDrawer_stagedWillCommit_many({
                  count: formatInteger($nativeParentView.preview.filesCount),
                })}
          </p>
        {/if}
        {#if !nativeParentClaimed && !$nativeParentView?.observation}
          <Button
            onclick={() => nativeIntent && triggerNativeReview(nativeIntent)}
            disabled={$nativeParentView?.status !== 'ready' ||
              !$nativeParentView.preview?.valid ||
              !!nativeConfirming}
          >
            {$nativeParentView?.status === 'capturing'
              ? m.workspace_prSection_preparing_label()
              : m.workspace_commitDrawer_commit_label()}
          </Button>
          <Button variant="secondary" onclick={endNativeOwners} disabled={!!nativeConfirming}
            >{m.native_review_changeTarget_label()}</Button
          >
        {/if}
        {#if !$nativeParentView || $nativeParentView.status === 'unavailable'}<p role="status">
            {m.native_review_unavailable_description()}
          </p>{/if}
        {#if nativeParentClaimed && !$nativeParentView?.observation}<p role="status">
            {m.native_review_pending_description()}
          </p>{/if}
        {#if $nativeParentView?.observation}
          {@render nativeObservationDetails($nativeParentView.observation)}
          {#if $nativeParentView.observation.uncertain}<p role="status">
              {m.native_review_uncertain_description()}
            </p>{/if}
          {#if $nativeParentView.observation.uncertain || $nativeParentView.observation.execute?.state === 'pending'}<Button
              onclick={() => nativeIntent && checkNative(nativeIntent.owner)}
              disabled={!!nativeChecking}>{m.repository_selection_check_label()}</Button
            >{/if}
        {/if}
        {#if nativeCanContinue}<Button onclick={prepareNativeChild}
            >{m.native_review_prepare_label()}</Button
          >{/if}
        {#if nativeChild}
          {#if $nativeChildView?.status === 'capturing'}<p role="status">
              {m.native_review_preparing_description()}
            </p>{/if}
          {#if !$nativeChildView || $nativeChildView.status === 'unavailable'}<p role="status">
              {m.native_review_unavailable_description()}
            </p>{/if}
          {#if $nativeChildView?.preview}
            <p class="break-all" data-native-child-destination>
              {$nativeChildView.preview.reviewPreparation.target.repository.projectPath} ({$nativeChildView
                .preview.reviewPreparation.target.repository.instanceBaseUrl})
            </p>
            <p>
              {$nativeChildView.preview.reviewPreparation.source.branch} → {$nativeChildView.preview
                .reviewPreparation.target.branch}
            </p>
            {#if !nativeChildClaimed}<Button
                onclick={confirmNativeChild}
                disabled={$nativeChildView.status !== 'ready' ||
                  !$nativeChildView.preview.valid ||
                  !!nativeConfirming}>{m.workspace_prCreator_create_label()}</Button
              >{/if}
          {/if}
          {#if nativeChildClaimed && !$nativeChildView?.observation}<p role="status">
              {m.native_review_pending_description()}
            </p>{/if}
          {#if $nativeChildView?.observation}
            {@render nativeObservationDetails($nativeChildView.observation)}
            {#if $nativeChildView.observation.uncertain}<p role="status">
                {m.native_review_uncertain_description()}
              </p>{/if}
            {#if $nativeChildView.observation.uncertain || $nativeChildView.observation.execute?.state === 'pending'}<Button
                onclick={() => nativeChild && checkNative(nativeChild)}
                disabled={!!nativeChecking}>{m.repository_selection_check_label()}</Button
              >{/if}
          {/if}
        {/if}
      {/if}
    {:else if nativeDemand && $nativeRead.view?.status !== 'loading'}<p role="status">
        {m.native_review_unavailable_description()}
      </p>{/if}
    <Button
      variant="ghost"
      onclick={() => {
        closeNative();
        prDrawerOpen = false;
      }}>{m.workspace_prCreator_cancel_label()}</Button
    >
  </section>
{/snippet}

{#if nativeReview && $nativeEnabled && isOwner && !$hostOperationContext$}
  <p role="status">{m.native_review_unavailable_description()}</p>
{/if}

<!-- A qualified native entry is independent of the legacy origin-only status. -->
{#if nativeEntryWithoutOrigin && canHostOperations}
  {#if (!nativeDemand || $nativeRead.target?.provider === 'gitlab' || (prDrawerOpen && nativeMode)) && (nativeIntent || (!hasOpenPR && !(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)) || (!hasOpenPR && hasNewWorkAfterMerge))}
    <TimelineDivider>
      <DividerButton
        data-testid="pr-create-button"
        tooltipContents={!hasStaged && !hasCommits
          ? m.workspace_prSection_noChangesForPr_tooltip()
          : ''}
        onclick={togglePRDrawer}
        expanded={prDrawerOpen}
        disabled={!nativeIntent && !hasStaged && !hasCommits}
        >{m.workspace_prSection_createPr_label()}</DividerButton
      >
      <DividerPanel open={prDrawerOpen}>
        {@render nativeReviewForm()}
      </DividerPanel>
    </TimelineDivider>
  {:else if $nativeRead.view?.status === 'loading'}
    <p role="status">{m.repository_details_loading_description()}</p>
  {:else if $nativeRead.target?.provider !== 'github'}
    <p role="status">{m.native_review_unavailable_description()}</p>
  {/if}
{/if}

<!-- Divider with Create PR, Push Commits button, or Synced status (only when
     the primary workspace has a remote, and never in listOnly mode) -->
{#if hasRemote && !listOnly}
  <TimelineDivider>
    {#if canHostOperations && hasOpenPR && hasUnpushedCommits && unpushedCount > 0 && !isDiverged && !isBehind}
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
    {:else if (nativeIntent || canHostOperations) && (nativeIntent || (!hasOpenPR && !(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk)) || (!hasOpenPR && hasNewWorkAfterMerge))}
      <!-- Show Create PR + Merge buttons when no open PR and not post-merge
           (accept-changes.execute / accept-changes.mergePR / github.*, owner-only) -->
      <div class="w-full flex gap-1">
        <DividerButton
          data-testid="pr-create-button"
          tooltipContents={!hasStaged && !hasCommits
            ? m.workspace_prSection_noChangesForPr_tooltip()
            : ''}
          onclick={togglePRDrawer}
          expanded={prDrawerOpen}
          disabled={!nativeIntent && !hasStaged && !hasCommits}
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
              prDrawerOpen = false;
              closeNative();
            }
          }}
          expanded={mergeDrawerOpen}
          disabled={!hasStaged && !hasCommits}
        >
          {m.workspace_prSection_merge_label()}
        </DividerButton>
      </div>
      <DividerPanel open={prDrawerOpen}>
        {#if nativeMode}
          {@render nativeReviewForm()}
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
    {#if canHostOperations && behindTrunk > 0 && !hasConflicts && aheadOfTrunk !== null}
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
               (secondary-root browsing) mode (monorepo#2053). Its
               unauthenticated path starts `github.connect`, which only the
               owner may call. -->
        {#if !listOnly && canHostOperations && (hasAnyPRs || $githubAuthIsAuthenticated$)}
          <Button
            variant="ghost"
            type="button"
            size="icon-compact"
            iconOnly
            data-testid="pr-refresh-button"
            class="rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            onclick={() => {
              if (selectCanAdministerHost.select(appStore.state) && !$githubAuthIsAuthenticated$) {
                pendingActionAfterAuth = 'refresh-pr';
                authBannerKey++;
              } else {
                handleRefreshPRStatus();
              }
            }}
            disabled={isRefreshingPR}
            title={!$canAdministerHost$ || $githubAuthIsAuthenticated$
              ? m.workspace_prSection_refreshPrStatus_tooltip()
              : m.workspace_prSection_connectToGithub_label()}
          >
            <Fa icon={faArrowsRotate} class="opacity-50 text-ui" />
          </Button>
        {/if}
      {/snippet}
      {#snippet children()}
        {#if canHostOperations && $canAdministerHost$ && !$githubAuthIsAuthenticated$}
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
{#if !listOnly && canHostOperations && !isPRMerged && (!hasRemote || hasOpenPR) && (!(isMergedToTrunk || (areAllPRsMerged && !hasResetToTrunk) || isContentMergedToTrunk) || hasNewWorkAfterMerge)}
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
          class="w-full px-2.5 py-1.5 text-sm bg-muted/30 border border-border rounded-md placeholder:text-muted-foreground"
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
