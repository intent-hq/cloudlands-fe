/**
 * Transient UI State Store
 *
 * Persists transient UI state that should survive navigation and reload:
 * - Accept Changes panel form values (commit message, PR title/description)
 * - Background executor state (agentId, status, result)
 * - Chat input drafts (per agent)
 *
 * This state is ephemeral but important for UX continuity.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { ExecutorStatus } from '$features/agent/background-agent-executor.svelte';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';

const logger = createLogger('transient-ui-state');

const STORAGE_KEY_PREFIX = 'workspace-transient-ui-';
const SAVE_DEBOUNCE_MS = 300;

// Stale state detection: clear problematic states if older than this threshold
// This prevents crash loops when the app restarts with incomplete operations
const STALE_STATE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export interface ExecutorState {
  agentId: string | null;
  status: ExecutorStatus;
  result: string | null;
  error: string | null;
}

/**
 * Background operation state for optimistic UI updates.
 * When a user triggers "Auto-fill & Commit" or "Auto-fill & Create PR",
 * we immediately show an optimistic success state while work continues in background.
 */
export interface BackgroundOperationState {
  /** Type of operation: 'commit', 'add-to-pr', or 'create-pr' */
  type: 'commit' | 'add-to-pr' | 'create-pr';
  /** When the operation was started */
  startedAt: number;
  /** Current phase: 'generating' (AI working) or 'executing' (git operations) */
  phase: 'generating' | 'executing';
  /** Optional label to show in the UI */
  label?: string;
}

export interface AcceptChangesState {
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  targetBranch: string;

  // Executor states
  commitMessageExecutor: ExecutorState | null;
  prDescriptionExecutor: ExecutorState | null;
  codeReviewExecutor: ExecutorState | null;
  walkthroughExecutor: ExecutorState | null;

  // Pending actions
  pendingCommitAction: 'commit' | 'add-to-pr' | 'merge' | 'squash-merge' | null;
  pendingPRContext: {
    includeStagedFiles: boolean;
    includeCommitHashes: string[];
    targetBranch: string;
  } | null;
  isAutofillAndCommitting: boolean;
  isAutofillAndCreatingPR: boolean;

  // Optimistic background operation state
  // Shows immediate success with subtle "still working" indicator
  backgroundOperation: BackgroundOperationState | null;

  // Cached git status to avoid re-fetching on navigation
  cachedGitStatus: WorkspaceGitStatus | null;
  cachedGitStatusTimestamp: number | null;
}

export type SidebarTabId =
  | 'notes'
  | 'changes'
  | 'files'
  | 'activity'
  | 'agents'
  | 'terminals'
  | 'browser';

/**
 * State for the SidebarChangesPanel "Create PR when done" feature.
 * Persists the createPRWhenReady flag and PR executor state so that
 * navigating away from the workspace doesn't lose pending auto-PR.
 */
export interface SidebarChangesState {
  createPRWhenReady: boolean;
  prDescriptionExecutor: ExecutorState | null;
}

export interface TransientUIState {
  acceptChanges: AcceptChangesState;
  sidebarChanges: SidebarChangesState;
  chatDrafts: Record<string, string>; // agentId -> draft input text
  sidebarActiveTab: SidebarTabId; // Active tab in the sidebar
  timestamp: number;
}

function createDefaultAcceptChangesState(): AcceptChangesState {
  return {
    commitMessage: '',
    prTitle: '',
    prDescription: '',
    targetBranch: '',
    commitMessageExecutor: null,
    prDescriptionExecutor: null,
    codeReviewExecutor: null,
    walkthroughExecutor: null,
    pendingCommitAction: null,
    pendingPRContext: null,
    isAutofillAndCommitting: false,
    isAutofillAndCreatingPR: false,
    backgroundOperation: null,
    cachedGitStatus: null,
    cachedGitStatusTimestamp: null,
  };
}

function createDefaultSidebarChangesState(): SidebarChangesState {
  return {
    createPRWhenReady: false,
    prDescriptionExecutor: null,
  };
}

