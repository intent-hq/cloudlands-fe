/**
 * Composer mic latch controller: click-to-latch dictation for the chat
 * composer's mic button, built on the trigger-agnostic PTT session API
 * (`startPttRecording` / `stopPttRecording` / `cancelPttRecording`) — no
 * recording or transcription logic is duplicated here. A stop hands the
 * captured audio to the existing `pttRecordingFinished` →
 * `voice.transcribe` → insert-at-caret flow (transcription-service).
 *
 * Ownership: the controller remembers the session token
 * (`getActivePttSessionToken`) of the session IT started. One recording at
 * a time is enforced by the session layer; this module only decides what a
 * click means — stop my session, hint that another trigger's session (the
 * hardware voice key) is live, or start a fresh one. Tokens are per-session,
 * so ownership can never go stale across auto-stop or hardware sessions.
 *
 * Esc cancels (discards the audio, no transcription) via the same
 * `cancelPttRecording` teardown the device-disconnect path uses.
 *
 * Dependency-light like the ptt-controller: no store instance, no
 * selectors — dispatch and the hint toast arrive via {@link PttContext}.
 */

import { m } from '$shared/paraglide/messages.js';
import {
  cancelPttRecording,
  getActivePttSessionToken,
  startPttRecording,
  stopPttRecording,
  type PttContext,
} from './ptt-controller';
import { isVoiceRecordingSupported } from './voice-recorder';

/** What a mic-button click did. */
export type ComposerMicToggleResult = 'started' | 'stopped' | 'blocked';

/** Token of the session the composer mic button started (else `null`). */
let ownedSession: object | null = null;

/** Forget any ownership without touching the session (test isolation). */
export function resetComposerMic(): void {
  ownedSession = null;
}

/**
 * Whether the live recording session (if any) is the composer mic's own.
 * False while the hardware voice key's session is live — the button renders
 * idle then, and a click hints instead of hijacking the hardware session.
 */
export function isComposerMicRecording(): boolean {
  const active = getActivePttSessionToken();
  if (active === null) {
    ownedSession = null;
    return false;
  }
  return active === ownedSession;
}

/**
 * Mic button click: latch toggle.
 * - Idle → start a recording session and take ownership (`started`).
 * - Own session live → stop it; the captured audio flows into the
 *   transcription middleware via `pttRecordingFinished` (`stopped`).
 * - Another trigger's session live (hardware PTT) → no-op with a hint
 *   (`blocked`) — one recording at a time.
 * - Recording unsupported on this system → no-op with a hint (`blocked`).
 */
export function toggleComposerMicRecording(context: PttContext): ComposerMicToggleResult {
  const active = getActivePttSessionToken();
  if (active !== null) {
    if (active === ownedSession) {
      ownedSession = null;
      stopPttRecording();
      return 'stopped';
    }
    context.showHint(m.chat_richInput_micBusy_message());
    return 'blocked';
  }
  if (!isVoiceRecordingSupported()) {
    context.showHint(m.hardwareConsole_ptt_unavailable_message());
    return 'blocked';
  }
  startPttRecording(context);
  ownedSession = getActivePttSessionToken();
  return ownedSession !== null ? 'started' : 'blocked';
}

/**
 * Esc while the composer mic's own session is live: discard the audio
 * without transcription. Returns whether a session was cancelled (callers
 * consume the key event only then). A hardware-owned session is left alone.
 */
export function cancelComposerMicRecording(context: PttContext): boolean {
  if (!isComposerMicRecording()) return false;
  ownedSession = null;
  cancelPttRecording(context);
  return true;
}
