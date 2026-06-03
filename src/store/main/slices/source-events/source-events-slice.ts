/**
 * Source Events Slice
 *
 * Saga-only slice (no reducer) for source domain events.
 * Actions: source:*
 */

import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Source actions
// ---------------------------------------------------------------------------

export const sourceCreated = createAction<
  [data: DomainEventPayloads["source:created"]]
>("domainEvents/sourceCreated");

export const sourceUpdated = createAction<
  [data: DomainEventPayloads["source:updated"]]
>("domainEvents/sourceUpdated");

export const sourceDeleted = createAction<
  [data: DomainEventPayloads["source:deleted"]]
>("domainEvents/sourceDeleted");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const SOURCE_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "source:created": { actionCreator: sourceCreated, ipcChannel: "source:created" },
  "source:updated": { actionCreator: sourceUpdated, ipcChannel: "source:updated" },
  "source:deleted": { actionCreator: sourceDeleted, ipcChannel: "source:deleted" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const SOURCE_EVENT_TYPES = Object.values(SOURCE_EVENT_ACTION_MAP).map(
  (entry) => entry!.actionCreator.type,
);

