/**
 * Resolve the backend connection that owns a workspace, keyed off the windows
 * currently hosting it (monorepo#3501).
 *
 * Electron `protocol.handle` requests do not expose the initiating
 * webContents. When the requesting window is known — a `webRequest` redirect
 * stamped its backend id onto the URL (`?backend=`, see
 * `setupWorkspaceMediaBackendHinting`) — that hint is authoritative: the
 * hinted backend's pooled client serves the request, and a disconnected
 * hinted backend fails closed rather than falling through to another daemon
 * (the primary compatibility client is allowed only where the wiring says it
 * coincides with the hinted backend, i.e. the implicit local one).
 *
 * Without a hint (legacy URL), the handlers resolve the owning backend from
 * the main-side window-tracking maps: any window hosting the workspace
 * (actively routed or in its tab bar) is bound to the backend the workspace
 * lives on.
 *
 * Fallback semantics (unhinted):
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
 *   Map-iteration-order arbitrary. This is exactly the workspace-id-collision
 *   case the hint exists for, so it is reported via `onAmbiguousHosting`
 *   instead of being picked silently.
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
  /**
   * Called when an unhinted resolution finds the workspace hosted by windows
   * bound to more than one backend, so the caller can log the ambiguity.
   */
  onAmbiguousHosting?(workspaceId: string, hostingBackendIds: string[]): void;
}

