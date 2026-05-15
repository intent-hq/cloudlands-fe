/**
 * Persistence saga for workspace events.
 *
 * On `workspaceEventAccepted`, persists the event to JSONL via EventStore.
 * Sanitization is handled internally by EventStore.add().
 *
 * Uses EventStore as a pure I/O utility — one instance per workspace,
 * cached at module level to avoid duplicate file handles.
 */

import {
  call,
  cancelled,
  takeEvery,
} from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";

// ---------------------------------------------------------------------------
// EventStore access — dynamic import to keep test bundles clean
// ---------------------------------------------------------------------------

/**
 * Persist a single event to JSONL storage.
 * EventStore.add() handles sanitization, indexing, dedup-by-ID,
 * and debounced JSONL append internally.
 *
 * Uses dynamic imports so Electron / Node deps don't leak into test bundles.
 */
export async function persistEvent(event: WorkspaceEvent): Promise<void> {
  const { EventStore } = await import(
    "../../../../../features/events/main/event-store"
  );
  const { WorkspaceConfig } = await import("../../../../../shared/main/config");

  const storageDir = WorkspaceConfig.paths.metadata(event.workspaceId);
  const store = getOrCreateEventStore(event.workspaceId, storageDir, EventStore);
  store.add(event);
}

// Module-level cache — one EventStore per workspace (avoids duplicate file handles)
const eventStoreCache = new Map<string, any>();

/** @internal exported for testing */
export function getOrCreateEventStore(
  workspaceId: string,
  storageDir: string,
  EventStoreCtor: any,
): any {
  let store = eventStoreCache.get(workspaceId);
  if (!store) {
    store = new EventStoreCtor(workspaceId, { storageDir, persistToDisk: true });
    eventStoreCache.set(workspaceId, store);
  }
  return store;
}

/** @internal exported for testing — clear cached stores */
export function clearEventStoreCache(): void {
  eventStoreCache.clear();
}

/**
 * Remove and dispose a single workspace's EventStore from the cache.
 * Calls EventStore.dispose() first to flush pending writes and clear timers,
 * then deletes the entry so the GC can reclaim the events + indexes.
 *
 * Call this from workspace close / delete / archive handlers.
 */
export async function deleteEventStoreForWorkspace(workspaceId: string): Promise<void> {
  const store = eventStoreCache.get(workspaceId);
  if (!store) return;

  // EventStore.dispose() flushes pending events to disk and clears debounce timers
  if (typeof store.dispose === "function") {
    await store.dispose();
  }

  eventStoreCache.delete(workspaceId);
}

// ---------------------------------------------------------------------------
// Saga handlers
// ---------------------------------------------------------------------------

export function* handlePersistEvent(action: ReturnType<typeof workspaceEventAccepted>) {
  const [event] = action.payload;
  yield* call(persistEvent, event);
}

// ---------------------------------------------------------------------------
// Root persistence saga
// ---------------------------------------------------------------------------

export function* workspaceEventsPersistenceSaga() {
  try {
    yield* takeEvery(workspaceEventAccepted, handlePersistEvent);
  } finally {
    if (yield* cancelled()) {
      clearEventStoreCache();
    }
  }
}

