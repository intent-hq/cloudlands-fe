/**
 * Background-hooks read/trigger/cancel surface (PROTOCOL §5.40, v2.10).
 *
 * Hooks are agent-authored (scheduling is MCP-only); the FE reads via
 * `hook.list`, triggers via `hook.runNow`, cancels via `hook.cancel`, and
 * stays live by folding the `hook:*` event family (§6.5) into the list.
 * The `hook:*` family is not part of the bridge firehose's bare-category
 * expansion, so this module owns its own `events.subscribe` with a
 * `hook:*` prefix filter, scoped to one workspace.
 */
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('BackgroundHooksService');

/** Wire `Hook` shape (PROTOCOL §5.40). `code` and `lastLogs` arrive on
 * `hook.list` only — `hook:*` event payloads never carry them, so the folds
 * below must spread the existing hook to retain them (the chip hover card
 * renders a code preview; staleness is resolved by an on-demand refetch). */
export interface BackgroundHook {
  hookId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  code?: string;
  delayMs: number;
  state: 'scheduled' | 'running' | 'dispatched' | 'evicted' | 'cancelled';
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  lastError?: string;
  lastLogs?: string;
}

/** `hook:*` event payload (§6.5): base fields plus per-type extras. */
export interface HookEventData {
  workspaceId?: string;
  agentId?: string;
  hookId?: string;
  name?: string;
  state?: string;
  nextRunAt?: string;
  lastError?: string;
}

/** Event types that end a hook's life — their chips drop from the row. */
const TERMINAL_HOOK_EVENTS = new Set(['hook:dispatched', 'hook:evicted', 'hook:cancelled']);

export interface FoldResult {
  hooks: BackgroundHook[];
  /**
   * The event referenced a hook this list has never seen (e.g. scheduled
   * after mount but before the subscription ack) — the fold cannot invent
   * the missing wire fields (`delayMs`, `createdAt`), so the caller should
   * re-run `hook.list` to converge.
   */
  needsRefetch: boolean;
}

/**
 * Pure fold of one `hook:*` event into the current hook list. Returns the
 * (possibly unchanged) next list plus whether a refetch is needed.
 */
export function foldHookEvent(
  hooks: BackgroundHook[],
  eventType: string,
  data: HookEventData,
): FoldResult {
  const hookId = data.hookId;
  if (!hookId) return { hooks, needsRefetch: false };

  if (TERMINAL_HOOK_EVENTS.has(eventType)) {
    const next = hooks.filter((h) => h.hookId !== hookId);
    return { hooks: next, needsRefetch: false };
  }

  const existing = hooks.find((h) => h.hookId === hookId);
  switch (eventType) {
    case 'hook:scheduled': {
      if (!existing) return { hooks, needsRefetch: true };
      return {
        hooks: hooks.map((h) =>
          h.hookId === hookId
            ? { ...h, state: 'scheduled' as const, nextRunAt: data.nextRunAt ?? h.nextRunAt }
            : h,
        ),
        needsRefetch: false,
      };
    }
    case 'hook:run-started': {
      if (!existing) return { hooks, needsRefetch: true };
      return {
        hooks: hooks.map((h) => (h.hookId === hookId ? { ...h, state: 'running' as const } : h)),
        needsRefetch: false,
      };
    }
    case 'hook:run-completed': {
      if (!existing) return { hooks, needsRefetch: true };
      // `nextRunAt` present ⇒ the hook stays scheduled; absent ⇒ a terminal
      // dispatched/evicted event follows and will drop the chip (§6.5).
      return {
        hooks: hooks.map((h) =>
          h.hookId === hookId
            ? { ...h, state: 'scheduled' as const, nextRunAt: data.nextRunAt }
            : h,
        ),
        needsRefetch: false,
      };
    }
    default:
      return { hooks, needsRefetch: false };
  }
}

/** `hook.list` (§5.40) — every hook in the workspace, all states. */
export async function listHooks(workspaceId: string): Promise<BackgroundHook[]> {
  const result = await backendRequest<{ hooks?: BackgroundHook[] }>('hook.list', { workspaceId });
  return Array.isArray(result?.hooks) ? result.hooks : [];
}

/** `hook.runNow` (§5.40) — ack only; the run's outcome arrives as `hook:*` events. */
export async function runHookNow(workspaceId: string, hookId: string): Promise<void> {
  await backendRequest('hook.runNow', { workspaceId, hookId });
}

/** `hook.cancel` (§5.40) — the `hook:cancelled` event drops the chip. */
export async function cancelHook(workspaceId: string, hookId: string): Promise<void> {
  await backendRequest('hook.cancel', { workspaceId, hookId });
}

/** `events.event` envelope subset this module consumes (§6.3). */
interface HookEventNotification {
  subscriptionId?: string;
  event?: { type?: string; workspaceId?: string; data?: HookEventData };
}

/** Handle returned by {@link subscribeBackgroundHooks}. */
export interface BackgroundHooksSubscription {
  /** On-demand `hook.list` re-seed — e.g. to refresh `lastLogs`, which
   * `hook:*` events never carry (§5.40). */
  refetch: () => void;
  /** Tear down the subscription and notification listeners. */
  dispose: () => void;
}

/**
 * Live hook list for one workspace: registers a `hook:*` `events.subscribe`,
 * seeds via `hook.list`, folds subsequent events, and re-seeds after a
 * backend reconnect (RESUB-1). The handler receives the full list on every
 * change (all states — callers filter to the active ones). Returns a handle
 * exposing an on-demand `refetch` plus the disposer.
 */
export function subscribeBackgroundHooks(
  workspaceId: string,
  handler: (hooks: BackgroundHook[]) => void,
): BackgroundHooksSubscription {
  let disposed = false;
  let subscriptionId: string | undefined;
  let hooks: BackgroundHook[] = [];
  let refetchInFlight = false;
  let refetchQueued = false;
  // Guards against a late-resolving subscribe from a previous registration
  // (e.g. rapid reconnect flaps) overwriting the current subscriptionId.
  let registerEpoch = 0;

  const emit = () => {
    if (!disposed) handler(hooks);
  };

  const refetch = () => {
    if (disposed) return;
    if (refetchInFlight) {
      refetchQueued = true;
      return;
    }
    refetchInFlight = true;
    listHooks(workspaceId)
      .then((fetched) => {
        if (disposed) return;
        hooks = fetched;
        emit();
      })
      .catch((error) => {
        logger.warn('hook.list failed', { workspaceId, error });
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
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ['hook:*'], workspaceId })
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
        logger.warn('events.subscribe (hook:*) failed', { workspaceId, error });
        // Without a subscription still serve the one-shot snapshot.
        if (!disposed && epoch === registerEpoch) refetch();
      });
  };

  const offNotification = onBackendNotification((n) => {
    if (disposed || n.method !== 'events.event') return;
    const params = n.params as HookEventNotification | undefined;
    const event = params?.event;
    if (!event?.type?.startsWith('hook:')) return;
    if (event.workspaceId !== workspaceId) return;
    // Match on our subscription id once known; before the ack lands, accept
    // any hook event for this workspace (the folds are idempotent).
    if (subscriptionId && params?.subscriptionId && params.subscriptionId !== subscriptionId) {
      return;
    }
    const result = foldHookEvent(hooks, event.type, event.data ?? {});
    hooks = result.hooks;
    emit();
    if (result.needsRefetch) refetch();
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
