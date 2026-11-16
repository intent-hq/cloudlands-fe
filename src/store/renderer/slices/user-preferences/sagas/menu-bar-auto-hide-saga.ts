import { call, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { invoke, isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import {
  selectMenuBarAutoHide,
  selectUserPreferencesHydrated,
} from '../user-preferences-selectors';
import {
  setMenuBarAutoHide,
  toggleMenuBarAutoHide,
  userPreferencesHydrated,
} from '../user-preferences-slice';

const logger = createLogger('MenuBarAutoHideSaga');

/** Mirrors the "Auto-hide menu bar" preference onto the native Linux/Windows windows. */
function* syncMenuBarAutoHideWorker(): SagaGenerator<void> {
  const enabled = yield* selectMenuBarAutoHide.effect();
  try {
    yield* call(invoke, WINDOW_CHANNELS.SET_MENU_BAR_AUTO_HIDE, { enabled });
  } catch (error) {
    logger.warn('native menu bar auto-hide sync failed', error);
  }
}

export function* menuBarAutoHideSaga(): SagaGenerator<void> {
  if (!isElectron()) return;
  yield* takeLatest(
    [userPreferencesHydrated, setMenuBarAutoHide, toggleMenuBarAutoHide],
    syncMenuBarAutoHideWorker,
  );
  if (yield* selectUserPreferencesHydrated.effect()) {
    yield* call(syncMenuBarAutoHideWorker);
  }
}
