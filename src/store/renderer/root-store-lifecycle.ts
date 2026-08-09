import type { Store } from '@augmentcode/themis/svelte-store';

import type { AppSagaCancel } from './sagas';
import { initAppStore } from './store';

type StopHandler = () => void;

export type RootStoreLifecycle = {
  startSagas: (store: Store<any, any>) => AppSagaCancel[];
};

export function startRootStoreLifecycle(
  store: Store<any, any>,
  lifecycle: RootStoreLifecycle,
): StopHandler {
  const storeContext = initAppStore(store);
  const stopAppSagas = lifecycle.startSagas(store);

  return () => {
    try {
      for (const stop of stopAppSagas) stop();
    } finally {
      storeContext.dispose();
    }
  };
}
