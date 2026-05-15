/**
 * Module-level dedup cache for workspace events.
 *
 * Moved out of Redux state (P2-6) because:
 * - The cache doesn't need to be serialized, observed, or time-travel debugged
 * - Eliminates DevTools noise and serialization overhead
 * - A simple Map<string, number> is more efficient than immutable Record updates
 *
 * The cache is keyed by workspace ID → Map<eventKey, timestampMs>.
 */

import type { WorkspaceEvent } from "../../../../features/events/types";
import {
  DEDUP_WINDOW_MS,
  DEDUP_MAX_CACHE,
  DEDUP_FIELDS,
} from "./types";

// ---------------------------------------------------------------------------
// Module-level cache: workspaceId → Map<eventKey, timestampMs>
// ---------------------------------------------------------------------------

const cacheByWorkspace = new Map<string, Map<string, number>>();

// ---------------------------------------------------------------------------
// Event key computation (moved from slice)
// ---------------------------------------------------------------------------

function getNestedValue(obj: any, path: string): any {
  let current = obj;
  for (const part of path.split(".")) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/** Compute a content-hash key for dedup based on DEDUP_FIELDS */
export function getEventKey(event: WorkspaceEvent): string {
  const parts: string[] = [];
  for (const field of DEDUP_FIELDS) {
    const v = getNestedValue(event, field);
    if (v != null) parts.push(String(v));
  }
  if (parts.length === 0 && event.id) parts.push(event.id);
  return parts.join("-");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if an event is a duplicate and, if not, record it in the cache.
 * Returns `true` if the event is a duplicate (should be skipped).
 */
export function isDuplicateEvent(
  event: WorkspaceEvent,
  eventTimestampMs: number,
): boolean {
  const wsId = event.workspaceId;
  const eventKey = getEventKey(event);

  let wsCache = cacheByWorkspace.get(wsId);
  if (!wsCache) {
    wsCache = new Map();
    cacheByWorkspace.set(wsId, wsCache);
  }

  const lastSeen = wsCache.get(eventKey);
  if (lastSeen !== undefined && eventTimestampMs - lastSeen < DEDUP_WINDOW_MS) {
    return true; // duplicate
  }

  // Record this event
  wsCache.set(eventKey, eventTimestampMs);

  // Trim if over max
  if (wsCache.size > DEDUP_MAX_CACHE) {
    const cutoff = eventTimestampMs - DEDUP_WINDOW_MS;
    for (const [k, ts] of wsCache) {
      if (ts < cutoff) wsCache.delete(k);
    }
  }

  return false; // not a duplicate
}

/**
 * Clear the dedup cache for a specific workspace.
 * Called when workspace state is cleaned up.
 */
export function clearWorkspaceCache(workspaceId: string): void {
  cacheByWorkspace.delete(workspaceId);
}

/**
 * Clear the entire dedup cache. Used in tests.
 * @internal
 */
export function clearAllCaches(): void {
  cacheByWorkspace.clear();
}

