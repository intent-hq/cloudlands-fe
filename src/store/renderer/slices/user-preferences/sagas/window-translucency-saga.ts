import { call, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { invoke, isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import {
  selectShellTransparencyEnabled,
  selectUserPreferencesHydrated,
} from '../user-preferences-selectors';
import {
  setShellTransparencyEnabled,
  toggleShellTransparency,
  userPreferencesHydrated,
} from '../user-preferences-slice';

const logger = createLogger('WindowTranslucencySaga');

/**
 * Mirrors the "Translucent window" preference onto the native macOS window.
 * Without this the switch only made the CSS shell opaque, while WindowServer
 * kept compositing the native blur behind it on every frame.
 */
function* syncWindowTranslucencyWorker(): SagaGenerator<void> {
  const enabled = yield* selectShellTransparencyEnabled.effect();
  try {
    yield* call(invoke, WINDOW_CHANNELS.SET_TRANSLUCENCY, { enabled });
  } catch (error) {
    logger.warn('native window translucency sync failed', error);
  }
}

export function* windowTranslucencySaga(): SagaGenerator<void> {
  if (!isElectron()) return;
  yield* takeLatest(
    [userPreferencesHydrated, setShellTransparencyEnabled, toggleShellTransparency],
    syncWindowTranslucencyWorker,
  );
  // Root sagas start in order, and preference persistence hydrates synchronously
  // before this saga runs, so the saved value has usually landed already.
  if (yield* selectUserPreferencesHydrated.effect()) {
    yield* call(syncWindowTranslucencyWorker);
  }
}
