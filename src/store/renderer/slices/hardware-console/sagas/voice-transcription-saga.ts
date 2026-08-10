import { all, call, cancelled, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  runTranscriptionFlow,
  type TranscriptionDeps,
} from '$features/hardware-console/voice/transcription-service';
import { cancelActiveTranscription } from '$features/hardware-console/voice/transcription-cancellation';
import { pttRecordingFinished, pttSendRequested } from '../hardware-console-slice';

export function* transcribeFinishedRecording(
  deps: TranscriptionDeps,
  action: ReturnType<typeof pttRecordingFinished>,
): SagaGenerator<void> {
  const [recording] = action.payload;
  try {
    yield* call(runTranscriptionFlow, recording, { autoSend: recording.autoSend === true }, deps);
  } finally {
    if (yield* cancelled()) yield* call(cancelActiveTranscription);
  }
}

export function* sendComposerWithoutRecording(deps: TranscriptionDeps): SagaGenerator<void> {
  yield* call(runTranscriptionFlow, null, { autoSend: true }, deps);
}

export function* voiceTranscriptionSaga(deps: TranscriptionDeps = {}): SagaGenerator<void> {
  yield* all([
    takeEvery(pttRecordingFinished, transcribeFinishedRecording, deps),
    takeEvery(pttSendRequested, sendComposerWithoutRecording, deps),
  ]);
}
