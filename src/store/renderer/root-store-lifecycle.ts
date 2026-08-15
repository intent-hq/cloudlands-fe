import type { Store } from '@augmentcode/themis/svelte-store';

import type { AppSagaCancel } from './sagas';
import { startRetentionFingerprint } from './retention-fingerprint';
import { initAppStore } from './store';

type StopHandler = () => void;

export type RootStoreHmrData = {
  rootStoreStop?: StopHandler;
  rootStoreReplaceSagas?: (lifecycle: RootStoreLifecycle) => void;
};

export type RootStoreLifecycle = {
  startSagas: (store: Store<any, any>) => AppSagaCancel[];
};

export function startRootStoreLifecycle(
  store: Store<any, any>,
  lifecycle: RootStoreLifecycle,
  hmrData?: RootStoreHmrData,
): StopHandler {
  if (hmrData?.rootStoreReplaceSagas) {
    hmrData.rootStoreReplaceSagas(lifecycle);
    return () => undefined;
  }

  if (hmrData?.rootStoreStop) {
    hmrData.rootStoreStop();
    hmrData.rootStoreStop = undefined;
  }

  const storeContext = initAppStore(store);
  let stopAppSagas = lifecycle.startSagas(store);
  // Diagnostics only — periodic counts of what the renderer retains. Started
  // last so a failure here cannot prevent the store from coming up.
  const stopRetentionFingerprint = startRetentionFingerprint(store);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      stopRetentionFingerprint();
      for (const stop of stopAppSagas) stop();
    } finally {
      storeContext.dispose();
      if (hmrData?.rootStoreStop === stop) {
        hmrData.rootStoreStop = undefined;
        hmrData.rootStoreReplaceSagas = undefined;
      }
    }
  };

  if (hmrData) {
    hmrData.rootStoreReplaceSagas = (nextLifecycle) => {
      for (const stop of stopAppSagas) stop();
      stopAppSagas = nextLifecycle.startSagas(store);
    };
    hmrData.rootStoreStop = stop;
    return () => undefined;
  }

  return stop;
}
