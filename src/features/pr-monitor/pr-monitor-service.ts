/**
 * PR-monitor read/cancel/flush surface (PROTOCOL §5.42, §6.9).
 *
 * Monitors are agent-owned (`ws.pr.monitor` is MCP-only); the FE reads via
 * `prMonitor.list`, cancels via `prMonitor.cancel`, flushes the pending
 * debounced changes via `prMonitor.flush`, and stays live by folding the
 * `prMonitor:*` event family into the list. Like `hook:*`, the family is not
 * part of the bridge firehose's bare-category expansion, so this module owns
 * its own `events.subscribe` with a `prMonitor:*` prefix filter, scoped to
 * one workspace.
 */
import { capturePrMonitorSession, onMonitorReconnected } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PrMonitorService');

export type { PrMonitorRow, PrMonitorSnapshot, PrMonitorEventData } from '$shared/types/pr-monitor';
import type {
  ReviewMonitorRow,
  PrMonitorEventData,
  PrMonitorOrigin,
  PrMonitorSession,
  ReviewMonitoringSupport,
} from '$shared/types/pr-monitor';
import { MonitorAvailabilitySchema, MonitorResourceSchema } from '$shared/types/pr-monitor';
import { reviewTargetKey } from '$shared/types/repository-context';

export interface PrMonitorFoldResult {
  monitors: ReviewMonitorRow[];
  /** The event referenced an unknown monitor, or carried a change the list
   * cannot reconstruct (`lastSnapshot` never rides events) — re-run
   * `prMonitor.list` to converge. */
  needsRefetch: boolean;
}

/**
 * Pure fold of one `prMonitor:*` event into the current monitor list.
 * Events carry identity + state but never the snapshot/title fields, so
 * snapshot-bearing transitions request a refetch to converge.
 */
export function foldPrMonitorEvent(
  monitors: ReviewMonitorRow[],
  eventType: string,
  data: PrMonitorEventData,
): PrMonitorFoldResult {
  if (data.resource !== undefined) {
    const resource = MonitorResourceSchema.safeParse(data.resource);
    if (
      !resource.success ||
      (data.prNumber !== undefined && resource.data.number !== data.prNumber) ||
      (data.repo !== undefined && resource.data.repository.projectPath !== data.repo)
    )
      return { monitors, needsRefetch: false };
  }
  if (data.monitorAvailability)
    data = {
      ...data,
      monitorAvailability: MonitorAvailabilitySchema.parse(data.monitorAvailability),
    };
  const monitorId = data.monitorId;
  if (!monitorId) return { monitors, needsRefetch: false };

  const matches = (row: ReviewMonitorRow) =>
    row.monitorId === monitorId &&
    (!data.workspaceId || row.workspaceId === data.workspaceId) &&
    (!data.resource ||
      !row.resource ||
      reviewTargetKey(row.resource) === reviewTargetKey(data.resource));
  const existing = monitors.find(matches);
  if (!existing && monitors.some((row) => row.monitorId === monitorId))
    return { monitors, needsRefetch: false };
  if (existing && (data.resource || data.monitorAvailability)) {
    monitors = monitors.map((row) =>
      matches(row)
        ? {
            ...row,
            ...(data.resource ? { resource: data.resource } : {}),
            ...(data.monitorAvailability ? { monitorAvailability: data.monitorAvailability } : {}),
          }
        : row,
    );
  }
  if (eventType === 'prMonitor:cancelled') {
    const next = monitors.filter((m) => !matches(m));
    return { monitors: next, needsRefetch: false };
  }

  if (!existing) return { monitors, needsRefetch: true };

  switch (eventType) {
    case 'prMonitor:registered':
      return {
        monitors: monitors.map((m) =>
          matches(m)
            ? { ...m, state: 'active' as const, ...(data.agentId ? { agentId: data.agentId } : {}) }
            : m,
        ),
        needsRefetch: !!data.agentId && existing.agentId !== data.agentId,
      };
    case 'prMonitor:changed':
      // `changes` is the full accumulated pending list; the refreshed
      // lastSnapshot only arrives via prMonitor.list.
      return {
        monitors: monitors.map((m) =>
          matches(m)
            ? {
                ...m,
                pendingChanges: data.changes ?? m.pendingChanges,
                hasPendingChanges: (data.changes ?? m.pendingChanges).length > 0,
              }
            : m,
        ),
        needsRefetch: true,
      };
    case 'prMonitor:emitted':
      return {
        monitors: monitors.map((m) =>
          matches(m) ? { ...m, pendingChanges: [], hasPendingChanges: false } : m,
        ),
        needsRefetch: false,
      };
    case 'prMonitor:refreshed':
      // UI-only re-read hint: only the informational merge-queue entry
      // (position / estimate) moved. Nothing to fold; re-list for the
      // fresh lastSnapshot.
      return { monitors, needsRefetch: true };
    case 'prMonitor:completed':
      // Terminal PR lifecycle (merged/closed): the row stays listed but the
      // final snapshot only arrives via prMonitor.list.
      return {
        monitors: monitors.map((m) =>
          matches(m)
            ? { ...m, state: 'completed' as const, pendingChanges: [], hasPendingChanges: false }
            : m,
        ),
        needsRefetch: true,
      };
    default:
      return { monitors, needsRefetch: false };
  }
}

