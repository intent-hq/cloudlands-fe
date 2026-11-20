import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { installInAppFileInputs, prefersInAppFilePicker } from '$lib/in-app-file-inputs';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { InAppFileDialogRequest, InAppFileDialogResponse } from '$shared/in-app-file-dialog';
import { createLogger } from '$lib/utils/client-logger';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { inAppFileDialogAnswered, inAppFileDialogRequested } from '../in-app-file-dialog-slice';

const logger = createLogger('InAppFileDialogSaga');

function* recordRequest(request: InAppFileDialogRequest): SagaGenerator<void> {
  if (request?.id) yield* put(inAppFileDialogRequested(request));
}

function* sendAnswer(action: ReturnType<typeof inAppFileDialogAnswered>): SagaGenerator<void> {
  const [id, paths] = action.payload;
  // Copy into a plain array: a reactive proxy cannot be cloned over IPC.
  const response: InAppFileDialogResponse = {
    id,
    paths: paths && paths.length ? Array.from(paths, String) : null,
  };
  try {
    yield* call(
      [window.electronAPI, window.electronAPI.invoke],
      IPC_CHANNELS.IN_APP_FILE_DIALOG.RESPOND,
      response,
    );
  } catch (error) {
    logger.warn('could not answer the in-app file dialog', {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Only runs when the session prefers the in-app picker: listens for main's
 * chooser requests, answers them, and swaps `<input type=file>` choosers for
 * the in-app picker in this renderer.
 */
export function* inAppFileDialogSaga(): SagaGenerator<void> {
  if (typeof window === 'undefined' || !prefersInAppFilePicker(window)) return;
  const disposeInputs = installInAppFileInputs(window);
  try {
    yield* takeEvery(inAppFileDialogAnswered, sendAnswer);
    yield* takeEveryFromElectronChannel<InAppFileDialogRequest>(
      IPC_CHANNELS.IN_APP_FILE_DIALOG.REQUEST,
      recordRequest,
      {
        bufferPolicy: {
          kind: 'lossless',
          rationale: 'Each request is a user waiting on a chooser; dropping one hangs it.',
        },
      },
    );
    // Tell main this renderer can show the picker (main never sends a request
    // to a page that has not announced itself, e.g. a website popup).
    try {
      yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        IPC_CHANNELS.IN_APP_FILE_DIALOG.HOST_READY,
        {},
      );
    } catch (error) {
      logger.warn('could not register as the in-app file dialog host', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    yield* call(() => new Promise<never>(() => {}));
  } finally {
    if (yield* cancelled()) disposeInputs();
  }
}
