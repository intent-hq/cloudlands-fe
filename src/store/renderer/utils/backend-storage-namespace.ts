/**
 * Backend-namespaced localStorage keys.
 *
 * Per-workspace persistence (panel layout, workspace-tab strip, sidebar-nav
 * pins/tab-order) is keyed by workspace ID today. With the multi-backend
 * connect feature two different intentd backends can each surface a workspace
 * with the *same* ID, so their un-namespaced keys would clobber each other.
 * These helpers scope those keys by THIS WINDOW's backend id (the connections
 * slice's `windowBackendId`), which is fixed for the window's lifetime.
 *
 * Migration: the local sidecar keeps the ORIGINAL un-namespaced key, so
 * existing (pre-multi-backend) users read and write the exact keys they always
 * have — their layouts carry over with zero migration. Remote backends get a
 * `backend:<id>:` prefix, giving each its own isolated namespace.
 */
import { select, type SagaGenerator } from 'typed-redux-saga';

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../types';

/**
 * This window's backend id from the connections slice, defaulting to the
 * local sidecar when the slice is absent (e.g. bridge-less test stores) or
 * still on its initial value at boot. Window-scoped on purpose: a switch
 * performed in another window must never re-key this window's persistence
 * mid-session.
 */
export function getActiveBackendId(state: StoreState): string {
  return state.connections?.windowBackendId ?? LOCAL_CONNECTION_ID;
}

/**
 * Namespace a base localStorage key by backend id. The local backend keeps the
 * bare key (legacy compatibility / migration); remote backends are prefixed.
 */
export function namespaceBackendKey(baseKey: string, backendId: string): string {
  return backendId === LOCAL_CONNECTION_ID ? baseKey : `backend:${backendId}:${baseKey}`;
}

/** Saga-side read of the active backend id. */
export function* selectActiveBackendId(): SagaGenerator<string> {
  return yield* select(getActiveBackendId);
}
