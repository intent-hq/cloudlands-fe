import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';

const lanes = new WeakMap<object, Map<string, Promise<void>>>();
const owners = new Map<string, { scope: object }>();
/** Lease membership can change without replacing the physical session owner. */
export function bindAgentRecoveryReadOwner(key: string, scope: object): () => void {
  const owned = { scope };
  owners.set(key, owned);
  return () => {
    if (owners.get(key) === owned) owners.delete(key);
  };
}
/** A new authority has its own slot; loss within one authority retains physical ownership. */
export function trackAgentRecoveryRead<T>(
  key: string,
  read: () => Promise<T>,
  lifetime?: RecoveryLifetime,
): Promise<T> {
  if (!lifetime) return read();
  const identity = owners.get(key)?.scope ?? lifetime.key;
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
