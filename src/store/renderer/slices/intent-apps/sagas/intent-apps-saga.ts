/**
 * Intent Apps Saga (Labs)
 *
 * Mirrors main's app library state into the slice (first read plus every
 * `intent-apps:changed` push), loads app icons, and carries the user's
 * requests to main. Main talks to the daemon; the renderer never calls an
 * `app.*` method itself.
 */

import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  fork,
  put,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  IntentAppPackageInstallResult,
  IntentAppsActionResult,
  IntentAppsState,
} from '$shared/intent-apps/intent-apps-types';
import { selectIntentAppIcons, selectIntentAppPackageInstall } from '../intent-apps-selectors';
import {
  intentAppApproveRequested,
  intentAppIconReceived,
  intentAppOpenRequested,
  intentAppPackageChecked,
  intentAppPackageChosen,
  intentAppPackageDismissed,
  intentAppPackageInstalled,
  intentAppPackageInstallRequested,
  intentAppPackagePickRequested,
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
} from '../intent-apps-slice';

/** A package install request: a package file or folder on this computer, or an earlier upload. */
type PackageInstallRequest = ({ path: string } | { uploadId: string }) & {
  replace?: boolean;
  dryRun?: boolean;
};

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
  pickPackage: async (): Promise<{ path: string } | null> =>
    ((await getApi()?.invoke(INTENT_APPS.PICK_PACKAGE, {})) as { path: string } | null) ?? null,
  discardPackage: async (uploadId: string): Promise<void> => {
    await getApi()?.invoke(INTENT_APPS.DISCARD_PACKAGE, { uploadId });
  },
  install: async (
    request: PackageInstallRequest,
  ): Promise<IntentAppsActionResult<IntentAppPackageInstallResult>> =>
    (await getApi()?.invoke(
      INTENT_APPS.INSTALL,
      request,
    )) as IntentAppsActionResult<IntentAppPackageInstallResult>,
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

function* handlePick() {
  try {
    const picked = yield* call(intentAppsRequests.pickPackage);
    if (picked?.path) yield* put(intentAppPackageChosen(picked.path));
  } catch (error) {
    logger.warn('The package picker failed', error);
  }
}

/**
 * Upload a chosen package to the window's machine and check it with a dry run;
 * an installed app of the same id makes it a replace check of the same upload.
 * One check at a time (`takeLeading`, and the library takes no pick or drop
 * meanwhile), so every upload that main begins ends in the review or is
 * discarded here.
 */
function* handleChosen({ payload: [path] }: ReturnType<typeof intentAppPackageChosen>) {
  const previous = yield* selectIntentAppPackageInstall.effect();
  if (previous)
    yield* put(intentAppPackageDismissed(previous.installed ? null : previous.uploadId));
  yield* put(intentAppsActionStarted('install', null));
  try {
    let replace = false;
    let result = yield* call(intentAppsRequests.install, { path, dryRun: true });
    if (result && !result.ok && result.error.code === 'app-exists' && result.error.uploadId) {
      replace = true;
      result = yield* call(intentAppsRequests.install, {
        uploadId: result.error.uploadId,
        dryRun: true,
        replace,
      });
    }
    if (!result || !result.ok) {
      const error = result?.ok === false ? result.error : { code: 'internal', message: '' };
      if (error.uploadId) yield* call(intentAppsRequests.discardPackage, error.uploadId);
      yield* put(intentAppsActionFailed('install', null, error));
      return;
    }
    yield* put(intentAppsActionFinished());
    const { uploadId, ...preview } = result.result;
    yield* put(intentAppPackageChecked({ uploadId, replace, preview, installed: false }));
  } catch (error) {
    yield* put(
      intentAppsActionFailed('install', null, {
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Whether the review of `uploadId` is still the one on screen (not dismissed or replaced). */
function* isCurrentReview(uploadId: string): SagaGenerator<boolean> {
  const current = yield* selectIntentAppPackageInstall.effect();
  return current?.uploadId === uploadId;
}

/**
 * Install the checked upload, then approve it with the features the user
 * kept. The approval binds to the hash the user saw in the check. The install
 * ends the upload, so once it succeeds the review only retries the approval.
 * A review that was dismissed or replaced while its install ran is left alone:
 * the app is installed and waits for approval in the library.
 */
function* handlePackageInstall({
  payload: [features],
}: ReturnType<typeof intentAppPackageInstallRequested>) {
  const pending = yield* selectIntentAppPackageInstall.effect();
  if (!pending) return;
  const checked = pending.preview.app;
  if (!pending.installed) {
    const installed = yield* runAction<IntentAppPackageInstallResult>('install', null, () =>
      intentAppsRequests.install({ uploadId: pending.uploadId, replace: pending.replace }),
    );
    if (!installed || !(yield* call(isCurrentReview, pending.uploadId))) return;
    yield* put(intentAppPackageInstalled(pending.uploadId));
    if (installed.app.bundleHash !== checked.bundleHash) {
      yield* put(
        intentAppsActionFailed('install', null, {
          code: 'hash-mismatch',
          message: 'The installed app is not the one that was checked',
        }),
      );
      return;
    }
  }
  if (checked.permissions.level !== 3) {
    const approved = yield* runAction<unknown>('approve', checked.id, () =>
      intentAppsRequests.approve({
        appId: checked.id,
        bundleHash: checked.bundleHash,
        level: checked.permissions.level,
        features,
      }),
    );
    if (approved === undefined) return;
  }
  if (yield* call(isCurrentReview, pending.uploadId)) yield* put(intentAppPackageDismissed(null));
}

function* handleDismissed({ payload: [uploadId] }: ReturnType<typeof intentAppPackageDismissed>) {
  if (!uploadId) return;
  try {
    yield* call(intentAppsRequests.discardPackage, uploadId);
  } catch (error) {
    logger.debug('Could not discard an app package upload', error);
  }
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
    takeEvery(intentAppPackagePickRequested, handlePick),
    takeLeading(intentAppPackageChosen, handleChosen),
    takeEvery(intentAppPackageInstallRequested, handlePackageInstall),
    takeEvery(intentAppPackageDismissed, handleDismissed),
    takeEvery(intentAppApproveRequested, handleApprove),
    takeEvery(intentAppRevokeRequested, handleRevoke),
    takeEvery(intentAppUninstallRequested, handleUninstall),
    takeEvery(intentAppOpenRequested, handleOpen),
  ]);
}
