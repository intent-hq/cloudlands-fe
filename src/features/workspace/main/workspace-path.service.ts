/**
 * Workspace Path Service (monorepo#1759)
 *
 * Main-process seam that resolves a workspace's checkout directory ONLY from
 * daemon-reported data (`Workspace.path` / `worktreePath` / `repositoryPath`
 * via `workspace.get`, PROTOCOL.md §5.1). Zero filesystem probing: the FE
 * never guesses a checkout location from `os.homedir()` or hardcoded roots.
 *
 * Returns `null` when no local checkout directory is known:
 *  - virtual workspaces (background-request, http-bridge-workspace, Chief)
 *  - a remote backend is active (the checkout lives on the remote host)
 *  - remote workspaces (`isRemote` / `environmentConfig.type === 'remote'`)
 *  - unknown workspaces (daemon has no row) or daemon errors
 *
 * Resolved paths are cached per workspace id and invalidated on
 * `workspace:updated` / `workspace:deleted` daemon events (own
 * `events.subscribe`, strict subscription-id match — same pattern as
 * app-settings.service.ts). The whole cache clears on backend reconnect,
 * since a reconnect may be a backend switch. Negative results are never
 * cached so a not-yet-created workspace resolves as soon as the daemon
 * knows it.
 */

import { Logger } from '../../../shared/logger';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
import {
  getBackendClient,
  isRemoteBackendActive,
  onBackendNotification,
  onBackendReconnected,
} from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';

const logger = new Logger('WorkspacePathService');

/** Workspace IDs that are not backed by a directory on any machine. */
const VIRTUAL_WORKSPACE_IDS = new Set<string>([
  'background-request',
  'http-bridge-workspace',
  CHIEF_WORKSPACE_ID,
]);

export interface WorkspacePathInfo {
  /** Absolute checkout directory as reported by the daemon. */
  path: string;
  /** Optional sub-directory scope within the checkout (Workspace.scope). */
  scope?: string;
}

const cache = new Map<string, WorkspacePathInfo>();
// Single-flight: concurrent lookups for the same workspace share one RPC.
const inFlight = new Map<string, Promise<WorkspacePathInfo | null>>();
// Invalidation generations: bumped per workspace on workspace:updated /
// workspace:deleted (and globally via cacheEpoch on reconnect) so a
// `workspace.get` response that raced an invalidation is never cached.
const invalidationGenerations = new Map<string, number>();
let cacheEpoch = 0;
let listenersAttached = false;
let subscriptionId: string | undefined;
// Epoch guard: bumped on reconnect so a pre-reconnect `events.subscribe`
// response resolving late can never overwrite the current connection's
// subscription id (it would silently break event invalidation).
let subscribeEpoch = 0;
let subscribeInFlight = false;

function handleBackendNotification(n: JsonRpcNotification): void {
  if (n.method !== 'events.event') return;
  const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
  const subId = typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
  // Strict match: the shared client also carries notifications for
  // renderer-proxied subscriptions; only our own subscription's events may
  // invalidate the cache.
  if (!subscriptionId || subId !== subscriptionId) return;
  const event = params?.event as { type?: unknown; data?: unknown } | undefined;
  if (!event || (event.type !== 'workspace:updated' && event.type !== 'workspace:deleted')) return;
  const workspaceId = (event.data as { workspaceId?: unknown } | undefined)?.workspaceId;
  if (typeof workspaceId === 'string') {
    cache.delete(workspaceId);
    invalidationGenerations.set(workspaceId, (invalidationGenerations.get(workspaceId) ?? 0) + 1);
  }
}

async function subscribeToWorkspaceEvents(): Promise<void> {
  if (subscriptionId !== undefined || subscribeInFlight) return;
  subscribeInFlight = true;
  const epoch = subscribeEpoch;
  try {
    const result = (await getBackendClient().request('events.subscribe', {
      eventTypes: ['workspace:updated', 'workspace:deleted'],
    })) as { subscriptionId?: string } | undefined;
    // A reconnect happened while this request was in flight: the result
    // belongs to the previous connection — drop it.
    if (epoch !== subscribeEpoch) return;
    subscriptionId = result?.subscriptionId;
    if (!subscriptionId) {
      logger.warn('events.subscribe for workspace events returned no subscriptionId');
    }
  } catch (error) {
    // Best-effort: retried on the next lookup (see getWorkspacePathInfo), and
    // the cache still self-heals on reconnect (full clear).
    logger.warn('events.subscribe for workspace events failed', {
      error: (error as Error).message,
    });
  } finally {
    if (epoch === subscribeEpoch) subscribeInFlight = false;
  }
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  onBackendNotification(handleBackendNotification);
  onBackendReconnected(() => {
    // The daemon dropped in-memory subscriptions and the backend may have
    // been switched — drop every cached path and re-subscribe. cacheEpoch
    // ensures in-flight workspace.get responses from the old connection are
    // not cached.
    cache.clear();
    cacheEpoch += 1;
    invalidationGenerations.clear();
    subscribeEpoch += 1;
    subscriptionId = undefined;
    subscribeInFlight = false;
    void subscribeToWorkspaceEvents();
  });
  void subscribeToWorkspaceEvents();
}