function createDefaultState(): TransientUIState {
  return {
    acceptChanges: createDefaultAcceptChangesState(),
    sidebarChanges: createDefaultSidebarChangesState(),
    chatDrafts: {},
    sidebarActiveTab: 'notes',
    timestamp: Date.now(),
  };
}

// Cache of stores per workspace
const storeCache = new Map<string, ReturnType<typeof createTransientUIStore>>();

function createTransientUIStore(workspaceId: string) {
  // Load from localStorage with stale state detection
  const loadState = (): TransientUIState => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${workspaceId}`);
      if (stored) {
        const parsed = JSON.parse(stored);

        // Check if state is stale (older than threshold)
        const isStale =
          parsed.timestamp && Date.now() - parsed.timestamp > STALE_STATE_THRESHOLD_MS;

        // Merge with defaults to handle missing fields
        const state: TransientUIState = {
          ...createDefaultState(),
          ...parsed,
          acceptChanges: {
            ...createDefaultAcceptChangesState(),
            ...parsed.acceptChanges,
          },
          sidebarChanges: {
            ...createDefaultSidebarChangesState(),
            ...parsed.sidebarChanges,
          },
        };

        // Clear problematic states if stale to prevent crash loops
        // These states indicate incomplete operations that should not be resumed after restart
        if (isStale) {
          logger.warn('Clearing stale transient UI state', {
            workspaceId,
            stateAge: Date.now() - parsed.timestamp,
            threshold: STALE_STATE_THRESHOLD_MS,
            hadAutofillAndCommitting: state.acceptChanges.isAutofillAndCommitting,
            hadAutofillAndCreatingPR: state.acceptChanges.isAutofillAndCreatingPR,
            hadPendingCommitAction: state.acceptChanges.pendingCommitAction,
            hadBackgroundOperation: state.acceptChanges.backgroundOperation?.type,
            hadSidebarCreatePRWhenReady: state.sidebarChanges.createPRWhenReady,
          });

          // Clear operation-in-progress states
          state.acceptChanges.isAutofillAndCommitting = false;
          state.acceptChanges.isAutofillAndCreatingPR = false;
          state.acceptChanges.pendingCommitAction = null;
          state.acceptChanges.pendingPRContext = null;
          state.acceptChanges.commitMessageExecutor = null;
          state.acceptChanges.prDescriptionExecutor = null;
          state.acceptChanges.backgroundOperation = null;
          // Also clear sidebar changes state
          state.sidebarChanges.createPRWhenReady = false;
          state.sidebarChanges.prDescriptionExecutor = null;
        }

        // Also clear these states unconditionally on load - they represent
        // in-progress operations that can't be resumed after app restart
        if (
          state.acceptChanges.isAutofillAndCommitting ||
          state.acceptChanges.isAutofillAndCreatingPR ||
          state.acceptChanges.backgroundOperation
        ) {
          logger.info('Clearing in-progress operation states on load', {
            workspaceId,
            isAutofillAndCommitting: state.acceptChanges.isAutofillAndCommitting,
            isAutofillAndCreatingPR: state.acceptChanges.isAutofillAndCreatingPR,
            backgroundOperation: state.acceptChanges.backgroundOperation?.type,
          });
          state.acceptChanges.isAutofillAndCommitting = false;
          state.acceptChanges.isAutofillAndCreatingPR = false;
          state.acceptChanges.backgroundOperation = null;
          // Note: We don't clear pendingCommitAction or pendingPRContext here
          // because the reconnect logic in AcceptChangesPanel will handle them.
          // If reconnect succeeds, the operation continues; if it fails,
          // the panel clears these states.
        }

        return state;
      }
    } catch (error) {
      logger.error('Failed to load transient UI state', error);
    }
    return createDefaultState();
  };

  // Initialize state
  const state = $state<TransientUIState>(loadState());

  // Debounced save
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  const saveState = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      try {
        state.timestamp = Date.now();
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${workspaceId}`, JSON.stringify(state));
        logger.debug('Saved transient UI state', { workspaceId });
      } catch (error) {
        logger.error('Failed to save transient UI state', error);
      }
    }, SAVE_DEBOUNCE_MS);
  };

  const saveImmediate = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    try {
      state.timestamp = Date.now();
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${workspaceId}`, JSON.stringify(state));
      logger.debug('Saved transient UI state immediately', { workspaceId });
    } catch (error) {
      logger.error('Failed to save transient UI state', error);
    }
  };

  return {
    // Getters
    get acceptChanges() {
      return state.acceptChanges;
    },
    get sidebarChanges() {
      return state.sidebarChanges;
    },
    get chatDrafts() {
      return state.chatDrafts;
    },
    get sidebarActiveTab() {
      return state.sidebarActiveTab;
    },

    // Sidebar tab management
    setSidebarActiveTab(tab: SidebarTabId) {
      state.sidebarActiveTab = tab;
      saveState();
    },

    // Sidebar Changes mutations (for SidebarChangesPanel "Create PR when done")
    setSidebarCreatePRWhenReady(value: boolean) {
      state.sidebarChanges.createPRWhenReady = value;
      saveState();
    },

    setSidebarPRExecutorState(executorState: ExecutorState | null) {
      state.sidebarChanges.prDescriptionExecutor = executorState;
      // Save immediately for running states to survive page reloads (e.g., Vite HMR)
      if (executorState?.status === 'running' || executorState?.status === 'initializing') {
        saveImmediate();
      } else {
        saveState();
      }
    },

    clearSidebarExecutorStates() {
      state.sidebarChanges.createPRWhenReady = false;
      state.sidebarChanges.prDescriptionExecutor = null;
      saveState();
    },

    // Accept Changes mutations
    updateAcceptChanges(updates: Partial<AcceptChangesState>) {
      Object.assign(state.acceptChanges, updates);
      saveState();
    },

    setCommitMessage(message: string) {
      state.acceptChanges.commitMessage = message;
      saveState();
    },

    setPRTitle(title: string) {
      state.acceptChanges.prTitle = title;
      saveState();
    },

    setPRDescription(description: string) {
      state.acceptChanges.prDescription = description;
      saveState();
    },

    setTargetBranch(branch: string) {
      state.acceptChanges.targetBranch = branch;
      saveState();
    },

    // Executor state management
    setCommitMessageExecutorState(executorState: ExecutorState | null) {
      state.acceptChanges.commitMessageExecutor = executorState;
      saveState();
    },

    setPRDescriptionExecutorState(executorState: ExecutorState | null) {
      state.acceptChanges.prDescriptionExecutor = executorState;
      saveState();
    },

    setCodeReviewExecutorState(executorState: ExecutorState | null) {
      state.acceptChanges.codeReviewExecutor = executorState;
      // Save immediately for running states to survive page reloads (e.g., Vite HMR)
      // The debounced save might not complete before the page unloads
      if (executorState?.status === 'running' || executorState?.status === 'initializing') {
        saveImmediate();
      } else {
        saveState();
      }
    },

    setWalkthroughExecutorState(executorState: ExecutorState | null) {
      state.acceptChanges.walkthroughExecutor = executorState;
      // Save immediately for running states
      if (executorState?.status === 'running' || executorState?.status === 'initializing') {
        saveImmediate();
      } else {
        saveState();
      }
    },

    // Pending action state
    setPendingCommitAction(action: 'commit' | 'add-to-pr' | 'merge' | 'squash-merge' | null) {
      state.acceptChanges.pendingCommitAction = action;
      saveState();
    },

    setPendingPRContext(
      context: {
        includeStagedFiles: boolean;
        includeCommitHashes: string[];
        targetBranch: string;
      } | null,
    ) {
      state.acceptChanges.pendingPRContext = context;
      saveState();
    },

    setIsAutofillAndCommitting(value: boolean) {
      state.acceptChanges.isAutofillAndCommitting = value;
      saveState();
    },

    setIsAutofillAndCreatingPR(value: boolean) {
      state.acceptChanges.isAutofillAndCreatingPR = value;
      saveState();
    },

    // Background operation state for optimistic UI
    setBackgroundOperation(operation: BackgroundOperationState | null) {
      state.acceptChanges.backgroundOperation = operation;
      saveState();
    },

    startBackgroundOperation(type: 'commit' | 'add-to-pr' | 'create-pr', label?: string) {
      state.acceptChanges.backgroundOperation = {
        type,
        startedAt: Date.now(),
        phase: 'generating',
        label,
      };
      saveState();
    },

    updateBackgroundOperationPhase(phase: 'generating' | 'executing') {
      if (state.acceptChanges.backgroundOperation) {
        state.acceptChanges.backgroundOperation.phase = phase;
        saveState();
      }
    },

    clearBackgroundOperation() {
      state.acceptChanges.backgroundOperation = null;
      saveState();
    },

    // Clear accept changes state (e.g., after successful commit)
    clearAcceptChangesForm() {
      state.acceptChanges.commitMessage = '';
      state.acceptChanges.prTitle = '';
      state.acceptChanges.prDescription = '';
      saveState();
    },

    // Clear executor states (commit and PR only, not code review)
    clearExecutorStates() {
      state.acceptChanges.commitMessageExecutor = null;
      state.acceptChanges.prDescriptionExecutor = null;
      state.acceptChanges.pendingCommitAction = null;
      state.acceptChanges.pendingPRContext = null;
      state.acceptChanges.isAutofillAndCommitting = false;
      state.acceptChanges.isAutofillAndCreatingPR = false;
      state.acceptChanges.backgroundOperation = null;
      saveState();
    },

    // Clear code review executor state separately
    clearCodeReviewExecutorState() {
      state.acceptChanges.codeReviewExecutor = null;
      saveState();
    },

    // Clear walkthrough executor state separately
    clearWalkthroughExecutorState() {
      state.acceptChanges.walkthroughExecutor = null;
      saveState();
    },

    // Cached git status for instant panel loading
    setCachedGitStatus(gitStatus: WorkspaceGitStatus | null) {
      state.acceptChanges.cachedGitStatus = gitStatus;
      state.acceptChanges.cachedGitStatusTimestamp = gitStatus ? Date.now() : null;
      saveState();
    },

    getCachedGitStatus(): WorkspaceGitStatus | null {
      return state.acceptChanges.cachedGitStatus;
    },

    getCachedGitStatusAge(): number | null {
      if (!state.acceptChanges.cachedGitStatusTimestamp) return null;
      return Date.now() - state.acceptChanges.cachedGitStatusTimestamp;
    },

    // Chat draft management
    getChatDraft(agentId: string): string {
      return state.chatDrafts[agentId] || '';
    },

    setChatDraft(agentId: string, draft: string) {
      if (draft) {
        state.chatDrafts[agentId] = draft;
      } else {
        delete state.chatDrafts[agentId];
      }
      saveState();
    },

    clearChatDraft(agentId: string) {
      delete state.chatDrafts[agentId];
      saveState();
    },

    // Force immediate save (e.g., before navigation or on beforeunload)
    saveImmediate,

    // Clear all state
    clearAll() {
      Object.assign(state, createDefaultState());
      saveImmediate();
    },
  };
}

/**
 * Get the transient UI state store for a workspace
 */
export function getTransientUIStore(workspaceId: string) {
  if (!storeCache.has(workspaceId)) {
    storeCache.set(workspaceId, createTransientUIStore(workspaceId));
  }
  return storeCache.get(workspaceId)!;
}

/**
 * Clear cached store for a workspace (e.g., when workspace is deleted)
 */
export function clearTransientUIStore(workspaceId: string) {
  storeCache.delete(workspaceId);
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${workspaceId}`);
  } catch (error) {
    logger.error('Failed to clear transient UI state', error);
  }
}
