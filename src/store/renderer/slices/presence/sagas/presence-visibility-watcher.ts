/**
 * Presence window-visibility watchers.
 *
 * Presence publishes the document's visibility, except the visibility an
 * agent capture causes: a capture keeps a minimized or covered app window
 * drawing, which makes the document briefly visible. Main brackets each
 * such capture with `browser:capture-drawing`; `watchCaptureDrawing` (for
 * the whole session) mirrors the bracket into the presence store, where it
 * survives presence resets, and `watchPresenceVisibility` (per admitted
 * connection) gates document visibility on it — including when it starts
 * while a capture is already in progress. The bracket exists only in
 * Electron; a bridge-less renderer (web build, tests) never captures.
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { put, race, take, takeMaybe, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronChannel } from '../../../utils/ipc-channel';
import {
  selectPresenceCaptureDrawingActive,
  selectPresenceWindowVisible,
} from '../presence-selectors';
import { presenceCaptureDrawingChanged, presenceWindowVisibilityChanged } from '../presence-slice';
import {
  applyPresenceVisibilityEvent,
  type PresenceVisibilityEvent,
  type PresenceVisibilityGate,
} from '../presence-visibility-gate';

/** `visibilitychange` is a document event, so the window-event helper does not apply. */
function createVisibilityChannel(): EventChannel<boolean> {
  return eventChannel<boolean>((emit) => {
    if (typeof document === 'undefined') {
      emit(END as never);
      return () => {};
    }
    const handler = () => emit(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, buffers.sliding<boolean>(1));
}

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Mirror main's capture bracket into the presence store for the whole session. */
export function* watchCaptureDrawing(): SagaGenerator<void> {
  if (typeof window === 'undefined' || !window.electronAPI) return;
  const captures = createElectronChannel<{ active?: unknown }>(
    IPC_CHANNELS.BROWSER.CAPTURE_DRAWING,
    {
      bufferPolicy: {
        kind: 'lossless',
        rationale: 'Capture start and end must pair up or presence would stay frozen.',
      },
    },
  );
  try {
    while (true) {
      // takeMaybe: a closed channel yields END here instead of ending the saga.
      const capture = yield* takeMaybe(captures);
      if ((capture as unknown) === END) return;
      yield* put(presenceCaptureDrawingChanged(capture.active === true));
    }
  } finally {
    captures.close();
  }
}

export function* watchPresenceVisibility(): SagaGenerator<void> {
  const documentChannel = createVisibilityChannel();
  const captureActive = yield* selectPresenceCaptureDrawingActive.effect();
  const lastReported = yield* selectPresenceWindowVisible.effect();
  // Started mid-capture: the document's visibility is the capture's, so
  // keep the last published visibility until the capture ends.
  let gate: PresenceVisibilityGate = {
    reported: captureActive ? lastReported : documentVisible(),
    captureActive,
  };
  try {
    if (typeof document !== 'undefined' && !captureActive) {
      yield* put(presenceWindowVisibilityChanged(gate.reported));
    }
    while (true) {
      const { visible, capture } = yield* race({
        visible: takeMaybe(documentChannel),
        capture: take(presenceCaptureDrawingChanged),
      });
      if ((visible as unknown) === END) break;
      const event: PresenceVisibilityEvent =
        capture !== undefined
          ? { kind: 'capture', active: capture.payload[0], documentVisible: documentVisible() }
          : { kind: 'document', visible: visible === true };
      const next = applyPresenceVisibilityEvent(gate, event);
      gate = next.gate;
      if (next.report !== null) yield* put(presenceWindowVisibilityChanged(next.report));
    }
  } finally {
    documentChannel.close();
  }
}