/** Routing leases only; monitor data remains in the shared Redux slice. */
const sessions = new Map<string, PrMonitorSession>();
function originalSession(workspaceId: string, origin?: PrMonitorOrigin): PrMonitorSession {
  const candidates = [...sessions.values()].filter(
    (session) =>
      session.origin.workspaceId === workspaceId &&
      (!origin ||
        (session.origin.sessionId === origin.sessionId &&
          session.origin.backendId === origin.backendId &&
          origin.workspaceId === workspaceId)),
  );
  if (candidates.length !== 1) throw new Error('Monitor connection unavailable');
  return candidates[0];
}

export async function listPrMonitors(
  workspaceId: string,
  session?: PrMonitorSession,
): Promise<ReviewMonitorRow[]> {
  const captured = session ?? (await capturePrMonitorSession(workspaceId));
  try {
    const result = await captured.request<{ monitors?: ReviewMonitorRow[] }>('prMonitor.list', {
      workspaceId,
    });
    return Array.isArray(result?.monitors)
      ? result.monitors
          .filter((row) => row.workspaceId === workspaceId)
          .map((row) => {
            if (row.resource !== undefined) {
              const resource = MonitorResourceSchema.parse(row.resource);
              if (resource.number !== row.prNumber || resource.repository.projectPath !== row.repo)
                throw new Error('Monitor identity mismatch');
            }
            return {
              ...row,
              ...(row.monitorAvailability
                ? { monitorAvailability: MonitorAvailabilitySchema.parse(row.monitorAvailability) }
                : {}),
              origin: captured.origin,
            };
          })
      : [];
  } finally {
    if (!session) await captured.release();
  }
}

export async function cancelPrMonitor(
  workspaceId: string,
  monitorId: string,
  origin?: PrMonitorOrigin,
): Promise<void> {
  await originalSession(workspaceId, origin).request('prMonitor.cancel', {
    workspaceId,
    monitorId,
  });
}
export async function flushPrMonitor(
  workspaceId: string,
  monitorId: string,
  check?: boolean,
  origin?: PrMonitorOrigin,
): Promise<void> {
  await originalSession(workspaceId, origin).request('prMonitor.flush', {
    workspaceId,
    monitorId,
    ...(check !== undefined ? { check } : {}),
  });
}

interface PrMonitorEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: PrMonitorEventData };
}
export interface PrMonitorsSubscription {
  refetch: () => void;
  dispose: () => void;
}
export type PrMonitorServiceStatus = 'failed' | 'reconnecting';

/** Consecutive failed capture/list attempts before the load error surfaces. */
export const PR_MONITOR_FAILURE_REPORT_THRESHOLD = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;

