/**
 * Workspace-event persistence helpers.
 *
 * Provides the EventStore cache used to persist workspace events to JSONL.
 * The saga that wired this into the main-process Redux store has been removed;
 * these remain as plain helpers consumed directly by event/workspace services.
 */

import type { WorkspaceEvent } from "../../../../../features/events/types";

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
 * Dispose every cached EventStore (flushing pending writes) and clear the cache.
 * Used on saga cancellation (app shutdown) so buffered events are not lost.
 */
export async function disposeAllEventStores(): Promise<void> {
  const stores = Array.from(eventStoreCache.values());
  eventStoreCache.clear();
  await Promise.allSettled(
    stores.map((store) =>
      typeof store?.dispose === "function" ? store.dispose() : Promise.resolve(),
    ),
  );
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

