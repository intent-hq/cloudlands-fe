/**
 * Note Events Saga
 *
 * Broadcast + listener sagas for note/comment domain events.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import type { DomainEvent } from "../../../../../features/events/types";
import type { MainStoreAction } from "../../../utils/create-action";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  noteCreated,
  noteUpdated,
  noteDeleted,
  NOTE_EVENT_TYPES,
  NOTE_EVENT_ACTION_MAP,
} from "../note-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(NOTE_EVENT_ACTION_MAP)) {
  if (entry) ACTION_TYPE_TO_IPC[entry.actionCreator.type] = domainEvent as DomainEvent;
}

// ---------------------------------------------------------------------------
// Broadcast handler
// ---------------------------------------------------------------------------

function* handleBroadcast(action: MainStoreAction<any>) {
  const ipcChannel = ACTION_TYPE_TO_IPC[action.type];
  if (!ipcChannel) return;

  const [data] = action.payload as [unknown];
  // Note events are workspace-scoped, never global
  yield* call(broadcastDomainEvent, ipcChannel, data, false);
  yield* call(broadcastDomainEventToStdio, ipcChannel, data);
}

// ---------------------------------------------------------------------------
// Listener: note created → workspace service
// ---------------------------------------------------------------------------

function* handleNoteCreatedForService(
  action: ReturnType<typeof noteCreated>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { workspaceService } = await import(
      "../../../../../features/workspace/main/workspace.service"
    );
    workspaceService.onNoteCreated(data);
  });
}

// ---------------------------------------------------------------------------
// Listener: note deleted → workspace service
// ---------------------------------------------------------------------------

function* handleNoteDeletedForService(
  action: ReturnType<typeof noteDeleted>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { workspaceService } = await import(
      "../../../../../features/workspace/main/workspace.service"
    );
    workspaceService.onNoteDeleted(data);
  });
}

// ---------------------------------------------------------------------------
// Listener: note updated → line attribution service
// ---------------------------------------------------------------------------

function* handleNoteUpdatedForAttribution(
  action: ReturnType<typeof noteUpdated>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    if (!data.workspaceId || !data.noteId) return;
    const { lineAttributionService } = await import(
      "../../../../../features/notes/main/line-attribution.service"
    );
    lineAttributionService.handleNoteUpdated(data);
  });
}

// ---------------------------------------------------------------------------
// Listener: note updated → line attribution debug service
// ---------------------------------------------------------------------------

function* handleNoteUpdatedForAttributionDebug(
  action: ReturnType<typeof noteUpdated>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { getLineAttributionDebugService } = await import(
      "../../../../../features/notes/main/line-attribution-debug.service"
    );
    const debugService = getLineAttributionDebugService();
    await debugService.handleNoteUpdated(data);
  });
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* noteEventsSaga() {
  // Broadcast all note/comment events
  yield* takeEvery(NOTE_EVENT_TYPES, handleBroadcast);

  // Workspace service reactions
  yield* takeEvery(noteCreated, handleNoteCreatedForService);
  yield* takeEvery(noteDeleted, handleNoteDeletedForService);

  // Line attribution
  yield* takeEvery(noteUpdated, handleNoteUpdatedForAttribution);
  yield* takeEvery(noteUpdated, handleNoteUpdatedForAttributionDebug);
}

