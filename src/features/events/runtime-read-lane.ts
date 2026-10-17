import { captureRuntimeReadAuthority } from './runtime-read-authority';
import { rendererEventRecovery } from './renderer-event-recovery';
import {
  getPhysicalRequestCompletion,
  type RecoveryRequestCompletion,
} from '$shared/event-recovery/session';

const sessions = new WeakMap<object, Map<string, Promise<void>>>();

/** Logical timeouts reject promptly, but their physical requests still own the lane. */
export function runtimeReadDrained(
  result: Promise<unknown>,
  onCompletion?: (outcome: RecoveryRequestCompletion) => void | Promise<void>,
): Promise<void> {
  return result.then(
    () => {},
    async (error) => {
      const completion = getPhysicalRequestCompletion(error);
      if (completion) {
        const outcome = await completion;
        await onCompletion?.(outcome);
      }
    },
  );
}

/** Resource remounts share a physical lane; a replacement transport owns a new one. */
export function trackRuntimeRead<T>(
  key: string,
  read: () => Promise<T>,
  missingResource = false,
): Promise<T> {
  const authority = captureRuntimeReadAuthority(key, missingResource);
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
  const result = (prior ? prior.then(invoke) : invoke()).catch((error: unknown) => {
    authority.failed(error);
    throw error;
  });
  const tail = runtimeReadDrained(result, authority.completed);
  lanes.set(key, tail);
  void tail.then(() => {
    if (lanes.get(key) === tail) lanes.delete(key);
  });
  return result;
}
