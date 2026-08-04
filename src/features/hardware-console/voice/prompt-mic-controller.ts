/**
 * Prompt mic latch controller: click-to-latch dictation for the
 * workspace-creation prompt surfaces (CompactWorkspaceInitializer in the
 * New Space modal and on the home page), built on the same trigger-agnostic
 * PTT session API as the chat composer's mic button
 * (composer-mic-controller) — no recording or transcription logic is
 * duplicated here.
 *
 * The one difference from the composer latch: on stop, the prompt's editor
 * is registered as the one-shot dictation insertion target
 * (prompt-dictation-target), so the transcription flow routes the
 * transcript into THIS prompt instead of the active agent's chat composer.
 *
 * Ownership mirrors the composer controller: the session token
 * (`getActivePttSessionToken`) of the session THIS surface started is
 * remembered, so a live hardware-PTT or composer-mic session renders the
 * prompt button idle and a click hints instead of hijacking it.
 *
 * Esc cancels (discards the audio, no transcription) and drops any
 * registered target.
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
import {
  clearPromptDictationTarget,
  setPromptDictationTarget,
  type PromptDictationTarget,
} from './prompt-dictation-target';

/** What a prompt mic-button click did. */
export type PromptMicToggleResult = 'started' | 'stopped' | 'blocked';

/** Token of the session the prompt mic button started (else `null`). */
let ownedSession: object | null = null;

/** Forget ownership and any registered target (test isolation). */
export function resetPromptMic(): void {
  ownedSession = null;
  clearPromptDictationTarget();
}

/**
 * Whether the live recording session (if any) is the prompt mic's own.
 * False while another trigger's session (hardware voice key, chat composer
 * mic) is live — the button renders idle then, and a click hints instead
 * of hijacking that session.
 */
export function isPromptMicRecording(): boolean {
  const active = getActivePttSessionToken();
  if (active === null) {
    ownedSession = null;
    return false;
  }
  return active === ownedSession;
}

/**
 * Prompt mic button click: latch toggle.
 * - Idle → start a recording session and take ownership (`started`).
 * - Own session live → register `target` as the dictation insertion target
 *   and stop; the captured audio flows into the transcription middleware
 *   via `pttRecordingFinished`, which consumes the target (`stopped`).
 * - Another trigger's session live → no-op with a hint (`blocked`).
 * - Recording unsupported on this system → no-op with a hint (`blocked`).
 */
export function togglePromptMicRecording(
  context: PttContext,
  target: PromptDictationTarget,
): PromptMicToggleResult {
  const active = getActivePttSessionToken();
  if (active !== null) {
    if (active === ownedSession) {
      ownedSession = null;
      setPromptDictationTarget(target);
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
 * Esc while the prompt mic's own session is live: discard the audio without
 * transcription and drop any registered target. Returns whether a session
 * was cancelled (callers consume the key event only then). Sessions owned
 * by other triggers are left alone.
 */
export function cancelPromptMicRecording(context: PttContext): boolean {
  if (!isPromptMicRecording()) return false;
  ownedSession = null;
  clearPromptDictationTarget();
  cancelPttRecording(context);
  return true;
}
