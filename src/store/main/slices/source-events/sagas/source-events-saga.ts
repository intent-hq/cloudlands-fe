/**
 * Source Events Saga
 *
 * Broadcast saga for source domain events.
 * No listener sagas currently — source events are broadcast-only.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import type { StoreAction } from "svelte-redux-toolkit/types";
import type { DomainEvent } from "../../../../../features/events/types";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  SOURCE_EVENT_TYPES,
  SOURCE_EVENT_ACTION_MAP,
} from "../source-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(SOURCE_EVENT_ACTION_MAP)) {
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

export function* sourceEventsSaga() {
  yield* takeEvery(SOURCE_EVENT_TYPES, handleBroadcast);
}

