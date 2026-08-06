/**
 * Voice transcription flow for the hardware console push-to-talk feature.
 *
 * Consumes the `pttRecordingFinished` seam (dispatched by the PTT controller
 * when a hold-to-record session stops with captured audio), calls the
 * daemon's `voice.transcribe` (PROTOCOL §5.41) through the AppClient seam,
 * and inserts the transcript at the caret of the target agent's chat
 * composer with dictation join semantics (see transcript-insertion.ts) —
 * insert-for-review by default; the double-press gestures pass
 * `autoSend: true` via {@link runTranscriptionFlow} to trigger the
 * composer's send after insertion (same path as pressing Enter).
 * `runTranscriptionFlow` is the trigger-agnostic entry point — a second
 * trigger (e.g. the composer mic latch button) calls it directly with a
 * finished recording, no hardware key events involved.
 *
 * While the RPC is in flight the bottom-center action HUD shows a
 * "Transcribing…" label (re-shown on an interval shorter than the HUD's
 * inactivity timeout so it stays visible for long transcriptions). Errors
 * surface as toasts: the daemon's no-API-key `-32603` becomes a hint pointing
 * at Settings (the daemon message names the provider), any other failure an
 * error toast.
 *
 * The request carries lightweight dynamic context (workspace title, branch,
 * visible agent names) as `context.keyterms` + `context.prompt`, gathered
 * off `appStore.state` only — no extra RPCs — plus the active workspace id
 * (`workspaceId`, §5.41 v5.1) so the daemon injects the workspace's
 * auto-derived vocabulary server-side; the OS-engine route fetches the same
 * terms via the cached workspace-vocabulary-service for parity.
 * Dependency-light middleware module per src/store/renderer/AGENTS.md: no
 * selector imports; the toast lib is imported lazily.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { appClient } from '$lib/client';
import type { VoiceTranscribeContext } from '$lib/client';
import {
  OsTranscriptionError,
  transcribeWithOs,
} from '$features/voice/os-transcription-service';
import { getWorkspaceVocabularyTerms } from '$features/voice/workspace-vocabulary-service';
import {
  resolveEffectiveVoiceEngine,
  type EffectiveVoiceEngineInputs,
} from '$features/voice/effective-voice-engine';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { getItem, type Collection } from '$lib/store-shim/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import {
  actionHudHidden,
  actionHudShown,
  pttRecordingFinished,
  pttSendRequested,
  voiceTranscriptionFinished,
  voiceTranscriptionStarted,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import type { PttRecordingFinishedPayload } from './ptt-controller';
import type { VoiceRecordingResult } from './voice-recorder';
import { voiceSettingsToastAction } from './voice-setup-toast';
import { focusAgentComposer } from '../actions/action-key-service';
import {
  consumePromptDictationTarget,
  type PromptDictationTarget,
} from './prompt-dictation-target';
import {
  beginTranscriptionSession,
  endTranscriptionSession,
  isTranscriptionSessionCurrent,
} from './transcription-cancellation';
import {
  insertTranscriptText,
  isFocusInsideDialog,
  sendFocusedComposer,
} from './transcript-insertion';

const logger = createLogger('HardwareConsoleVoiceTranscription');

/** Re-show cadence for the in-flight HUD label (< ACTION_HUD_HIDE_MS). */
export const TRANSCRIBING_HUD_REFRESH_MS = 800;

/**
 * Insertion retry delays after a successful transcription: the composer
 * focus dispatched via `focusAgentComposer` lands at 150/600ms, so the
 * insertion attempts trail each focus dispatch (immediate attempt first for
 * an already-focused composer).
 */
export const TRANSCRIPT_INSERT_DELAYS_MS = [250, 800] as const;

/** Shared id: transcription toasts replace one another instead of stacking. */
const TRANSCRIPTION_TOAST_ID = 'hardware-console-voice-transcription';

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

