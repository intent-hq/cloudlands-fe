import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { fileReadAuthorityDenied, observeFileReadFailure } from './file-read-completion';
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
  read: (onFailure: (error: unknown) => void) => Promise<T>,
): Promise<T> {
  const retire = rendererEventRecovery.captureRetirement(key);
  const failed = (error: unknown) => {
    // A missing file is a failed read, retaining any draft for a later retry.
    // Permission/principal failures revoke the entire captured content owner.
    if (key.startsWith('file-content:') && (error as { rpcCode?: unknown })?.rpcCode === -32602)
      return;
    if (fileReadAuthorityDenied(error)) retire(error);
  };
  return trackWorktreeSnapshotRead(key, () => {
    if (!receipt.isCurrent()) throw new Error('File read authority expired');
    return observeFileReadFailure(read(failed), failed);
  });
}
