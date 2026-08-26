/**
 * Resolve the backend connection that owns a workspace, keyed off the windows
 * currently hosting it (monorepo#3501).
 *
 * Electron `protocol.handle` requests do not expose the initiating
 * webContents, so the workspace-file:// and workspace-asset:// handlers cannot
 * ask "which window issued this fetch?". Instead they resolve the owning
 * backend from the main-side window-tracking maps: any window hosting the
 * workspace (actively routed or in its tab bar) is bound to the backend the
 * workspace lives on.
 *
 * Fallback semantics:
 * - No hosting window at all → the app-primary compatibility client
 *   (pre-per-window-connections #1572 behavior). This is also the only
 *   available guess for cross-workspace references — e.g. a note rendered in
 *   a sibling workspace's view emits workspace-asset:// URLs for a workspace
 *   not open in any window — a known limitation, not a resolution bug.
 * - A hosting window's stamped backend has no live pooled client → primary
 *   fallback only when that backend is fallback-eligible per
 *   `isPrimaryFallbackAllowed` (the wiring allows it for the implicit local
 *   backend, whose pooled client and the compatibility client coincide at
 *   startup). Otherwise the resolution fails closed (`client: null`) rather
 *   than silently retargeting another daemon — mirroring
 *   `getBackendClientForIpcEvent` in backend.ipc.ts, so a workspace-id
 *   collision across daemons yields a clean failure, not wrong-backend bytes.
 * - When the same workspace id is hosted by windows stamped to different
 *   backends, the first backend with a live pooled client wins; that order is
 *   Map-iteration-order arbitrary. Fine in practice — one workspace lives on
 *   one backend.
 *
 * Dependency-light by design: callers inject the lookups so this stays
 * unit-testable without Electron or the backend client pool.
 */

export interface WorkspaceBackendLookup<C> {
  /** Window ids currently hosting the workspace (active view or tab bar). */
  getWindowIdsForWorkspace(workspaceId: string): number[];
  /** Backend id a window is stamped with, or null for a dead window. */
  getBackendIdForWindowId(windowId: number): string | null;
  /** Live pooled client for a backend id, if one is connected. */
  getClientForBackend(backendId: string): C | undefined;
  /** The app-primary compatibility client (legacy fallback). */
  getPrimaryClient(): C;
  /**
   * Whether the primary fallback is allowed when this stamped backend has no
   * pooled client (true for the implicit local backend; named/remote backends
   * fail closed instead).
   */
  isPrimaryFallbackAllowed(backendId: string): boolean;
}

export type WorkspaceBackendResolution<C> =
  /** A hosting window's stamped backend has a live pooled client. */
  | { client: C; backendId: string; fallback: null }
  /** Primary fallback — no hosting window, or only unpooled fallback-eligible backends. */
  | {
      client: C;
      backendId: null;
      fallback: 'no-hosting-window' | 'unpooled-backend';
      attemptedBackendIds: string[];
    }
  /** Fail closed: hosting window(s) found, but every stamped backend is disconnected and not fallback-eligible. */
  | {
      client: null;
      backendId: string;
      fallback: 'backend-disconnected';
      attemptedBackendIds: string[];
    };

/**
 * Pick the backend client that owns `workspaceId`: the first hosting window
 * whose backend has a live pooled client wins; see the module doc for the
 * fallback/fail-closed semantics when none does.
 */
export function resolveWorkspaceBackendClient<C>(
  workspaceId: string,
  lookup: WorkspaceBackendLookup<C>,
): WorkspaceBackendResolution<C> {
  const attempted: string[] = [];
  for (const windowId of lookup.getWindowIdsForWorkspace(workspaceId)) {
    const backendId = lookup.getBackendIdForWindowId(windowId);
    if (!backendId || attempted.includes(backendId)) continue;
    attempted.push(backendId);
    const client = lookup.getClientForBackend(backendId);
    if (client) return { client, backendId, fallback: null };
  }
  if (attempted.length === 0) {
    return {
      client: lookup.getPrimaryClient(),
      backendId: null,
      fallback: 'no-hosting-window',
      attemptedBackendIds: attempted,
    };
  }
  if (attempted.some((id) => lookup.isPrimaryFallbackAllowed(id))) {
    return {
      client: lookup.getPrimaryClient(),
      backendId: null,
      fallback: 'unpooled-backend',
      attemptedBackendIds: attempted,
    };
  }
  return {
    client: null,
    backendId: attempted[0],
    fallback: 'backend-disconnected',
    attemptedBackendIds: attempted,
  };
}

export interface WorkspaceBackendRetryOptions {
  /** Total resolution attempts (>= 1). */
  attempts: number;
  /** Delay between attempts. */
  delayMs: number;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * `resolveWorkspaceBackendClient` with a short bounded retry while no hosting
 * window is known. The window→workspace maps are populated by un-awaited
 * renderer IPCs after navigation, so a cached image can issue its protocol
 * request before the main process has recorded the workspace; the browser
 * never retries a 404'd <img>, so a brief wait here absorbs that startup race
 * (monorepo#3501). Steady-state resolutions (hosting window known, or a
 * stamped-but-disconnected backend) return immediately.
 */
export async function resolveWorkspaceBackendClientWithRetry<C>(
  workspaceId: string,
  lookup: WorkspaceBackendLookup<C>,
  { attempts, delayMs, sleep }: WorkspaceBackendRetryOptions,
): Promise<WorkspaceBackendResolution<C>> {
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let resolution = resolveWorkspaceBackendClient(workspaceId, lookup);
  for (
    let attempt = 1;
    attempt < attempts && resolution.fallback === 'no-hosting-window';
    attempt++
  ) {
    await wait(delayMs);
    resolution = resolveWorkspaceBackendClient(workspaceId, lookup);
  }
  return resolution;
}