/** The narrow slice of the app store state the context gathering reads. */
interface VoiceContextState {
  workspace: {
    activeWorkspaceId: string | null;
    workspaces: Collection<Workspace, 'id'>;
  };
  workspaceAgents: {
    byWorkspaceId: Record<
      string,
      { foregroundAgentIds: readonly string[]; activeAgentId: string | null }
    >;
  };
  agentSessions: { byAgentId: Record<string, { name?: string }> };
}

function activeWorkspaceId(state: VoiceContextState): string | null {
  const wsId = state.workspace.activeWorkspaceId;
  if (typeof wsId !== 'string' || wsId.length === 0 || wsId === CHIEF_WORKSPACE_ID) return null;
  return wsId;
}

/** The insertion target: the active workspace's active agent, if any. */
export function resolveTargetAgentId(state: VoiceContextState): string | null {
  const wsId = activeWorkspaceId(state);
  if (wsId === null) return null;
  return state.workspaceAgents.byWorkspaceId[wsId]?.activeAgentId ?? null;
}

/**
 * Compose the request's domain-vocabulary context from store state only:
 * the active workspace's title and branch plus its visible (foreground)
 * agent names as keyterms, and a one-line prompt naming the workspace and
 * branch. Returns `undefined` when there is nothing to send (no active
 * workspace) so the request omits `context` per the documented shape.
 */
export function gatherTranscriptionContext(
  state: VoiceContextState,
): VoiceTranscribeContext | undefined {
  const wsId = activeWorkspaceId(state);
  if (wsId === null) return undefined;
  const workspace = getItem(state.workspace.workspaces, wsId as Workspace['id']);
  const keyterms: string[] = [];
  const seen = new Set<string>();
  const push = (term: string | undefined) => {
    const trimmed = term?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    keyterms.push(trimmed);
  };
  push(workspace?.title);
  push(workspace?.branch);
  for (const agentId of state.workspaceAgents.byWorkspaceId[wsId]?.foregroundAgentIds ?? []) {
    push(state.agentSessions.byAgentId[agentId]?.name);
  }
  if (keyterms.length === 0) return undefined;
  const context: VoiceTranscribeContext = { keyterms };
  if (workspace?.title && workspace?.branch) {
    // Wire content forwarded to the transcription provider, not UI copy.
    // i18n-ignore (provider prompt sent over the wire)
    context.prompt = `Dictation in the "${workspace.title}" workspace on branch ${workspace.branch}.`;
  }
  return context;
}

export interface TranscriptionDeps {
  /** Transcribe a finished recording. Defaults to the engine-routing seam
   * (`transcribeWithSelectedEngine`: daemon `voice.transcribe` or the local
   * OS engine per the voiceSettings engine selection). */
  transcribe?: (
    audio: Blob,
    mimeType: string,
    context?: VoiceTranscribeContext,
    workspaceId?: string,
  ) => Promise<{ text: string }>;
  /** Focus an agent tab's chat composer. Defaults to `focusAgentComposer`. */
  focusComposer?: (agentId: string) => void;
  /** Insert text at the focused editable's caret (dictation join semantics). Defaults to `insertTranscriptText`. */
  insertText?: (text: string) => boolean;
  /** Trigger the focused composer's send (Enter path). Defaults to `sendFocusedComposer`. */
  sendComposer?: () => boolean;
  /** Dispatch into the app store. Defaults to `appStore.dispatch`. */
  dispatch?: (action: unknown) => void;
}

/** Per-run flow options (gesture-decided, orthogonal to the injected deps). */
export interface TranscriptionFlowOptions {
  /** Trigger the composer's send after insertion (double-press gestures). */
  autoSend?: boolean;
}

