import { rendererEventRecovery } from './renderer-event-recovery';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';

const sessions = new WeakMap<object, Map<string, Promise<void>>>();

/** Logical timeouts reject promptly, but their physical requests still own the lane. */
export function runtimeReadDrained(result: Promise<unknown>): Promise<void> {
  return result.then(
    () => {},
    async (error) => {
      if (error instanceof RecoveryRequestTimeoutError) await error.drained;
    },
  );
}

/** Resource remounts share a physical lane; a replacement transport owns a new one. */
export function trackRuntimeRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const session = rendererEventRecovery.capturePhysicalSessionIdentity();
  const lanes = sessions.get(session) ?? new Map<string, Promise<void>>();
  sessions.set(session, lanes);
  const invoke = () => {
    try {
      return Promise.resolve(read());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const prior = lanes.get(key);
  const result = prior ? prior.then(invoke) : invoke();
  const tail = runtimeReadDrained(result);
  lanes.set(key, tail);
  void tail.then(() => {
    if (lanes.get(key) === tail) lanes.delete(key);
  });
  return result;
}
