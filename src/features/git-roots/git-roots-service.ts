/**
 * Workspace git-root read surface (multi git root tracking,
 * intent-hq/monorepo#2053).
 *
 * Roots are registered by agents (`ws.git.registerRoot`) or auto-detected by
 * the daemon; the FE reads via `gitRoot.list` and stays live by folding the
 * `gitRoot:*` event family into the list. Like `prMonitor:*`, the family is
 * not part of the bridge firehose's bare-category expansion, so this module
 * owns its own `events.subscribe` with a `gitRoot:*` prefix filter, scoped to
 * one workspace.
 */
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { PullRequestInfo, PullRequestStatus } from '$shared/types';

const logger = createLogger('GitRootsService');

/** How a git root came to be tracked (wire words are lowercase). */
export type GitRootSource = 'agent' | 'auto';

/** Wire `gitRoot.list` row: the persisted `WorkspaceGitRoot` plus a live-read
 * `branch` (never persisted; absent when HEAD is unreadable). Optional fields
 * are skipped on the wire when empty/absent. */
export interface GitRootRow {
  id: string;
  workspaceId: string;
  /** Canonicalized absolute path of the git repository root. */
  path: string;
  source: GitRootSource;
  /** Live-read current branch; absent on `gitRoot:registered`/`updated`
   * events (only `gitRoot.list` grafts it on). */
  branch?: string;
  repoOwner?: string;
  repoName?: string;
  /** Agents that registered this root, in registration order (deduped). */
  registeredByAgentIds?: string[];
  /** The root's HEAD SHA when first captured — at registration going
   * forward, or at the sweep's best-effort backfill for rows predating the
   * field (backfill-time HEAD, not registration-time provenance). Immutable
   * once set; omitted while still unknown. */
  registeredCommitSha?: string;
  prNumber?: number;
  prUrl?: string;
  prStatus?: PullRequestStatus;
  pullRequests?: PullRequestInfo[];
  createdAt: string;
  updatedAt: string;
}

/** `gitRoot:*` event payload (§6.5): `registered`/`updated` carry the full
 * row as `gitRoot`; `unregistered` carries `gitRootId` + `path`. */
export interface GitRootEventData {
  workspaceId?: string;
  gitRoot?: GitRootRow;
  gitRootId?: string;
  path?: string;
}

export interface GitRootFoldResult {
  gitRoots: GitRootRow[];
  /** The folded row has no `branch` (events never carry it) and none was
   * known locally — re-run `gitRoot.list` to converge the branch display. */
  needsRefetch: boolean;
}

/**
 * Pure fold of one `gitRoot:*` event into the current root list.
 * `registered`/`updated` payloads are self-sufficient except for the
 * live-read `branch`, which is preserved from the known row when the event
 * omits it; a row with no branch from either side requests a refetch.
 */
export function foldGitRootEvent(
  gitRoots: GitRootRow[],
  eventType: string,
  data: GitRootEventData,
): GitRootFoldResult {
  if (eventType === 'gitRoot:unregistered') {
    if (!data.gitRootId) return { gitRoots, needsRefetch: false };
    const next = gitRoots.filter((r) => r.id !== data.gitRootId);
    return { gitRoots: next, needsRefetch: false };
  }

  if (eventType === 'gitRoot:registered' || eventType === 'gitRoot:updated') {
    const incoming = data.gitRoot;
    if (!incoming?.id) return { gitRoots, needsRefetch: false };
    const existing = gitRoots.find((r) => r.id === incoming.id);
    const merged: GitRootRow =
      incoming.branch === undefined && existing?.branch !== undefined
        ? { ...incoming, branch: existing.branch }
        : incoming;
    const next = existing
      ? gitRoots.map((r) => (r.id === incoming.id ? merged : r))
      : [...gitRoots, merged];
    return { gitRoots: next, needsRefetch: merged.branch === undefined };
  }

  return { gitRoots, needsRefetch: false };
}

/** `gitRoot.list` (monorepo#2053) — every registered root for a workspace
 * (agent-registered and auto-detected), each row carrying a live-read
 * `branch`. */
export async function listGitRoots(workspaceId: string): Promise<GitRootRow[]> {
  const result = await backendRequest<{ gitRoots?: GitRootRow[] }>('gitRoot.list', {
    workspaceId,
  });
  return Array.isArray(result?.gitRoots) ? result.gitRoots : [];
}

/** `events.event` envelope subset this module consumes (§6.3). */
interface GitRootEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: GitRootEventData };
}

