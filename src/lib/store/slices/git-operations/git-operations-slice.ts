import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type GitOperationType = "commit" | "push" | "create-pr" | "auto-commit";

export type GitOperationResult = {
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  noChanges?: boolean;
  reason?: string;
};

export type GitOperationMetadata = {
  message?: string;
  prTitle?: string;
  agentId?: string;
  agentName?: string;
};

export type GitOperationCompletedEvent = {
  operationId: string;
  workspaceId: string;
  operationType: GitOperationType;
  result?: GitOperationResult;
  metadata?: GitOperationMetadata;
};

export type GitOperationFailedEvent = {
  operationId: string;
  workspaceId: string;
  operationType: GitOperationType;
  error: string;
  metadata?: GitOperationMetadata;
};

export type AutoCommitHookFailureEvent = {
  workspaceId: string;
  agentId: string;
  agentName?: string;
  status: "waking-agent" | "retries-exhausted";
  hookOutput: string;
  retryCount: number;
};

export type GitOperationsState = {
  lastGitOperation: GitOperationCompletedEvent | null;
  lastGitError: GitOperationFailedEvent | null;
  lastAutoCommitHookFailure: AutoCommitHookFailureEvent | null;
};

export const initialState: GitOperationsState = {
  lastGitOperation: null,
  lastGitError: null,
  lastAutoCommitHookFailure: null,
};

export const setLastGitOperation = createAction<[event: GitOperationCompletedEvent]>(
  "gitOperations/setLastGitOperation"
);

export const setLastGitError = createAction<[event: GitOperationFailedEvent]>(
  "gitOperations/setLastGitError"
);

export const setLastAutoCommitHookFailure = createAction<[
  event: AutoCommitHookFailureEvent,
]>("gitOperations/setLastAutoCommitHookFailure");

export const gitOperationsReducer = createReducer<GitOperationsState>(initialState)
  .with(setLastGitOperation, (state, { payload: [event] }) => ({
    ...state,
    lastGitOperation: event,
  }))
  .with(setLastGitError, (state, { payload: [event] }) => ({
    ...state,
    lastGitError: event,
  }))
  .with(setLastAutoCommitHookFailure, (state, { payload: [event] }) => ({
    ...state,
    lastAutoCommitHookFailure: event,
  }));