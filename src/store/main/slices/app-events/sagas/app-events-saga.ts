/**
 * App Events Saga
 *
 * Broadcast saga for app-level domain events (including log:events-updated).
 * No listener sagas currently — app events are broadcast-only.
 */

import { call, takeEvery } from "typed-redux-saga";
import type { DomainEvent } from "../../../../../features/events/types";
import type { MainStoreAction } from "../../../utils/create-action";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  APP_EVENT_TYPES,
  APP_EVENT_ACTION_MAP,
} from "../app-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(APP_EVENT_ACTION_MAP)) {
  if (entry) ACTION_TYPE_TO_IPC[entry.actionCreator.type] = domainEvent as DomainEvent;
}

// ---------------------------------------------------------------------------
// Broadcast handler
// ---------------------------------------------------------------------------

function* handleBroadcast(action: MainStoreAction<any>) {
  const ipcChannel = ACTION_TYPE_TO_IPC[action.type];
  if (!ipcChannel) return;

  const [data] = action.payload as [unknown];
  yield* call(broadcastDomainEvent, ipcChannel, data, false);
  yield* call(broadcastDomainEventToStdio, ipcChannel, data);
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* appEventsSaga() {
  yield* takeEvery(APP_EVENT_TYPES, handleBroadcast);
}

