/**
 * HUD grid-filter persistence — restores the header FLEET OPS repo + status
 * filter per backend id. The HUD saga owns hydration and writes; this module
 * retains only the storage key and persisted-value narrowing. Unknown
 * status keys are dropped and malformed payloads fall back to
 * `EMPTY_HUD_GRID_FILTER`.
 */
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
