import type { WorkspaceGitStatus } from "$features/accept-changes/types";
import type { StoreAction } from "../../types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

export const STORAGE_KEY_PREFIX = "workspace-transient-ui-";
export const SAVE_DEBOUNCE_MS = 300;
export const STALE_STATE_THRESHOLD_MS = 60 * 60 * 1000;

export type PendingCommitAction = "commit" | "add-to-pr" | "merge" | "squash-merge" | null;
export type SidebarTabId = "notes" | "changes" | "files" | "agents" | "terminals" | "browser";
export type BackgroundOperationType = "commit" | "add-to-pr" | "create-pr";
export type BackgroundOperationPhase = "generating" | "executing";

export interface BackgroundOperationState {
  type: BackgroundOperationType;
  startedAt: number;
  phase: BackgroundOperationPhase;
  label?: string;
}

export interface PendingPRContext {
  includeStagedFiles: boolean;
  includeCommitHashes: string[];
  targetBranch: string;
}

export interface PostMergeState {
  aheadOfTrunk: number | null;
  behindTrunk: number;
  hasConflicts: boolean;
  isContentMergedToTrunk: boolean;
  hasRemote: boolean;
  isMergedToTrunk: boolean;
  mergeHeadSha: string | null;
  hasResetToTrunk: boolean;
}

export interface AcceptChangesState {
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  targetBranch: string;
  pendingCommitAction: PendingCommitAction;
  pendingPRContext: PendingPRContext | null;
  isAutofillAndCommitting: boolean;
  isAutofillAndCreatingPR: boolean;
  backgroundOperation: BackgroundOperationState | null;
  cachedGitStatus: WorkspaceGitStatus | null;
  cachedGitStatusTimestamp: number | null;
}

export type GitOperationFlagName =
  | "isPushing"
  | "isPulling"
  | "isForcePushing"
  | "isRebasing"
  | "isRefreshingPR"
  | "isRefreshingGitStatus"
  | "isResettingToTrunk";

export interface GitOperationFlags {
  isPushing: boolean;
  isPulling: boolean;
  isForcePushing: boolean;
  isRebasing: boolean;
  isRefreshingPR: boolean;
  isRefreshingGitStatus: boolean;
  isResettingToTrunk: boolean;
}

export type PendingAutoActionType = "commit" | "create-pr" | "merge" | null;

export interface PendingAutoAction {
  action: "commit" | "create-pr" | "merge";
  workspaceId: string;
  /** For PR auto-create: the target branch from the executor context */
  targetBranch?: string;
}

export interface SidebarChangesState {
  commitWhenReady: boolean;
  createPRWhenReady: boolean;
  mergeWhenReady: boolean;
  pendingAutoAction: PendingAutoAction | null;
  postMergeState: PostMergeState | null;
  gitOperations: GitOperationFlags;
}

export interface TransientUiWorkspaceState {
  acceptChanges: AcceptChangesState;
  sidebarChanges: SidebarChangesState;
  chatDrafts: Record<string, string>;
  sidebarActiveTab: SidebarTabId;
  viewedFiles: Record<string, string>;
  timestamp: number;
}

export interface TransientUiState {
  byWorkspaceId: Record<string, TransientUiWorkspaceState>;
}

export function createEmptyAcceptChangesState(): AcceptChangesState {
  return {
    commitMessage: "",
    prTitle: "",
    prDescription: "",
    targetBranch: "",
    pendingCommitAction: null,
    pendingPRContext: null,
    isAutofillAndCommitting: false,
    isAutofillAndCreatingPR: false,
    backgroundOperation: null,
    cachedGitStatus: null,
    cachedGitStatusTimestamp: null,
  };
}

export const defaultGitOperationFlags: GitOperationFlags = {
  isPushing: false,
  isPulling: false,
  isForcePushing: false,
  isRebasing: false,
  isRefreshingPR: false,
  isRefreshingGitStatus: false,
  isResettingToTrunk: false,
};

export function createEmptySidebarChangesState(): SidebarChangesState {
  return {
    commitWhenReady: false,
    createPRWhenReady: false,
    mergeWhenReady: false,
    pendingAutoAction: null,
    postMergeState: null,
    gitOperations: { ...defaultGitOperationFlags },
  };
}

export function createEmptyWorkspaceTransientUiState(): TransientUiWorkspaceState {
  return {
    acceptChanges: createEmptyAcceptChangesState(),
    sidebarChanges: createEmptySidebarChangesState(),
    chatDrafts: {},
    sidebarActiveTab: "notes",
    viewedFiles: {},
    timestamp: 0,
  };
}

export const emptyWorkspaceTransientUiState = createEmptyWorkspaceTransientUiState();
export const initialState: TransientUiState = { byWorkspaceId: {} };

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTransientUiState);

