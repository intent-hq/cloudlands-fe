import { rendererEventRecovery } from './renderer-event-recovery';
import type { RecoveryRequestCompletion } from '$shared/event-recovery/session';

/** Capture before dispatch: dirty generations may change, resource authority may not. */
export function captureRuntimeReadAuthority(key: string, missingResource = false) {
  const retire = rendererEventRecovery.captureRetirement(key);
  const failed = (error: unknown): void => {
    const value = error as { rpcCode?: number; data?: { code?: string } } | null;
    if (
      value?.rpcCode === -32003 ||
      value?.rpcCode === -32001 ||
      (missingResource && value?.rpcCode === -32602 && value.data?.code === 'not-found')
    )
      retire(error);
  };
  return {
    failed,
    completed: (outcome: RecoveryRequestCompletion): void => {
      if (!outcome.retired) outcome.errors.forEach(failed);
    },
  };
}
