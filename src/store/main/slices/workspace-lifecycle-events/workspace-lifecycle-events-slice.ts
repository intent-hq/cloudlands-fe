/**
 * Workspace Lifecycle Events Slice
 *
 * Saga-only slice (no reducer) for workspace lifecycle domain events.
 * Actions: workspace:created/updated/deleting/deleted/archived/file-changes
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const workspaceCreated = createAction<
  [data: DomainEventPayloads["workspace:created"]]
>("domainEvents/workspaceCreated");

export const workspaceUpdated = createAction<
  [data: DomainEventPayloads["workspace:updated"]]
>("domainEvents/workspaceUpdated");

export const workspaceDeleting = createAction<
  [data: DomainEventPayloads["workspace:deleting"]]
>("domainEvents/workspaceDeleting");

export const workspaceDeleted = createAction<
  [data: DomainEventPayloads["workspace:deleted"]]
>("domainEvents/workspaceDeleted");

export const workspaceArchived = createAction<
  [data: DomainEventPayloads["workspace:archived"]]
>("domainEvents/workspaceArchived");

export const workspaceFileChanges = createAction<
  [data: DomainEventPayloads["workspace:file-changes"]]
>("domainEvents/workspaceFileChanges");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "workspace:created": { actionCreator: workspaceCreated, ipcChannel: "workspace:created" },
  "workspace:updated": { actionCreator: workspaceUpdated, ipcChannel: "workspace:updated" },
  "workspace:deleting": { actionCreator: workspaceDeleting, ipcChannel: "workspace:deleting" },
  "workspace:deleted": { actionCreator: workspaceDeleted, ipcChannel: "workspace:deleted" },
  "workspace:archived": { actionCreator: workspaceArchived, ipcChannel: "workspace:archived" },
  "workspace:file-changes": { actionCreator: workspaceFileChanges, ipcChannel: "workspace:file-changes" },
};

// ---------------------------------------------------------------------------
// Global broadcast events (sent to ALL windows, not workspace-scoped)
// ---------------------------------------------------------------------------

export const WORKSPACE_LIFECYCLE_GLOBAL_BROADCAST_EVENTS: ReadonlySet<string> = new Set([
  workspaceCreated.type,
  workspaceUpdated.type,
  workspaceDeleting.type,
  workspaceDeleted.type,
  workspaceArchived.type,
]);

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const WORKSPACE_LIFECYCLE_EVENT_TYPES = Object.values(
  WORKSPACE_LIFECYCLE_EVENT_ACTION_MAP,
).flatMap((entry) => (entry ? [entry.actionCreator.type] : []));

