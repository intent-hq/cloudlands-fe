import type { Store } from '@augmentcode/themis/svelte-store';

import type { AppSagaCancel } from './sagas';
import { startRetentionFingerprint } from './retention-fingerprint';
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
  // Diagnostics only — periodic counts of what the renderer retains. Started
  // last so a failure here cannot prevent the store from coming up.
  const stopRetentionFingerprint = startRetentionFingerprint(store);

  return () => {
    try {
      stopRetentionFingerprint();
      for (const stop of stopAppSagas) stop();
    } finally {
      storeContext.dispose();
    }
  };
}
