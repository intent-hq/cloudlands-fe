/**
 * Git Events Slice
 *
 * Saga-only slice (no reducer) for git domain events.
 * Actions: git:*, github:auth-required
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Git actions
// ---------------------------------------------------------------------------

export const gitCommitCreated = createAction<
  [data: DomainEventPayloads["git:commit-created"]]
>("domainEvents/gitCommitCreated");

export const gitBranchChanged = createAction<
  [data: DomainEventPayloads["git:branch-changed"]]
>("domainEvents/gitBranchChanged");

export const gitAuthRequired = createAction<
  [data: DomainEventPayloads["git:auth-required"]]
>("domainEvents/gitAuthRequired");

export const githubAuthRequired = createAction<
  [data: DomainEventPayloads["github:auth-required"]]
>("domainEvents/githubAuthRequired");

export const gitStatusChanged = createAction<
  [data: DomainEventPayloads["git:status-changed"]]
>("domainEvents/gitStatusChanged");

// ---------------------------------------------------------------------------
// Auto-commit actions
// ---------------------------------------------------------------------------

export const gitAutoCommitStarted = createAction<
  [data: DomainEventPayloads["git:auto-commit-started"]]
>("domainEvents/gitAutoCommitStarted");

export const gitAutoCommitSucceeded = createAction<
  [data: DomainEventPayloads["git:auto-commit-succeeded"]]
>("domainEvents/gitAutoCommitSucceeded");

export const gitAutoCommitHookFailure = createAction<
  [data: DomainEventPayloads["git:auto-commit-hook-failure"]]
>("domainEvents/gitAutoCommitHookFailure");

// ---------------------------------------------------------------------------
// Background git operations actions
// ---------------------------------------------------------------------------

export const gitOpStarted = createAction<
  [data: DomainEventPayloads["git:op-started"]]
>("domainEvents/gitOpStarted");

export const gitOpProgress = createAction<
  [data: DomainEventPayloads["git:op-progress"]]
>("domainEvents/gitOpProgress");

export const gitOpCompleted = createAction<
  [data: DomainEventPayloads["git:op-completed"]]
>("domainEvents/gitOpCompleted");

export const gitOpFailed = createAction<
  [data: DomainEventPayloads["git:op-failed"]]
>("domainEvents/gitOpFailed");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const GIT_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "git:commit-created": { actionCreator: gitCommitCreated, ipcChannel: "git:commit-created" },
  "git:branch-changed": { actionCreator: gitBranchChanged, ipcChannel: "git:branch-changed" },
  "git:auth-required": { actionCreator: gitAuthRequired, ipcChannel: "git:auth-required" },
  "github:auth-required": { actionCreator: githubAuthRequired, ipcChannel: "github:auth-required" },
  "git:status-changed": { actionCreator: gitStatusChanged, ipcChannel: "git:status-changed" },
  "git:auto-commit-started": { actionCreator: gitAutoCommitStarted, ipcChannel: "git:auto-commit-started" },
  "git:auto-commit-succeeded": { actionCreator: gitAutoCommitSucceeded, ipcChannel: "git:auto-commit-succeeded" },
  "git:auto-commit-hook-failure": { actionCreator: gitAutoCommitHookFailure, ipcChannel: "git:auto-commit-hook-failure" },
  "git:op-started": { actionCreator: gitOpStarted, ipcChannel: "git:op-started" },
  "git:op-progress": { actionCreator: gitOpProgress, ipcChannel: "git:op-progress" },
  "git:op-completed": { actionCreator: gitOpCompleted, ipcChannel: "git:op-completed" },
  "git:op-failed": { actionCreator: gitOpFailed, ipcChannel: "git:op-failed" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const GIT_EVENT_TYPES = Object.values(GIT_EVENT_ACTION_MAP).flatMap((entry) =>
  entry ? [entry.actionCreator.type] : [],
);

