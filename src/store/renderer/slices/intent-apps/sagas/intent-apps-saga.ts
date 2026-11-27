/**
 * Intent Apps Saga (Labs)
 *
 * Mirrors main's app library state into the slice (first read plus every
 * `intent-apps:changed` push), loads app icons, and carries the user's
 * requests to main. Main talks to the daemon; the renderer never calls an
 * `app.*` method itself.
 */

import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { all, call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  IntentAppInstallResult,
  IntentAppsActionResult,
  IntentAppsState,
} from '$shared/intent-apps/intent-apps-types';
import { selectIntentAppIcons } from '../intent-apps-selectors';
import {
  intentAppApproveRequested,
  intentAppIconReceived,
  intentAppInstalled,
  intentAppInstallPreviewReceived,
  intentAppInstallRequested,
  intentAppOpenRequested,
  intentAppRevokeRequested,
  intentAppsActionFailed,
  intentAppsActionFinished,
  intentAppsActionStarted,
  intentAppsLabRequested,
  intentAppsRefreshRequested,
  intentAppsStateReceived,
  intentAppUninstallRequested,
  type IntentAppsActionKind,
  type IntentAppsApproveRequest,
  type IntentAppsInstallRequest,
} from '../intent-apps-slice';

const logger = createLogger('IntentAppsSaga');
const INTENT_APPS = IPC_CHANNELS.INTENT_APPS;

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/** One function per request, each naming its channel, so the wire surface stays auditable. */
const intentAppsRequests = {
  getState: async (): Promise<IntentAppsState | null> => {
    const api = getApi();
    if (!api) return null;
    return (await api.invoke(INTENT_APPS.GET_STATE, {})) as IntentAppsState;
  },
  refresh: async (): Promise<IntentAppsState | null> =>
    ((await getApi()?.invoke(INTENT_APPS.REFRESH, {})) as IntentAppsState | undefined) ?? null,
  setLab: async (enabled: boolean): Promise<IntentAppsState | null> =>
    ((await getApi()?.invoke(INTENT_APPS.SET_LAB, { enabled })) as IntentAppsState | undefined) ??
    null,
  install: async (
    request: IntentAppsInstallRequest,
  ): Promise<IntentAppsActionResult<IntentAppInstallResult>> =>
    (await getApi()?.invoke(
      INTENT_APPS.INSTALL,
      request,
    )) as IntentAppsActionResult<IntentAppInstallResult>,
  approve: async (request: IntentAppsApproveRequest): Promise<IntentAppsActionResult<unknown>> =>
    (await getApi()?.invoke(INTENT_APPS.APPROVE, request)) as IntentAppsActionResult<unknown>,
  revoke: async (appId: string): Promise<IntentAppsActionResult<unknown>> =>
    (await getApi()?.invoke(INTENT_APPS.REVOKE, { appId })) as IntentAppsActionResult<unknown>,
  uninstall: async (appId: string): Promise<IntentAppsActionResult<unknown>> =>
    (await getApi()?.invoke(INTENT_APPS.UNINSTALL, { appId })) as IntentAppsActionResult<unknown>,
  open: async (appId: string): Promise<IntentAppsActionResult<unknown>> =>
    (await getApi()?.invoke(INTENT_APPS.OPEN, { appId })) as IntentAppsActionResult<unknown>,
  icon: async (appId: string): Promise<string | null> =>
    ((await getApi()?.invoke(INTENT_APPS.ICON, { appId })) as string | null | undefined) ?? null,
};

function createChangedChannel(): EventChannel<IntentAppsState> {
  return eventChannel<IntentAppsState>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(INTENT_APPS.CHANGED, (state: IntentAppsState) => emit(state));
    return () => api.offById(INTENT_APPS.CHANGED, listenerId);
  }, buffers.sliding<IntentAppsState>(1));
}

