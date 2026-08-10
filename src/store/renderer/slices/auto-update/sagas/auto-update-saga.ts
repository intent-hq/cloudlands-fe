import { END, buffers, eventChannel, type EventChannel, type Task } from 'redux-saga';
import { call, cancel, delay, fork, put, take, takeEvery } from 'typed-redux-saga';

import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import type { UpdateProgress, UpdateState } from '$features/auto-update/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectAutoUpdateStatus } from '../auto-update-selectors';
import {
  downloadUpdate,
  initAutoUpdate,
  installUpdate,
  setCheckTimedOut,
  setProgress,
  setUpToDate,
  setUpdateError,
  setUpdateState,
  showToast,
  showToastChecking,
} from '../auto-update-slice';

const logger = createLogger('AutoUpdateSaga');

/**
 * Renderer-side watchdog window (intent-hq/monorepo#1698). Slightly longer
 * than the main-process 30s watchdog so a main-side error/status event wins
 * the race when it does arrive.
 */
export const CHECK_TIMEOUT_MS = 35_000;

/** Mutable holder for the in-flight check-timeout fork, if any. */
type CheckWatchdog = { task?: Task };

/** Mutable flag: set once any live channel event has been handled. */
type SessionFlags = { eventSeen: boolean };

type AutoUpdateEvent =
  | { kind: 'show-toast' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'status'; state: UpdateState }
  | { kind: 'progress'; progress: UpdateProgress }
  | { kind: 'error'; error: string };

function mapUpdateState(state: UpdateState): UpdateState {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    updateInfo: state.updateInfo
      ? {
          version: state.updateInfo.version,
          releaseDate: state.updateInfo.releaseDate,
          releaseNotes: state.updateInfo.releaseNotes,
        }
      : null,
    progress: state.progress
      ? {
          percent: state.progress.percent,
          bytesPerSecond: state.progress.bytesPerSecond,
          transferred: state.progress.transferred,
          total: state.progress.total,
        }
      : null,
    error: state.error,
    channel: state.channel,
  };
}

function mapProgress(progress: UpdateProgress): UpdateProgress {
  return {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  };
}

export function createAutoUpdateChannel(): EventChannel<AutoUpdateEvent> {
  return eventChannel<AutoUpdateEvent>((emit) => {
    const disposers = [
      autoUpdateClient.onShowToast(() => emit({ kind: 'show-toast' })),
      autoUpdateClient.onUpToDate((data) => emit({ kind: 'up-to-date', version: data.version })),
      autoUpdateClient.onStatusChanged((state) => emit({ kind: 'status', state })),
      autoUpdateClient.onProgress((progress) => emit({ kind: 'progress', progress })),
      autoUpdateClient.onError((error) => emit({ kind: 'error', error })),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, buffers.expanding<AutoUpdateEvent>());
}

function* loadInitialState(watchdog: CheckWatchdog, session: SessionFlags) {
  try {
    const state: UpdateState = yield* call([autoUpdateClient, autoUpdateClient.getState]);
    // A live event handled before this fork resumed supersedes the snapshot;
    // applying it now could reset a completed check back to 'checking'.
    if (session.eventSeen) return;
    yield* put(setUpdateState(mapUpdateState(state)));
    if (state.status === 'checking') {
      // A check started before this saga's listeners existed (e.g. manual
      // "Check for Updates" during startup, intent-hq/monorepo#1857): the
      // show-toast event was lost, so surface the toast now and arm the
      // watchdog to guarantee a terminal state.
      yield* armCheckTimeout(watchdog);
      yield* put(showToastChecking());
    }
  } catch (error) {
    logger.error('Failed to initialize auto-update', error);
  }
}

function* cancelCheckTimeout(watchdog: CheckWatchdog) {
  if (watchdog.task) {
    yield* cancel(watchdog.task);
    watchdog.task = undefined;
  }
}

function* armCheckTimeout(watchdog: CheckWatchdog) {
  yield* cancelCheckTimeout(watchdog);
  watchdog.task = yield* fork(function* () {
    yield* delay(CHECK_TIMEOUT_MS);
    yield* put(setCheckTimedOut());
  });
}

function* handleAutoUpdateEvent(event: AutoUpdateEvent, watchdog: CheckWatchdog) {
  switch (event.kind) {
    case 'show-toast':
      yield* armCheckTimeout(watchdog);
      yield* put(showToastChecking());
      break;
    case 'up-to-date':
      yield* cancelCheckTimeout(watchdog);
      yield* put(setUpToDate(event.version));
      yield* put(showToast());
      break;
    case 'status':
      if (event.state.status === 'checking') {
        yield* armCheckTimeout(watchdog);
      } else {
        yield* cancelCheckTimeout(watchdog);
      }
      yield* put(setUpdateState(mapUpdateState(event.state)));
      break;
    case 'progress':
      yield* put(setProgress(mapProgress(event.progress)));
      break;
    case 'error':
      yield* cancelCheckTimeout(watchdog);
      yield* put(setUpdateError(event.error));
      break;
  }
}

function* runAutoUpdateSession() {
  const channel = createAutoUpdateChannel();
  const watchdog: CheckWatchdog = {};
  const session: SessionFlags = { eventSeen: false };
  try {
    yield* fork(loadInitialState, watchdog, session);
    while (true) {
      const event: AutoUpdateEvent = yield* take(channel);
      if (event === (END as unknown as AutoUpdateEvent)) break;
      session.eventSeen = true;
      yield* handleAutoUpdateEvent(event, watchdog);
    }
  } finally {
    channel.close();
    yield* cancelCheckTimeout(watchdog);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function* handleDownload() {
  try {
    yield* call([autoUpdateClient, autoUpdateClient.downloadUpdate]);
  } catch (error) {
    const status = yield* selectAutoUpdateStatus.effect();
    if (status === 'downloading' || status === 'downloaded') return;
    yield* put(setUpdateError(errorMessage(error, m.autoUpdate_mutation_downloadFailed_error())));
  }
}

function* handleInstall() {
  try {
    yield* call([autoUpdateClient, autoUpdateClient.installUpdate]);
  } catch (error) {
    yield* put(setUpdateError(errorMessage(error, m.autoUpdate_mutation_installFailed_error())));
  }
}

export function* autoUpdateSaga() {
  yield* takeEvery(downloadUpdate, handleDownload);
  yield* takeEvery(installUpdate, handleInstall);
  yield* take(initAutoUpdate);
  yield* call(runAutoUpdateSession);
}
