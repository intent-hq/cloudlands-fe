import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { installInAppFileInputs, prefersInAppFilePicker } from '$lib/in-app-file-inputs';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { InAppFileDialogRequest, InAppFileDialogResponse } from '$shared/in-app-file-dialog';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { inAppFileDialogAnswered, inAppFileDialogRequested } from '../in-app-file-dialog-slice';

function* recordRequest(request: InAppFileDialogRequest): SagaGenerator<void> {
  if (request?.id) yield* put(inAppFileDialogRequested(request));
}

function* sendAnswer(action: ReturnType<typeof inAppFileDialogAnswered>): SagaGenerator<void> {
  const [id, paths] = action.payload;
  const response: InAppFileDialogResponse = { id, paths: paths && paths.length ? paths : null };
  try {
    yield* call(
      [window.electronAPI, window.electronAPI.invoke],
      IPC_CHANNELS.IN_APP_FILE_DIALOG.RESPOND,
      response,
    );
  } catch {
    // Main resolves the dialog as cancelled when this renderer goes away.
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
    yield* call(() => new Promise<never>(() => {}));
  } finally {
    if (yield* cancelled()) disposeInputs();
  }
}