/** Load icons of listed apps that the slice does not hold yet. */
function* loadIcons(state: IntentAppsState): SagaGenerator<void> {
  const icons = yield* selectIntentAppIcons.effect();
  for (const app of state.apps) {
    const key = `${app.id}@${app.bundleHash}`;
    if (!app.icon || key in icons) continue;
    try {
      const url = yield* call(intentAppsRequests.icon, app.id);
      yield* put(intentAppIconReceived(key, url));
    } catch (error) {
      logger.debug('Could not load an app icon', error);
      yield* put(intentAppIconReceived(key, null));
    }
  }
}

function* receive(state: IntentAppsState | null): SagaGenerator<void> {
  if (!state) return;
  yield* put(intentAppsStateReceived(state));
  yield* fork(loadIcons, state);
}

function* watchChanges(): SagaGenerator<void> {
  if (!getApi()) return;
  const channel = yield* call(createChangedChannel);
  try {
    yield* call(receive, yield* call(intentAppsRequests.getState));
  } catch (error) {
    logger.warn('Could not read the app library', error);
  }
  try {
    while (true) yield* call(receive, yield* take(channel));
  } finally {
    channel.close();
  }
}

/** Run one request; record busy, failure and its outcome. */
function* runAction<T>(
  kind: IntentAppsActionKind,
  appId: string | null,
  request: () => Promise<IntentAppsActionResult<T>>,
): SagaGenerator<T | undefined> {
  yield* put(intentAppsActionStarted(kind, appId));
  try {
    const result = yield* call(request);
    if (!result || !result.ok) {
      const error = result?.ok === false ? result.error : { code: 'internal', message: '' };
      yield* put(intentAppsActionFailed(kind, appId, error));
      return undefined;
    }
    yield* put(intentAppsActionFinished());
    return (result as { result?: T }).result;
  } catch (error) {
    yield* put(
      intentAppsActionFailed(kind, appId, {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return undefined;
  }
}

function* handleLab({ payload: [enabled] }: ReturnType<typeof intentAppsLabRequested>) {
  yield* put(intentAppsActionStarted('lab', null));
  try {
    yield* call(receive, yield* call(intentAppsRequests.setLab, enabled));
    yield* put(intentAppsActionFinished());
  } catch (error) {
    yield* put(
      intentAppsActionFailed('lab', null, {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function* handleRefresh() {
  try {
    yield* call(receive, yield* call(intentAppsRequests.refresh));
  } catch (error) {
    logger.warn('Could not refresh the app library', error);
  }
}

function* handleInstall({ payload: [request] }: ReturnType<typeof intentAppInstallRequested>) {
  const result = yield* runAction<IntentAppInstallResult>('install', null, () =>
    intentAppsRequests.install(request),
  );
  if (!result) return;
  yield* put(request.dryRun ? intentAppInstallPreviewReceived(result) : intentAppInstalled(result));
}

function* handleApprove({ payload: [request] }: ReturnType<typeof intentAppApproveRequested>) {
  yield* runAction<unknown>('approve', request.appId, () => intentAppsRequests.approve(request));
}

function* handleRevoke({ payload: [appId] }: ReturnType<typeof intentAppRevokeRequested>) {
  yield* runAction<unknown>('revoke', appId, () => intentAppsRequests.revoke(appId));
}

function* handleUninstall({ payload: [appId] }: ReturnType<typeof intentAppUninstallRequested>) {
  yield* runAction<unknown>('uninstall', appId, () => intentAppsRequests.uninstall(appId));
}

function* handleOpen({ payload: [appId] }: ReturnType<typeof intentAppOpenRequested>) {
  yield* runAction<unknown>('open', appId, () => intentAppsRequests.open(appId));
}

export function* intentAppsSaga(): SagaGenerator<void> {
  yield* all([
    fork(watchChanges),
    takeEvery(intentAppsLabRequested, handleLab),
    takeEvery(intentAppsRefreshRequested, handleRefresh),
    takeEvery(intentAppInstallRequested, handleInstall),
    takeEvery(intentAppApproveRequested, handleApprove),
    takeEvery(intentAppRevokeRequested, handleRevoke),
    takeEvery(intentAppUninstallRequested, handleUninstall),
    takeEvery(intentAppOpenRequested, handleOpen),
  ]);
}