/** Same seed/fold/refetch flow, scoped to one captured document/socket lifetime. */
export function subscribePrMonitors(
  workspaceId: string,
  handler: (monitors: ReviewMonitorRow[]) => void,
  statusHandler?: (status: PrMonitorServiceStatus) => void,
  supportHandler?: (support: ReviewMonitoringSupport) => void,
): PrMonitorsSubscription {
  let disposed = false;
  let epoch = 0;
  let active: { refetch(): void; dispose(): void } | undefined;
  // A capture refused mid-reconnect or a timed-out list is usually transient:
  // retry with capped exponential backoff (a failed capture re-captures; a
  // failed list re-lists on the same live session) and report `failed` once,
  // when a run of attempts has failed. Retries continue after that, so the
  // first success clears the error without waiting for another event.
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };
  const recordFailure = (retry: () => void) => {
    failures++;
    if (failures === PR_MONITOR_FAILURE_REPORT_THRESHOLD) statusHandler?.('failed');
    cancelRetry();
    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (failures - 1), RETRY_MAX_DELAY_MS);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!disposed) retry();
    }, delay);
  };
  const register = async () => {
    const registration = ++epoch;
    cancelRetry();
    active?.dispose();
    active = undefined;
    let session: PrMonitorSession;
    try {
      session = await capturePrMonitorSession(workspaceId);
    } catch (error) {
      if (!disposed && registration === epoch) {
        logger.warn('Monitor capture failed', { workspaceId, error });
        recordFailure(() => void register());
      }
      return;
    }
    if (disposed || registration !== epoch) {
      void session.release();
      return;
    }
    let stopped = false;
    let subscriptionId: string | undefined;
    let monitors: ReviewMonitorRow[] = [];
    let inFlight = false;
    let queued = false;
    let revision = 0;
    const locallyCancelled = new Set<string>();
    const current = () => !disposed && !stopped && registration === epoch;
    const emit = () => {
      if (current()) handler(monitors);
    };
    const refetch = () => {
      if (!current()) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      const seedRevision = revision;
      void listPrMonitors(workspaceId, session)
        .then((fetched) => {
          if (!current()) return;
          // Any intervening event makes this seed stale, even if its response is later.
          if (seedRevision !== revision) {
            queued = true;
            return;
          }
          for (const id of locallyCancelled)
            if (!fetched.some((row) => row.monitorId === id)) locallyCancelled.delete(id);
          monitors = fetched.filter((row) => !locallyCancelled.has(row.monitorId));
          failures = 0;
          cancelRetry();
          emit();
        })
        .catch((error) => {
          if (!current()) return;
          logger.warn('prMonitor.list failed', { workspaceId, error });
          // Emit nothing: an empty emission would mark the snapshot ready and
          // drop retained rows while the retry is still pending. Keep the
          // session (and its event stream) for row actions; a retired one
          // re-registers through its own retirement/reconnect path.
          recordFailure(() => (current() ? refetch() : void register()));
        })
        .finally(() => {
          inFlight = false;
          if (queued && current()) {
            queued = false;
            refetch();
          }
        });
    };
    sessions.set(session.origin.sessionId, session);
    const offNotification = session.onNotification((n) => {
      if (!current() || n.method !== 'events.event') return;
      const params = n.params as PrMonitorEventNotification | undefined;
      const event = params?.event;
      if (
        !event?.type?.startsWith('prMonitor:') ||
        event.workspaceId !== workspaceId ||
        (event.data?.workspaceId && event.data.workspaceId !== workspaceId)
      )
        return;
      // Pre-ack gaps converge through the unconditional post-ack seed.
      if (!subscriptionId || params?.subscriptionId !== subscriptionId) return;
      revision++;
      const result = foldPrMonitorEvent(monitors, event.type, event.data ?? {});
      const folded = result.monitors !== monitors;
      monitors = result.monitors;
      if (folded && event.type === 'prMonitor:cancelled' && event.data?.monitorId)
        locallyCancelled.add(event.data.monitorId);
      emit();
      if (result.needsRefetch || inFlight) refetch();
    });
    let offRetired = () => {};
    const disposeSession = () => {
      if (stopped) return;
      stopped = true;
      sessions.delete(session.origin.sessionId);
      offNotification();
      offRetired();
      void session.release();
    };
    active = { refetch, dispose: disposeSession };
    offRetired = session.onRetired(() => {
      if (!current()) return;
      disposeSession();
      handler([]);
      statusHandler?.('reconnecting');
    });
    if (!current()) return;
    supportHandler?.(session.support);
    refetch();
    void session
      .request<{ subscriptionId?: string }>('events.subscribe', {
        eventTypes: ['prMonitor:*'],
        workspaceId,
      })
      .then((result) => {
        if (!current()) return;
        subscriptionId = result?.subscriptionId;
        refetch();
      })
      .catch((error) => {
        if (current()) logger.warn('Monitor subscription failed', { workspaceId, error });
      });
  };
  const offReconnected = onMonitorReconnected(() => {
    if (disposed) return;
    failures = 0;
    handler([]);
    statusHandler?.('reconnecting');
    void register();
  });
  void register();
  return {
    refetch: () => active?.refetch(),
    dispose: () => {
      disposed = true;
      ++epoch;
      cancelRetry();
      offReconnected();
      active?.dispose();
    },
  };
}
