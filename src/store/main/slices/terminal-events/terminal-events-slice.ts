/**
 * Terminal Events Slice
 *
 * Saga-only slice (no reducer) for terminal domain events.
 * Actions: terminal:*, terminal:professional:*
 */

import { createAction } from "$lib/store-shim/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Terminal actions
// ---------------------------------------------------------------------------

export const terminalCreated = createAction<
  [data: DomainEventPayloads["terminal:created"]]
>("domainEvents/terminalCreated");

export const terminalData = createAction<
  [data: DomainEventPayloads["terminal:data"]]
>("domainEvents/terminalData");

export const terminalExit = createAction<
  [data: DomainEventPayloads["terminal:exit"]]
>("domainEvents/terminalExit");

export const terminalError = createAction<
  [data: DomainEventPayloads["terminal:error"]]
>("domainEvents/terminalError");

export const terminalDisposed = createAction<
  [data: DomainEventPayloads["terminal:disposed"]]
>("domainEvents/terminalDisposed");

// ---------------------------------------------------------------------------
// Professional terminal actions
// ---------------------------------------------------------------------------

export const terminalProfessionalData = createAction<
  [data: DomainEventPayloads["terminal:professional:data"]]
>("domainEvents/terminalProfessionalData");

export const terminalProfessionalExit = createAction<
  [data: DomainEventPayloads["terminal:professional:exit"]]
>("domainEvents/terminalProfessionalExit");

export const terminalProfessionalCommandStart = createAction<
  [data: DomainEventPayloads["terminal:professional:command:start"]]
>("domainEvents/terminalProfessionalCommandStart");

export const terminalProfessionalCommandExecuted = createAction<
  [data: DomainEventPayloads["terminal:professional:command:executed"]]
>("domainEvents/terminalProfessionalCommandExecuted");

export const terminalProfessionalCommandFinished = createAction<
  [data: DomainEventPayloads["terminal:professional:command:finished"]]
>("domainEvents/terminalProfessionalCommandFinished");

export const terminalProfessionalCwdChanged = createAction<
  [data: DomainEventPayloads["terminal:professional:cwd:changed"]]
>("domainEvents/terminalProfessionalCwdChanged");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const TERMINAL_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "terminal:created": { actionCreator: terminalCreated, ipcChannel: "terminal:created" },
  "terminal:data": { actionCreator: terminalData, ipcChannel: "terminal:data" },
  "terminal:exit": { actionCreator: terminalExit, ipcChannel: "terminal:exit" },
  "terminal:error": { actionCreator: terminalError, ipcChannel: "terminal:error" },
  "terminal:disposed": { actionCreator: terminalDisposed, ipcChannel: "terminal:disposed" },
  "terminal:professional:data": { actionCreator: terminalProfessionalData, ipcChannel: "terminal:professional:data" },
  "terminal:professional:exit": { actionCreator: terminalProfessionalExit, ipcChannel: "terminal:professional:exit" },
  "terminal:professional:command:start": { actionCreator: terminalProfessionalCommandStart, ipcChannel: "terminal:professional:command:start" },
  "terminal:professional:command:executed": { actionCreator: terminalProfessionalCommandExecuted, ipcChannel: "terminal:professional:command:executed" },
  "terminal:professional:command:finished": { actionCreator: terminalProfessionalCommandFinished, ipcChannel: "terminal:professional:command:finished" },
  "terminal:professional:cwd:changed": { actionCreator: terminalProfessionalCwdChanged, ipcChannel: "terminal:professional:cwd:changed" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const TERMINAL_EVENT_TYPES = Object.values(TERMINAL_EVENT_ACTION_MAP).flatMap((entry) =>
  entry ? [entry.actionCreator.type] : [],
);

