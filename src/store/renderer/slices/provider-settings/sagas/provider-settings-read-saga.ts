import { call, cancelled, put, takeLatest } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { selectProviderPathsRevision } from '../provider-settings-selectors';
import {
  providerPathsRequested,
  providerConfiguredPathsLoaded,
  providerPathsLoaded,
  providerPathsFailed,
} from '../provider-settings-slice';

function* loadPaths() {
  const revision = yield* selectProviderPathsRevision.effect();
  try {
    const entry = yield* call([appClient.settings, appClient.settings.get], 'providers.paths');
    const value = entry?.value;
    const configured: Record<string, string> = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [id, path] of Object.entries(value))
        if (typeof path === 'string') configured[id] = path;
    }
    yield* put(providerConfiguredPathsLoaded(revision, configured));
    const result = yield* call(
      invoke<{
        success: boolean;
        data?: {
          paths: Record<string, string | null>;
          secondaryPaths: Record<string, string | null>;
          npxPackages?: Record<string, string>;
        };
      }>,
      PROVIDERS_CHANNELS.GET_PATHS,
    );
    if (!result.success || !result.data) {
      yield* put(providerPathsFailed(revision));
      return;
    }
    yield* put(
      providerPathsLoaded(revision, {
        configured,
        resolved: result.data.paths,
        secondary: result.data.secondaryPaths,
        npxPackages: result.data.npxPackages ?? {},
      }),
    );
  } catch {
    yield* put(providerPathsFailed(revision));
  } finally {
    if (yield* cancelled()) yield* put(providerPathsFailed(revision));
  }
}

/** Attached to providerSettingsSaga: no independent registration or runtime. */
export function* providerSettingsReadSaga() {
  yield* takeLatest(providerPathsRequested, loadPaths);
}
