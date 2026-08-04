/**
 * Voice-key controller: one module-level recording session shared by the
 * registry's `push-to-talk` action. Raw keydown/keyup pairs feed the
 * {@link VoiceGestureDecoder} (press & hold = PTT, tap = latch, double
 * press = send, double press & hold = PTT + send); recording starts on the
 * FIRST keydown of every gesture so no speech is lost during
 * disambiguation. `pttRecordingStarted` drives the HUD "Listening…"
 * indicator and the LED recording state; a resolved gesture dispatches
 * `pttRecordingFinished` with the captured audio plus `(stopReason,
 * autoSend)` — the seam the transcription flow (separate task) consumes.
 * Audio shorter than {@link PTT_MIN_RECORDING_MS} is discarded without a
 * finished seam, but a requested send still fires (`pttSendRequested`, the
 * composer-send seam — this side never reaches into the composer). One
 * session at a time: a second start while one is live is a no-op, and
 * duplicate key pairs collapse via a pressed-key count (the Codex Micro's
 * factory Mic keycap presses ACT10 + ACT11 together).
 *
 * The session API (`startPttRecording` / `stopPttRecording` /
 * `cancelPttRecording`) is trigger-agnostic — no coupling to hardware key
 * events — so other surfaces (e.g. a composer mic button) can reuse it.
 *
 * Dependency-light per src/store/renderer/AGENTS.md middleware
 * conventions: imports slice actions but no selectors and no store
 * instance — dispatch arrives via the action context.
 */

