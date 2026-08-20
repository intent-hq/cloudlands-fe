/**
 * Backend-keyed localStorage JSON helpers.
 *
 * Thin wrappers over `safeLocalStorage` that scope a base key by backend id
 * via `namespaceBackendKey` (local sidecar keeps the bare key, remotes get a
 * `backend:<id>:` prefix). For renderer features that persist small per-backend
 * preferences (e.g. the HUD grid filter) outside the saga layer — Redux stays
 * the source of truth; these only read/write the thin persistence layer.
 */
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { namespaceBackendKey } from './backend-storage-namespace';

/** Parsed JSON under the backend-scoped key; undefined when absent/malformed. */
export function readBackendScopedJSON<T>(baseKey: string, backendId: string): T | undefined {
  return safeLocalStorage.getJSON<T>(namespaceBackendKey(baseKey, backendId));
}

/** Serialize `value` under the backend-scoped key (best-effort, never throws). */
export function writeBackendScopedJSON(baseKey: string, backendId: string, value: unknown): void {
  safeLocalStorage.setJSON(namespaceBackendKey(baseKey, backendId), value);
}
