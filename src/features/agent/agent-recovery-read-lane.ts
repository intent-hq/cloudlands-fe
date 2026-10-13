import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';

const lanes = new WeakMap<object, Map<string, Promise<void>>>();
const owners = new Map<string, { scope: object }>();
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
  const identity = owners.get(key)?.scope ?? rendererEventRecovery.capturePhysicalSessionIdentity();
  const owned = lanes.get(identity) ?? new Map<string, Promise<void>>();
  lanes.set(identity, owned);
  const invoke = async () => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof RecoveryRequestTimeoutError) await error.drained;
      throw error;
    }
  };
  const prior = owned.get(key);
  const result = prior ? prior.then(invoke) : invoke();
  const drained = result.then(
    () => {},
    () => {},
  );
  owned.set(key, drained);
  void drained.then(() => {
    if (owned.get(key) === drained) owned.delete(key);
  });
  return result;
}
