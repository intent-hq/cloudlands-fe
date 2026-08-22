/**
 * Per-workspace UI state paths under Electron userData.
 *
 * Pure-UI persistence (panel-layout undo/redo history, first-visit state)
 * lives under `<userData>/workspace-state/<backendKey>/<workspaceId>/` —
 * keyed by backend id + workspace id so two backends surfacing the SAME
 * workspace id never collide (preserves the cloudlands-fe#823 namespacing
 * intent; the former filename backend suffix collapsed into the directory
 * key). Intentionally independent of the daemon-owned workspace checkout —
 * no guessed workspace roots (intent-hq/monorepo#1760).
 */

import * as path from 'path';
import { app } from 'electron';
import { LOCAL_CONNECTION_ID } from '../types/connections';

/** Root folder name inside `app.getPath('userData')`. */
const WORKSPACE_STATE_FOLDER = 'workspace-state';

/**
 * Sanitize an id to a filesystem-safe token (host/port punctuation → `_`).
 * All-dot tokens (`.`, `..`) are rewritten to underscores so an id arriving
 * over IPC can never resolve to a path segment that escapes the state root.
 */
function sanitizeToken(id: string): string {
  const token = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return /^\.+$/.test(token) ? token.replace(/\./g, '_') : token;
}

/**
 * Directory key for a backend. The local sidecar (or an unspecified backend)
 * maps to the reserved `local` key; remote backend ids are sanitized so an id
 * carrying host/port punctuation never yields an invalid directory name.
 *
 * Invariants relied on (real backend ids are `LOCAL_CONNECTION_ID` or
 * `randomUUID()`, so both hold today): sanitization is not injective —
 * distinct ids differing only in punctuation collapse to the same key — and
 * a remote id that sanitizes to the literal `local` would share the reserved
 * local key.
 */
export function workspaceStateBackendKey(backendId?: string): string {
  if (!backendId || backendId.trim().length === 0) {
    return LOCAL_CONNECTION_ID;
  }
  return sanitizeToken(backendId);
}

/**
 * Per-workspace UI state directory:
 * `<userData>/workspace-state/<backendKey>/<workspaceId>`.
 */
export function workspaceStateDir(workspaceId: string, backendId?: string): string {
  return path.join(
    app.getPath('userData'),
    WORKSPACE_STATE_FOLDER,
    workspaceStateBackendKey(backendId),
    sanitizeToken(workspaceId),
  );
}
