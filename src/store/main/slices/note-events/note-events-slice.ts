/**
 * Note Events Slice
 *
 * Saga-only slice (no reducer) for note/comment domain events.
 * Actions: note:created/updated/deleted, line-attribution:updated, comment:*
 */

import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Note actions
// ---------------------------------------------------------------------------

export const noteCreated = createAction<
  [data: DomainEventPayloads["note:created"]]
>("domainEvents/noteCreated");

export const noteUpdated = createAction<
  [data: DomainEventPayloads["note:updated"]]
>("domainEvents/noteUpdated");

export const noteDeleted = createAction<
  [data: DomainEventPayloads["note:deleted"]]
>("domainEvents/noteDeleted");

export const lineAttributionUpdated = createAction<
  [data: DomainEventPayloads["line-attribution:updated"]]
>("domainEvents/lineAttributionUpdated");

// ---------------------------------------------------------------------------
// Comment actions
// ---------------------------------------------------------------------------

export const commentAdded = createAction<
  [data: DomainEventPayloads["comment:added"]]
>("domainEvents/commentAdded");

export const commentUpdated = createAction<
  [data: DomainEventPayloads["comment:updated"]]
>("domainEvents/commentUpdated");

export const commentDeleted = createAction<
  [data: DomainEventPayloads["comment:deleted"]]
>("domainEvents/commentDeleted");

export const commentResolved = createAction<
  [data: DomainEventPayloads["comment:resolved"]]
>("domainEvents/commentResolved");

export const commentStatusChanged = createAction<
  [data: DomainEventPayloads["comment:status-changed"]]
>("domainEvents/commentStatusChanged");

export const commentUpdatedBatch = createAction<
  [data: DomainEventPayloads["comment:updated-batch"]]
>("domainEvents/commentUpdatedBatch");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const NOTE_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "note:created": { actionCreator: noteCreated, ipcChannel: "note:created" },
  "note:updated": { actionCreator: noteUpdated, ipcChannel: "note:updated" },
  "note:deleted": { actionCreator: noteDeleted, ipcChannel: "note:deleted" },
  "line-attribution:updated": { actionCreator: lineAttributionUpdated, ipcChannel: "line-attribution:updated" },
  "comment:added": { actionCreator: commentAdded, ipcChannel: "comment:added" },
  "comment:updated": { actionCreator: commentUpdated, ipcChannel: "comment:updated" },
  "comment:deleted": { actionCreator: commentDeleted, ipcChannel: "comment:deleted" },
  "comment:resolved": { actionCreator: commentResolved, ipcChannel: "comment:resolved" },
  "comment:status-changed": { actionCreator: commentStatusChanged, ipcChannel: "comment:status-changed" },
  "comment:updated-batch": { actionCreator: commentUpdatedBatch, ipcChannel: "comment:updated-batch" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const NOTE_EVENT_TYPES = Object.values(NOTE_EVENT_ACTION_MAP).map(
  (entry) => entry!.actionCreator.type,
);

