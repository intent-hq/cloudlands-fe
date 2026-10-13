import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';
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

/** A queued read must still belong to the caller when it physically starts. */
export function readFileSnapshot<T>(
  key: string,
  receipt: RecoveryLifetime,
  read: () => Promise<T>,
): Promise<T> {
  return trackWorktreeSnapshotRead(key, () => {
    if (!receipt.isCurrent()) throw new Error('File read authority expired');
    return read();
  });
}
