import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { runtimeReadDrained } from '$features/events/runtime-read-lane';
interface PendingRead {
  lifetime: RecoveryLifetime;
  result: Promise<unknown>;
  drained: Promise<void>;
  generation: number;
  settled: boolean;
}
interface ReadQueue {
  generation: number;
  pending: Set<Promise<void>>;
  recovery?: Promise<void>;
  ordinary: Map<string, PendingRead>;
}
const sessions = new WeakMap<object, Map<string, ReadQueue>>();

export function retireRecoveryReads(key: string): void {
  const queue = sessions.get(rendererEventRecovery.capturePhysicalSessionIdentity())?.get(key);
  // Retire queued starts, while retaining physical work across owner remounts.
  if (queue) queue.generation++;
}

/** Equal ordinary reads share work; a fresh recovery waits for physical drainage. */
export function runRecoveryRead<T>(
  key: string,
  lifetime: RecoveryLifetime,
  mode: 'ordinary' | 'recovery',
  requestKey: string,
  read: () => Promise<T>,
  options: {
    retireOnDenied?: boolean;
    retireOnNotFound?: boolean;
    onFailure?: (error: unknown) => void;
  } = {},
): Promise<T> {
  const retire = rendererEventRecovery.captureRetirement(key);
  const observeFailure = (error: unknown) => {
    options.onFailure?.(error);
    const failure = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
    const denied =
      options.retireOnDenied !== false &&
      (failure?.rpcCode === -32003 || failure?.rpcCode === -32001);
    const missing =
      options.retireOnNotFound !== false &&
      failure?.rpcCode === -32602 &&
      failure.data?.code === 'not-found';
    if (denied || missing) retire(error);
  };
  const session = rendererEventRecovery.capturePhysicalSessionIdentity();
  const queues = sessions.get(session) ?? new Map<string, ReadQueue>();
  sessions.set(session, queues);
  let queue = queues.get(key);
  if (!queue) {
    queue = { generation: 0, pending: new Set(), ordinary: new Map() };
    queues.set(key, queue);
  }
  const owned = queue;
  const generation = owned.generation;
  const existing = mode === 'ordinary' ? owned.ordinary.get(requestKey) : undefined;
  if (
    existing &&
    !existing.settled &&
    existing.generation === generation &&
    existing.lifetime.key === lifetime.key &&
    existing.lifetime.commit(() => {})
  )
    return existing.result as Promise<T>;
  const start = () => {
    const current =
      session === rendererEventRecovery.capturePhysicalSessionIdentity() &&
      generation === owned.generation &&
      (mode === 'ordinary' ? lifetime.commit(() => {}) : lifetime.isCurrent());
    if (!current) return Promise.reject(new Error('Read authority expired before dispatch'));
    try {
      return read();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const prior =
    mode === 'recovery'
      ? owned.pending.size
        ? Promise.all([...owned.pending])
        : undefined
      : existing
        ? Promise.all([existing.drained, ...(owned.recovery ? [owned.recovery] : [])])
        : owned.recovery;
  const result = (prior ? prior.then(start, start) : start()).catch((error) => {
    observeFailure(error);
    throw error;
  });
  const drained = runtimeReadDrained(result, (outcome) => {
    if (!outcome.retired) for (const error of outcome.errors) observeFailure(error);
  });
  owned.pending.add(drained);
  if (mode === 'ordinary') {
    const row = { lifetime, result, drained, generation, settled: false };
    owned.ordinary.set(requestKey, row);
    const settled = () => {
      row.settled = true;
    };
    void result.then(settled, settled);
  } else owned.recovery = drained;
  void drained.then(() => {
    owned.pending.delete(drained);
    if (owned.ordinary.get(requestKey)?.result === result) owned.ordinary.delete(requestKey);
    if (owned.recovery === drained) owned.recovery = undefined;
    if (owned.pending.size === 0 && queues.get(key) === owned) queues.delete(key);
  });
  return result;
}