/** Handle returned by {@link subscribeGitRoots}. */
export interface GitRootsSubscription {
  /** On-demand `gitRoot.list` re-seed — e.g. to refresh the live-read
   * `branch`, which `gitRoot:*` events never carry. */
  refetch: () => void;
  /** Tear down the subscription and notification listeners. */
  dispose: () => void;
}

/**
 * Live git-root list for one workspace: registers a `gitRoot:*`
 * `events.subscribe`, seeds via `gitRoot.list`, folds subsequent events,
 * and re-seeds after a backend reconnect (RESUB-1). The handler receives the
 * full list on every change. Returns a handle exposing an on-demand
 * `refetch` plus the disposer.
 */
export function subscribeGitRoots(
  workspaceId: string,
  handler: (gitRoots: GitRootRow[]) => void,
): GitRootsSubscription {
  let disposed = false;
  let subscriptionId: string | undefined;
  let gitRoots: GitRootRow[] = [];
  let refetchInFlight = false;
  let refetchQueued = false;
  // Roots removed by a fold: a `gitRoot.list` response that was already in
  // flight when the `gitRoot:unregistered` event arrived can still carry the
  // row, so list responses filter these until the server stops returning them.
  const locallyRemoved = new Set<string>();
  // Guards against a late-resolving subscribe from a previous registration
  // (e.g. rapid reconnect flaps) overwriting the current subscriptionId.
  let registerEpoch = 0;

  const emit = () => {
    if (!disposed) handler(gitRoots);
  };

  const refetch = () => {
    if (disposed) return;
    if (refetchInFlight) {
      refetchQueued = true;
      return;
    }
    refetchInFlight = true;
    listGitRoots(workspaceId)
      .then((fetched) => {
        if (disposed) return;
        // Prune ids the server no longer returns (converged), then drop rows
        // removed locally while this list was in flight.
        for (const id of [...locallyRemoved]) {
          if (!fetched.some((r) => r.id === id)) locallyRemoved.delete(id);
        }
        gitRoots = fetched.filter((r) => !locallyRemoved.has(r.id));
        emit();
      })
      .catch((error) => {
        logger.warn('gitRoot.list failed', { workspaceId, error });
      })
      .finally(() => {
        refetchInFlight = false;
        if (refetchQueued) {
          refetchQueued = false;
          refetch();
        }
      });
  };

  const register = () => {
    const epoch = ++registerEpoch;
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ['gitRoot:*'], workspaceId })
      .then((result) => {
        const acked = result?.subscriptionId;
        if (disposed || epoch !== registerEpoch) {
          // Stale registration (disposed or superseded by a reconnect) —
          // drop the ack and release its server-side subscription.
          if (acked) void backendUnsubscribe(acked);
          return;
        }
        subscriptionId = acked;
        // Seed AFTER the subscribe ack so no event falls between the
        // snapshot and the subscription window.
        refetch();
      })
      .catch((error) => {
        logger.warn('events.subscribe (gitRoot:*) failed', { workspaceId, error });
        // Without a subscription still serve the one-shot snapshot.
        if (!disposed && epoch === registerEpoch) refetch();
      });
  };

  const offNotification = onBackendNotification((n) => {
    if (disposed || n.method !== 'events.event') return;
    const params = n.params as GitRootEventNotification | undefined;
    const event = params?.event;
    if (!event?.type?.startsWith('gitRoot:')) return;
    if (event.workspaceId !== workspaceId) return;
    // Match on our subscription id once known; before the ack lands, accept
    // any gitRoot event for this workspace (the folds are idempotent).
    if (subscriptionId && params?.subscriptionId && params.subscriptionId !== subscriptionId) {
      return;
    }
    const result = foldGitRootEvent(gitRoots, event.type, event.data ?? {});
    gitRoots = result.gitRoots;
    if (event.type === 'gitRoot:unregistered' && event.data?.gitRootId) {
      locallyRemoved.add(event.data.gitRootId);
    }
    emit();
    // A fold landing while a list request is in flight would be clobbered by
    // that older response — queue a trailing refetch (single-flight,
    // coalesced) so the list converges.
    if (result.needsRefetch || refetchInFlight) refetch();
  });

  // Subscriptions are per-connection (§6.1) — replay after a reconnect and
  // re-seed so anything missed during the outage converges.
  const offReconnected = onBackendReconnected(() => {
    if (disposed) return;
    subscriptionId = undefined;
    register();
  });

  register();

  return {
    refetch,
    dispose: () => {
      disposed = true;
      offNotification();
      offReconnected();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    },
  };
}
