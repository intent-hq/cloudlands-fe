/**
 * Agent Events Slice
 *
 * Saga-only slice (no reducer) for agent domain events.
 * Actions: agent:session-*, agent:auth-required, agent:remote-error, agent:plan-required
 */

import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import type {
  DomainEvent,
  DomainEventPayloads,
} from "../../../../features/events/types";

// ---------------------------------------------------------------------------
// Agent session actions
// ---------------------------------------------------------------------------

export const agentSessionCreated = createAction<
  [data: DomainEventPayloads["agent:session-created"]]
>("domainEvents/agentSessionCreated");

export const agentSessionUpdated = createAction<
  [data: DomainEventPayloads["agent:session-updated"]]
>("domainEvents/agentSessionUpdated");

export const agentSessionCompleted = createAction<
  [data: DomainEventPayloads["agent:session-completed"]]
>("domainEvents/agentSessionCompleted");

// ---------------------------------------------------------------------------
// Agent auth/error actions
// ---------------------------------------------------------------------------

export const agentAuthRequired = createAction<
  [data: DomainEventPayloads["agent:auth-required"]]
>("domainEvents/agentAuthRequired");

export const agentRemoteError = createAction<
  [data: DomainEventPayloads["agent:remote-error"]]
>("domainEvents/agentRemoteError");

export const agentPlanRequired = createAction<
  [data: DomainEventPayloads["agent:plan-required"]]
>("domainEvents/agentPlanRequired");

// ---------------------------------------------------------------------------
// Domain event → action mapping (for broadcast saga)
// ---------------------------------------------------------------------------

export const AGENT_EVENT_ACTION_MAP: Partial<{
  [E in DomainEvent]: { actionCreator: { type: string; (...args: any[]): any }; ipcChannel: E };
}> = {
  "agent:session-created": { actionCreator: agentSessionCreated, ipcChannel: "agent:session-created" },
  "agent:session-updated": { actionCreator: agentSessionUpdated, ipcChannel: "agent:session-updated" },
  "agent:session-completed": { actionCreator: agentSessionCompleted, ipcChannel: "agent:session-completed" },
  "agent:auth-required": { actionCreator: agentAuthRequired, ipcChannel: "agent:auth-required" },
  "agent:remote-error": { actionCreator: agentRemoteError, ipcChannel: "agent:remote-error" },
  "agent:plan-required": { actionCreator: agentPlanRequired, ipcChannel: "agent:plan-required" },
};

// ---------------------------------------------------------------------------
// All action types (for takeEvery matching)
// ---------------------------------------------------------------------------

export const AGENT_EVENT_TYPES = Object.values(AGENT_EVENT_ACTION_MAP).flatMap((entry) =>
  entry ? [entry.actionCreator.type] : [],
);

