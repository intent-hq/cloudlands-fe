/**
 * Presence window-visibility watcher.
 *
 * Publishes the document's visibility for presence, except the visibility
 * an agent capture causes: a capture keeps a minimized or covered app window
 * drawing, which makes the document briefly visible. Main brackets each such
 * capture with `browser:capture-drawing` (see presence-visibility-gate.ts);
 * the bracket exists only in Electron, so a bridge-less renderer (web
 * build, tests) watches document visibility alone.
 */

import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { put, race, takeMaybe, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronChannel } from '../../../utils/ipc-channel';
import { presenceWindowVisibilityChanged } from '../presence-slice';
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

type CaptureDrawing = { active?: unknown };

function createCaptureChannel(): EventChannel<CaptureDrawing> | null {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  return createElectronChannel<CaptureDrawing>(IPC_CHANNELS.BROWSER.CAPTURE_DRAWING, {
    bufferPolicy: {
      kind: 'lossless',
      rationale: 'Capture start and end must pair up or presence would stay frozen.',
    },
  });
}

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function* watchPresenceVisibility(): SagaGenerator<void> {
  const documentChannel = createVisibilityChannel();
  let captures = createCaptureChannel();
  let gate: PresenceVisibilityGate = { reported: documentVisible(), captureActive: false };
  try {
    if (typeof document !== 'undefined') yield* put(presenceWindowVisibilityChanged(gate.reported));
    while (true) {
      // takeMaybe: a closed channel yields END here instead of ending the saga.
      const { visible, capture } = captures
        ? yield* race({ visible: takeMaybe(documentChannel), capture: takeMaybe(captures) })
        : { visible: yield* takeMaybe(documentChannel), capture: undefined };
      if ((visible as unknown) === END) break;
      if ((capture as unknown) === END) {
        captures = null;
        continue;
      }
      const event: PresenceVisibilityEvent =
        capture !== undefined
          ? { kind: 'capture', active: capture.active === true, documentVisible: documentVisible() }
          : { kind: 'document', visible: visible === true };
      const next = applyPresenceVisibilityEvent(gate, event);
      gate = next.gate;
      if (next.report !== null) yield* put(presenceWindowVisibilityChanged(next.report));
    }
  } finally {
    documentChannel.close();
    captures?.close();
  }
}
