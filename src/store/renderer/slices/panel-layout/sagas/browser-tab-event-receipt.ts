import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { withRecoveryLifetime } from '../../../middlewares/event-recovery';
import { store } from '../../../store';
import { browserTabClosed, browserTabUpserted } from '../../browser-clients/browser-clients-slice';

type TabAction = ReturnType<typeof browserTabClosed> | ReturnType<typeof browserTabUpserted>;
const completions = new WeakMap<object, () => void>();

/** The ordered ingress must await this receipt, not only Redux dispatch. */
export function dispatchBrowserTabEvent(
  action: TabAction,
  lifetime: RecoveryLifetime,
): Promise<void> {
  return new Promise((resolve) => {
    if (!lifetime.commit(() => undefined)) {
      resolve();
      return;
    }
    completions.set(action, resolve);
    store.dispatch(withRecoveryLifetime(action, lifetime));
  });
}

export function completeBrowserTabEvent(action: object): void {
  completions.get(action)?.();
  completions.delete(action);
}