const updateWorkspaceState = (
  state: TransientUiState,
  workspaceId: string,
  updater: (workspaceState: TransientUiWorkspaceState) => TransientUiWorkspaceState
) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, updater(workspaceState));
};

export const hydrateWorkspaceTransientUi = createAction<[
  workspaceId: string,
  workspaceState: TransientUiWorkspaceState,
]>("transientUi/hydrateWorkspaceTransientUi");
export const clearWorkspaceTransientUi = createAction<[workspaceId: string]>(
  "transientUi/clearWorkspaceTransientUi"
);
export const requestPersistWorkspaceTransientUi = createAction<[StoreAction<any>]>(
  "transientUi/requestPersistWorkspaceTransientUi"
);
export const persistWorkspaceTransientUi = createAction<[workspaceId: string]>(
  "transientUi/persistWorkspaceTransientUi"
);
export const setViewedFiles = createAction<[workspaceId: string, viewedFiles: Record<string, string>]>(
  "transientUi/setViewedFiles"
);
export const setSidebarActiveTab = createAction<[workspaceId: string, tab: SidebarTabId]>(
  "transientUi/setSidebarActiveTab"
);
export const setSidebarCreatePRWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "transientUi/setSidebarCreatePRWhenReady"
);
export const setSidebarCommitWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "transientUi/setSidebarCommitWhenReady"
);
export const setSidebarMergeWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "transientUi/setSidebarMergeWhenReady"
);
export const setPendingAutoAction = createAction<[workspaceId: string, pendingAutoAction: PendingAutoAction | null]>(
  "transientUi/setPendingAutoAction"
);
export const setPostMergeState = createAction<[workspaceId: string, postMergeState: PostMergeState | null]>(
  "transientUi/setPostMergeState"
);
export const setCommitMessage = createAction<[workspaceId: string, message: string]>(
  "transientUi/setCommitMessage"
);
export const setPRTitle = createAction<[workspaceId: string, title: string]>("transientUi/setPRTitle");
export const setPRDescription = createAction<[workspaceId: string, description: string]>(
  "transientUi/setPRDescription"
);
export const setTargetBranch = createAction<[workspaceId: string, branch: string]>(
  "transientUi/setTargetBranch"
);
export const setPendingCommitAction = createAction<[
  workspaceId: string,
  action: PendingCommitAction,
]>("transientUi/setPendingCommitAction");
export const setPendingPRContext = createAction<[
  workspaceId: string,
  context: PendingPRContext | null,
]>("transientUi/setPendingPRContext");
export const setIsAutofillAndCommitting = createAction<[workspaceId: string, value: boolean]>(
  "transientUi/setIsAutofillAndCommitting"
);
export const setIsAutofillAndCreatingPR = createAction<[workspaceId: string, value: boolean]>(
  "transientUi/setIsAutofillAndCreatingPR"
);
export const startBackgroundOperation = createAction<[
  workspaceId: string,
  type: BackgroundOperationType,
  startedAt: number,
  label?: string,
]>("transientUi/startBackgroundOperation");
export const updateBackgroundOperationPhase = createAction<[
  workspaceId: string,
  phase: BackgroundOperationPhase,
]>("transientUi/updateBackgroundOperationPhase");
export const clearBackgroundOperation = createAction<[workspaceId: string]>(
  "transientUi/clearBackgroundOperation"
);
export const clearAcceptChangesForm = createAction<[workspaceId: string]>(
  "transientUi/clearAcceptChangesForm"
);
export const resetAcceptChangesOperations = createAction<[workspaceId: string]>(
  "transientUi/resetAcceptChangesOperations"
);
export const setCachedGitStatus = createAction<[
  workspaceId: string,
  gitStatus: WorkspaceGitStatus | null,
  cachedGitStatusTimestamp: number | null,
]>("transientUi/setCachedGitStatus");
export const setChatDraft = createAction<[workspaceId: string, agentId: string, draft: string]>(
  "transientUi/setChatDraft"
);
export const clearChatDraft = createAction<[workspaceId: string, agentId: string]>(
  "transientUi/clearChatDraft"
);
export const setGitOperationFlag = createAction<[
  workspaceId: string,
  flag: GitOperationFlagName,
  value: boolean,
]>("transientUi/setGitOperationFlag");

/** Saga trigger: fetch AcceptChangesClient.getStatus and update post-merge state */
export const refreshAcceptChangesStatus = createAction<[workspaceId: string]>(
  "transientUi/refreshAcceptChangesStatus"
);