/**
 * Merge the daemon-persisted `voice.vocabulary` terms, the auto-derived
 * workspace vocabulary, and the dynamic context keyterms — in that fixed
 * order (user vocabulary → workspace terms → keyterms, mirroring the
 * daemon's §5.41 injection order) — deduplicated case-insensitively (first
 * spelling wins): the OS engine's counterpart of the daemon's server-side
 * vocabulary biasing on the cloud path.
 */
export function mergeOsContextualStrings(
  vocabulary: readonly string[] | null | undefined,
  workspaceTerms: readonly string[] | null | undefined,
  keyterms: readonly string[] | undefined,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const term of [...(vocabulary ?? []), ...(workspaceTerms ?? []), ...(keyterms ?? [])]) {
    const trimmed = term?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged;
}

/**
 * Default transcribe seam: routes by the EFFECTIVE engine (the voiceSettings
 * selection resolved against configuration reality — see
 * $features/voice/effective-voice-engine), so a daemon selection with a
 * missing provider key gracefully falls back to the local OS engine when it
 * is available. `os` runs the local macOS Speech.framework helper over IPC
 * with the hydrated `voice.vocabulary` terms, the workspace's auto-derived
 * vocabulary (`voice.getWorkspaceVocabulary`, cached/coalesced by
 * workspace-vocabulary-service; a failed fetch degrades to no terms), and
 * the context keyterms as contextual strings; `daemon` calls the cloud
 * `voice.transcribe` with the `workspaceId` so the daemon injects the same
 * workspace vocabulary server-side (§5.41 v5.1). `unavailable` still goes
 * to the daemon — the triggers gate that case up front, and the daemon's
 * no-key error toast covers any race. State is read at call time so a
 * settings change applies to the next dictation without re-wiring the
 * middleware.
 */
async function transcribeWithSelectedEngine(
  audio: Blob,
  mimeType: string,
  context?: VoiceTranscribeContext,
  workspaceId?: string,
): Promise<{ text: string }> {
  const voiceSettings = (
    appStore.state as {
      voiceSettings?: EffectiveVoiceEngineInputs & {
        vocabulary?: string[] | null;
        language?: string | null;
      };
    }
  ).voiceSettings;
  if (voiceSettings && resolveEffectiveVoiceEngine(voiceSettings) === 'os') {
    // The hydrated `voice.language` setting is the OS-engine counterpart of
    // the daemon's server-side language resolution (§5.41): non-blank ⇒ the
    // recognizer locale; blank/null ⇒ system locale.
    const language = voiceSettings.language;
    // OS-engine parity with the daemon's workspace-vocabulary injection:
    // resilient by construction (the service resolves [] on failure).
    const workspaceTerms = workspaceId ? await getWorkspaceVocabularyTerms(workspaceId) : [];
    return transcribeWithOs(
      audio,
      mergeOsContextualStrings(voiceSettings.vocabulary, workspaceTerms, context?.keyterms),
      typeof language === 'string' && language.trim().length > 0 ? language.trim() : undefined,
    );
  }
  return appClient.voice.transcribe(audio, mimeType, context, workspaceId);
}

/**
 * Matches the daemon's no-API-key failure (intent-voice registry). Daemons on
 * PROTOCOL §5.41 v4.4+ carry a structured `error.data.code`
 * (`voice-no-api-key`, intent-hq/monorepo#1448), matched first; the
 * descriptive-message sniff is kept only as a fallback for older daemons
 * whose `error.data` is the plain string.
 */
function isNoApiKeyError(error: unknown): boolean {
  const data = (error as { data?: unknown })?.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === 'voice-no-api-key'
  ) {
    return true;
  }
  const parts: unknown[] = [(error as { message?: unknown })?.message, data];
  return parts.some((part) => typeof part === 'string' && /no API key/i.test(part));
}

function errorDetail(error: unknown): string | undefined {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === 'object' && data !== null) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) return detail;
  }
  if (typeof data === 'string' && data.trim().length > 0) return data;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : undefined;
}