export interface WorkspaceBackendResolveOptions {
  /** Backend id of the requesting window (from the URL hint), or null when unhinted. */
  backendIdHint?: string | null;
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
 * Pick the backend client that owns `workspaceId`. With a `backendIdHint`
 * the hinted backend is the only candidate (live client, else the primary
 * fallback only where allowed, else fail closed). Without one, the first
 * hosting window whose backend has a live pooled client wins; see the module
 * doc for the fallback/fail-closed semantics when none does.
 */
export function resolveWorkspaceBackendClient<C>(
  workspaceId: string,
  lookup: WorkspaceBackendLookup<C>,
  { backendIdHint = null }: WorkspaceBackendResolveOptions = {},
): WorkspaceBackendResolution<C> {
  if (backendIdHint !== null) {
    const client = lookup.getClientForBackend(backendIdHint);
    if (client) return { client, backendId: backendIdHint, fallback: null };
    if (lookup.isPrimaryFallbackAllowed(backendIdHint)) {
      return {
        client: lookup.getPrimaryClient(),
        backendId: null,
        fallback: 'unpooled-backend',
        attemptedBackendIds: [backendIdHint],
      };
    }
    return {
      client: null,
      backendId: backendIdHint,
      fallback: 'backend-disconnected',
      attemptedBackendIds: [backendIdHint],
    };
  }

  const attempted: string[] = [];
  for (const windowId of lookup.getWindowIdsForWorkspace(workspaceId)) {
    const backendId = lookup.getBackendIdForWindowId(windowId);
    if (backendId && !attempted.includes(backendId)) attempted.push(backendId);
  }
  if (attempted.length > 1) lookup.onAmbiguousHosting?.(workspaceId, [...attempted]);
  for (const backendId of attempted) {
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
 * (monorepo#3501). Steady-state resolutions (hosting window known, a
 * stamped-but-disconnected backend, or any hinted resolution) return
 * immediately.
 */
export async function resolveWorkspaceBackendClientWithRetry<C>(
  workspaceId: string,
  lookup: WorkspaceBackendLookup<C>,
  { attempts, delayMs, sleep }: WorkspaceBackendRetryOptions,
  resolveOptions: WorkspaceBackendResolveOptions = {},
): Promise<WorkspaceBackendResolution<C>> {
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let resolution = resolveWorkspaceBackendClient(workspaceId, lookup, resolveOptions);
  for (
    let attempt = 1;
    attempt < attempts && resolution.fallback === 'no-hosting-window';
    attempt++
  ) {
    await wait(delayMs);
    resolution = resolveWorkspaceBackendClient(workspaceId, lookup, resolveOptions);
  }
  return resolution;
}

export interface WorkspaceOwnershipLookup<C> {
  /** Snapshot of every live pooled backend id (the local backend included). */
  getLiveBackendIds(): string[];
  /** Live pooled client for a backend id, if one is connected. */
  getClientForBackend(backendId: string): C | undefined;
  /**
   * Cheap positive ownership check against one backend (e.g. `workspace.get`).
   * A rejection is treated as "not the owner".
   */
  confirmOwnership(client: C, workspaceId: string): Promise<boolean>;
  /**
   * Called when more than one live backend confirms ownership of the same
   * workspace id (a cross-daemon collision) so the caller can log/diagnose;
   * the probe itself fails closed and resolves no owner.
   */
  onAmbiguousOwnership?(workspaceId: string, confirmingBackendIds: string[]): void;
}

export interface WorkspaceOwnershipProber<C> {
  /**
   * Find the live backend that owns `workspaceId` by positive confirmation.
   * Serves from the workspaceId → backendId cache while the cached backend
   * still has a live client (a disconnected backend self-invalidates its
   * entries); otherwise probes every live backend concurrently. Exactly one
   * confirmation names the owner (cached and returned); multiple
   * confirmations — a workspace-id collision across daemons — are ambiguous
   * and fail closed: `onAmbiguousOwnership` is notified and null is returned
   * so no bytes are ever served from an unconfirmed-unique owner. Returns
   * null when no live backend confirms ownership; null results (no owner or
   * ambiguous) are never cached.
   */
  probeOwner(workspaceId: string): Promise<{ client: C; backendId: string } | null>;
  /** Drop the cached owner so the next probe re-confirms from scratch. */
  invalidate(workspaceId: string): void;
}

/**
 * Ownership-probing fallback for the workspace protocol handlers (v2.123.1
 * remote-backend broken-images regression): when the window-map resolution
 * cannot name a live owning backend — or the backend it named refuses the
 * read — the owner is found by positively confirming ownership against every
 * live pooled backend instead of blindly trusting the local fallback.
 * Concurrent probes for the same workspace coalesce into one in-flight
 * fan-out (single-flight), so a burst of image requests costs one probe.
 */
export function createWorkspaceOwnershipProber<C>(
  lookup: WorkspaceOwnershipLookup<C>,
): WorkspaceOwnershipProber<C> {
  const owners = new Map<string, string>();
  const inflight = new Map<string, Promise<{ client: C; backendId: string } | null>>();

  async function probeAllBackends(
    workspaceId: string,
  ): Promise<{ client: C; backendId: string } | null> {
    const candidates = lookup
      .getLiveBackendIds()
      .map((backendId) => ({ backendId, client: lookup.getClientForBackend(backendId) }))
      .filter((entry): entry is { backendId: string; client: C } => entry.client !== undefined);
    const confirmations = await Promise.all(
      candidates.map(({ client }) =>
        lookup.confirmOwnership(client, workspaceId).catch(() => false),
      ),
    );
    const confirming = candidates.filter((_, index) => confirmations[index]);
    if (confirming.length === 0) return null;
    if (confirming.length > 1) {
      // Ambiguous ownership (workspace-id collision across daemons): fail
      // closed rather than serving bytes from an arbitrary backend.
      lookup.onAmbiguousOwnership?.(
        workspaceId,
        confirming.map(({ backendId }) => backendId),
      );
      return null;
    }
    const owner = confirming[0];
    owners.set(workspaceId, owner.backendId);
    return owner;
  }

  return {
    probeOwner(workspaceId) {
      const cachedBackendId = owners.get(workspaceId);
      if (cachedBackendId !== undefined) {
        const client = lookup.getClientForBackend(cachedBackendId);
        if (client) return Promise.resolve({ client, backendId: cachedBackendId });
        owners.delete(workspaceId);
      }
      const pending = inflight.get(workspaceId);
      if (pending) return pending;
      const probe = probeAllBackends(workspaceId).finally(() => inflight.delete(workspaceId));
      inflight.set(workspaceId, probe);
      return probe;
    },
    invalidate(workspaceId) {
      owners.delete(workspaceId);
    },
  };
}
