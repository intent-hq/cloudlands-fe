import { put } from 'typed-redux-saga';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { withRecoveryLifetime } from '$store/renderer/middlewares/event-recovery';

/** Check now and again at reducer dispatch, after the saga scheduler yields. */
export function* putFileRecovery(
  receipt: RecoveryLifetime,
  action: { type: string; payload?: unknown },
) {
  if (receipt.commit(() => undefined)) yield* put(withRecoveryLifetime(action, receipt));
}