export const transientUiReducer = createReducer<TransientUiState>(initialState)
  .with(hydrateWorkspaceTransientUi, (state, { payload: [workspaceId, workspaceState] }) =>
    setWorkspaceState(state, workspaceId, workspaceState)
  )
  .with(clearWorkspaceTransientUi, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId)
  )
  .with(setViewedFiles, (state, { payload: [workspaceId, viewedFiles] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({ ...workspaceState, viewedFiles }))
  )
  .with(setSidebarActiveTab, (state, { payload: [workspaceId, tab] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarActiveTab: tab,
    }))
  )
  .with(setSidebarCreatePRWhenReady, (state, { payload: [workspaceId, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: { ...workspaceState.sidebarChanges, createPRWhenReady: value },
    }))
  )
  .with(setSidebarCommitWhenReady, (state, { payload: [workspaceId, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: { ...workspaceState.sidebarChanges, commitWhenReady: value },
    }))
  )
  .with(setSidebarMergeWhenReady, (state, { payload: [workspaceId, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: { ...workspaceState.sidebarChanges, mergeWhenReady: value },
    }))
  )
  .with(setPendingAutoAction, (state, { payload: [workspaceId, pendingAutoAction] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: { ...workspaceState.sidebarChanges, pendingAutoAction },
    }))
  )
  .with(setPostMergeState, (state, { payload: [workspaceId, postMergeState] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: { ...workspaceState.sidebarChanges, postMergeState },
    }))
  )
  .with(setCommitMessage, (state, { payload: [workspaceId, message] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, commitMessage: message },
    }))
  )
  .with(setPRTitle, (state, { payload: [workspaceId, title] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, prTitle: title },
    }))
  )
  .with(setPRDescription, (state, { payload: [workspaceId, description] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, prDescription: description },
    }))
  )
  .with(setTargetBranch, (state, { payload: [workspaceId, branch] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, targetBranch: branch },
    }))
  )
  .with(setPendingCommitAction, (state, { payload: [workspaceId, action] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, pendingCommitAction: action },
    }))
  )
  .with(setPendingPRContext, (state, { payload: [workspaceId, context] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, pendingPRContext: context },
    }))
  )
  .with(setIsAutofillAndCommitting, (state, { payload: [workspaceId, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, isAutofillAndCommitting: value },
    }))
  )
  .with(setIsAutofillAndCreatingPR, (state, { payload: [workspaceId, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, isAutofillAndCreatingPR: value },
    }))
  )
  .with(startBackgroundOperation, (state, { payload: [workspaceId, type, startedAt, label] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: {
        ...workspaceState.acceptChanges,
        backgroundOperation: { type, startedAt, phase: "generating", label },
      },
    }))
  )
  .with(updateBackgroundOperationPhase, (state, { payload: [workspaceId, phase] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    if (!workspaceState.acceptChanges.backgroundOperation) {
      return state;
    }

    return updateWorkspaceState(state, workspaceId, (currentWorkspaceState) => ({
      ...currentWorkspaceState,
      acceptChanges: {
        ...currentWorkspaceState.acceptChanges,
        backgroundOperation: currentWorkspaceState.acceptChanges.backgroundOperation
          ? { ...currentWorkspaceState.acceptChanges.backgroundOperation, phase }
          : null,
      },
    }));
  })
  .with(clearBackgroundOperation, (state, { payload: [workspaceId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: { ...workspaceState.acceptChanges, backgroundOperation: null },
    }))
  )
  .with(clearAcceptChangesForm, (state, { payload: [workspaceId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: {
        ...workspaceState.acceptChanges,
        commitMessage: "",
        prTitle: "",
        prDescription: "",
      },
    }))
  )
  .with(resetAcceptChangesOperations, (state, { payload: [workspaceId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: {
        ...workspaceState.acceptChanges,
        pendingCommitAction: null,
        pendingPRContext: null,
        isAutofillAndCommitting: false,
        isAutofillAndCreatingPR: false,
        backgroundOperation: null,
      },
    }))
  )
  .with(setCachedGitStatus, (state, { payload: [workspaceId, gitStatus, cachedGitStatusTimestamp] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      acceptChanges: {
        ...workspaceState.acceptChanges,
        cachedGitStatus: gitStatus,
        cachedGitStatusTimestamp: gitStatus ? cachedGitStatusTimestamp : null,
      },
    }))
  )
  .with(setChatDraft, (state, { payload: [workspaceId, agentId, draft] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => {
      const chatDrafts = { ...workspaceState.chatDrafts };
      if (draft) {
        chatDrafts[agentId] = draft;
      } else {
        delete chatDrafts[agentId];
      }
      return { ...workspaceState, chatDrafts };
    })
  )
  .with(clearChatDraft, (state, { payload: [workspaceId, agentId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => {
      const chatDrafts = { ...workspaceState.chatDrafts };
      delete chatDrafts[agentId];
      return { ...workspaceState, chatDrafts };
    })
  )
  .with(setGitOperationFlag, (state, { payload: [workspaceId, flag, value] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarChanges: {
        ...workspaceState.sidebarChanges,
        gitOperations: {
          ...workspaceState.sidebarChanges.gitOperations,
          [flag]: value,
        },
      },
    }))
  )
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));