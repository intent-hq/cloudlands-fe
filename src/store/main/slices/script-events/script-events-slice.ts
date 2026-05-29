/**
 * Script Events Slice
 *
 * Saga-only slice (no reducer) for script domain events.
 * Actions: script:*
 */

import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Script actions
// ---------------------------------------------------------------------------

export const scriptStarted = createAction<
  [data: DomainEventPayloads["script:started"]]
>("domainEvents/scriptStarted");

export const scriptStopped = createAction<
  [data: DomainEventPayloads["script:stopped"]]
>("domainEvents/scriptStopped");

export const scriptOutput = createAction<
  [data: DomainEventPayloads["script:output"]]
>("domainEvents/scriptOutput");

export const scriptError = createAction<
  [data: DomainEventPayloads["script:error"]]
>("domainEvents/scriptError");

export const scriptUrlDetected = createAction<
  [data: DomainEventPayloads["script:url-detected"]]
>("domainEvents/scriptUrlDetected");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const SCRIPT_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "script:started": { actionCreator: scriptStarted, ipcChannel: "script:started" },
  "script:stopped": { actionCreator: scriptStopped, ipcChannel: "script:stopped" },
  "script:output": { actionCreator: scriptOutput, ipcChannel: "script:output" },
  "script:error": { actionCreator: scriptError, ipcChannel: "script:error" },
  "script:url-detected": { actionCreator: scriptUrlDetected, ipcChannel: "script:url-detected" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const SCRIPT_EVENT_TYPES = Object.values(SCRIPT_EVENT_ACTION_MAP).map(
  (entry) => entry!.actionCreator.type,
);

