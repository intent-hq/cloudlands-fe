import type { Store } from '@augmentcode/themis/svelte-store';

import { startAllAppSagas } from './sagas';

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
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const stopSaga of stopAppSagas) stopSaga();
    if (hmrData?.appSagasStop === stop) hmrData.appSagasStop = undefined;
  };

  if (hmrData) hmrData.appSagasStop = stop;
  return stop;
}
