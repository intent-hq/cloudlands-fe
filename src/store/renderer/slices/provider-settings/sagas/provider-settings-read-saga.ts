import { all, call, cancelled, put, takeEvery, takeLatest } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import { checkPiMcpAdapterInstalled, installPiMcpAdapter } from '$features/pi/pi-models.client';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import {
  takeEveryByContextFIFO,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { checkSingleProviderSuccess } from '../../agent-availability/agent-availability-slice';
import { selectProviderStatusMap } from '../../agent-availability/agent-availability-selectors';
import {
  selectPiAdapter,
  selectProviderPathsRevision,
  selectProviderSettingsSessionActive,
} from '../provider-settings-selectors';
import {
  piAdapterCheckRequested,
  piAdapterCheckSettled,
  piAdapterInstallRequested,
  providerPathsRequested,
  providerConfiguredPathsLoaded,
  providerPathsLoaded,
  providerPathsFailed,
  providerSettingsRequestSettled,
  providerSettingsSessionOpened,
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

type AdapterReads = { revision: number };

function* checkPiAdapter(reads: AdapterReads) {
  const revision = ++reads.revision;
  try {
    const installed = yield* call(checkPiMcpAdapterInstalled);
    if (revision === reads.revision) yield* put(piAdapterCheckSettled(installed));
  } catch {
    if (revision === reads.revision) yield* put(piAdapterCheckSettled(null));
  } finally {
    if ((yield* cancelled()) && revision === reads.revision)
      yield* put(piAdapterCheckSettled(null));
  }
}

function* ensurePiAdapterChecked() {
  const status = yield* selectProviderStatusMap.effect();
  const adapter = yield* selectPiAdapter.effect();
  if (status.pi?.available && adapter.status === 'idle') yield* put(piAdapterCheckRequested());
}

function* cancelPiInstall(action: ReturnType<typeof piAdapterInstallRequested>) {
  yield* put(providerSettingsRequestSettled(action.payload[0].id, 'cancelled'));
}

function* installPiAdapter(
  reads: AdapterReads,
  action: ReturnType<typeof piAdapterInstallRequested>,
) {
  const [request] = action.payload;
  if (!(yield* selectProviderSettingsSessionActive.effect(request.sessionId))) {
    yield* call(cancelPiInstall, action);
    return;
  }
  try {
    const result = yield* call(installPiMcpAdapter);
    if (!result?.success) throw new Error(result?.error || m.settings_providers_unknownError());
    yield* call(checkPiAdapter, reads);
    yield* put(providerSettingsRequestSettled(request.id, 'success'));
    if (yield* selectProviderSettingsSessionActive.effect(request.sessionId)) {
      const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
      yield* call(notify.success, m.settings_providers_piAdapterInstalled());
    }
  } catch (error) {
    yield* put(providerSettingsRequestSettled(request.id, 'failure'));
    if (yield* selectProviderSettingsSessionActive.effect(request.sessionId)) {
      const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
      yield* call(notify.error, m.settings_providers_piAdapterInstallFailed(), {
        description: error instanceof Error ? error.message : m.settings_providers_unknownError(),
      });
    }
  } finally {
    if (yield* cancelled()) yield* call(cancelPiInstall, action);
  }
}

/** Attached to providerSettingsSaga: no independent registration or runtime. */
export function* providerSettingsReadSaga() {
  const adapterReads: AdapterReads = { revision: 0 };
  yield* all([
    takeLatest(providerPathsRequested, loadPaths),
    takeEvery([checkSingleProviderSuccess, providerSettingsSessionOpened], ensurePiAdapterChecked),
    takeSingleFlightInContext(
      piAdapterCheckRequested,
      () => 'pi-adapter',
      function* () {
        yield* call(checkPiAdapter, adapterReads);
      },
    ),
    takeEveryByContextFIFO(
      piAdapterInstallRequested,
      () => 'pi-adapter',
      function* (action) {
        yield* call(installPiAdapter, adapterReads, action);
      },
      { onDiscardPending: cancelPiInstall },
    ),
  ]);
}
