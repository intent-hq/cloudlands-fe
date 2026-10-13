import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

const lanes = new WeakMap<object, Map<string, Promise<void>>>();
const owners = new Map<string, { scope: object }>();

export function isAgentReadAuthorityError(error: unknown, includeNotFound = true): boolean {
  const e = error as { rpcCode?: number; data?: { code?: string } } | null;
  return (
    e?.rpcCode === -32003 ||
    e?.rpcCode === -32001 ||
    (includeNotFound && e?.rpcCode === -32602 && e.data?.code === 'not-found')
  );
}

/** Observe errors outside caller catches without extending their logical deadline. */
export async function drainAgentReadFailure(
  error: unknown,
  retire: (error: unknown) => unknown,
  includeNotFound = true,
): Promise<void> {
  if (isAgentReadAuthorityError(error, includeNotFound)) retire(error);
  const completion = await getPhysicalRequestCompletion(error);
  if (completion && !completion.retired)
    for (const failure of completion.errors)
      if (isAgentReadAuthorityError(failure, includeNotFound)) retire(failure);
}
/** Lease membership can change without replacing the physical session owner. */
export function bindAgentRecoveryReadOwner(key: string, _scope: object): () => void {
  const owned = { scope: rendererEventRecovery.capturePhysicalSessionIdentity() };
  owners.set(key, owned);
  return () => {
    if (owners.get(key) === owned) owners.delete(key);
  };
}
/** Authority changes retain pending physical work; only a new session gets a new lane. */
export function trackAgentRecoveryRead<T>(
  key: string,
  read: () => Promise<T>,
  lifetime?: RecoveryLifetime,
): Promise<T> {
  if (!lifetime) return read();
  const retire = rendererEventRecovery.captureRetirement(key);
  const identity = owners.get(key)?.scope ?? rendererEventRecovery.capturePhysicalSessionIdentity();
  const owned = lanes.get(identity) ?? new Map<string, Promise<void>>();
  lanes.set(identity, owned);
  const invoke = async () => read();
  const prior = owned.get(key);
  const result = prior ? prior.then(invoke) : invoke();
  const drained = result.then(
    () => {},
    (error: unknown) => drainAgentReadFailure(error, retire),
  );
  owned.set(key, drained);
  void drained.then(() => {
    if (owned.get(key) === drained) owned.delete(key);
  });
  return result;
}