/**
 * Resolve a workspace's checkout directory plus optional scope from
 * daemon-reported data. `null` when no local checkout is known — callers
 * must handle that explicitly instead of fabricating a path.
 */
export async function getWorkspacePathInfo(workspaceId: string): Promise<WorkspacePathInfo | null> {
  if (!workspaceId || VIRTUAL_WORKSPACE_IDS.has(workspaceId)) return null;
  // Remote backend: workspace.get would answer with the REMOTE host's paths,
  // which do not exist on this machine.
  if (isRemoteBackendActive()) return null;

  attachListeners();
  // Retry a failed/absent subscription (no-op when live or in flight) so a
  // transient initial failure does not leave lookups cached without any
  // event-driven invalidation until the next reconnect.
  void subscribeToWorkspaceEvents();

  const cached = cache.get(workspaceId);
  if (cached !== undefined) return cached;

  // Single-flight: concurrent lookups for the same workspace share one RPC.
  const pending = inFlight.get(workspaceId);
  if (pending) return pending;

  const lookup = fetchWorkspacePathInfo(workspaceId).finally(() => {
    inFlight.delete(workspaceId);
  });
  inFlight.set(workspaceId, lookup);
  return lookup;
}

async function fetchWorkspacePathInfo(workspaceId: string): Promise<WorkspacePathInfo | null> {
  const epochAtStart = cacheEpoch;
  const generationAtStart = invalidationGenerations.get(workspaceId) ?? 0;
  try {
    const response = (await getBackendClient().request('workspace.get', { workspaceId })) as
      | { workspace?: unknown }
      | unknown;
    const raw =
      response && typeof response === 'object' && 'workspace' in response
        ? (response as { workspace?: unknown }).workspace
        : response;
    if (!raw || typeof raw !== 'object') return null;
    const ws = raw as {
      path?: unknown;
      worktreePath?: unknown;
      repositoryPath?: unknown;
      scope?: unknown;
      isRemote?: unknown;
      environmentConfig?: { type?: unknown } | null;
    };
    // Remote workspaces: their checkout only exists on the SSH host.
    if (ws.isRemote === true || ws.environmentConfig?.type === 'remote') return null;
    // Same precedence the FE already applies to daemon rows (terminal cwd,
    // workspace file search): worktree first, then repository, then `path`.
    const candidates = [ws.worktreePath, ws.repositoryPath, ws.path];
    const path = candidates.find(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
    if (!path) return null;
    const info: WorkspacePathInfo = {
      path,
      ...(typeof ws.scope === 'string' && ws.scope.length > 0 ? { scope: ws.scope } : {}),
    };
    // Do not cache a response that raced an invalidation or a reconnect: it
    // may predate the change that triggered the invalidation. Still return
    // it — the next lookup re-fetches.
    if (
      epochAtStart === cacheEpoch &&
      generationAtStart === (invalidationGenerations.get(workspaceId) ?? 0)
    ) {
      cache.set(workspaceId, info);
    }
    return info;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    // Missing-workspace surfaces as a JSON-RPC error; every failure folds to
    // `null` (unknown workspace), but only unexpected ones are worth a warn.
    if (!/not\s*found/i.test(message)) {
      logger.warn('workspace.get failed while resolving workspace path', {
        workspaceId,
        error: message,
      });
    }
    return null;
  }
}

/**
 * Resolve a workspace's checkout directory from daemon-reported data.
 * `null` for virtual/unknown workspaces and remote backends.
 */
export async function getWorkspacePath(workspaceId: string): Promise<string | null> {
  const info = await getWorkspacePathInfo(workspaceId);
  return info?.path ?? null;
}

/**
 * True when `getWorkspacePathInfo(workspaceId)` returns `null` deterministically
 * (virtual workspace or remote backend) — callers with retry loops for the
 * workspace-creation race can skip retrying these.
 */
export function isWorkspacePathDeterministicallyNull(workspaceId: string): boolean {
  return !workspaceId || VIRTUAL_WORKSPACE_IDS.has(workspaceId) || isRemoteBackendActive();
}

/** Test-only: reset module state (cache, listeners, subscription). */
export function __resetWorkspacePathServiceForTesting(): void {
  cache.clear();
  inFlight.clear();
  invalidationGenerations.clear();
  cacheEpoch = 0;
  listenersAttached = false;
  subscriptionId = undefined;
  subscribeEpoch = 0;
  subscribeInFlight = false;
}
