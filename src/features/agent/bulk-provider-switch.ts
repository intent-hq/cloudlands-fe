/**
 * Toast-free bulk worker behind the grouped failure toast's "Switch all…"
 * and "Retry all" (no per-agent toasts; results go back to the caller).
 *
 * Per coordinator: `agent.setModel` to the explicit target, then the same
 * `setModel` for its tracked failed workers (never `agent.retry` — the
 * restarted coordinator decides whether to retry them), then `agent.retry`.
 * Registry members are error sessions by definition, so the redrive is
 * always the daemon's `agent.retry`; no Redux session status is read here.
 * A failed switch never retries: that would re-send to the exhausted
 * provider.
 */

export interface BulkSwitchTarget {
  providerId: string;
  modelId: string;
}

export interface BulkAgentRef {
  agentId: string;
  workspaceId: string;
}

export interface BulkSwitchItem extends BulkAgentRef {
  /** `null` when the chosen target is not available for this agent. */
  target: BulkSwitchTarget | null;
  workers: BulkAgentRef[];
}

export type BulkAgentStatus = 'switched' | 'retried' | 'failed' | 'unavailable' | 'gone';

export interface BulkAgentOutcome {
  agentId: string;
  status: BulkAgentStatus;
  reason?: string;
  workersSwitched: number;
  /** `false` when the daemon accepted the retry but had nothing queued. */
  redriven?: boolean;
}

type CallResult = { ok: true } | { ok: false; error: string };
type RetryResult =
  { ok: true; redriven?: boolean } | { ok: false; notFound?: boolean; error: string };

export interface BulkSwitchDeps {
  setModel(
    agentId: string,
    modelId: string,
    workspaceId: string,
    providerId: string,
  ): Promise<CallResult>;
  retry(agentId: string, workspaceId: string): Promise<RetryResult>;
  onAgentDone?(outcome: BulkAgentOutcome): void;
  onWorkerSwitched?(workerId: string): void;
}

export const BULK_SWITCH_CONCURRENCY = 3;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function retryOutcome(
  agentId: string,
  workspaceId: string,
  retry: BulkSwitchDeps['retry'],
  success: 'switched' | 'retried',
  workersSwitched: number,
): Promise<BulkAgentOutcome> {
  const result = await retry(agentId, workspaceId);
  if (result.ok) {
    return {
      agentId,
      status: success,
      workersSwitched,
      ...(result.redriven !== undefined ? { redriven: result.redriven } : {}),
    };
  }
  if (result.notFound) return { agentId, status: 'gone', workersSwitched };
  return { agentId, status: 'failed', reason: result.error, workersSwitched };
}

async function switchOne(item: BulkSwitchItem, deps: BulkSwitchDeps): Promise<BulkAgentOutcome> {
  const { agentId, workspaceId, target } = item;
  if (!target) return { agentId, status: 'unavailable', workersSwitched: 0 };
  let workersSwitched = 0;
  try {
    const switched = await deps.setModel(agentId, target.modelId, workspaceId, target.providerId);
    if (!switched.ok) return { agentId, status: 'failed', reason: switched.error, workersSwitched };
    for (const worker of item.workers) {
      try {
        const moved = await deps.setModel(
          worker.agentId,
          target.modelId,
          worker.workspaceId,
          target.providerId,
        );
        if (moved.ok) {
          workersSwitched += 1;
          deps.onWorkerSwitched?.(worker.agentId);
        }
      } catch {
        // A worker that cannot move stays failed on the old provider; the
        // coordinator still restarts.
      }
    }
    return await retryOutcome(agentId, workspaceId, deps.retry, 'switched', workersSwitched);
  } catch (error) {
    return { agentId, status: 'failed', reason: errorText(error), workersSwitched };
  }
}

export async function runBulkProviderSwitch(
  items: BulkSwitchItem[],
  deps: BulkSwitchDeps,
  concurrency = BULK_SWITCH_CONCURRENCY,
): Promise<BulkAgentOutcome[]> {
  return mapWithConcurrency(items, concurrency, async (item) => {
    const outcome = await switchOne(item, deps);
    deps.onAgentDone?.(outcome);
    return outcome;
  });
}

export async function runBulkRetry(
  items: BulkAgentRef[],
  deps: Pick<BulkSwitchDeps, 'retry' | 'onAgentDone'>,
  concurrency = BULK_SWITCH_CONCURRENCY,
): Promise<BulkAgentOutcome[]> {
  return mapWithConcurrency(items, concurrency, async ({ agentId, workspaceId }) => {
    let outcome: BulkAgentOutcome;
    try {
      outcome = await retryOutcome(agentId, workspaceId, deps.retry, 'retried', 0);
    } catch (error) {
      outcome = { agentId, status: 'failed', reason: errorText(error), workersSwitched: 0 };
    }
    deps.onAgentDone?.(outcome);
    return outcome;
  });
}