import { m } from '$shared/paraglide/messages.js';
import {
  pttRecordingFinished,
  pttRecordingStarted,
  pttRecordingStopped,
  pttSendRequested,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { VoiceGestureDecoder, type VoiceGestureStopReason } from './gesture-decoder';
import { clearPromptDictationTarget } from './prompt-dictation-target';
import { VoiceRecorder, type VoiceRecordingResult } from './voice-recorder';

/** Captured audio shorter than this is discarded without transcription. */
export const PTT_MIN_RECORDING_MS = 300;

/**
 * Why a recording ended: a resolved gesture, the max-duration cap
 * (`auto-stop`), or a non-gesture surface's stop (`manual`).
 */
export type PttStopReason = VoiceGestureStopReason | 'auto-stop' | 'manual';

/** How a recording ended and whether the gesture requested an auto-send. */
export interface PttOutcome {
  stopReason: PttStopReason;
  autoSend: boolean;
}

/** `pttRecordingFinished` payload: the captured audio plus its outcome. */
export interface PttRecordingFinishedPayload extends VoiceRecordingResult, PttOutcome {}

/** The narrow slice of the action context the controller needs. */
export interface PttContext {
  dispatch: (action: unknown) => unknown;
  /** Show a subtle toast hint (same surface as the unavailable-action hint). */
  showHint: (message: string) => void;
}

/** getUserMedia rejection kinds that mean "the user/OS denied mic access". */
function isPermissionDeniedError(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === 'NotAllowedError' || name === 'SecurityError';
}

const MANUAL_STOP: PttOutcome = { stopReason: 'manual', autoSend: false };

let activeRecorder: VoiceRecorder | null = null;
/** Outcome of the gesture/stop that requested the in-flight recorder.stop(). */
let pendingOutcome: PttOutcome | null = null;
/** Physically-down voice keys (collapses the Codex Micro's linked pair). */
let pressedKeyCount = 0;
/** Context of the latest key event, for decoder timer callbacks. */
let lastContext: PttContext | null = null;

const decoder = new VoiceGestureDecoder({
  onRecordStart: () => {
    if (lastContext) startPttRecording(lastContext);
  },
  onRecordStop: (outcome) => {
    stopSession(lastContext, outcome);
  },
});

/** Whether a voice recording session is live (starting or recording). */
export function isPttRecordingActive(): boolean {
  return activeRecorder !== null;
}

/**
 * Opaque identity token of the live recording session (`null` when idle).
 * A trigger that starts a session can hold onto the token to later tell
 * "my session is still live" apart from "a different trigger's session is
 * live" — every session gets a fresh token, so a stale one never matches.
 */
export function getActivePttSessionToken(): object | null {
  return activeRecorder;
}

/** Discard any live session and gesture without dispatching (test isolation). */
export function resetPttRecording(): void {
  activeRecorder?.cancel();
  activeRecorder = null;
  pendingOutcome = null;
  pressedKeyCount = 0;
  lastContext = null;
  decoder.reset();
}

/** Voice-key keydown: feed the gesture decoder (duplicate keys collapse). */
export function handleVoiceKeyDown(context: PttContext): void {
  lastContext = context;
  pressedKeyCount += 1;
  if (pressedKeyCount === 1) decoder.keyDown();
}

/** Voice-key keyup: feed the gesture decoder (duplicate keys collapse). */
export function handleVoiceKeyUp(context: PttContext): void {
  lastContext = context;
  if (pressedKeyCount === 0) return;
  pressedKeyCount -= 1;
  if (pressedKeyCount === 0) decoder.keyUp();
}

/** Start a recording session (no-op while one is live). */
export function startPttRecording(context: PttContext): void {
  if (activeRecorder !== null) return;
  // A prompt dictation target only applies to the recording it was
  // registered for (at that session's stop). One left dangling — the
  // stopped audio was discarded as too short, so no transcription consumed
  // it — must never route a LATER session's transcript into the prompt.
  clearPromptDictationTarget();
  const recorder = new VoiceRecorder({
    onFinished: (result) => {
      if (activeRecorder === recorder) activeRecorder = null;
      const outcome = pendingOutcome ?? { stopReason: 'auto-stop' as const, autoSend: false };
      const gestureInitiated = pendingOutcome !== null;
      pendingOutcome = null;
      context.dispatch(pttRecordingStopped());
      // The max-duration cap ends the session outside any gesture (e.g.
      // mid-latch): abandon the in-flight gesture so the next press starts
      // fresh. The pressed-key count still drains via real keyups.
      if (!gestureInitiated) decoder.reset();
      if (result.durationMs < PTT_MIN_RECORDING_MS) {
        if (outcome.autoSend) context.dispatch(pttSendRequested());
        return;
      }
      context.dispatch(
        pttRecordingFinished({
          ...result,
          stopReason: outcome.stopReason,
          autoSend: outcome.autoSend,
        }),
      );
    },
    onError: (error) => {
      if (activeRecorder === recorder) activeRecorder = null;
      pendingOutcome = null;
      context.dispatch(pttRecordingStopped());
      context.showHint(
        isPermissionDeniedError(error)
          ? m.hardwareConsole_ptt_micDenied_message()
          : m.hardwareConsole_ptt_recordingFailed_message(),
      );
      // The gesture decoder is left alone: the user's gesture still
      // resolves, and a requested send fires via the no-recorder path.
    },
  });
  activeRecorder = recorder;
  context.dispatch(pttRecordingStarted());
  void recorder.start().then((outcome) => {
    if (outcome === 'recording') return;
    if (activeRecorder === recorder) activeRecorder = null;
    // 'error' already dispatched stopped via onError; a discarded session
    // (stop/cancel won the race against mic acquisition) settles here —
    // nothing was captured (< min duration), but a requested send fires.
    if (outcome === 'discarded') {
      const send = pendingOutcome?.autoSend === true;
      pendingOutcome = null;
      context.dispatch(pttRecordingStopped());
      if (send) context.dispatch(pttSendRequested());
    }
  });
}

/** Stop the live session with an outcome; audio arrives via `onFinished`. */
function stopSession(context: PttContext | null, outcome: PttOutcome): void {
  const recorder = activeRecorder;
  if (recorder === null) {
    // No live capture (start failed or session already ended): the send
    // half of the gesture is still honored — "send the composer as-is".
    if (outcome.autoSend) context?.dispatch(pttSendRequested());
    return;
  }
  pendingOutcome = outcome;
  recorder.stop();
}

/** Finish the live session without a gesture (non-hardware surfaces). */
export function stopPttRecording(): void {
  stopSession(null, MANUAL_STOP);
}

/** Device disconnect/teardown: discard the session and any gesture. */
export function cancelPttRecording(context: PttContext): void {
  decoder.reset();
  pressedKeyCount = 0;
  pendingOutcome = null;
  const recorder = activeRecorder;
  if (recorder === null) return;
  activeRecorder = null;
  recorder.cancel();
  context.dispatch(pttRecordingStopped());
}
