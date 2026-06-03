/**
 * Agent Events Saga
 *
 * Broadcast saga for agent domain events.
 * No listener sagas currently — agent events are broadcast-only.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import type { StoreAction } from "ag-redux-toolkit/types";
import type { DomainEvent } from "../../../../../features/events/types";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  AGENT_EVENT_TYPES,
  AGENT_EVENT_ACTION_MAP,
} from "../agent-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(AGENT_EVENT_ACTION_MAP)) {
  if (entry) ACTION_TYPE_TO_IPC[entry.actionCreator.type] = domainEvent as DomainEvent;
}

// ---------------------------------------------------------------------------
// Broadcast handler
// ---------------------------------------------------------------------------

function* handleBroadcast(action: StoreAction<[unknown]>) {
  const ipcChannel = ACTION_TYPE_TO_IPC[action.type];
  if (!ipcChannel) return;

  const [data] = action.payload;
  yield* call(broadcastDomainEvent, ipcChannel, data, false);
  yield* call(broadcastDomainEventToStdio, ipcChannel, data);
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* agentEventsSaga() {
  yield* takeEvery(AGENT_EVENT_TYPES, handleBroadcast);
}

