<script lang="ts">
  /**
   * Accept Changes Panel
   *
   * Timeline-based architecture showing:
   * - Unstaged changes
   * - Staged changes (with commit panel)
   * - Local commits
   * - Pull requests
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faCheckCircle,
    faTimesCircle,
    faExternalLinkAlt,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { workspaceClient } from '$lib/store/slices/workspace/utils/workspace.client';
  import {
    selectStagedWorkingChanges as selectFtStagedChanges,
    selectUnstagedWorkingChanges as selectFtUnstagedChanges,
    selectFileTrackingIsInitialized as selectFtIsInitialized,
  } from '$lib/store/slices/file-tracking/file-tracking-selectors';
  import {
    clearMainPanelView as ftClearMainPanelView,
  } from '$lib/store/slices/file-tracking/file-tracking-slice';
  import {
    stageByPathRequested,
    unstageByPathRequested,
    revertByPathRequested,
    refreshRequested,
  } from '$lib/store/slices/file-tracking/file-tracking-slice';
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import {
    selectExecutorState,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-selectors';
  import {
    executeBackgroundAgent,
    cancelExecution,
    reconnectAgent,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';
  import type { ExecutorStatus } from '$lib/store/slices/background-agent-executor/background-agent-executor-types';
  import type {
    WorkspaceGitStatus,
    PrepareAcceptResponse,
    AcceptChangesResult,
  } from '$features/accept-changes/types';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';

  import ChangeTimeline from './ChangeTimeline.svelte';
  import type { UIFileChange, PRInfo } from './types';
  import confetti from 'canvas-confetti';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { unifiedIdService } from '$shared/services/unified-id.service';
  import { selectSelectedModel } from '$lib/store/slices/model/model-selectors';
  import { setWorkspaceModel } from '$lib/store/slices/model/model-slice';
  import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
  import {
    parseAllReviewComments,
    getReviewStats,
    type ReviewStatus,
  } from '$lib/components/code-review/types';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import { initializeGitHubAuth } from '$lib/store/slices/github-auth/github-auth-slice';
  import { handleLink } from '$features/navigation/link-handler';
  import { track, trackGitOp } from '$lib/services/analytics';
  import {
    addTerminal,
    openTerminalOverlay,
  } from '$lib/store/slices/terminals/terminals-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { loadWorkspacesRequested, setWorkspaceEntity } from '$lib/store/slices/workspace/workspace-slice';
  import { selectAcceptChangesState } from '$lib/store/slices/transient-ui/transient-ui-selectors';
  import {
    clearAcceptChangesForm,
    clearBackgroundOperation,
    resetAcceptChangesOperations,
    setCachedGitStatus,
    setCommitMessage,
    setIsAutofillAndCommitting,
    setIsAutofillAndCreatingPR,
    setPendingCommitAction,
    setPendingPRContext,
    setPRDescription,
    setPRTitle,
    setTargetBranch,
    startBackgroundOperation,
    updateBackgroundOperationPhase,
  } from '$lib/store/slices/transient-ui/transient-ui-slice';
  import {
    resetExecutor,
  } from '$lib/store/slices/background-agent-executor/background-agent-executor-slice';

  const dispatch = getDispatch();
  const selectedModel$ = selectSelectedModel();
  const logger = createLogger('AcceptChangesPanel');
  const githubAuthIsAuthenticated$ = selectGitHubAuthIsAuthenticated();

  // Default timeout for git operations (2 minutes to allow for pre-commit hooks)
  const GIT_OPERATION_TIMEOUT_MS = 120000;

  /**
   * Wraps a promise with a timeout to prevent UI getting stuck if IPC hangs.
   * This is important because HMR or other issues can cause IPC responses to be lost.
   */
  function withTimeout<T>(promise: Promise<T>, timeoutMs = GIT_OPERATION_TIMEOUT_MS): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
      }),
    ]);
  }

  // Celebrate successful merge with confetti
  function celebrateMerge() {
    // Fire confetti from both sides
    const duration = 2000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      });
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }

  interface Props {
    workspaceId: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
    onBack?: () => void;
    onSuccess?: (result: AcceptChangesResult) => void;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
  }

  let {
    workspaceId,
    canGoBack = false,
    canGoForward = false,
    onBack,
    onSuccess,
    onNavigateBack,
    onNavigateForward,
  }: Props = $props();

  const workspace = selectWorkspaceById(workspaceId);
  const acceptChangesState = selectAcceptChangesState(workspaceId);
  const ftStagedChanges$ = selectFtStagedChanges(workspaceId);
  const ftUnstagedChanges$ = selectFtUnstagedChanges(workspaceId);
  const ftIsInitialized$ = selectFtIsInitialized(workspaceId);

  // Background agent executor state from Redux
  const commitExecState$ = selectExecutorState(workspaceId, 'commit');
  const prExecState$ = selectExecutorState(workspaceId, 'pr');
  const reviewExecState$ = selectExecutorState(workspaceId, 'review');

  // State - initialize from transient UI Redux state for persistence across navigation
  let status = $state<WorkspaceGitStatus | null>(null);
  let prepareResult = $state<PrepareAcceptResponse | null>(null);
  let isLoading = $state(true); // Initial full load (no data at all)
  let isLoadingStatus = $state(false); // Loading git status (branch, commits, PRs)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let isLoadingPrepare = $state(false); // Loading prepare data (+/- counts)
  let isExecuting = $state(false);
  let executionResult = $state<AcceptChangesResult | null>(null);

  // Request version counters to prevent stale responses from overwriting fresh data
  // This fixes UI flickering when multiple async requests race
  let prepareRequestVersion = 0;
  let statusRequestVersion = 0;

  // Action states
  let isPushing = $state(false);
  let isCreatingPR = $state(false);
  let isCommitting = $state(false);
  let isExporting = $state(false);
  let isMergingToTrunk = $state(false);
  let isMergedToTrunk = $state(false);

  // GitHub auth modal state
  let showGitHubAuthModal = $state(false);
  let pendingActionAfterAuth = $state<'create-pr' | null>(null);

  // Get panel layout manager for opening terminal tabs



  // Helper: Get attribution from file tracking store for a given file path
  function getAttributionForFile(filePath: string): UIFileChange['attribution'] | undefined {
    // Check both staged and unstaged for the file
    const tracked =
      $ftStagedChanges$.find((c) => c.file === filePath || c.relativePath === filePath) ||
      $ftUnstagedChanges$.find((c) => c.file === filePath || c.relativePath === filePath);

    if (tracked?.attribution?.agent) {
      return {
        agentId: tracked.attribution.agent.agentId,
        agentName: tracked.attribution.agent.agentName,
        sessionId: tracked.attribution.agent.sessionId,
        turnNumber: tracked.attribution.agent.turnNumber,
        timestamp: tracked.attribution.agent.timestamp,
      };
    }
    return undefined;
  }

  // Derived: staged and unstaged files with attribution from file tracking store
  // IMPORTANT: Always use Redux file tracking workingChanges for staged/unstaged status
  // (it has optimistic updates) and augment with prepareResult for +/- counts.
  // This prevents UI flickering when prepareResult is stale after staging/unstaging.

  // Build a lookup map for prepareResult stats by path
  const prepareStatsMap = $derived.by(() => {
    const map = new Map<string, { additions: number; deletions: number }>();
    if (prepareResult?.files) {
      for (const f of prepareResult.files) {
        map.set(f.path, { additions: f.additions, deletions: f.deletions });
      }
    }
    return map;
  });

  const stagedFiles = $derived.by<UIFileChange[]>(() => {
    // Always use Redux staged changes for staged status (has optimistic updates)
    return $ftStagedChanges$.map((c) => {
      const path = c.file || c.relativePath || '';
      const stats = prepareStatsMap.get(path);
      return {
        path,
        additions: stats?.additions ?? 0,
        deletions: stats?.deletions ?? 0,
        staged: true,
        attribution: getAttributionForFile(path),
      };
    });
  });

  const unstagedFiles = $derived.by<UIFileChange[]>(() => {
    // Always use Redux unstaged changes for unstaged status (has optimistic updates)
    return $ftUnstagedChanges$.map((c) => {
      const path = c.file || c.relativePath || '';
      const stats = prepareStatsMap.get(path);
      return {
        path,
        additions: stats?.additions ?? 0,
        deletions: stats?.deletions ?? 0,
        staged: false,
        attribution: getAttributionForFile(path),
      };
    });
  });

  // Derived: local commits
  const localCommits = $derived(status?.localCommits ?? []);

  // Derived: Remote commits (pushed to remote branch)
  const remoteCommits = $derived(localCommits.filter((c) => c.isPushed));

  // Derived: PRs (convert existing PR to array format, with remote commits included)
  const prs = $derived.by<PRInfo[]>(() => {
    const pr = status?.existingPR;
    if (!pr) return [];

    // Map PR state to our status type
    const prStatus: PRInfo['status'] =
      pr.state === 'open' ? 'open' : pr.state === 'merged' ? 'merged' : 'closed';

    return [
      {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        htmlUrl: pr.htmlUrl || pr.url,
        status: prStatus,
        commits: remoteCommits,
      },
    ];
  });

  // Background agent executors - reactive state from Redux
  let prevCommitResult: string | null = null;
  $effect(() => {
    const state = $commitExecState$;
    if (state.status === 'success' && state.result && state.result !== prevCommitResult) {
      prevCommitResult = state.result;
      dispatch(setCommitMessage(workspaceId, state.result));
      toast.success('Commit message generated');
    }
  });

  let prevPRResult: string | null = null;
  $effect(() => {
    const state = $prExecState$;
    if (state.status === 'success' && state.result && state.result !== prevPRResult) {
      prevPRResult = state.result;
      const lines = state.result.trim().split('\n');
      const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
      const descriptionLines = lines.slice(1).join('\n').trim();

      if (titleLine) {
        dispatch(setPRTitle(workspaceId, titleLine));
      } else {
        const branchName = status?.branch || 'feature';
        const cleanBranchName = branchName
          .replace(/^(feature|fix|chore|docs|refactor|test)[-/]/, '')
          .replace(/[-_]/g, ' ')
          .trim();
        dispatch(setPRTitle(workspaceId, cleanBranchName.charAt(0).toUpperCase() + cleanBranchName.slice(1)));
      }

      dispatch(setPRDescription(workspaceId, descriptionLines || state.result));
      toast.success('PR description generated');
    }
  });

  // Track code review state
  interface CodeReviewState {
    result: string | null;
    agentId: string | null;
    stagedFiles: string[];
    status: ReviewStatus;
    streamingText?: string;
    error?: string;
    timestamp?: number;
  }

  let codeReviewState = $state<CodeReviewState>({
    result: null,
    agentId: null,
    stagedFiles: [],
    status: 'idle',
  });

  // Archive of previous reviews (limited to last 5)
  let reviewArchive = $state<Array<CodeReviewState & { timestamp: number }>>([]);

  // Code review executor - reactive state from Redux
  let prevReviewResult: string | null = null;
  $effect(() => {
    const state = $reviewExecState$;

    if (state.status === 'running') {
      codeReviewState = {
        ...codeReviewState,
        agentId: state.agentId || null,
        status: 'running',
      };
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            agentId: state.agentId,
            stagedFiles: stagedFiles.map((f: any) => f.path),
            status: 'running',
          },
        }),
      );
    }

    if (state.status === 'success' && state.result && state.result !== prevReviewResult) {
      prevReviewResult = state.result;
      logger.info('Code review completed', { resultLength: state.result.length });
      const newReviewState: CodeReviewState = {
        result: state.result,
        agentId: state.agentId || null,
        stagedFiles: stagedFiles.map((f: any) => f.path),
        status: 'complete',
        timestamp: Date.now(),
      };
      codeReviewState = newReviewState;
      reviewArchive = [{ ...newReviewState, timestamp: Date.now() }, ...reviewArchive.slice(0, 4)];
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            result: state.result,
            agentId: state.agentId,
            stagedFiles: stagedFiles.map((f: any) => f.path),
            status: 'complete',
          },
        }),
      );
      toast.success('Code review complete');
    }

    if (state.status === 'error' && state.error) {
      codeReviewState = {
        ...codeReviewState,
        error: state.error,
        status: 'error',
      };
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            error: state.error,
            status: 'error',
          },
        }),
      );
    }
  });

  // Check if staged files have changed since the last review
  const stagedFilesSorted = $derived([...stagedFiles.map((f: any) => f.path)].sort().join(','));
  const reviewedFilesSorted = $derived([...codeReviewState.stagedFiles].sort().join(','));

  // Detect staleness when staged files change
  $effect(() => {
    if (
      codeReviewState.status === 'complete' &&
      stagedFilesSorted !== reviewedFilesSorted &&
      stagedFilesSorted.length > 0
    ) {
      codeReviewState = {
        ...codeReviewState,
        status: 'stale',
      };
    }
  });

  // Derived: review state for the button
  const reviewIsRunning = $derived($reviewExecState$.status === 'running' || $reviewExecState$.status === 'initializing');
  const reviewStatus = $derived<ReviewStatus>(
    reviewIsRunning ? 'running' : codeReviewState.status,
  );
  const hasExistingReview = $derived(
    codeReviewState.result !== null && (reviewStatus === 'complete' || reviewStatus === 'stale'),
  );

  // Parse review comments from the result to get counts
  const parsedReviewComments = $derived.by(() => {
    if (!codeReviewState.result) return [];
    return parseAllReviewComments(codeReviewState.result);
  });
  const reviewStats = $derived(getReviewStats(parsedReviewComments));
  const reviewCommentCount = $derived(reviewStats.total);
  const reviewHasCritical = $derived(reviewStats.hasCritical);

  // Track whether we've already reconnected to avoid infinite loops
  let hasReconnectedCommitExecutor = false;
  let hasReconnectedPRExecutor = false;
  let hasReconnectedCodeReviewExecutor = false;

  // Reconnect to running executors on mount (runs once)
  $effect(() => {
    const stored = $acceptChangesState;
    const reviewExec = $reviewExecState$;
    const commitExec = $commitExecState$;
    const prExec = $prExecState$;

    // Reconnect code review executor if it was running and we haven't already reconnected
    if (reviewExec.agentId && !hasReconnectedCodeReviewExecutor) {
      const { agentId, status: savedStatus, result } = reviewExec;
      if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedCodeReviewExecutor = true;
        logger.info('Reconnecting to running code review executor', { agentId, savedStatus });

        codeReviewState = { ...codeReviewState, agentId, status: 'running' };
        window.dispatchEvent(
          new CustomEvent('workspace:open-code-review', {
            detail: { result: null, agentId, stagedFiles: codeReviewState.stagedFiles, status: 'running' },
          }),
        );
        dispatch(reconnectAgent(workspaceId, 'review', agentId!, { status: savedStatus as ExecutorStatus, result }));
      } else if (savedStatus === 'success' && result && !reviewExec.result) {
        hasReconnectedCodeReviewExecutor = true;
        logger.info('Restoring completed code review result', { agentId, resultLength: result.length });
        dispatch(reconnectAgent(workspaceId, 'review', agentId!, { status: savedStatus as ExecutorStatus, result }));
        codeReviewState = { result, agentId, stagedFiles: codeReviewState.stagedFiles, status: 'complete' };
      } else {
        hasReconnectedCodeReviewExecutor = true;
      }
    }

    // Reconnect commit message executor if it was running and we haven't already reconnected
    if (commitExec.agentId && !hasReconnectedCommitExecutor) {
      const { agentId, status: savedStatus, result } = commitExec;
      if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedCommitExecutor = true;
        if (stored.pendingCommitAction) {
          dispatch(setIsAutofillAndCommitting(workspaceId, true));
          dispatch(setPendingCommitAction(workspaceId, stored.pendingCommitAction));
          dispatch(startBackgroundOperation(workspaceId, 'commit', Date.now(), 'Resuming...'));
        }
        dispatch(reconnectAgent(workspaceId, 'commit', agentId!, { status: savedStatus as ExecutorStatus, result }));
      } else if (savedStatus === 'success' && result && !commitExec.result) {
        hasReconnectedCommitExecutor = true;
        dispatch(reconnectAgent(workspaceId, 'commit', agentId!, { status: savedStatus as ExecutorStatus, result }));
      } else {
        hasReconnectedCommitExecutor = true;
      }
    }

    // Reconnect PR description executor if it was running and we haven't already reconnected
    if (prExec.agentId && !hasReconnectedPRExecutor) {
      const { agentId, status: savedStatus, result } = prExec;
      if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedPRExecutor = true;
        if (stored.pendingPRContext) {
          dispatch(setIsAutofillAndCreatingPR(workspaceId, true));
          dispatch(setPendingPRContext(workspaceId, stored.pendingPRContext));
          dispatch(startBackgroundOperation(workspaceId, 'create-pr', Date.now(), 'Resuming...'));
        }
        dispatch(reconnectAgent(workspaceId, 'pr', agentId!, { status: savedStatus as ExecutorStatus, result }));
      } else if (savedStatus === 'success' && result && !prExec.result) {
        hasReconnectedPRExecutor = true;
        if (stored.pendingPRContext) {
          dispatch(setIsAutofillAndCreatingPR(workspaceId, true));
          dispatch(setPendingPRContext(workspaceId, stored.pendingPRContext));
          dispatch(startBackgroundOperation(workspaceId, 'create-pr', Date.now(), 'Resuming...'));
        }
        dispatch(reconnectAgent(workspaceId, 'pr', agentId!, { status: savedStatus as ExecutorStatus, result }));
      } else {
        hasReconnectedPRExecutor = true;
      }
    }

    // Restore pending action states only if we're not reconnecting to a running executor
    if (stored.pendingCommitAction && !commitExec.agentId) {
      dispatch(setPendingCommitAction(workspaceId, stored.pendingCommitAction));
    }
    if (stored.pendingPRContext && !prExec.agentId) {
      dispatch(setPendingPRContext(workspaceId, stored.pendingPRContext));
    }
  });

  // Event listeners for code review actions from other components
  $effect(() => {
    // Handler for re-triggering code review
    const handleTriggerCodeReview = () => {
      logger.info('Received workspace:trigger-code-review event');
      handleReviewStaged(true); // Force new review
    };

    // Handler for stopping code review
    const handleStopCodeReview = () => {
      logger.info('Received workspace:stop-code-review event');
      dispatch(cancelExecution(workspaceId, 'review'));
      codeReviewState = {
        ...codeReviewState,
        status: 'idle',
      };
      dispatch(resetExecutor(workspaceId, 'review'));
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            status: 'idle',
          },
        }),
      );
    };

    window.addEventListener('workspace:trigger-code-review', handleTriggerCodeReview);
    window.addEventListener('workspace:stop-code-review', handleStopCodeReview);

    return () => {
      window.removeEventListener('workspace:trigger-code-review', handleTriggerCodeReview);
      window.removeEventListener('workspace:stop-code-review', handleStopCodeReview);
    };
  });

  // Streaming preview data for commit message generation
  const commitIsRunning = $derived($commitExecState$.status === 'running' || $commitExecState$.status === 'initializing');
  const generatingMessagePreview = $derived(''); // Streaming preview not available via Redux yet
  const generatingMessageStatus = $derived.by(() => {
    if (!commitIsRunning) return '';
    if ($commitExecState$.status === 'initializing') return 'Starting agent...';
    if ($commitExecState$.progress < 20) return 'Analyzing changes...';
    if ($commitExecState$.progress < 50) return 'Generating commit message...';
    return 'Finalizing...';
  });

  // Streaming preview data for PR description generation
  const prIsRunning = $derived($prExecState$.status === 'running' || $prExecState$.status === 'initializing');
  const generatingPRPreview = $derived(''); // Streaming preview not available via Redux yet
  const generatingPRStatus = $derived.by(() => {
    if (!prIsRunning) return '';
    if ($prExecState$.status === 'initializing') return 'Starting agent...';
    if ($prExecState$.progress < 20) return 'Analyzing commits and changes...';
    if ($prExecState$.progress < 50) return 'Generating PR description...';
    return 'Finalizing...';
  });

  // Track file tracking changes to refresh
  // We need to track BOTH the count AND the staged status to detect when files move between staged/unstaged
  let hasInitiallyLoaded = false;
  const stagedCount = $derived($ftStagedChanges$?.length ?? 0);
  const unstagedCount = $derived($ftUnstagedChanges$?.length ?? 0);
  // Create a fingerprint of staged file paths to detect stage/unstage operations
  const stagedFingerprint = $derived(
    $ftStagedChanges$
      ?.map((f) => f.file)
      .sort()
      .join(',') ?? '',
  );

  // Refresh prepare data when staged/unstaged files change
  // Note: refreshRequested has built-in deduplication via saga, so we don't need cooldowns here
  $effect(() => {
    // Depend on counts AND fingerprint so we detect both additions/removals AND stage/unstage operations
    void stagedCount;
    void unstagedCount;
    void stagedFingerprint;

    if (hasInitiallyLoaded && !isLoading && !isExecuting) {
      // Small debounce to batch rapid changes
      const timer = setTimeout(() => {
        refreshPrepareData();
      }, 100);
      return () => clearTimeout(timer);
    }
  });

  // Cache TTL: consider cache valid for 30 seconds
  const CACHE_TTL_MS = 30000;

  // PERF: Determine if we have ANY data to show (from Redux file tracking)
  // This lets us show the timeline immediately even without status/prepareResult
  const hasFilesToShow = $derived(
    $ftStagedChanges$.length > 0 ||
      $ftUnstagedChanges$.length > 0,
  );

  // Check if file tracking state is still initializing
  const isFileTrackingInitialized = $derived($ftIsInitialized$);

  // Track if we've already started loading to prevent the $effect from triggering multiple loads
  // IMPORTANT: We track both the flag AND the workspace ID so we reset when switching workspaces
  let hasStartedLoading = false;
  let loadedForWorkspaceId: string | null = null;

  // Load status on mount - PROGRESSIVE LOADING:
  // 1. Show timeline immediately with files from Redux file tracking state
  // 2. Load status and prepare in PARALLEL
  // 3. Update UI progressively as each completes
  $effect(() => {
    if (workspaceId) {
      // Reset loading state if workspace changed (e.g., user switched workspaces)
      if (loadedForWorkspaceId !== null && loadedForWorkspaceId !== workspaceId) {
        hasStartedLoading = false;
        hasInitiallyLoaded = false;
        // Reset state for new workspace
        status = null;
        prepareResult = null;
        isLoading = true;
      }
      loadedForWorkspaceId = workspaceId;

      // If file tracking store is not yet initialized, wait for it and show skeleton
      if (!isFileTrackingInitialized) {
        isLoading = true;
        return;
      }

      // Only start loading once - prevent infinite loops when store updates trigger this effect
      if (hasStartedLoading) {
        return;
      }
      hasStartedLoading = true;

      const cachedTransientState = selectAcceptChangesState.select(getReduxStore().getState(), workspaceId);
      const cachedStatus = cachedTransientState.cachedGitStatus;
      const cacheAge = cachedTransientState.cachedGitStatusTimestamp
        ? Date.now() - cachedTransientState.cachedGitStatusTimestamp
        : null;

      if (cachedStatus && cacheAge !== null && cacheAge !== undefined && cacheAge < CACHE_TTL_MS) {
        // Use cached status data immediately for instant display
        status = cachedStatus;
        if (!$acceptChangesState.targetBranch) {
          dispatch(setTargetBranch(workspaceId, cachedStatus.trunkBranch));
        }
        // PERF: Show UI immediately since we have cached status + files from Redux
        isLoading = false;
        hasInitiallyLoaded = true;

        // Load prepare data and refresh status in PARALLEL in background
        Promise.all([prepareAction(), loadStatusOnly()]);
      } else if (hasFilesToShow) {
        // PERF: No cached status, but we have files from Redux file tracking
        // Show timeline immediately with files, load status/prepare in background
        isLoading = false;
        hasInitiallyLoaded = true;

        // Load both in parallel
        Promise.all([loadStatusOnly(), prepareAction()]);
      } else {
        // No cached data AND no files - show skeleton and load everything
        loadAll();
      }
    }
  });

  // Load only git status (branch, commits, PRs) - used for background refresh
  async function loadStatusOnly() {
    // Capture version at start to prevent stale responses from overwriting fresh data
    const thisVersion = ++statusRequestVersion;
    isLoadingStatus = true;
    try {
      // Refresh file tracking in background (don't await - it may be slow)
      dispatch(refreshRequested(workspaceId));

      const newStatus = await AcceptChangesClient.getStatus(WorkspaceId(workspaceId));

      // Only update state if this is still the most recent request
      if (thisVersion !== statusRequestVersion) return;

      status = newStatus;

      // Cache the status for future navigation
      dispatch(setCachedGitStatus(workspaceId, newStatus, Date.now()));

      if (!$acceptChangesState.targetBranch) {
        dispatch(setTargetBranch(workspaceId, newStatus.trunkBranch));
      }
    } catch (error) {
      logger.error('Failed to load status', error as Error);
      // Don't show toast for background refresh failures
    } finally {
      // Only clear loading state if this is still the most recent request
      if (thisVersion === statusRequestVersion) {
        isLoadingStatus = false;
      }
    }
  }

  // Load everything (for initial load with no data)
  async function loadAll() {
    // Capture version at start to prevent stale responses from overwriting fresh data
    const thisStatusVersion = ++statusRequestVersion;
    isLoading = true;
    isLoadingStatus = true;
    isLoadingPrepare = true;
    try {
      // Refresh file tracking in background (dispatch is synchronous)
      dispatch(refreshRequested(workspaceId));
      // Load status
      const newStatus = await AcceptChangesClient.getStatus(WorkspaceId(workspaceId));

      // Only update status if this is still the most recent request
      if (thisStatusVersion === statusRequestVersion) {
        status = newStatus;
        isLoadingStatus = false;
        dispatch(setCachedGitStatus(workspaceId, newStatus, Date.now()));

        if (!$acceptChangesState.targetBranch) {
          dispatch(setTargetBranch(workspaceId, newStatus.trunkBranch));
        }
      }

      // Now load prepare data (prepareAction manages its own version check)
      await prepareAction();
    } catch (error) {
      logger.error('Failed to load status', error as Error);
      toast.error('Failed to load git status');
    } finally {
      isLoading = false;
      if (thisStatusVersion === statusRequestVersion) {
        isLoadingStatus = false;
      }
      // isLoadingPrepare is handled by prepareAction
      hasInitiallyLoaded = true;
    }
  }

  async function prepareAction() {
    if (!workspaceId) return;
    // Capture version at start to prevent stale responses from overwriting fresh data
    const thisVersion = ++prepareRequestVersion;
    isLoadingPrepare = true;
    try {
      const result = await AcceptChangesClient.prepare(WorkspaceId(workspaceId), 'commit');

      // Only update state if this is still the most recent request
      if (thisVersion !== prepareRequestVersion) return;

      prepareResult = result;
      if (result.suggestedCommitMessage && !$acceptChangesState.commitMessage) {
        dispatch(setCommitMessage(workspaceId, result.suggestedCommitMessage));
      }
    } catch (error) {
      logger.error('Failed to prepare action', error as Error);
    } finally {
      // Only clear loading state if this is still the most recent request
      if (thisVersion === prepareRequestVersion) {
        isLoadingPrepare = false;
      }
    }
  }

  async function refreshPrepareData() {
    if (!workspaceId || isExecuting) return;
    // Capture version at start to prevent stale responses from overwriting fresh data
    const thisVersion = ++prepareRequestVersion;
    isLoadingPrepare = true;
    try {
      const result = await AcceptChangesClient.prepare(WorkspaceId(workspaceId), 'commit');

      // Only update state if this is still the most recent request
      if (thisVersion !== prepareRequestVersion) {
        logger.debug('Discarding stale prepare response', {
          requestVersion: thisVersion,
          currentVersion: prepareRequestVersion,
        });
        return;
      }

      prepareResult = result;
    } catch (error) {
      logger.error('Failed to refresh prepare data', error as Error);
    } finally {
      // Only clear loading state if this is still the most recent request
      if (thisVersion === prepareRequestVersion) {
        isLoadingPrepare = false;
      }
    }
  }

  // Background refresh after actions (commit, push, etc) - doesn't show loading indicators
  async function loadStatus(showLoading = true) {
    // This is used for refreshing after actions - run in background without blocking UI
    void showLoading; // Unused but kept for API compatibility
    await Promise.all([loadStatusOnly(), prepareAction()]);
  }

  // Actions - use Redux file tracking to keep both panels in sync
  async function handleStage(filePath: string) {
    try {
      getReduxStore().dispatch(stageByPathRequested(workspaceId, [filePath]));
      await refreshPrepareData();
      // Track staging event
      track('Staged Changes', { method: 'file', file_count: 1 });
    } catch (error) {
      logger.error('Failed to stage file', error as Error, { filePath });
      toast.error('Failed to stage file');
    }
  }

  async function handleUnstage(filePath: string) {
    try {
      getReduxStore().dispatch(unstageByPathRequested(workspaceId, [filePath]));
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage file', error as Error, { filePath });
      toast.error('Failed to unstage file');
    }
  }

  async function handleStageAll() {
    try {
      const paths = unstagedFiles.map((f) => f.path);
      getReduxStore().dispatch(stageByPathRequested(workspaceId, paths));
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to stage all files', error as Error);
      toast.error('Failed to stage files');
    }
  }

  async function handleUnstageAll() {
    try {
      const paths = stagedFiles.map((f) => f.path);
      getReduxStore().dispatch(unstageByPathRequested(workspaceId, paths));
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage all files', error as Error);
      toast.error('Failed to unstage files');
    }
  }

  // Batch stage a group of files (used for per-agent-group staging)
  async function handleStageGroup(paths: string[]) {
    try {
      getReduxStore().dispatch(stageByPathRequested(workspaceId, paths));
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to stage file group', error as Error, { count: paths.length });
      toast.error('Failed to stage files');
    }
  }

  // Batch unstage a group of files (used for per-agent-group unstaging)
  async function handleUnstageGroup(paths: string[]) {
    try {
      getReduxStore().dispatch(unstageByPathRequested(workspaceId, paths));
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage file group', error as Error, { count: paths.length });
      toast.error('Failed to unstage files');
    }
  }

  async function handleRevert(filePath: string) {
    // Use optimistic revert - UI updates immediately, toast shows right away
    toast.warning('Changes reverted');

    // Dispatch revert action - saga handles optimistic update + rollback on failure
    getReduxStore().dispatch(revertByPathRequested(workspaceId, [filePath]));
    {
      // Refresh prepare data in background to update the timeline
      refreshPrepareData().catch((err) => {
        logger.error('Failed to refresh prepare data after revert', err as Error);
      });
    }
  }

  async function handlePickExportFolder(): Promise<string | undefined> {
    try {
      const result = await window.electronAPI?.invoke('dialog:open', {
        directory: true,
        title: 'Select Export Folder',
      });

      if (result && typeof result === 'object' && 'data' in result) {
        if (!result.data?.canceled && result.data?.filePaths?.[0]) {
          return result.data.filePaths[0];
        }
      } else if (result && typeof result === 'string') {
        return result;
      }
      return undefined;
    } catch (error) {
      logger.error('Failed to open folder picker', error as Error);
      toast.error('Failed to open folder picker');
      return undefined;
    }
  }

  async function handleExport(targetPath: string) {
    isExporting = true;
    try {
      await AcceptChangesClient.exportFiles(WorkspaceId(workspaceId), targetPath, {
        preserveStructure: true,
      });
      toast.success('Files exported successfully');
    } catch (error) {
      logger.error('Failed to export files', error as Error, { targetPath });
      toast.error('Failed to export files');
    } finally {
      isExporting = false;
    }
  }

  async function handleGenerateMessage() {
    if (!$workspace) return;
    dispatch(executeBackgroundAgent(workspaceId, 'commit'));
  }

  function handleOpenExistingReview() {
    // Open the existing review in the main panel
    window.dispatchEvent(
      new CustomEvent('workspace:open-code-review', {
        detail: {
          result: codeReviewState.result,
          agentId: codeReviewState.agentId,
          stagedFiles: codeReviewState.stagedFiles,
          status: codeReviewState.status,
        },
      }),
    );
  }

  async function handleReviewStaged(forceNew = false) {
    if (!$workspace) return;

    logger.info('handleReviewStaged called', {
      forceNew,
      executorStatus: $reviewExecState$.status,
      executorIsRunning: reviewIsRunning,
      executorAgentId: $reviewExecState$.agentId,
      hasExistingReview,
      codeReviewStateStatus: codeReviewState.status,
    });

    // Don't start a new review if one is already running
    if (reviewIsRunning) {
      logger.info('Executor already running, opening existing review');
      handleOpenExistingReview();
      return;
    }

    // If there's an existing complete review and we're not forcing a new one, just open it
    if (hasExistingReview && !forceNew) {
      logger.info('Existing review found, opening it');
      handleOpenExistingReview();
      return;
    }

    // Update local state to running
    codeReviewState = {
      result: null,
      agentId: $reviewExecState$.agentId || null,
      stagedFiles: stagedFiles.map((f) => f.path),
      status: 'running',
    };

    // Open the review panel immediately when starting
    window.dispatchEvent(
      new CustomEvent('workspace:open-code-review', {
        detail: {
          result: null,
          agentId: $reviewExecState$.agentId,
          stagedFiles: stagedFiles.map((f) => f.path),
          status: 'running',
        },
      }),
    );

    // Track new code review request (only fires for new reviews, not re-opens)
    track('Requested Code Review', { staged_file_count: stagedFiles.length });

    // Pass staged files as context for the review
    dispatch(executeBackgroundAgent(workspaceId, 'review', {
      files: stagedFiles.map((f) => f.path),
    }));
  }

  function handleOpenArchivedReview(review: CodeReviewState & { timestamp: number }) {
    window.dispatchEvent(
      new CustomEvent('workspace:open-code-review', {
        detail: {
          result: review.result,
          agentId: review.agentId,
          stagedFiles: review.stagedFiles,
          status: 'complete', // Archived reviews are always shown as complete
          isArchived: true,
        },
      }),
    );
  }

  async function handleCommit() {
    if (!workspaceId || !$acceptChangesState.commitMessage.trim()) return;

    isCommitting = true;
    logger.info('Starting commit', { workspaceId, messageLength: $acceptChangesState.commitMessage.length });
    try {
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'commit', {
          commitMessage: $acceptChangesState.commitMessage,
          stageUnstaged: false,
        }),
      );

      logger.info('Commit result received', { success: result.success, error: result.error });

      trackGitOp('commit', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        logger.info('Commit succeeded, updating UI');
        toast.success('Changes committed');
        dispatch(setCommitMessage(workspaceId, ''));
        dispatch(resetAcceptChangesOperations(workspaceId));
        logger.info('Loading status after successful commit');
        await loadStatus(false);
        logger.info('Status loaded, calling onSuccess callback');
        onSuccess?.(result);
      } else {
        logger.warn('Commit failed', { error: result.error });
        toast.error(result.error || 'Failed to commit');
      }
    } catch (error) {
      trackGitOp('commit', { workspaceId, success: false, trigger: 'manual' });
      logger.error('Failed to commit changes', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to commit changes';
      if (errorMessage.includes('timed out')) {
        toast.error('Commit timed out. Check git status to see if it succeeded.');
        // Reload status to check if commit actually succeeded
        await loadStatus(false);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      logger.info('Commit operation complete, resetting isCommitting flag');
      isCommitting = false;
    }
  }

  async function handlePush() {
    if (!workspaceId) return;

    isPushing = true;
    try {
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'push', {
          targetBranch: $acceptChangesState.targetBranch,
        }),
      );

      trackGitOp('push', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        toast.success('Changes pushed');
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('Push failed', { error: result.error, targetBranch: $acceptChangesState.targetBranch });
        toast.error(result.error || 'Failed to push');
      }
    } catch (error) {
      trackGitOp('push', { workspaceId, success: false, trigger: 'manual' });
      logger.error('Failed to push changes', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to push changes';
      if (errorMessage.includes('timed out')) {
        toast.error('Push timed out. Check git status to see if it succeeded.');
        await loadStatus(false);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      isPushing = false;
    }
  }

  async function handleAddRemote(remoteUrl: string) {
    if (!workspaceId) return;
    try {
      const newStatus = await AcceptChangesClient.addRemote(WorkspaceId(workspaceId), remoteUrl);
      status = newStatus;
      toast.success('Remote added successfully');
    } catch (error) {
      toast.error(`Failed to add remote: ${(error as Error).message}`);
      throw error;
    }
  }

  async function handleMergeToTrunk(options?: { squash?: boolean; rebaseFirst?: boolean }) {
    if (!workspaceId) return;

    isMergingToTrunk = true;
    try {
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'merge', {
          targetBranch: $acceptChangesState.targetBranch,
          mergeStrategy: options?.squash ? 'squash' : 'merge',
          rebaseFirst: options?.rebaseFirst,
        }),
      );

      trackGitOp('merge', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        toast.success(`Changes merged into ${$acceptChangesState.targetBranch}`);
        isMergedToTrunk = true;
        celebrateMerge();
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('Merge failed', { error: result.error, targetBranch: $acceptChangesState.targetBranch });

        // Check if this is a "behind trunk" error that can be resolved with rebase
        const errorMsg = result.error || '';
        const needsRebase =
          errorMsg.includes('behind') ||
          errorMsg.includes('rebase') ||
          errorMsg.includes('Please rebase first');

        if (needsRebase && !options?.rebaseFirst) {
          // Show toast with action to open terminal and run rebase
          toast.error('Branch is behind trunk', {
            description: 'Your branch needs to be rebased before merging.',
            action: {
              label: 'Rebase in Terminal',
              onClick: () => openRebaseTerminal(),
            },
            duration: 10000,
          });
        } else {
          toast.error(result.error || 'Failed to merge');
        }
      }
    } catch (error) {
      trackGitOp('merge', { workspaceId, success: false, trigger: 'manual' });
      logger.error('Failed to merge to trunk', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to merge changes';
      if (errorMessage.includes('timed out')) {
        toast.error('Merge timed out. Check git status to see if it succeeded.');
        await loadStatus(false);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      isMergingToTrunk = false;
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
      const trunkBranch = status?.trunkBranch || 'main';
      const tb = $acceptChangesState.targetBranch || trunkBranch;
      const rebaseCommand = `git fetch origin ${tb} && git rebase origin/${tb}`;

      // Create terminal with the rebase command
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId,
        command: rebaseCommand,
        cwd: worktreePath,
        title: `Rebase onto ${tb}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        const terminalTitle = `Rebase onto ${tb}`;
        dispatch(addTerminal(workspaceId, result.terminalId, terminalTitle));
        dispatch(openTerminalOverlay(workspaceId, result.terminalId));

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

  function handleStartNewSpace() {
    // Navigate to the new workspace creation page with the same repo context
    const repo = $workspace?.repositoryPath;
    if (repo) {
      // Dispatch event to start new workspace with same repo
      window.dispatchEvent(
        new CustomEvent('workspace:create-for-repo', {
          detail: { repositoryPath: repo },
        }),
      );
    } else {
      window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
    }
  }

  let isCreatingWorkspace = $state(false);

  async function handleCreateWorkspace(prompt: string) {
    if (!$workspace?.repositoryPath) {
      toast.error('No repository path found');
      return;
    }

    isCreatingWorkspace = true;

    try {
      // Archive the current workspace first
      if ($workspace.id) {
        const archiveResult = await workspaceClient.archive($workspace.id);
        if (!archiveResult.ok) {
          toast.error('Failed to archive workspace');
          isCreatingWorkspace = false;
          return;
        }
        dispatch(loadWorkspacesRequested());
      }

      const repoPath = $workspace.repositoryPath;
      const baseBranch = $workspace.baseRef || $workspace.branch || 'main';

      // Generate a unique agent ID for the initial agent
      const initialAgentId = unifiedIdService.generateAgentId();

      // Get model from model store
      const selectedModel = $selectedModel$ || DEFAULT_AGENT_MODEL;

      // Prepare the initial agent configuration
      const initialAgent = {
        agentId: String(initialAgentId),
        name: 'Starting new Space',
        model: selectedModel ?? undefined, // undefined means use specialist default
        prompt: prompt.trim() || undefined,
        agentType: createAgentTypeId('workspace'),
        metadata: {
          source: 'accept-changes-panel',
          isInitialAgent: true,
          createdAt: new Date().toISOString(),
        },
      };

      // Build environment config if remote
      const environmentConfig =
        $workspace.environmentConfig?.type === 'remote' && $workspace.environmentConfig?.ssh
          ? {
              type: 'remote' as const,
              ssh: $workspace.environmentConfig.ssh,
            }
          : undefined;

      // Create the workspace
      // Note: Branch name will be generated by the backend using the workspace ID
      const result = await workspaceClient.create({
        title: repoPath.split('/').pop() || 'New Workspace',
        repositoryPath: repoPath,
        // branch is omitted - backend will use workspace ID as branch name
        baseRef: baseBranch,
        environmentConfig,
        initialAgent,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to create space');
      }

      const newWorkspace = result.data;
      dispatch(setWorkspaceEntity(newWorkspace));

      logger.info('Workspace created successfully from Accept Changes', {
        workspaceId: newWorkspace.id,
        title: newWorkspace.title,
      });

      // Save the selected model as the workspace's default model
      if (selectedModel) {
        dispatch(setWorkspaceModel({ workspaceId: newWorkspace.id, model: selectedModel }));
      }

      // Store the initial agent configuration for the workspace page to pick up
      const agentConfigData = {
        agentId: initialAgent.agentId,
        config: {
          ...initialAgent,
          isInitialAgent: true,
          isFirstWorkspaceAgent: true,
        },
        timestamp: Date.now(),
      };

      sessionStorage.setItem(
        `workspace:${newWorkspace.id}:initial-agent-pending`,
        JSON.stringify(agentConfigData),
      );

      toast.success('New space created!');

      // Navigate to the new workspace using full page navigation
      // We use window.location.href instead of SvelteKit's goto() because the workspace page
      // has 24+ reactive effects that all fire when workspaceId changes. Client-side navigation
      // between workspaces causes an "effect_update_depth_exceeded" error due to the cascade.
      // A full page load avoids this by resetting all reactive state cleanly.
      window.location.href = `/workspace/${newWorkspace.id}`;
    } catch (error) {
      logger.error('Failed to create workspace', error as Error);
      toast.error(error instanceof Error ? error.message : 'Failed to create space');
    } finally {
      isCreatingWorkspace = false;
    }
  }

  async function handleAddToPR(includeCommit: boolean) {
    if (!workspaceId) return;

    // If including commit, we need a commit message
    if (includeCommit && !$acceptChangesState.commitMessage.trim()) {
      toast.error('Please enter a commit message');
      return;
    }

    isPushing = true;
    if (includeCommit) {
      isCommitting = true;
    }

    try {
      if (includeCommit) {
        // Commit + push in one action
        const result = await withTimeout(
          AcceptChangesClient.execute(WorkspaceId(workspaceId), 'commit', {
            commitMessage: $acceptChangesState.commitMessage,
            pushAfterCommit: true,
          }),
        );

        trackGitOp('commit', { workspaceId, success: result.success, trigger: 'manual' });
        if (result.success) {
          toast.success('Changes added to PR');
          dispatch(setCommitMessage(workspaceId, ''));
          await loadStatus(false);
          onSuccess?.(result);
        } else {
          logger.warn('Add to PR failed', { error: result.error });
          toast.error(result.error || 'Failed to add to PR');
        }
      } else {
        // Just push
        const result = await withTimeout(
          AcceptChangesClient.execute(WorkspaceId(workspaceId), 'push', {
            targetBranch: $acceptChangesState.targetBranch,
          }),
        );

        trackGitOp('push', {
          workspaceId,
          success: result.success,
          trigger: 'manual',
          hasPr: true,
        });
        if (result.success) {
          toast.success('Changes added to PR');
          await loadStatus(false);
          onSuccess?.(result);
        } else {
          logger.warn('Add to PR failed', { error: result.error });
          toast.error(result.error || 'Failed to add to PR');
        }
      }
    } catch (error) {
      trackGitOp(includeCommit ? 'commit' : 'push', {
        workspaceId,
        success: false,
        trigger: 'manual',
      });
      logger.error('Failed to add to PR', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to add to PR';
      if (errorMessage.includes('timed out')) {
        toast.error('Operation timed out. Check git status to see if it succeeded.');
        await loadStatus(false);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      isPushing = false;
      isCommitting = false;
    }
  }

  async function handleCreatePR() {
    if (!workspaceId) return;

    // Ensure GitHub authentication before attempting to create a PR
    if (!$githubAuthIsAuthenticated$) {
      dispatch(initializeGitHubAuth());
    }

    if (!$githubAuthIsAuthenticated$) {
      pendingActionAfterAuth = 'create-pr';
      showGitHubAuthModal = true;
      return;
    }

    isCreatingPR = true;
    try {
      const title = $acceptChangesState.prTitle || `Changes from ${status?.branch}`;
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'create-pr', {
          targetBranch: $acceptChangesState.targetBranch,
          prTitle: title,
          prBody: $acceptChangesState.prDescription,
          // Use PR title as commit message if there are staged changes to commit
          commitMessage: title,
        }),
      );

      trackGitOp('create-pr', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        dispatch(clearAcceptChangesForm(workspaceId));
        dispatch(resetAcceptChangesOperations(workspaceId));
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('PR creation failed', { error: result.error, title, targetBranch: $acceptChangesState.targetBranch });
        if (result.error?.toLowerCase().includes('github authentication')) {
          pendingActionAfterAuth = 'create-pr';
          showGitHubAuthModal = true;
        } else {
          toast.error(result.error || 'Failed to create PR');
        }
        // Still refresh status - commit may have succeeded before PR creation failed
        await loadStatus(false);
      }
    } catch (error) {
      trackGitOp('create-pr', { workspaceId, success: false, trigger: 'manual' });
      logger.error('Failed to create pull request', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create pull request';
      if (errorMessage.includes('timed out')) {
        toast.error('PR creation timed out. Check GitHub to see if it was created.');
      } else if (errorMessage.toLowerCase().includes('github authentication')) {
        pendingActionAfterAuth = 'create-pr';
        showGitHubAuthModal = true;
      } else {
        toast.error(errorMessage);
      }
      // Always refresh status - commit/push may have succeeded before error
      await loadStatus(false);
    } finally {
      isCreatingPR = false;
    }
  }

  async function handleGeneratePR(context: {
    includeStagedFiles: boolean;
    includeCommitHashes: string[];
    targetBranch: string;
  }) {
    if (!$workspace) return;
    dispatch(executeBackgroundAgent(workspaceId, 'pr', {
      includeStagedFiles: context.includeStagedFiles,
      includeCommitHashes: context.includeCommitHashes,
      targetBranch: context.targetBranch,
      baseBranch: context.targetBranch,
    }));
  }

  function handleFileClick(
    filePath: string,
    commitHash?: string,
    staged?: boolean,
    event?: MouseEvent,
  ) {
    // Check if file is in staged or unstaged list
    const stagedFile = stagedFiles.find((f) => f.path === filePath);
    const unstagedFile = unstagedFiles.find((f) => f.path === filePath);
    const file = stagedFile || unstagedFile;
    // Use the staged parameter from the click event if provided, otherwise fall back to checking the list
    const isStaged = staged !== undefined ? staged : !!stagedFile;

    // Infer status from additions/deletions if not explicitly set
    let fileStatus: 'added' | 'modified' | 'deleted' = 'modified';
    if (file) {
      if (file.status) {
        fileStatus = file.status === 'renamed' ? 'modified' : file.status;
      } else if (file.additions > 0 && file.deletions === 0) {
        fileStatus = 'added';
      } else if (file.deletions > 0 && file.additions === 0) {
        fileStatus = 'deleted';
      }
    }

    // Determine the stage based on context
    // If commitHash is provided, this is a committed file
    // Otherwise, check if it's staged or unstaged
    const stage = commitHash ? 'committed' : isStaged ? 'staged' : 'unstaged';

    const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
    const panelElement = event?.target
      ? (event.target as HTMLElement)?.closest('[data-panel-id]')
      : null;
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

    const change = {
      id: `accept-file-${filePath}${commitHash ? `-${commitHash}` : ''}`,
      file: filePath,
      relativePath: filePath,
      status: fileStatus,
      stage,
      commitHash, // Include commit hash for committed files
    };

    window.dispatchEvent(
      new CustomEvent('workspace:open-diff', {
        detail: { change, filePath, changeId: change.id, openInAdjacentPanel, sourcePanelId },
      }),
    );
  }

  function handleOpenPR(url: string) {
    handleLink(url, { workspaceId: WorkspaceId(workspaceId) });
  }

  function handleOpenCommit(hash: string) {
    // Construct GitHub commit URL from remote URL
    const remoteUrl = status?.remoteUrl;
    if (remoteUrl) {
      // Parse remote URL (handles both HTTPS and SSH formats)
      // SSH: git@github.com:org/repo.git
      // HTTPS: https://github.com/org/repo.git
      let baseUrl = remoteUrl;
      if (baseUrl.startsWith('git@')) {
        // Convert SSH to HTTPS: git@github.com:org/repo.git -> https://github.com/org/repo.git
        baseUrl = baseUrl.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2');
      }
      baseUrl = baseUrl.replace(/\.git$/, '');
      const commitUrl = `${baseUrl}/commit/${hash}`;
      handleLink(commitUrl, { workspaceId: WorkspaceId(workspaceId) });
    }
  }

  function handleViewCommitThoughtProcess(e?: MouseEvent) {
    const agentId = selectExecutorState.select(getReduxStore().getState(), workspaceId, 'commit').agentId;
    if (agentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }

  function handleViewPRThoughtProcess(e?: MouseEvent) {
    const agentId = selectExecutorState.select(getReduxStore().getState(), workspaceId, 'pr').agentId;
    if (agentId) {
      const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId, sourcePanelId, openInAdjacentPanel },
        }),
      );
    }
  }



  // Watch for commit message executor completion to trigger auto-submit
  $effect(() => {
    const pendingAction = $acceptChangesState.pendingCommitAction;
    if (pendingAction && $commitExecState$.result && !commitIsRunning) {
      const action = pendingAction;

      untrack(() => {
        dispatch(setPendingCommitAction(workspaceId, null));

        // Set the commit message from the result
        dispatch(setCommitMessage(workspaceId, $commitExecState$.result!));

        // Update phase to executing (git operations)
        dispatch(updateBackgroundOperationPhase(workspaceId, 'executing'));

        // Perform the action
        if (action === 'commit') {
          handleCommit().finally(() => {
            dispatch(setIsAutofillAndCommitting(workspaceId, false));
            dispatch(clearBackgroundOperation(workspaceId));
          });
        } else if (action === 'add-to-pr') {
          handleAddToPR(true).finally(() => {
            dispatch(setIsAutofillAndCommitting(workspaceId, false));
            dispatch(clearBackgroundOperation(workspaceId));
          });
        } else if (action === 'merge') {
          handleMergeToTrunk({ squash: false }).finally(() => {
            dispatch(setIsAutofillAndCommitting(workspaceId, false));
            dispatch(clearBackgroundOperation(workspaceId));
          });
        } else if (action === 'squash-merge') {
          handleMergeToTrunk({ squash: true }).finally(() => {
            dispatch(setIsAutofillAndCommitting(workspaceId, false));
            dispatch(clearBackgroundOperation(workspaceId));
          });
        }
      });
    }
  });

  // Watch for PR description executor completion to trigger auto-submit
  $effect(() => {
    const pendingPR = $acceptChangesState.pendingPRContext;
    if (pendingPR && $prExecState$.result && !prIsRunning) {
      untrack(() => {
        dispatch(setPendingPRContext(workspaceId, null));

        // Parse the result to extract title and description
        const result = $prExecState$.result!;
        const lines = result.trim().split('\n');
        const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
        const descriptionLines = lines.slice(1).join('\n').trim();

        if (titleLine) {
          dispatch(setPRTitle(workspaceId, titleLine));
        } else {
          // Fallback: generate title from branch name
          const branchName = status?.branch || 'feature';
          const cleanBranchName = branchName
            .replace(/^(feature|fix|chore|docs|refactor|test)[-/]/, '')
            .replace(/[-_]/g, ' ')
            .trim();
          dispatch(setPRTitle(workspaceId, cleanBranchName.charAt(0).toUpperCase() + cleanBranchName.slice(1)));
        }

        dispatch(setPRDescription(workspaceId, descriptionLines || result));

        // Update phase to executing (git operations)
        dispatch(updateBackgroundOperationPhase(workspaceId, 'executing'));

        // Now create the PR
        handleCreatePR().finally(() => {
          dispatch(setIsAutofillAndCreatingPR(workspaceId, false));
          dispatch(clearBackgroundOperation(workspaceId));
        });
      });
    }
  });

  // Watch for executor errors to reset state
  $effect(() => {
    if ($acceptChangesState.pendingCommitAction && $commitExecState$.error) {
      untrack(() => {
        dispatch(setPendingCommitAction(workspaceId, null));
        dispatch(setIsAutofillAndCommitting(workspaceId, false));
        dispatch(clearBackgroundOperation(workspaceId));
      });
    }
  });

  $effect(() => {
    if ($acceptChangesState.pendingPRContext && $prExecState$.error) {
      untrack(() => {
        dispatch(setPendingPRContext(workspaceId, null));
        dispatch(setIsAutofillAndCreatingPR(workspaceId, false));
        dispatch(clearBackgroundOperation(workspaceId));
      });
    }
  });

  // Autofill and commit - optimistically shows as submitting while generating message
  async function handleAutofillAndCommit() {
    if (!$workspace) return;

    dispatch(setIsAutofillAndCommitting(workspaceId, true));
    dispatch(setPendingCommitAction(workspaceId, 'commit'));

    // Start optimistic background operation tracking
    dispatch(startBackgroundOperation(workspaceId, 'commit', Date.now(), 'Committing changes...'));

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Committing in background...', { duration: 2000 });

    // Start generating the commit message
    dispatch(executeBackgroundAgent(workspaceId, 'commit'));
  }

  // Autofill and add to PR - optimistically shows as submitting while generating message
  async function handleAutofillAndAddToPR() {
    if (!$workspace) return;

    dispatch(setIsAutofillAndCommitting(workspaceId, true));
    dispatch(setPendingCommitAction(workspaceId, 'add-to-pr'));

    // Start optimistic background operation tracking
    dispatch(startBackgroundOperation(workspaceId, 'add-to-pr', Date.now(), 'Adding to PR...'));

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Adding to PR in background...', { duration: 2000 });

    // Start generating the commit message
    dispatch(executeBackgroundAgent(workspaceId, 'commit'));
  }

  // Autofill and create PR - optimistically shows as submitting while generating description
  async function handleAutofillAndCreatePR(context: {
    includeStagedFiles: boolean;
    includeCommitHashes: string[];
    targetBranch: string;
  }) {
    if (!$workspace) return;

    dispatch(setIsAutofillAndCreatingPR(workspaceId, true));
    dispatch(setPendingPRContext(workspaceId, context));

    // Start optimistic background operation tracking
    dispatch(startBackgroundOperation(workspaceId, 'create-pr', Date.now(), 'Creating PR...'));

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Creating PR in background...', { duration: 2000 });

    // Start generating the PR description
    dispatch(executeBackgroundAgent(workspaceId, 'pr', context));
  }

  // Autofill and merge - generates commit message for staged files, then merges
  async function handleAutofillAndMerge(options?: { squash?: boolean }) {
    if (!$workspace) return;

    dispatch(setIsAutofillAndCommitting(workspaceId, true));
    dispatch(setPendingCommitAction(workspaceId, options?.squash ? 'squash-merge' : 'merge'));

    // Start optimistic background operation tracking
    dispatch(startBackgroundOperation(workspaceId, 'commit', Date.now(), 'Merging to trunk...'));

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Merging in background...', { duration: 2000 });

    // Start generating the commit message (will trigger merge on completion)
    dispatch(executeBackgroundAgent(workspaceId, 'commit'));
  }

  function handleBack() {
    dispatch(ftClearMainPanelView());
    onBack?.();
  }

  function handleGitHubAuthModalClose() {
    showGitHubAuthModal = false;
    pendingActionAfterAuth = null;
  }

  function handleGitHubAuthModalSuccess() {
    const action = pendingActionAfterAuth;
    showGitHubAuthModal = false;
    pendingActionAfterAuth = null;

    if (action === 'create-pr' && $githubAuthIsAuthenticated$) {
      handleCreatePR();
    }
  }
</script>

<PanelWrapper
  title="Review changes"
  breadcrumbs={[{ label: 'Changes', icon: faPencil }]}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
  showClose={true}
  onClose={handleBack}
  contentClass="overflow-y-auto p-3 space-y-3"
>
  {#if isLoading}
    <!-- Skeleton matching ChangeTimeline layout -->
    <div class="w-full p-6">
      <div class="relative">
        <!-- Timeline vertical line -->
        <div class="absolute left-5 top-3 bottom-0 w-px bg-border"></div>

        <!-- Local changes section skeleton -->
        <div class="relative mb-9">
          <!-- Timeline dot -->
          <div
            class="absolute left-6 top-3.5 mt-0.5 w-2 h-2 -ml-1 rounded-full bg-border z-10 transform -translate-x-1/2 -translate-y-1/2"
          ></div>

          <!-- Section Header -->
          <div class="pl-10 pr-3 py-2">
            <div class="h-3 w-24 bg-muted rounded animate-pulse"></div>
          </div>

          <!-- Card skeleton -->
          <div class="pl-10 pr-3">
            <div class="border border-border rounded-md overflow-hidden shadow-xs">
              <!-- File rows skeleton -->
              <div class="py-2 px-3 space-y-2">
                {#each [1, 2, 3] as { }}
                  <div class="flex items-center gap-2">
                    <div class="h-3 w-3 bg-muted rounded animate-pulse"></div>
                    <div class="h-3 flex-1 bg-muted rounded animate-pulse"></div>
                    <div class="h-3 w-8 bg-muted rounded animate-pulse"></div>
                  </div>
                {/each}
              </div>

              <!-- Action bar skeleton -->
              <div class="flex items-center gap-1 px-2 py-1.5 border-t border-border">
                <div class="h-6 w-16 bg-muted rounded animate-pulse"></div>
                <div class="h-6 w-16 bg-muted rounded animate-pulse"></div>
                <div class="h-6 w-16 bg-muted rounded animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {:else if executionResult}
    <!-- Result View -->
    <div class="space-y-4">
      <div
        class="flex items-center gap-3 px-4 py-3 rounded-lg {executionResult.success
          ? 'bg-green-50/50 dark:bg-green-950/20'
          : 'bg-red-50/50 dark:bg-red-950/20'}"
      >
        <Fa
          icon={executionResult.success ? faCheckCircle : faTimesCircle}
          class="h-4 w-4 {executionResult.success ? 'text-green-500' : 'text-red-500'}"
        />
        <div class="flex-1">
          <p class="text-sm font-medium">{executionResult.success ? 'Success' : 'Failed'}</p>
          {#if executionResult.error}
            <p class="text-xs text-subtle">{executionResult.error}</p>
          {/if}
        </div>
      </div>

      {#if executionResult.result?.prUrl}
        <Button
          variant="ghost-light"
          size="sm"
          onclick={() => handleOpenPR(executionResult!.result!.prUrl!)}
        >
          <Fa icon={faExternalLinkAlt} class="h-3 w-3 mr-1.5" />
          View Pull Request
        </Button>
      {/if}

      <Button
        variant="ghost-light"
        size="sm"
        onclick={() => {
          executionResult = null;
        }}
      >
        Back to Changes
      </Button>
    </div>
  {:else if status || hasFilesToShow}
    <!-- Timeline - show immediately with files, even if status is still loading -->
    <ChangeTimeline
      {workspaceId}
      workspace={$workspace}
      workspaceTitle={$workspace?.title}
      branch={status?.branch ?? (isLoadingStatus ? '' : 'Loading...')}
      targetBranch={$acceptChangesState.targetBranch}
      availableBranches={status?.availableBranches ?? []}
      {unstagedFiles}
      {stagedFiles}
      commits={localCommits}
      {prs}
      commitMessage={$acceptChangesState.commitMessage}
      prTitle={$acceptChangesState.prTitle}
      prDescription={$acceptChangesState.prDescription}
      isGeneratingMessage={commitIsRunning}
      isGeneratingPR={prIsRunning}
      {generatingMessagePreview}
      {generatingPRPreview}
      {generatingMessageStatus}
      {generatingPRStatus}
      {isCommitting}
      {isPushing}
      {isCreatingPR}
      {isExporting}
      onFileClick={handleFileClick}
      onStage={handleStage}
      onUnstage={handleUnstage}
      onRevert={handleRevert}
      onStageAll={handleStageAll}
      onUnstageAll={handleUnstageAll}
      onStageGroup={handleStageGroup}
      onUnstageGroup={handleUnstageGroup}
      onCommitMessageChange={(msg: string) => {
        dispatch(setCommitMessage(workspaceId, msg));
      }}
      onGenerateMessage={handleGenerateMessage}
      onCommit={handleCommit}
      onPush={handlePush}
      onAddToPR={handleAddToPR}
      onTargetBranchChange={(branch: string) => {
        dispatch(setTargetBranch(workspaceId, branch));
      }}
      onPRTitleChange={(title: string) => {
        dispatch(setPRTitle(workspaceId, title));
      }}
      onPRDescriptionChange={(desc: string) => {
        dispatch(setPRDescription(workspaceId, desc));
      }}
      onGeneratePR={handleGeneratePR}
      onCreatePR={handleCreatePR}
      onPickExportFolder={handlePickExportFolder}
      onExport={handleExport}
      defaultExportPath={$workspace?.repositoryPath}
      onOpenCommit={handleOpenCommit}
      onOpenPR={handleOpenPR}
      onOpenLocalChanges={() => {
        window.dispatchEvent(new CustomEvent('workspace:open-local-changes'));
      }}
      commitMessageAgentId={$commitExecState$.agentId}
      prDescriptionAgentId={$prExecState$.agentId}
      onViewCommitThoughtProcess={handleViewCommitThoughtProcess}
      onViewPRThoughtProcess={handleViewPRThoughtProcess}
      onAutofillAndCommit={handleAutofillAndCommit}
      onAutofillAndAddToPR={handleAutofillAndAddToPR}
      onAutofillAndCreatePR={handleAutofillAndCreatePR}
      isAutofillAndCommitting={$acceptChangesState.isAutofillAndCommitting}
      isAutofillAndCreatingPR={$acceptChangesState.isAutofillAndCreatingPR}
      backgroundOperation={$acceptChangesState.backgroundOperation}
      onStopGeneratingMessage={() => {
        dispatch(cancelExecution(workspaceId, 'commit'));
        dispatch(setIsAutofillAndCommitting(workspaceId, false));
        dispatch(setPendingCommitAction(workspaceId, null));
        dispatch(resetAcceptChangesOperations(workspaceId));
      }}
      onStopGeneratingPR={() => {
        dispatch(cancelExecution(workspaceId, 'pr'));
        dispatch(setIsAutofillAndCreatingPR(workspaceId, false));
        dispatch(setPendingPRContext(workspaceId, null));
        dispatch(resetAcceptChangesOperations(workspaceId));
      }}
      onReviewStaged={() => handleReviewStaged(false)}
      onReReview={() => handleReviewStaged(true)}
      onOpenReview={handleOpenExistingReview}
      onOpenArchivedReview={handleOpenArchivedReview}
      isReviewingCode={reviewIsRunning}
      {reviewStatus}
      {hasExistingReview}
      {reviewCommentCount}
      {reviewHasCritical}
      {reviewArchive}
      onMergeToTrunk={handleMergeToTrunk}
      onAutofillAndMerge={handleAutofillAndMerge}
      {isMergingToTrunk}
      onStartNewSpace={handleStartNewSpace}
      onCreateWorkspace={handleCreateWorkspace}
      {isCreatingWorkspace}
      {isMergedToTrunk}
      hasRemote={status?.hasRemote ?? true}
      onAddRemote={handleAddRemote}
    />
  {/if}
</PanelWrapper>

{#if showGitHubAuthModal}
  <GitHubAuthModal
    open={showGitHubAuthModal}
    onClose={handleGitHubAuthModalClose}
    onSuccess={handleGitHubAuthModalSuccess}
  />
{/if}