/**
 * Insert the transcript into the target agent's composer: focus the
 * composer (the existing `panel:focus-content` seam, dispatched at
 * 150/600ms) and attempt the insertion after each focus dispatch has had
 * time to land — never before, so the text cannot land in whatever
 * unrelated editable happens to hold focus. Without a target agent the
 * insertion goes straight into the currently focused editable (the radial
 * prompt picker semantics). Resolves `true` when some attempt inserted.
 */
export function insertTranscript(
  text: string,
  targetAgentId: string | null,
  deps: TranscriptionDeps = {},
): Promise<boolean> {
  const focusComposer = deps.focusComposer ?? focusAgentComposer;
  const insertText = deps.insertText ?? ((value: string) => insertTranscriptText(value));
  if (targetAgentId === null) return Promise.resolve(insertText(text));
  focusComposer(targetAgentId);
  return new Promise((resolve) => {
    let remaining = TRANSCRIPT_INSERT_DELAYS_MS.length;
    let done = false;
    for (const delay of TRANSCRIPT_INSERT_DELAYS_MS) {
      setTimeout(() => {
        if (done) return;
        if (insertText(text)) {
          done = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(false);
      }, delay);
    }
  });
}

/**
 * Trigger the target composer's send: focus it (same retry cadence as the
 * insertion) and dispatch the synthetic Enter once focus has had time to
 * land. Without a target agent the send goes to the currently focused
 * editable. Resolves `true` when some attempt reached a focused editable.
 */
export function triggerComposerSend(
  targetAgentId: string | null,
  deps: TranscriptionDeps = {},
): Promise<boolean> {
  const focusComposer = deps.focusComposer ?? focusAgentComposer;
  const send = deps.sendComposer ?? (() => sendFocusedComposer());
  if (targetAgentId === null) return Promise.resolve(send());
  focusComposer(targetAgentId);
  return new Promise((resolve) => {
    let remaining = TRANSCRIPT_INSERT_DELAYS_MS.length;
    let done = false;
    for (const delay of TRANSCRIPT_INSERT_DELAYS_MS) {
      setTimeout(() => {
        if (done) return;
        if (send()) {
          done = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(false);
      }, delay);
    }
  });
}

/**
 * Insert the transcript into a prompt surface's editor (the one-shot
 * prompt dictation target): focus it, then attempt the focused-editable
 * caret insertion on the same retry cadence as the composer path (an
 * immediate attempt would race the focus landing). Resolves `true` when
 * some attempt inserted.
 */
export function insertTranscriptIntoPrompt(
  text: string,
  target: PromptDictationTarget,
  deps: TranscriptionDeps = {},
): Promise<boolean> {
  const insertText = deps.insertText ?? ((value: string) => insertTranscriptText(value));
  target.focus();
  return new Promise((resolve) => {
    let remaining = TRANSCRIPT_INSERT_DELAYS_MS.length;
    let done = false;
    for (const delay of TRANSCRIPT_INSERT_DELAYS_MS) {
      setTimeout(() => {
        if (done) return;
        target.focus();
        if (insertText(text)) {
          done = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(false);
      }, delay);
    }
  });
}

/**
 * Handle one finished recording end-to-end: show the "Transcribing…" HUD,
 * call `voice.transcribe` with the gathered context, insert the transcript
 * into the composer captured as the target at recording-finish time, and
 * surface failures as toasts. With `autoSend` the composer's send is
 * triggered after a successful insertion (the composer is focused at that
 * point, so the send lands there); an empty transcript with `autoSend`
 * still sends the composer's current content. Exported for tests.
 *
 * A registered prompt dictation target (a workspace-creation prompt started
 * this dictation) is consumed up front — synchronously, before any await —
 * and overrides the agent-composer routing: the transcript lands in that
 * prompt's editor instead, and `autoSend` never fires (creating a workspace
 * is an explicit act).
 *
 * Without a prompt target, focus inside a modal dialog overlay
 * (`[role="dialog"]`, e.g. the New Space modal) — captured synchronously at
 * recording-finish time — also bypasses the agent-composer routing: the
 * transcript is inserted at the focused editable's caret so focus is never
 * stolen from the modal, and `autoSend` is suppressed for the same reason
 * as the prompt target (intent-hq/monorepo#1461).
 *
 * The run registers itself with the cancellation seam
 * (transcription-cancellation): `cancelActiveTranscription` — the mic
 * buttons' cancel-while-transcribing affordance — settles the in-flight
 * state immediately and abandons the session, after which the resolved or
 * rejected transcribe result is discarded (never inserted, no toast).
 */
export async function handleFinishedRecording(
  recording: VoiceRecordingResult,
  deps: TranscriptionDeps = {},
  options: TranscriptionFlowOptions = {},
): Promise<void> {
  const dispatch = deps.dispatch ?? ((action: unknown) => appStore.dispatch(action as never));
  const transcribe = deps.transcribe ?? transcribeWithSelectedEngine;
  const promptTarget = consumePromptDictationTarget();
  // Captured synchronously at recording-finish time, before any await —
  // the modal is what holds focus right now, whatever happens later.
  const dialogFocused = isFocusInsideDialog();

  const state = appStore.state as unknown as VoiceContextState;
  // A focused modal keeps the insertion: null target → focused-editable
  // caret path, never `focusAgentComposer` stealing focus from the modal.
  const targetAgentId = dialogFocused ? null : resolveTargetAgentId(state);
  const context = gatherTranscriptionContext(state);
  // The active workspace (chief excluded, same rule as the context) opts the
  // call into workspace-vocabulary biasing on both engines (§5.41 v5.1).
  const workspaceId = activeWorkspaceId(state) ?? undefined;

  const hudLabel = m.hardwareConsole_voice_transcribing_label();
  dispatch(voiceTranscriptionStarted());
  dispatch(actionHudShown(hudLabel));
  // The action-key middleware hides the HUD after ~1.2s of inactivity;
  // re-dispatching the same label re-arms its timer without state churn.
  const hudRefresh = setInterval(() => dispatch(actionHudShown(hudLabel)), TRANSCRIBING_HUD_REFRESH_MS);
  // Single idempotent reset for the in-flight state, guaranteed by the
  // finally below so no exit path (helper crash, insertion throw, toast
  // import failure) can leave the "Transcribing…" HUD stuck.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearInterval(hudRefresh);
    dispatch(voiceTranscriptionFinished());
    dispatch(actionHudHidden());
  };
  // Register the run as the cancellable in-flight session: the mic
  // buttons' cancel affordance runs `settle` immediately (spinner clears,
  // a new recording can start) and abandons the session, so the checks
  // below discard the late-arriving result instead of applying it.
  const sessionToken = beginTranscriptionSession(settle);

  try {
    const result = await transcribe(recording.blob, recording.mimeType, context, workspaceId);
    if (!isTranscriptionSessionCurrent(sessionToken)) {
      logger.info('Transcription session was cancelled; discarding the late result');
      return;
    }
    settle();
    const text = result.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      logger.info('voice.transcribe returned an empty transcript; nothing to insert');
      if (options.autoSend && !promptTarget && !dialogFocused) {
        await triggerComposerSend(targetAgentId, deps);
      }
      return;
    }
    const inserted = promptTarget
      ? await insertTranscriptIntoPrompt(text, promptTarget, deps)
      : await insertTranscript(text, targetAgentId, deps);
    if (!inserted) {
      logger.warn('Transcript insertion failed: no focused composer after retries');
      const toast = await getToast();
      toast.error(m.hardwareConsole_voice_insertFailed_error(), {
        id: TRANSCRIPTION_TOAST_ID,
        description: text,
      });
      return;
    }
    // The successful insertion leaves the composer focused, so the send
    // lands on it directly — no focus retry cadence needed. A focused modal
    // suppresses the send like the prompt target: a synthetic Enter must
    // not submit the modal form.
    if (options.autoSend && !promptTarget && !dialogFocused) {
      const send = deps.sendComposer ?? (() => sendFocusedComposer());
      send();
    }
  } catch (error) {
    if (!isTranscriptionSessionCurrent(sessionToken)) {
      logger.info('Transcription session was cancelled; discarding the late failure', { error });
      return;
    }
    settle();
    logger.error('voice.transcribe failed', { error });
    const toast = await getToast();
    if (error instanceof OsTranscriptionError && error.code === 'authorization-denied') {
      // Actionable: the Settings Voice section explains the System Settings
      // grant and offers the engine/key alternatives.
      toast.error(m.hardwareConsole_voice_osAuthDenied_error(), {
        id: TRANSCRIPTION_TOAST_ID,
        description: errorDetail(error),
        action: voiceSettingsToastAction(),
      });
    } else if (
      error instanceof OsTranscriptionError &&
      (error.code === 'helper-missing' || error.code === 'unsupported-platform')
    ) {
      // The user's explicit OS-engine choice is honored — never a silent
      // fallback to the cloud path — so an unavailable engine fails clearly.
      toast.error(m.hardwareConsole_voice_osUnavailable_error(), {
        id: TRANSCRIPTION_TOAST_ID,
        description: errorDetail(error),
        action: voiceSettingsToastAction(),
      });
    } else if (isNoApiKeyError(error)) {
      toast.error(m.hardwareConsole_voice_noKey_error(), {
        id: TRANSCRIPTION_TOAST_ID,
        description: errorDetail(error),
      });
    } else {
      toast.error(m.hardwareConsole_voice_transcribeFailed_error(), {
        id: TRANSCRIPTION_TOAST_ID,
        description: errorDetail(error),
      });
    }
  } finally {
    endTranscriptionSession(sessionToken);
    settle();
  }
}

/**
 * Trigger-agnostic entry point for a finished dictation: any trigger
 * (hardware gesture decoder, composer mic latch button) calls this with the
 * captured recording and the gesture-decided options. `recording: null` is
 * the degenerate case — nothing was captured (or the audio was discarded as
 * too short) but the gesture still asked to send, so the composer's current
 * content is sent as-is. Focus inside a modal dialog overlay suppresses
 * that send entirely — same rule as `handleFinishedRecording`: no composer
 * focus steal, no synthetic Enter into the modal form
 * (intent-hq/monorepo#1461).
 */
export async function runTranscriptionFlow(
  recording: VoiceRecordingResult | null,
  options: TranscriptionFlowOptions = {},
  deps: TranscriptionDeps = {},
): Promise<void> {
  if (recording === null) {
    if (!options.autoSend || isFocusInsideDialog()) return;
    const state = appStore.state as unknown as VoiceContextState;
    await triggerComposerSend(resolveTargetAgentId(state), deps);
    return;
  }
  await handleFinishedRecording(recording, deps, options);
}

/**
 * Middleware: run the transcription flow for every `pttRecordingFinished`
 * dispatch (fire-and-forget — the flow settles via HUD/toasts/insertion).
 * The payload's `autoSend` flag (send gestures) carries through to the
 * flow; `pttSendRequested` (send gesture without transcribable audio)
 * sends the target composer's current content as-is, no transcription.
 */
export function createVoiceTranscriptionMiddleware(deps: TranscriptionDeps = {}): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === pttRecordingFinished.type) {
      const [recording] = (action as { payload: [PttRecordingFinishedPayload] }).payload;
      void runTranscriptionFlow(recording, { autoSend: recording.autoSend === true }, deps);
    } else if (action && action.type === pttSendRequested.type) {
      void runTranscriptionFlow(null, { autoSend: true }, deps);
    }
    return result;
  };
}
