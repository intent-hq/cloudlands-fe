import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, take, takeEvery } from 'typed-redux-saga';

import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import type { UpdateProgress, UpdateState } from '$features/auto-update/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectAutoUpdateStatus } from '../auto-update-selectors';
import {
  downloadUpdate,
  initAutoUpdate,
  installUpdate,
  setProgress,
  setUpToDate,
  setUpdateError,
  setUpdateState,
  showToast,
  showToastChecking,
} from '../auto-update-slice';

const logger = createLogger('AutoUpdateSaga');

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

function* loadInitialState() {
  try {
    const state: UpdateState = yield* call([autoUpdateClient, autoUpdateClient.getState]);
    yield* put(setUpdateState(mapUpdateState(state)));
  } catch (error) {
    logger.error('Failed to initialize auto-update', error);
  }
}

function* handleAutoUpdateEvent(event: AutoUpdateEvent) {
  switch (event.kind) {
    case 'show-toast':
      yield* put(showToastChecking());
      break;
    case 'up-to-date':
      yield* put(setUpToDate(event.version));
      yield* put(showToast());
      break;
    case 'status':
      yield* put(setUpdateState(mapUpdateState(event.state)));
      break;
    case 'progress':
      yield* put(setProgress(mapProgress(event.progress)));
      break;
    case 'error':
      yield* put(setUpdateError(event.error));
      break;
  }
}

function* runAutoUpdateSession() {
  const channel = createAutoUpdateChannel();
  try {
    yield* fork(loadInitialState);
    while (true) {
      const event: AutoUpdateEvent = yield* take(channel);
      if (event === (END as unknown as AutoUpdateEvent)) break;
      yield* call(handleAutoUpdateEvent, event);
    }
  } finally {
    channel.close();
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
