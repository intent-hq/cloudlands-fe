/**
 * HUD grid-filter persistence — restores the header FLEET OPS repo + status
 * filter per backend id on activation and persists every change, so the
 * selection survives app restarts and is kept per backend. Redux stays the
 * source of truth; this is a thin localStorage layer (`safeLocalStorage` via
 * the backend-scoped helpers) started/stopped by `startHudSubscription`.
 *
 * Hydration waits for the connections list (`hasReceivedList`) so this
 * window's backend id is authoritative — the id can arrive after HUD mount,
 * and a HUD window is bound to one backend for its lifetime, so one hydration
 * per start suffices. Persisted values are sanitized on the way in: unknown
 * status keys are dropped and malformed payloads fall back to
 * `EMPTY_HUD_GRID_FILTER`.
 */
import { store as appStore } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import { getActiveBackendId } from '$store/renderer/utils/backend-storage-namespace';
import {
  readBackendScopedJSON,
  writeBackendScopedJSON,
} from '$store/renderer/utils/backend-scoped-storage';
import { hudGridFilterHydrated } from '$store/renderer/slices/hud/hud-slice';
import {
  EMPTY_HUD_GRID_FILTER,
  HUD_CARD_STATE_KEYS,
  type HudCardStateKey,
  type HudGridFilter,
} from '$store/renderer/slices/hud/hud-types';

/** Base localStorage key; backend-scoped via `namespaceBackendKey`. */
export const HUD_GRID_FILTER_STORAGE_KEY = 'hudGridFilter';

/**
 * Narrow a persisted payload to a valid `HudGridFilter`: unknown status keys
 * are dropped (the persisting build may know keys this one does not — or vice
 * versa), duplicates collapse, and any malformed shape falls back to
 * `EMPTY_HUD_GRID_FILTER`.
 */
export function sanitizePersistedHudGridFilter(value: unknown): HudGridFilter {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_HUD_GRID_FILTER;
  }
  const { repo, states } = value as { repo?: unknown; states?: unknown };
  if ((repo !== null && typeof repo !== 'string') || !Array.isArray(states)) {
    return EMPTY_HUD_GRID_FILTER;
  }
  const known = states.filter((key): key is HudCardStateKey =>
    (HUD_CARD_STATE_KEYS as readonly string[]).includes(key as string),
  );
  return {
    repo: typeof repo === 'string' && repo.length > 0 ? repo : null,
    states: [...new Set(known)],
  };
}

/** The sanitized persisted filter for `backendId` (EMPTY when absent/bad). */
function readPersistedHudGridFilter(backendId: string): HudGridFilter {
  return sanitizePersistedHudGridFilter(
    readBackendScopedJSON<unknown>(HUD_GRID_FILTER_STORAGE_KEY, backendId),
  );
}

/** Persist `filter` under `backendId`'s scoped key (best-effort). */
function persistHudGridFilter(backendId: string, filter: HudGridFilter): void {
  writeBackendScopedJSON(HUD_GRID_FILTER_STORAGE_KEY, backendId, filter);
}

/**
 * Start the hydrate-then-persist loop. Call after `hudActivated`; the
 * returned disposer must run BEFORE `hudDeactivated` so the deactivation
 * reset is never persisted. Phases: wait for `hasReceivedList`, dispatch the
 * restored filter (deferred out of the store's notification loop), then
 * persist every `gridFilter` reference change under the hydrated backend id.
 */
export function startHudGridFilterPersistence(): () => void {
  let stopped = false;
  let phase: 'waiting-backend' | 'hydrating' | 'ready' = 'waiting-backend';
  let backendId = '';
  let lastSeen: HudGridFilter | null = null;

  function onState(state: StoreState): void {
    if (stopped) return;
    if (phase === 'waiting-backend') {
      if (!state.connections?.hasReceivedList) return;
      backendId = getActiveBackendId(state);
      const restored = readPersistedHudGridFilter(backendId);
      phase = 'hydrating';
      queueMicrotask(() => {
        if (stopped) return;
        phase = 'ready';
        lastSeen = restored;
        appStore.dispatch(hudGridFilterHydrated(restored));
      });
      return;
    }
    if (phase !== 'ready' || !state.hud?.active) return;
    const filter = state.hud.gridFilter;
    if (filter === lastSeen) return;
    lastSeen = filter;
    // Defensive: a HUD window is bound to one backend for its lifetime, so
    // the window's backend id should never change within one start — but if
    // that invariant ever breaks (e.g. a web build), skip the write rather
    // than land it under the stale backend's key.
    if (getActiveBackendId(state) !== backendId) return;
    persistHudGridFilter(backendId, filter);
  }

  onState(appStore.state);
  const unsubscribe = appStore.getReadableState().subscribe(onState);
  return () => {
    stopped = true;
    unsubscribe();
  };
}
