import type { RecoveryLifetime } from '$shared/event-recovery/resource';
interface PendingRead {
  lifetime: RecoveryLifetime;
  result: Promise<unknown>;
}
interface ReadQueue {
  epoch: object;
  pending: Set<Promise<unknown>>;
  recovery?: Promise<unknown>;
  ordinary: Map<string, PendingRead>;
  retired: boolean;
}
const queues = new Map<string, ReadQueue>();

export function retireRecoveryReads(key: string): void {
  const queue = queues.get(key);
  if (queue) queue.retired = true;
  queues.delete(key);
}

/** Equal ordinary reads share work; a fresh recovery waits for all earlier reads. */
export function runRecoveryRead<T>(
  key: string,
  lifetime: RecoveryLifetime,
  mode: 'ordinary' | 'recovery',
  requestKey: string,
  read: () => Promise<T>,
): Promise<T> {
  let queue = queues.get(key);
  if (!queue || queue.epoch !== lifetime.key) {
    queue = { epoch: lifetime.key, pending: new Set(), ordinary: new Map(), retired: false };
    queues.set(key, queue);
  }
  const owned = queue;
  const existing = mode === 'ordinary' ? owned.ordinary.get(requestKey) : undefined;
  if (existing?.lifetime.commit(() => {})) return existing.result as Promise<T>;
  const start = () => {
    const current =
      !owned.retired && (mode === 'ordinary' ? lifetime.commit(() => {}) : lifetime.isCurrent());
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
        ? Promise.allSettled([...owned.pending])
        : undefined
      : existing
        ? Promise.allSettled([existing.result, ...(owned.recovery ? [owned.recovery] : [])])
        : owned.recovery;
  const result = prior ? prior.then(start, start) : start();
  owned.pending.add(result);
  if (mode === 'ordinary') owned.ordinary.set(requestKey, { lifetime, result });
  else owned.recovery = result;
  const finished = () => {
    owned.pending.delete(result);
    if (owned.ordinary.get(requestKey)?.result === result) owned.ordinary.delete(requestKey);
    if (owned.recovery === result) owned.recovery = undefined;
    if (owned.pending.size === 0 && queues.get(key) === owned) queues.delete(key);
  };
  void result.then(finished, finished);
  return result;
}
