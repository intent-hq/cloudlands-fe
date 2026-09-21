import type { Store } from '@augmentcode/themis/svelte-store';

import { startLongTaskWatchdog } from './long-task-watchdog';
import { startAllAppSagas } from './sagas';
import { startRetentionFingerprint } from './retention-fingerprint';

type StopHandler = () => void;

export type AppStoreHmrData = {
  appSagasStop?: StopHandler;
};

export function startAppStoreLifecycle(
  store: Store<any, any>,
  hmrData?: AppStoreHmrData,
): StopHandler {
  hmrData?.appSagasStop?.();

  const stopAppSagas = startAllAppSagas(store);
  // App-only diagnostics can import live transports. Keep them outside the
  // shared root lifecycle so isolated previews do not load that graph.
  const stopRetentionFingerprint = startRetentionFingerprint(store);
  const stopLongTaskWatchdog = startLongTaskWatchdog(store);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      stopLongTaskWatchdog();
    } finally {
      try {
        stopRetentionFingerprint();
      } finally {
        for (const stopSaga of stopAppSagas) stopSaga();
      }
    }
    if (hmrData?.appSagasStop === stop) hmrData.appSagasStop = undefined;
  };

  if (hmrData) hmrData.appSagasStop = stop;
  return stop;
}
