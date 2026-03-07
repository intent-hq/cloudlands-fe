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
    faCodeBranch,
    faPencil,
  } from '@fortawesome/free-solid-svg-icons';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';
  import {
    createCommitMessageExecutor,
    createPRDescriptionExecutor,
    createCodeReviewExecutor,
  } from '$features/agent/background-agent-executor.svelte';
  import type {
    WorkspaceGitStatus,
    PrepareAcceptResponse,
    AcceptChangesResult,
  } from '$features/accept-changes/types';
  import GitHubAuthModal from '$lib/components/GitHubAuthModal.svelte';

  import ChangeTimeline from './ChangeTimeline.svelte';
  import type { UIFileChange, PRInfo } from './types';
  import { getTransientUIStore } from '$features/workspace/transient-ui-state.store.svelte';
  import { extractTextFromBlocks } from '$lib/utils/text-utils';
  import confetti from 'canvas-confetti';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import { unifiedIdService } from '$shared/services/unified-id.service';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
  import {
    parseAllReviewComments,
    getReviewStats,
    type ReviewStatus,
  } from '$lib/components/code-review/types';
  import { untrack } from 'svelte';
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { terminalOverlayStore } from '$lib/stores/terminal-overlay.store.svelte';
  import { track, trackGitOp } from '$lib/services/analytics';

  const logger = createLogger('AcceptChangesPanel');
  const { state: githubAuthState } = githubAuthStore;

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

  // Get transient UI store lazily to avoid creating $state during effect flush
  // NOTE: We cache the store reference at initialization time (not in an effect)
  // because getTransientUIStore creates a new store with $state if one doesn't exist,
  // and creating $state during effect evaluation triggers effect_update_depth_exceeded.
  // The cache is populated ONCE when the component initializes, before any effects run.
  let cachedTransientStore: ReturnType<typeof getTransientUIStore> | null = null;
  function getTransientStore() {
    if (!cachedTransientStore && workspaceId) {
      cachedTransientStore = getTransientUIStore(workspaceId);
    }
    return cachedTransientStore;
  }
  // Pre-initialize the cache immediately at component creation time (before effects run)
  if (workspaceId) {
    cachedTransientStore = getTransientUIStore(workspaceId);
  }

  // State - initialize from transient store for persistence across navigation
  let status = $state<WorkspaceGitStatus | null>(null);
  let prepareResult = $state<PrepareAcceptResponse | null>(null);
  let isLoading = $state(true); // Initial full load (no data at all)
  let isLoadingStatus = $state(false); // Loading git status (branch, commits, PRs)
  let isLoadingPrepare = $state(false); // Loading prepare data (+/- counts)
  let isExecuting = $state(false);
  let executionResult = $state<AcceptChangesResult | null>(null);

  // Request version counters to prevent stale responses from overwriting fresh data
  // This fixes UI flickering when multiple async requests race
  let prepareRequestVersion = 0;
  let statusRequestVersion = 0;

  // Form values - sync with transient store
  let targetBranch = $state('');
  let commitMessage = $state('');
  let prTitle = $state('');
  let prDescription = $state('');

  // Action states
  let isPushing = $state(false);
  let isCreatingPR = $state(false);
  let isCommitting = $state(false);
  let isExporting = $state(false);
  let isAutofillAndCommitting = $state(false);
  let isAutofillAndCreatingPR = $state(false);
  let isMergingToTrunk = $state(false);
  let isMergedToTrunk = $state(false);

  // GitHub auth modal state
  let showGitHubAuthModal = $state(false);
  let pendingActionAfterAuth = $state<'create-pr' | null>(null);

  // Background operation state for optimistic UI
  // NOTE: Use a getter function instead of $derived to avoid creating $state during effect flush
  function getBackgroundOperation() {
    return getTransientStore()?.acceptChanges.backgroundOperation ?? null;
  }

  // Get workspace
  const workspace = $derived(workspaceStore.findById(WorkspaceId(workspaceId)));

  // Get panel layout manager for opening terminal tabs
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Restore form values from transient store on mount
  $effect(() => {
    // Use untrack to avoid creating $state during effect flush
    const transientStore = untrack(() => getTransientStore());
    const stored = transientStore?.acceptChanges;
    if (stored) {
      if (stored.commitMessage && !commitMessage) commitMessage = stored.commitMessage;
      if (stored.prTitle && !prTitle) prTitle = stored.prTitle;
      if (stored.prDescription && !prDescription) prDescription = stored.prDescription;
      if (stored.targetBranch && !targetBranch) targetBranch = stored.targetBranch;
      // Restore action states
      if (stored.isAutofillAndCommitting) isAutofillAndCommitting = stored.isAutofillAndCommitting;
      if (stored.isAutofillAndCreatingPR) isAutofillAndCreatingPR = stored.isAutofillAndCreatingPR;
    }
  });

  // PERF: Consolidated form sync effect - single effect instead of 6 separate ones
  // This reduces reactive subscription overhead significantly
  $effect(() => {
    // Use untrack to avoid creating $state during effect flush
    const transientStore = untrack(() => getTransientStore());
    if (!transientStore) return;

    const stored = transientStore.acceptChanges;

    // Sync all form values in a single effect
    if (commitMessage !== stored.commitMessage) {
      transientStore.setCommitMessage(commitMessage);
    }
    if (prTitle !== stored.prTitle) {
      transientStore.setPRTitle(prTitle);
    }
    if (prDescription !== stored.prDescription) {
      transientStore.setPRDescription(prDescription);
    }
    if (targetBranch !== stored.targetBranch) {
      transientStore.setTargetBranch(targetBranch);
    }
    if (isAutofillAndCommitting !== stored.isAutofillAndCommitting) {
      transientStore.setIsAutofillAndCommitting(isAutofillAndCommitting);
    }
    if (isAutofillAndCreatingPR !== stored.isAutofillAndCreatingPR) {
      transientStore.setIsAutofillAndCreatingPR(isAutofillAndCreatingPR);
    }
  });

  // Helper: Get attribution from file tracking store for a given file path
  function getAttributionForFile(filePath: string): UIFileChange['attribution'] | undefined {
    const changes = fileTrackingStore.workingChanges;
    // Check both staged and unstaged for the file
    const tracked =
      changes.staged.find((c) => c.file === filePath || c.relativePath === filePath) ||
      changes.unstaged.find((c) => c.file === filePath || c.relativePath === filePath);

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
  // IMPORTANT: Always use fileTrackingStore.workingChanges for staged/unstaged status
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
    // Always use workingChanges for staged status (has optimistic updates)
    return fileTrackingStore.workingChanges.staged.map((c) => {
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
    // Always use workingChanges for unstaged status (has optimistic updates)
    return fileTrackingStore.workingChanges.unstaged.map((c) => {
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

  // Background agent executors with state sync to transient store
  const commitMessageExecutor = createCommitMessageExecutor({
    onResult: (result, context) => {
      commitMessage = result;
      getTransientStore()?.setCommitMessageExecutorState(commitMessageExecutor.getState());
      // Only show toast for freshly generated messages, not restored ones
      if (!context?.isRestored) {
        toast.success('Commit message generated');
      }
    },
    onError: (error) => {
      getTransientStore()?.setCommitMessageExecutorState(commitMessageExecutor.getState());
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
    onStatusChange: () => {
      getTransientStore()?.setCommitMessageExecutorState(commitMessageExecutor.getState());
    },
  });

  const prDescriptionExecutor = createPRDescriptionExecutor({
    onResult: (result, context) => {
      // Parse the result to extract title and description
      // The result format is expected to be markdown with a title at the top
      const lines = result.trim().split('\n');
      const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
      const descriptionLines = lines.slice(1).join('\n').trim();

      if (titleLine) {
        prTitle = titleLine;
      } else {
        // Fallback: generate title from branch name
        const branchName = status?.branch || 'feature';
        const cleanBranchName = branchName
          .replace(/^(feature|fix|chore|docs|refactor|test)[-/]/, '')
          .replace(/[-_]/g, ' ')
          .trim();
        prTitle = cleanBranchName.charAt(0).toUpperCase() + cleanBranchName.slice(1);
      }

      prDescription = descriptionLines || result;
      getTransientStore()?.setPRDescriptionExecutorState(prDescriptionExecutor.getState());
      // Only show toast for freshly generated descriptions, not restored ones
      if (!context?.isRestored) {
        toast.success('PR description generated');
      }
    },
    onError: (error) => {
      getTransientStore()?.setPRDescriptionExecutorState(prDescriptionExecutor.getState());
      // Don't show toast for "all models exhausted" - it's shown in chat
      const isModelsExhausted =
        error.message.includes('No available models') ||
        error.message.includes('all models exhausted') ||
        error.message.includes('All models unavailable');
      if (!isModelsExhausted) {
        toast.error(`Failed to generate: ${error.message}`);
      }
    },
    onStatusChange: () => {
      getTransientStore()?.setPRDescriptionExecutorState(prDescriptionExecutor.getState());
    },
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

  // Code review executor for AI-powered code review
  const codeReviewExecutor = createCodeReviewExecutor({
    onMessage: (message) => {
      // Stream updates to the code review panel
      const text = extractTextFromBlocks(message.contentBlocks || []);
      codeReviewState = {
        ...codeReviewState,
        streamingText: text,
        agentId: codeReviewExecutor.agentId || null,
        status: 'running',
      };
      // Save state to transient store for reconnection after page reload
      getTransientStore()?.setCodeReviewExecutorState(codeReviewExecutor.getState());
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            streamingText: text,
            agentId: codeReviewExecutor.agentId,
            stagedFiles: stagedFiles.map((f) => f.path),
            status: 'running',
          },
        }),
      );
    },
    onResult: (result) => {
      logger.info('Code review completed', { resultLength: result.length });
      const newReviewState: CodeReviewState = {
        result,
        agentId: codeReviewExecutor.agentId || null,
        stagedFiles: stagedFiles.map((f) => f.path),
        status: 'complete',
        timestamp: Date.now(),
      };
      codeReviewState = newReviewState;

      // Add to archive (keep last 5)
      reviewArchive = [{ ...newReviewState, timestamp: Date.now() }, ...reviewArchive.slice(0, 4)];

      // Save state to transient store
      getTransientStore()?.setCodeReviewExecutorState(codeReviewExecutor.getState());

      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            result,
            agentId: codeReviewExecutor.agentId,
            stagedFiles: stagedFiles.map((f) => f.path),
            status: 'complete',
          },
        }),
      );
      toast.success('Code review complete');
    },
    onError: (error) => {
      toast.error(`Review failed: ${error.message}`);
      codeReviewState = {
        ...codeReviewState,
        error: error.message,
        status: 'error',
      };
      // Save state to transient store
      getTransientStore()?.setCodeReviewExecutorState(codeReviewExecutor.getState());
      window.dispatchEvent(
        new CustomEvent('workspace:code-review-update', {
          detail: {
            error: error.message,
            status: 'error',
          },
        }),
      );
    },
    onStatusChange: () => {
      // Save state to transient store on any status change
      getTransientStore()?.setCodeReviewExecutorState(codeReviewExecutor.getState());
    },
  });

  // Check if staged files have changed since the last review
  const stagedFilesSorted = $derived([...stagedFiles.map((f) => f.path)].sort().join(','));
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
  const reviewStatus = $derived<ReviewStatus>(
    codeReviewExecutor.isRunning ? 'running' : codeReviewState.status,
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
    // Use untrack to avoid creating $state during effect flush
    const stored = untrack(() => getTransientStore())?.acceptChanges;
    if (!stored) return;

    // Reconnect code review executor if it was running and we haven't already reconnected
    if (stored.codeReviewExecutor?.agentId && !hasReconnectedCodeReviewExecutor) {
      const { agentId, status: savedStatus, result } = stored.codeReviewExecutor;
      // Skip reconnection if executor already has an agentId
      if (codeReviewExecutor.agentId) {
        logger.info('Code review executor already has an agentId, skipping reconnect', {
          currentAgentId: codeReviewExecutor.agentId,
          storedAgentId: agentId,
          isSameAgent: codeReviewExecutor.agentId === agentId,
        });
        hasReconnectedCodeReviewExecutor = true;
      }
      // Only reconnect if still running
      else if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedCodeReviewExecutor = true;
        logger.info('Reconnecting to running code review executor', { agentId, savedStatus });

        // Restore the code review state to show running UI
        codeReviewState = {
          ...codeReviewState,
          agentId,
          status: 'running',
        };

        // Open the code review panel to show progress
        window.dispatchEvent(
          new CustomEvent('workspace:open-code-review', {
            detail: {
              result: null,
              agentId,
              stagedFiles: codeReviewState.stagedFiles,
              status: 'running',
            },
          }),
        );

        codeReviewExecutor
          .reconnect(workspaceId, agentId, { status: savedStatus, result })
          .then((reconnectResult) => {
            // If reconnect failed (agent gone), clear state
            if (
              reconnectResult === null &&
              !codeReviewExecutor.result &&
              codeReviewExecutor.agentId === agentId
            ) {
              logger.info('Code review executor reconnect failed, clearing state');
              codeReviewState = {
                result: null,
                agentId: null,
                stagedFiles: [],
                status: 'idle',
              };
              getTransientStore()?.clearCodeReviewExecutorState();
              // Dispatch update to close the panel or show error
              window.dispatchEvent(
                new CustomEvent('workspace:code-review-update', {
                  detail: {
                    status: 'error',
                    error: 'Code review session was lost. Please try again.',
                  },
                }),
              );
            }
          });
      } else if (result && !codeReviewExecutor.result) {
        // Restore completed result only if executor doesn't have it
        hasReconnectedCodeReviewExecutor = true;
        logger.info('Restoring completed code review result', {
          agentId,
          resultLength: result.length,
        });
        codeReviewExecutor.reconnect(workspaceId, agentId, { status: savedStatus, result });

        // Also restore the local state
        codeReviewState = {
          result,
          agentId,
          stagedFiles: codeReviewState.stagedFiles,
          status: 'complete',
        };
      }
    }

    // Reconnect commit message executor if it was running and we haven't already reconnected
    if (stored.commitMessageExecutor?.agentId && !hasReconnectedCommitExecutor) {
      const { agentId, status: savedStatus, result } = stored.commitMessageExecutor;
      // Skip reconnection if executor already has an agentId (new operation in progress OR same operation we started)
      // This prevents the reconnect effect from interfering with ongoing operations
      if (commitMessageExecutor.agentId) {
        logger.info('Commit executor already has an agentId, skipping reconnect', {
          currentAgentId: commitMessageExecutor.agentId,
          storedAgentId: agentId,
          isSameAgent: commitMessageExecutor.agentId === agentId,
        });
        hasReconnectedCommitExecutor = true;
      }
      // Only reconnect if still running OR if we have a result but executor doesn't have it yet
      else if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedCommitExecutor = true;
        // Restore the isAutofillAndCommitting state to show generating UI
        if (stored.pendingCommitAction) {
          isAutofillAndCommitting = true;
          pendingCommitAction = stored.pendingCommitAction;
          getTransientStore()?.startBackgroundOperation('commit', 'Resuming...');
        }
        commitMessageExecutor
          .reconnect(workspaceId, agentId, { status: savedStatus, result })
          .then((reconnectResult) => {
            // If reconnect failed (agent gone), clear pending state
            // But only if we're still trying to reconnect to the same agent
            if (
              reconnectResult === null &&
              !commitMessageExecutor.result &&
              commitMessageExecutor.agentId === agentId
            ) {
              logger.info('Commit executor reconnect failed, clearing pending state');
              pendingCommitAction = null;
              isAutofillAndCommitting = false;
              getTransientStore()?.clearBackgroundOperation();
              getTransientStore()?.clearExecutorStates();
            }
          });
      } else if (result && !commitMessageExecutor.result) {
        // Restore completed result only if executor doesn't have it
        hasReconnectedCommitExecutor = true;
        commitMessageExecutor.reconnect(workspaceId, agentId, { status: savedStatus, result });
      }
    }

    // Reconnect PR description executor if it was running and we haven't already reconnected
    if (stored.prDescriptionExecutor?.agentId && !hasReconnectedPRExecutor) {
      const { agentId, status: savedStatus, result } = stored.prDescriptionExecutor;
      // Skip reconnection if executor already has an agentId (new operation in progress OR same operation we started)
      // This prevents the reconnect effect from interfering with ongoing operations
      if (prDescriptionExecutor.agentId) {
        logger.info('PR executor already has an agentId, skipping reconnect', {
          currentAgentId: prDescriptionExecutor.agentId,
          storedAgentId: agentId,
          isSameAgent: prDescriptionExecutor.agentId === agentId,
        });
        hasReconnectedPRExecutor = true;
      }
      // Only reconnect if still running OR if we have a result but executor doesn't have it yet
      else if (savedStatus === 'running' || savedStatus === 'initializing') {
        hasReconnectedPRExecutor = true;
        // Restore the isAutofillAndCreatingPR state to show generating UI
        if (stored.pendingPRContext) {
          isAutofillAndCreatingPR = true;
          pendingPRContext = stored.pendingPRContext;
          getTransientStore()?.startBackgroundOperation('create-pr', 'Resuming...');
        }
        prDescriptionExecutor
          .reconnect(workspaceId, agentId, { status: savedStatus, result })
          .then((reconnectResult) => {
            // If reconnect failed (agent gone), clear pending state
            // But only if we're still trying to reconnect to the same agent
            if (
              reconnectResult === null &&
              !prDescriptionExecutor.result &&
              prDescriptionExecutor.agentId === agentId
            ) {
              logger.info('PR executor reconnect failed, clearing pending state');
              pendingPRContext = null;
              isAutofillAndCreatingPR = false;
              getTransientStore()?.clearBackgroundOperation();
              getTransientStore()?.clearExecutorStates();
            }
          });
      } else if (result && !prDescriptionExecutor.result) {
        // Restore completed result only if executor doesn't have it
        hasReconnectedPRExecutor = true;
        // Restore pendingPRContext so the $effect at line 1879 can trigger handleCreatePR()
        if (stored.pendingPRContext) {
          isAutofillAndCreatingPR = true;
          pendingPRContext = stored.pendingPRContext;
          getTransientStore()?.startBackgroundOperation('create-pr', 'Resuming...');
        }
        prDescriptionExecutor.reconnect(workspaceId, agentId, { status: savedStatus, result });
      }
    }

    // Restore pending action states only if we're not reconnecting to a running executor
    // (reconnecting executors handle their own pending state restoration above)
    if (stored.pendingCommitAction && !stored.commitMessageExecutor?.agentId) {
      pendingCommitAction = stored.pendingCommitAction;
    }
    if (stored.pendingPRContext && !stored.prDescriptionExecutor?.agentId) {
      pendingPRContext = stored.pendingPRContext;
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
      codeReviewExecutor.cancel();
      codeReviewState = {
        ...codeReviewState,
        status: 'idle',
      };
      getTransientStore()?.clearCodeReviewExecutorState();
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
  const generatingMessagePreview = $derived.by(() => {
    const latestMessage = commitMessageExecutor.latestMessage;
    if (!latestMessage?.contentBlocks) return '';
    const text = extractTextFromBlocks(latestMessage.contentBlocks);
    // Return last ~100 chars, trimmed to 2 lines max
    const lines = text.trim().split('\n').slice(-2);
    return lines.join('\n').slice(-200);
  });

  const generatingMessageStatus = $derived.by(() => {
    if (!commitMessageExecutor.isRunning) return '';
    if (commitMessageExecutor.status === 'initializing') return 'Starting agent...';
    if (commitMessageExecutor.progress < 20) return 'Analyzing changes...';
    if (commitMessageExecutor.progress < 50) return 'Generating commit message...';
    return 'Finalizing...';
  });

  // Streaming preview data for PR description generation
  const generatingPRPreview = $derived.by(() => {
    const latestMessage = prDescriptionExecutor.latestMessage;
    if (!latestMessage?.contentBlocks) return '';
    const text = extractTextFromBlocks(latestMessage.contentBlocks);
    // Return last ~100 chars, trimmed to 2 lines max
    const lines = text.trim().split('\n').slice(-2);
    return lines.join('\n').slice(-200);
  });

  const generatingPRStatus = $derived.by(() => {
    if (!prDescriptionExecutor.isRunning) return '';
    if (prDescriptionExecutor.status === 'initializing') return 'Starting agent...';
    if (prDescriptionExecutor.progress < 20) return 'Analyzing commits and changes...';
    if (prDescriptionExecutor.progress < 50) return 'Generating PR description...';
    return 'Finalizing...';
  });

  // Track file tracking changes to refresh
  // We need to track BOTH the count AND the staged status to detect when files move between staged/unstaged
  let hasInitiallyLoaded = false;
  const stagedCount = $derived(fileTrackingStore.workingChanges?.staged?.length ?? 0);
  const unstagedCount = $derived(fileTrackingStore.workingChanges?.unstaged?.length ?? 0);
  // Create a fingerprint of staged file paths to detect stage/unstage operations
  const stagedFingerprint = $derived(
    fileTrackingStore.workingChanges?.staged
      ?.map((f) => f.file)
      .sort()
      .join(',') ?? '',
  );

  // Refresh prepare data when staged/unstaged files change
  // Note: fileTrackingStore.refresh() has built-in deduplication, so we don't need cooldowns here
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

  // PERF: Determine if we have ANY data to show (from fileTrackingStore)
  // This lets us show the timeline immediately even without status/prepareResult
  const hasFilesToShow = $derived(
    fileTrackingStore.workingChanges.staged.length > 0 ||
      fileTrackingStore.workingChanges.unstaged.length > 0,
  );

  // Check if file tracking store is still initializing
  const isFileTrackingInitialized = $derived(fileTrackingStore.isInitialized);

  // Track if we've already started loading to prevent the $effect from triggering multiple loads
  // IMPORTANT: We track both the flag AND the workspace ID so we reset when switching workspaces
  let hasStartedLoading = false;
  let loadedForWorkspaceId: string | null = null;

  // Load status on mount - PROGRESSIVE LOADING:
  // 1. Show timeline immediately with files from fileTrackingStore
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
        // Update cached transient store for new workspace
        cachedTransientStore = getTransientUIStore(workspaceId);
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

      // Check for cached status for instant display
      // Use untrack to avoid creating $state during effect flush
      const transientStore = untrack(() => getTransientStore());
      const cachedStatus = transientStore?.getCachedGitStatus();
      const cacheAge = transientStore?.getCachedGitStatusAge();

      if (cachedStatus && cacheAge !== null && cacheAge !== undefined && cacheAge < CACHE_TTL_MS) {
        // Use cached status data immediately for instant display
        status = cachedStatus;
        if (!targetBranch) {
          targetBranch = cachedStatus.trunkBranch;
        }
        // PERF: Show UI immediately since we have cached status + files from fileTrackingStore
        isLoading = false;
        hasInitiallyLoaded = true;

        // Load prepare data and refresh status in PARALLEL in background
        Promise.all([prepareAction(), loadStatusOnly()]);
      } else if (hasFilesToShow) {
        // PERF: No cached status, but we have files from fileTrackingStore
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
      // Refresh fileTrackingStore in background (don't await - it may be slow)
      fileTrackingStore.refresh();

      const newStatus = await AcceptChangesClient.getStatus(WorkspaceId(workspaceId));

      // Only update state if this is still the most recent request
      if (thisVersion !== statusRequestVersion) return;

      status = newStatus;

      // Cache the status for future navigation
      getTransientStore()?.setCachedGitStatus(newStatus);

      if (!targetBranch) {
        targetBranch = newStatus.trunkBranch;
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
      // Run all loads in parallel for faster initial load
      const [, newStatus] = await Promise.all([
        fileTrackingStore.refresh(),
        AcceptChangesClient.getStatus(WorkspaceId(workspaceId)),
      ]);

      // Only update status if this is still the most recent request
      if (thisStatusVersion === statusRequestVersion) {
        status = newStatus;
        isLoadingStatus = false;
        getTransientStore()?.setCachedGitStatus(newStatus);

        if (!targetBranch) {
          targetBranch = newStatus.trunkBranch;
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
      if (result.suggestedCommitMessage && !commitMessage) {
        commitMessage = result.suggestedCommitMessage;
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

  // Actions - use fileTrackingStore to keep both panels in sync
  async function handleStage(filePath: string) {
    try {
      await fileTrackingStore.stageByPath([filePath]);
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
      await fileTrackingStore.unstageByPath([filePath]);
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage file', error as Error, { filePath });
      toast.error('Failed to unstage file');
    }
  }

  async function handleStageAll() {
    try {
      const paths = unstagedFiles.map((f) => f.path);
      await fileTrackingStore.stageByPath(paths);
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to stage all files', error as Error);
      toast.error('Failed to stage files');
    }
  }

  async function handleUnstageAll() {
    try {
      const paths = stagedFiles.map((f) => f.path);
      await fileTrackingStore.unstageByPath(paths);
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage all files', error as Error);
      toast.error('Failed to unstage files');
    }
  }

  // Batch stage a group of files (used for per-agent-group staging)
  async function handleStageGroup(paths: string[]) {
    try {
      await fileTrackingStore.stageByPath(paths);
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to stage file group', error as Error, { count: paths.length });
      toast.error('Failed to stage files');
    }
  }

  // Batch unstage a group of files (used for per-agent-group unstaging)
  async function handleUnstageGroup(paths: string[]) {
    try {
      await fileTrackingStore.unstageByPath(paths);
      await refreshPrepareData();
    } catch (error) {
      logger.error('Failed to unstage file group', error as Error, { count: paths.length });
      toast.error('Failed to unstage files');
    }
  }

  async function handleRevert(filePath: string) {
    // Use optimistic revert - UI updates immediately, toast shows right away
    toast.warning('Changes reverted');

    const result = await fileTrackingStore.revertByPath([filePath]);
    if (!result.ok) {
      toast.error('Failed to revert changes');
      logger.error('Failed to revert changes', undefined, { filePath });
    } else {
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
    if (!workspace) return;
    await commitMessageExecutor.execute(workspace);
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
    if (!workspace) return;

    logger.info('handleReviewStaged called', {
      forceNew,
      executorStatus: codeReviewExecutor.status,
      executorIsRunning: codeReviewExecutor.isRunning,
      executorAgentId: codeReviewExecutor.agentId,
      hasExistingReview,
      codeReviewStateStatus: codeReviewState.status,
    });

    // Don't start a new review if one is already running
    if (codeReviewExecutor.isRunning) {
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
      agentId: codeReviewExecutor.agentId || null,
      stagedFiles: stagedFiles.map((f) => f.path),
      status: 'running',
    };

    // Open the review panel immediately when starting
    window.dispatchEvent(
      new CustomEvent('workspace:open-code-review', {
        detail: {
          result: null,
          agentId: codeReviewExecutor.agentId,
          stagedFiles: stagedFiles.map((f) => f.path),
          status: 'running',
        },
      }),
    );

    // Track new code review request (only fires for new reviews, not re-opens)
    track('Requested Code Review', { staged_file_count: stagedFiles.length });

    // Pass staged files as context for the review
    await codeReviewExecutor.execute(workspace, {
      files: stagedFiles.map((f) => f.path),
    });
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
    if (!workspaceId || !commitMessage.trim()) return;

    isCommitting = true;
    logger.info('Starting commit', { workspaceId, messageLength: commitMessage.length });
    try {
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'commit', {
          commitMessage,
          stageUnstaged: false,
        }),
      );

      logger.info('Commit result received', { success: result.success, error: result.error });

      trackGitOp('commit', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        logger.info('Commit succeeded, updating UI');
        toast.success('Changes committed');
        commitMessage = '';
        // Clear executor state after successful commit
        getTransientStore()?.clearExecutorStates();
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
          targetBranch,
        }),
      );

      trackGitOp('push', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        toast.success('Changes pushed');
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('Push failed', { error: result.error, targetBranch });
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
          targetBranch,
          mergeStrategy: options?.squash ? 'squash' : 'merge',
          rebaseFirst: options?.rebaseFirst,
        }),
      );

      trackGitOp('merge', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        toast.success(`Changes merged into ${targetBranch}`);
        isMergedToTrunk = true;
        celebrateMerge();
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('Merge failed', { error: result.error, targetBranch });

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

    const worktreePath = workspace?.worktreePath || workspace?.repositoryPath;
    if (!worktreePath) {
      toast.error('Cannot find space path');
      return;
    }

    try {
      // Rebase command: fetch origin first, then rebase onto origin/trunk
      const trunkBranch = status?.trunkBranch || 'main';
      const rebaseCommand = `git fetch origin ${targetBranch || trunkBranch} && git rebase origin/${targetBranch || trunkBranch}`;

      // Create terminal with the rebase command
      const result = await window.electronAPI.invoke('terminal:createWithCommand', {
        workspaceId,
        command: rebaseCommand,
        cwd: worktreePath,
        title: `Rebase onto ${targetBranch || trunkBranch}`,
      });

      if (result.ok && result.terminalId) {
        // Open the terminal in the quake terminal bar
        const terminalTitle = `Rebase onto ${targetBranch || trunkBranch}`;
        terminalOverlayStore.addTerminal(result.terminalId, terminalTitle);
        terminalOverlayStore.open(workspaceId, result.terminalId);

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
    const repo = workspace?.repositoryPath;
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
    if (!workspace?.repositoryPath) {
      toast.error('No repository path found');
      return;
    }

    isCreatingWorkspace = true;

    try {
      // Archive the current workspace first
      if (workspace.id) {
        const archiveResult = await workspaceStore.archive(workspace.id);
        if (!archiveResult.ok) {
          toast.error('Failed to archive workspace');
          isCreatingWorkspace = false;
          return;
        }
      }

      const repoPath = workspace.repositoryPath;
      const baseBranch = workspace.baseRef || workspace.branch || 'main';

      // Generate a unique agent ID for the initial agent
      const initialAgentId = unifiedIdService.generateAgentId();

      // Get model from model store
      const selectedModel = modelStore.selectedModel || DEFAULT_AGENT_MODEL;

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
        workspace.environmentConfig?.type === 'remote' && workspace.environmentConfig?.ssh
          ? {
              type: 'remote' as const,
              ssh: workspace.environmentConfig.ssh,
            }
          : undefined;

      // Create the workspace
      // Note: Branch name will be generated by the backend using the workspace ID
      const result = await workspaceStore.create({
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

      logger.info('Workspace created successfully from Accept Changes', {
        workspaceId: newWorkspace.id,
        title: newWorkspace.title,
      });

      // Save the selected model as the workspace's default model
      if (selectedModel) {
        modelStore.setWorkspaceDefaultModel(newWorkspace.id, selectedModel);
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
    if (includeCommit && !commitMessage.trim()) {
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
            commitMessage,
            pushAfterCommit: true,
          }),
        );

        trackGitOp('commit', { workspaceId, success: result.success, trigger: 'manual' });
        if (result.success) {
          toast.success('Changes added to PR');
          commitMessage = '';
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
            targetBranch,
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
    if (!githubAuthState.isAuthenticated) {
      try {
        await githubAuthStore.initialize();
      } catch (error) {
        logger.warn('Failed to refresh GitHub auth state before creating PR', error);
      }
    }

    if (!githubAuthState.isAuthenticated) {
      pendingActionAfterAuth = 'create-pr';
      showGitHubAuthModal = true;
      return;
    }

    isCreatingPR = true;
    try {
      const title = prTitle || `Changes from ${status?.branch}`;
      const result = await withTimeout(
        AcceptChangesClient.execute(WorkspaceId(workspaceId), 'create-pr', {
          targetBranch,
          prTitle: title,
          prBody: prDescription,
          // Use PR title as commit message if there are staged changes to commit
          commitMessage: title,
        }),
      );

      trackGitOp('create-pr', { workspaceId, success: result.success, trigger: 'manual' });
      if (result.success) {
        prTitle = '';
        prDescription = '';
        commitMessage = '';
        // Clear executor state after successful PR creation
        getTransientStore()?.clearExecutorStates();
        await loadStatus(false);
        onSuccess?.(result);
      } else {
        logger.warn('PR creation failed', { error: result.error, title, targetBranch });
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
    if (!workspace) return;
    await prDescriptionExecutor.execute(workspace, {
      includeStagedFiles: context.includeStagedFiles,
      includeCommitHashes: context.includeCommitHashes,
      targetBranch: context.targetBranch,
      baseBranch: context.targetBranch,
    });
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
    const agentId = commitMessageExecutor.agentId;
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
    const agentId = prDescriptionExecutor.agentId;
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

  // State to track pending auto-submit actions
  let pendingCommitAction: 'commit' | 'add-to-pr' | 'merge' | 'squash-merge' | null = $state(null);
  let pendingPRContext: {
    includeStagedFiles: boolean;
    includeCommitHashes: string[];
    targetBranch: string;
  } | null = $state(null);

  // Sync pending action states to transient store
  $effect(() => {
    // Use untrack to avoid creating $state during effect flush
    const transientStore = untrack(() => getTransientStore());
    if (transientStore) {
      transientStore.setPendingCommitAction(pendingCommitAction);
    }
  });
  $effect(() => {
    // Use untrack to avoid creating $state during effect flush
    const transientStore = untrack(() => getTransientStore());
    if (transientStore) {
      transientStore.setPendingPRContext(pendingPRContext);
    }
  });

  // Watch for commit message executor completion to trigger auto-submit
  $effect(() => {
    if (pendingCommitAction && commitMessageExecutor.result && !commitMessageExecutor.isRunning) {
      const action = pendingCommitAction;
      pendingCommitAction = null;

      // Set the commit message from the result
      commitMessage = commitMessageExecutor.result;

      // Update phase to executing (git operations)
      getTransientStore()?.updateBackgroundOperationPhase('executing');

      // Perform the action
      if (action === 'commit') {
        handleCommit().finally(() => {
          isAutofillAndCommitting = false;
          getTransientStore()?.clearBackgroundOperation();
        });
      } else if (action === 'add-to-pr') {
        handleAddToPR(true).finally(() => {
          isAutofillAndCommitting = false;
          getTransientStore()?.clearBackgroundOperation();
        });
      } else if (action === 'merge') {
        handleMergeToTrunk({ squash: false }).finally(() => {
          isAutofillAndCommitting = false;
          getTransientStore()?.clearBackgroundOperation();
        });
      } else if (action === 'squash-merge') {
        handleMergeToTrunk({ squash: true }).finally(() => {
          isAutofillAndCommitting = false;
          getTransientStore()?.clearBackgroundOperation();
        });
      }
    }
  });

  // Watch for PR description executor completion to trigger auto-submit
  $effect(() => {
    if (pendingPRContext && prDescriptionExecutor.result && !prDescriptionExecutor.isRunning) {
      pendingPRContext = null;

      // Parse the result to extract title and description
      const result = prDescriptionExecutor.result;
      const lines = result.trim().split('\n');
      const titleLine = lines[0]?.replace(/^#\s*/, '').trim();
      const descriptionLines = lines.slice(1).join('\n').trim();

      if (titleLine) {
        prTitle = titleLine;
      } else {
        // Fallback: generate title from branch name
        const branchName = status?.branch || 'feature';
        const cleanBranchName = branchName
          .replace(/^(feature|fix|chore|docs|refactor|test)[-/]/, '')
          .replace(/[-_]/g, ' ')
          .trim();
        prTitle = cleanBranchName.charAt(0).toUpperCase() + cleanBranchName.slice(1);
      }

      prDescription = descriptionLines || result;

      // Update phase to executing (git operations)
      getTransientStore()?.updateBackgroundOperationPhase('executing');

      // Now create the PR
      handleCreatePR().finally(() => {
        isAutofillAndCreatingPR = false;
        getTransientStore()?.clearBackgroundOperation();
      });
    }
  });

  // Watch for executor errors to reset state
  $effect(() => {
    if (pendingCommitAction && commitMessageExecutor.error) {
      pendingCommitAction = null;
      isAutofillAndCommitting = false;
      getTransientStore()?.clearBackgroundOperation();
    }
  });

  $effect(() => {
    if (pendingPRContext && prDescriptionExecutor.error) {
      pendingPRContext = null;
      isAutofillAndCreatingPR = false;
      getTransientStore()?.clearBackgroundOperation();
    }
  });

  // Autofill and commit - optimistically shows as submitting while generating message
  async function handleAutofillAndCommit() {
    if (!workspace) return;

    isAutofillAndCommitting = true;
    pendingCommitAction = 'commit';

    // Start optimistic background operation tracking
    getTransientStore()?.startBackgroundOperation('commit', 'Committing changes...');

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Committing in background...', { duration: 2000 });

    // Start generating the commit message
    await commitMessageExecutor.execute(workspace);
  }

  // Autofill and add to PR - optimistically shows as submitting while generating message
  async function handleAutofillAndAddToPR() {
    if (!workspace) return;

    isAutofillAndCommitting = true;
    pendingCommitAction = 'add-to-pr';

    // Start optimistic background operation tracking
    getTransientStore()?.startBackgroundOperation('add-to-pr', 'Adding to PR...');

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Adding to PR in background...', { duration: 2000 });

    // Start generating the commit message
    await commitMessageExecutor.execute(workspace);
  }

  // Autofill and create PR - optimistically shows as submitting while generating description
  async function handleAutofillAndCreatePR(context: {
    includeStagedFiles: boolean;
    includeCommitHashes: string[];
    targetBranch: string;
  }) {
    if (!workspace) return;

    isAutofillAndCreatingPR = true;
    pendingPRContext = context;

    // Start optimistic background operation tracking
    getTransientStore()?.startBackgroundOperation('create-pr', 'Creating PR...');

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Creating PR in background...', { duration: 2000 });

    // Start generating the PR description
    await prDescriptionExecutor.execute(workspace, context);
  }

  // Autofill and merge - generates commit message for staged files, then merges
  async function handleAutofillAndMerge(options?: { squash?: boolean }) {
    if (!workspace) return;

    isAutofillAndCommitting = true;
    pendingCommitAction = options?.squash ? 'squash-merge' : 'merge';

    // Start optimistic background operation tracking
    getTransientStore()?.startBackgroundOperation('commit', 'Merging to trunk...');

    // Show optimistic feedback - brief toast, UI shows status
    toast.info('Merging in background...', { duration: 2000 });

    // Start generating the commit message (will trigger merge on completion)
    await commitMessageExecutor.execute(workspace);
  }

  function handleBack() {
    fileTrackingStore.clearMainPanelView();
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

    if (action === 'create-pr' && githubAuthState.isAuthenticated) {
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
                {#each [1, 2, 3] as _}
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
      {workspace}
      workspaceTitle={workspace?.title}
      branch={status?.branch ?? (isLoadingStatus ? '' : 'Loading...')}
      bind:targetBranch
      availableBranches={status?.availableBranches ?? []}
      {unstagedFiles}
      {stagedFiles}
      commits={localCommits}
      {prs}
      bind:commitMessage
      bind:prTitle
      bind:prDescription
      isGeneratingMessage={commitMessageExecutor.isRunning}
      isGeneratingPR={prDescriptionExecutor.isRunning}
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
        commitMessage = msg;
      }}
      onGenerateMessage={handleGenerateMessage}
      onCommit={handleCommit}
      onPush={handlePush}
      onAddToPR={handleAddToPR}
      onTargetBranchChange={(branch: string) => {
        targetBranch = branch;
      }}
      onPRTitleChange={(title: string) => {
        prTitle = title;
      }}
      onPRDescriptionChange={(desc: string) => {
        prDescription = desc;
      }}
      onGeneratePR={handleGeneratePR}
      onCreatePR={handleCreatePR}
      onPickExportFolder={handlePickExportFolder}
      onExport={handleExport}
      defaultExportPath={workspace?.repositoryPath}
      onOpenCommit={handleOpenCommit}
      onOpenPR={handleOpenPR}
      onOpenLocalChanges={() => {
        window.dispatchEvent(new CustomEvent('workspace:open-local-changes'));
      }}
      commitMessageAgentId={commitMessageExecutor.agentId}
      prDescriptionAgentId={prDescriptionExecutor.agentId}
      onViewCommitThoughtProcess={handleViewCommitThoughtProcess}
      onViewPRThoughtProcess={handleViewPRThoughtProcess}
      onAutofillAndCommit={handleAutofillAndCommit}
      onAutofillAndAddToPR={handleAutofillAndAddToPR}
      onAutofillAndCreatePR={handleAutofillAndCreatePR}
      {isAutofillAndCommitting}
      {isAutofillAndCreatingPR}
      backgroundOperation={getBackgroundOperation()}
      onStopGeneratingMessage={() => {
        commitMessageExecutor.cancel();
        isAutofillAndCommitting = false;
        pendingCommitAction = null;
        getTransientStore()?.clearExecutorStates();
      }}
      onStopGeneratingPR={() => {
        prDescriptionExecutor.cancel();
        isAutofillAndCreatingPR = false;
        pendingPRContext = null;
        getTransientStore()?.clearExecutorStates();
      }}
      onReviewStaged={() => handleReviewStaged(false)}
      onReReview={() => handleReviewStaged(true)}
      onOpenReview={handleOpenExistingReview}
      onOpenArchivedReview={handleOpenArchivedReview}
      isReviewingCode={codeReviewExecutor.isRunning}
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
