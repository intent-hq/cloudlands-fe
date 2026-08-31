/**
 * Background-hooks read/trigger/cancel surface (PROTOCOL §5.40, v2.10).
 *
 * Hooks are agent-authored (scheduling is MCP-only); the FE reads via
 * `hook.list`, triggers via `hook.runNow`, cancels via `hook.cancel`, and
 * stays live by folding the `hook:*` event family (§6.5) into the list.
 * The `hook:*` family is not part of the bridge firehose's bare-category
 * expansion, so the background-hooks saga owns a dedicated workspace-scoped
 * `events.subscribe` with a `hook:*` prefix filter.
 */
import { backendRequest } from '$lib/client/live/backend-transport';

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
  /** Fixed cadence in ms. `0` (or absent) for cron/runAt schedule kinds. */
  delayMs?: number;
  /** 5-field UTC cron expression — present only on cron-scheduled hooks. */
  cron?: string;
  /** RFC3339 UTC one-shot fire time — present only on runAt-scheduled hooks. */
  runAt?: string;
  state: 'scheduled' | 'running' | 'dispatched' | 'evicted' | 'cancelled' | 'expired';
  createdAt: string;
  /** TTL deadline (v3.1): `createdAt` + clamped `ttlMs` (≤ 24 hours).
   * Absent only on pre-TTL legacy rows, which never expire. */
  expiresAt?: string;
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
const TERMINAL_HOOK_EVENTS = new Set([
  'hook:dispatched',
  'hook:evicted',
  'hook:cancelled',
  'hook:expired',
]);

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
