/**
 * Backend-namespaced localStorage keys.
 *
 * Per-workspace persistence (panel layout, workspace-tab strip, sidebar-nav
 * pins/tab-order) is keyed by workspace ID today. With the multi-backend
 * connect feature two different intentd backends can each surface a workspace
 * with the *same* ID, so their un-namespaced keys would clobber each other.
 * These helpers scope those keys by the active backend id (the connections
 * slice's `activeId`, sourced from the T2 store / T5 slice).
 *
 * Migration: the local sidecar keeps the ORIGINAL un-namespaced key, so
 * existing (pre-multi-backend) users read and write the exact keys they always
 * have — their layouts carry over with zero migration. Remote backends get a
 * `backend:<id>:` prefix, giving each its own isolated namespace.
 *
 * Window route + bounds (last-viewed workspace + size per backend) are already
 * backend-keyed in the main process via T4's `WindowSessionsMap`
 * (`src/main/window.ts`) — no change needed there.
 */
import { LOCAL_CONNECTION_ID } from "$shared/types/connections";
import type { StoreState } from "../types";

/**
 * The active backend id from the connections slice, defaulting to the local
 * sidecar when the slice is absent (e.g. bridge-less test stores) or still on
 * its initial value at boot.
 */
export function getActiveBackendId(state: StoreState): string {
  return state.connections?.activeId ?? LOCAL_CONNECTION_ID;
}

/**
 * Namespace a base localStorage key by backend id. The local backend keeps the
 * bare key (legacy compatibility / migration); remote backends are prefixed.
 */
export function namespaceBackendKey(baseKey: string, backendId: string): string {
  return backendId === LOCAL_CONNECTION_ID ? baseKey : `backend:${backendId}:${baseKey}`;
}
