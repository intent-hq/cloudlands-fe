import {
  call,
  put,
  fork,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  STREAMING_PROFILES,
  STREAMING_PROFILE_STORAGE_KEY,
  type StreamingProfileName,
} from '../streaming-config-types';
import {
  setStreamingProfile,
  resetStreamingConfig,
  hydrateStreamingProfile,
} from '../streaming-config-slice';
import { selectStreamingProfileName } from '../streaming-config-selectors';

// ============================================================================
// Init saga — load saved profile from localStorage
// ============================================================================

function* initSaga(): SagaGenerator<void> {
  const saved = yield* call(getLocalStorageItem, STREAMING_PROFILE_STORAGE_KEY);
  if (saved && saved in STREAMING_PROFILES) {
    yield* put(hydrateStreamingProfile(saved as StreamingProfileName));
  }
}

// ============================================================================
// Persistence saga — save profile to localStorage on change
// ============================================================================

function* persistProfile(): SagaGenerator<void> {
  try {
    const profileName: StreamingProfileName = yield* selectStreamingProfileName.effect();
    yield* call(setLocalStorageItem, STREAMING_PROFILE_STORAGE_KEY, profileName);
  } catch {
    // Ignore storage errors (quota, private browsing)
  }
}

function* watchPersistence(): SagaGenerator<void> {
  yield* takeEvery(
    [setStreamingProfile, resetStreamingConfig, hydrateStreamingProfile],
    persistProfile,
  );
}

// ============================================================================
// Root saga
// ============================================================================

export function* streamingConfigSaga(): SagaGenerator<void> {
  yield* call(initSaga);
  yield* fork(watchPersistence);
}

