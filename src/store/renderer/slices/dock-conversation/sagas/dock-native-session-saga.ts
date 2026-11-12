/**
 * Root-owned native evidence session for the open dock pair.
 *
 * One adapter per scope (pair + live authority): initialize (probe only) →
 * install the evidence boundary → run the speech event channel, start/stop and
 * the final-transcript barrier → retire and cancel when the scope changes.
 * Components and the composer controller only dispatch requests and read the
 * serializable `nativeSpeech` mirror through selectors.
 */
import { buffers, eventChannel } from 'redux-saga';
import { call, delay, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { store as appStore } from '$store/renderer/store';
import type { DockEvidencePrivacyPane } from '$shared/dock-evidence-ipc';
import { createDockEvidenceNative } from '$features/hud/composer/dock-evidence-native';
import {
  showDockEvidenceNotice,
  speechStartNotice,
} from '$features/hud/composer/dock-evidence-notice';
import {
  createDockSpeechTranscript,
  type DockSpeechEndReason,
  type DockSpeechEvent,
} from '$shared/dock-speech';
import { dockEvidenceId, recordingDockClip } from '$shared/dock-evidence';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  DOCK_NOTE_MAX,
  type DockCaptureEditorNoteDictationRequested,
  type DockCaptureEditorNoteDictationText,
} from '$shared/dock-capture-editor';
import type { DockInsertionPart } from '$shared/dock-evidence';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { getPrincipalActionContext } from '../../principal/principal-context';
import { selectDockNativeScope } from '../dock-conversation-selectors';
import {
  dockEvidenceAnnotationIssue,
  dockEvidenceDictationChanged,
  dockEvidenceDictationFinished,
  dockEvidenceDictationInterim,
  dockEvidenceInsertionQueued,
  dockEvidenceOpenSettingsRequested,
  dockNativeSpeechLevel,
  dockNativeSpeechPatched,
  dockNativeSpeechSessionChanged,
  dockNativeSpeechStopSettled,
  dockSpeechStartRequested,
  dockSpeechKeepLiveRequested,
  dockSpeechStopRequested,
  dockSpeechToggleRequested,
} from '../dock-conversation-slice';
import {
  configureDockEvidenceNative,
  evidenceOf,
  flushDockMarkAnswers,
  retireDockEvidenceNative,
  setDockDictationMarkSink,
} from './dock-evidence-saga';

type NativeAdapter = ReturnType<typeof createDockEvidenceNative>;
export type DockNativeAdapter = Pick<
  NativeAdapter,
  'initialize' | 'cancel' | 'service' | 'speech' | 'openSettings'
> &
  Partial<Pick<NativeAdapter, 'accessibilityStatus'>>;

/** Issue id for a missing Accessibility grant learned from a probe, not from a session. */
const DOCK_ACCESSIBILITY_PROBE_ID = 'accessibility-probe';
export type DockNativeFactory = (scope: {
  workspaceId: string;
  agentId: string;
  draftId: string;
}) => DockNativeAdapter;
type StopResult = Awaited<ReturnType<NativeAdapter['speech']['stop']>>;
/** Only these ends are a clean final-transcript barrier; 'error' and 'cancelled' are not. */
const CLEAN_END_REASONS: ReadonlySet<DockSpeechEndReason> = new Set([
  'stopped',
  'silence',
  'max-duration',
]);

let nativeFactory: DockNativeFactory = createDockEvidenceNative;

/** Injection seam (scripted natives in tests); null restores the IPC adapter. */
export function configureDockNativeFactory(factory: DockNativeFactory | null): void {
  nativeFactory = factory ?? createDockEvidenceNative;
}

interface NativeScope {
  workspaceId: string;
  agentId: string;
  authority: string;
}

function stillCurrent(scope: NativeScope): boolean {
  const dock = appStore.state.dockConversation;
  return (
    dock.workspaceId === scope.workspaceId &&
    dock.agentId === scope.agentId &&
    dock.authority === scope.authority &&
    getPrincipalActionContext(appStore.state) === scope.authority
  );
}

function* runNativeSession({ payload: key }: SelectorChannelPayload<string>): SagaGenerator<void> {
  if (!key) return;
  const scope = JSON.parse(key) as NativeScope;
  const { workspaceId, agentId } = scope;
  const pairId = dockEvidenceId(workspaceId, agentId);
  const ours = (ws: string, agent: string) =>
    ws === workspaceId && agent === agentId && stillCurrent(scope);
  const adapter = nativeFactory({
    workspaceId,
    agentId,
    draftId: JSON.stringify([pairId, scope.authority]),
  });
  let installed = false;
  let speech: {
    id: string;
    transcript: ReturnType<typeof createDockSpeechTranscript>;
    stopping: Promise<StopResult | null> | null;
  } | null = null;
  /** How the most recent speech session ended (set once, from its `ended` event). */
  let lastEnded: { id: string; reason: DockSpeechEndReason } | null = null;
  /** Sessions ended by Send without their final transcript; native's late answers are ignored. */
  const keptLive = new Set<string>();
  const channel = eventChannel<{ speechId: string; event: DockSpeechEvent }>(
    (emit) => adapter.speech.subscribe((message) => emit(message)),
    buffers.expanding(64),
  );

  /**
   * Note dictation (capture editor, screenshot mark notes): its own speech session,
   * started only while the microphone is free (no prompt dictation, no recording).
   * Its text goes to main for that note, never into the prompt; every accepted start
   * ends with exactly one final report.
   */
  let note: {
    requestId: string;
    generation: number;
    speechId: string;
    transcript: ReturnType<typeof createDockSpeechTranscript>;
    committed: string;
  } | null = null;
  const textOf = (parts: readonly DockInsertionPart[]) =>
    parts.map((part) => (part.kind === 'text' ? part.text : '')).join('');
  function reportNote(report: DockCaptureEditorNoteDictationText): void {
    void window.electronAPI
      ?.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.NOTE_DICTATION_TEXT, {
        ...report,
        text: report.text.slice(0, DOCK_NOTE_MAX),
      })
      .catch(() => undefined);
  }
  function* onNoteRequest(value: object): SagaGenerator<void> {
    const request = value as DockCaptureEditorNoteDictationRequested;
    if (typeof request.requestId !== 'string' || !Number.isInteger(request.generation)) return;
    if (request.phase === 'stop') {
      const live = note;
      if (!live || live.requestId !== request.requestId || live.generation !== request.generation)
        return;
      const stopped = yield* call(async () => {
        try {
          return await adapter.speech.stop(live.speechId);
        } catch {
          return null;
        }
      });
      // A stop that could not reach native still ends the dictation, once.
      if (!stopped && note === live) {
        note = null;
        reportNote({
          requestId: live.requestId,
          generation: live.generation,
          text: live.committed,
          final: true,
          error: 'failed',
        });
      }
      return;
    }
    const refuse = (error: 'busy' | 'unavailable' | 'failed' | 'permission') =>
      reportNote({
        requestId: request.requestId,
        generation: request.generation,
        text: '',
        final: true,
        error,
      });
    if (
      request.pair?.workspaceId !== workspaceId ||
      request.pair?.agentId !== agentId ||
      !stillCurrent(scope)
    )
      return refuse('unavailable');
    // Never take the microphone from prompt dictation, another note or a recording.
    if (speech || note || recordingDockClip(evidenceOf(workspaceId, agentId)))
      return refuse('busy');
    const speechId = crypto.randomUUID();
    const live = {
      requestId: request.requestId,
      generation: request.generation,
      speechId,
      transcript: createDockSpeechTranscript(speechId),
      committed: '',
    };
    note = live;
    const result = yield* call(async () => {
      try {
        return await adapter.speech.start(speechId);
      } catch {
        return { ok: false as const, error: 'failed' as const };
      }
    });
    if (!result.ok && note === live) {
      note = null;
      refuse(String(result.error).includes('permission') ? 'permission' : 'failed');
    }
  }
  function onNoteSpeech(event: DockSpeechEvent): void {
    const live = note;
    if (!live) return;
    const update = live.transcript.apply(event);
    if (!update) return;
    for (const commit of update.commits) live.committed += textOf(commit.parts);
    if (update.ended) {
      note = null;
      const text =
        live.committed + (update.ended.trailing ? textOf(update.ended.trailing.parts) : '');
      reportNote({
        requestId: live.requestId,
        generation: live.generation,
        text,
        final: true,
        ...(CLEAN_END_REASONS.has(update.ended.reason) ? {} : { error: 'failed' as const }),
      });
      return;
    }
    reportNote({
      requestId: live.requestId,
      generation: live.generation,
      text: live.committed + textOf(update.interim),
      final: false,
    });
  }

  function* onSpeechEvent(speechId: string, event: DockSpeechEvent): SagaGenerator<void> {
    if (note && note.speechId === speechId) {
      onNoteSpeech(event);
      return;
    }
    const live = speech;
    if (!live || live.id !== speechId || !stillCurrent(scope)) return;
    if (event.type === 'ready') {
      yield* put(
        dockEvidenceDictationChanged(workspaceId, agentId, {
          id: speechId,
          startedAt: event.startedAtEpochMs,
          status: 'listening',
        }),
      );
      // Only marks this pair accepted while listening are stamped on the audio clock.
      setDockDictationMarkSink((pair, markId) => {
        if (pair.workspaceId === workspaceId && pair.agentId === agentId && speech?.id === speechId)
          void adapter.speech.mark(speechId, markId).catch(() => undefined);
      });
      yield* put(dockNativeSpeechPatched(pairId, { pending: false }));
      return;
    }
    if (event.type === 'level') {
      yield* put(dockNativeSpeechLevel(pairId, event.level));
      return;
    }
    if (event.type === 'state' && event.state === 'finalizing') {
      const dictation = evidenceOf(workspaceId, agentId)?.dictation;
      if (dictation?.id === speechId)
        yield* put(
          dockEvidenceDictationChanged(workspaceId, agentId, {
            ...dictation,
            status: 'transcribing',
          }),
        );
      return;
    }
    if (event.type === 'error') {
      if (event.fatal) yield* put(dockNativeSpeechPatched(pairId, { error: event.code }));
      return;
    }
    const update = live.transcript.apply(event);
    if (!update) return;
    for (const commit of update.commits)
      yield* put(dockEvidenceInsertionQueued(workspaceId, agentId, commit));
    if (update.ended) {
      setDockDictationMarkSink(null);
      speech = null;
      lastEnded = { id: speechId, reason: update.ended.reason };
      // Known words were already committed above; an error end is surfaced, never sent.
      const failed = !CLEAN_END_REASONS.has(update.ended.reason);
      yield* put(
        dockEvidenceDictationFinished(workspaceId, agentId, speechId, update.ended.trailing),
      );
      yield* put(
        dockNativeSpeechPatched(pairId, {
          activeId: null,
          pending: false,
          ...(failed && !appStore.state.dockConversation.nativeSpeech.error
            ? { error: 'recognition-failed' }
            : {}),
        }),
      );
      return;
    }
    yield* put(dockEvidenceDictationInterim(workspaceId, agentId, speechId, update.interim));
  }

  function* startSpeech(): SagaGenerator<void> {
    // A note dictation holds the microphone until it ends.
    if (speech || note || !stillCurrent(scope)) return;
    const speechId = crypto.randomUUID();
    speech = { id: speechId, transcript: createDockSpeechTranscript(speechId), stopping: null };
    yield* put(dockNativeSpeechPatched(pairId, { activeId: speechId, pending: true, error: null }));
    const result = yield* call(async () => {
      try {
        return await adapter.speech.start(speechId);
      } catch {
        return { ok: false as const, error: 'failed' as const };
      }
    });
    if (!result.ok && speech?.id === speechId) {
      speech = null;
      // A fatal event may already have named the exact denial (microphone vs speech).
      const prior = appStore.state.dockConversation.nativeSpeech.error;
      const code = prior?.includes('permission') ? prior : result.error;
      yield* put(dockNativeSpeechPatched(pairId, { activeId: null, pending: false, error: code }));
      if (stillCurrent(scope))
        yield* call(
          showDockEvidenceNotice,
          speechStartNotice(code),
          (pane: DockEvidencePrivacyPane) =>
            appStore.dispatch(
              dockEvidenceOpenSettingsRequested(scope.workspaceId, scope.agentId, pane),
            ),
        );
    }
  }

  /**
   * The finals barrier. True only when the session demonstrably ended cleanly:
   * native stop succeeded and the session's `ended` reason is clean. A failed or
   * timed-out stop (`ended.reason === 'error'`, or a failed stop result) is false
   * even when the session already ended through the channel: its known words stay
   * queued, the error is surfaced, and only a later explicit send may proceed.
   */
  function* stopSpeech(): SagaGenerator<boolean> {
    const live = speech;
    if (!live) {
      // Already ended: clean only if that end was clean and native owes no answer.
      const answered = yield* flushDockMarkAnswers();
      if (!answered) yield* put(dockNativeSpeechPatched(pairId, { error: 'mark-answer-failed' }));
      const clean = answered && (lastEnded === null || CLEAN_END_REASONS.has(lastEnded.reason));
      if (clean) yield* clearStopError();
      return clean;
    }
    // An explicit Stop always stops the helper FIRST (the microphone goes off now).
    // Unanswered marks are then retried with bounded attempts while native drains;
    // native bounds its own wait for them and keeps their words, so a later retry
    // collects them without restarting capture.
    live.stopping ??= (async () => {
      try {
        return await adapter.speech.stop(live.id);
      } catch {
        return null;
      }
    })();
    const stopping = live.stopping;
    const answeredBefore = yield* flushDockMarkAnswers();
    const result = yield* call(() => stopping);
    // Send already kept this session's live words; its late end changes nothing.
    if (keptLive.has(live.id)) return true;
    if (result?.ok && speech?.id === live.id) yield* onSpeechEvent(live.id, result.value);
    const answered = answeredBefore || (yield* flushDockMarkAnswers());
    if (speech?.id === live.id) {
      // Not ended yet (for example native awaiting a lost answer): a repeat Stop
      // returns the original end, it never restarts capture.
      live.stopping = null;
      yield* put(
        dockNativeSpeechPatched(pairId, {
          error: !answered
            ? 'mark-answer-failed'
            : result?.ok
              ? 'not-ended'
              : (result?.error ?? 'stop-failed'),
        }),
      );
      return false;
    }
    const endedReason = lastEnded?.id === live.id ? lastEnded.reason : null;
    const clean =
      answered &&
      result?.ok === true &&
      CLEAN_END_REASONS.has(result.value.reason) &&
      (endedReason === null || CLEAN_END_REASONS.has(endedReason));
    if (!clean && !answered)
      yield* put(dockNativeSpeechPatched(pairId, { error: 'mark-answer-failed' }));
    else if (!clean && !appStore.state.dockConversation.nativeSpeech.error)
      yield* put(
        dockNativeSpeechPatched(pairId, {
          error: result === null ? 'stop-failed' : !result.ok ? result.error : 'recognition-failed',
        }),
      );
    if (clean) yield* clearStopError();
    return clean;
  }

  /**
   * Send gave up waiting for the final transcript: turn the microphone off, end
   * the session now and queue its live words (and chips) as one typed insertion.
   * Finals already committed stay; nothing is dropped and nothing arrives twice.
   */
  function* keepLiveSpeech(): SagaGenerator<void> {
    const live = speech;
    if (live) {
      keptLive.add(live.id);
      speech = null;
      setDockDictationMarkSink(null);
      lastEnded = { id: live.id, reason: 'stopped' };
      live.stopping ??= adapter.speech.stop(live.id).catch(() => null);
    }
    const dictation = evidenceOf(workspaceId, agentId)?.dictation;
    if (dictation) {
      const parts = dictation.interim ?? [];
      yield* put(
        dockEvidenceDictationFinished(
          workspaceId,
          agentId,
          dictation.id,
          parts.length ? { id: crypto.randomUUID(), parts: [...parts] } : null,
        ),
      );
    }
    yield* put(dockNativeSpeechPatched(pairId, { activeId: null, pending: false }));
  }

  /** A clean barrier clears only a previous delivery failure (other errors stay surfaced). */
  function* clearStopError(): SagaGenerator<void> {
    if (appStore.state.dockConversation.nativeSpeech.error === 'mark-answer-failed')
      yield* put(dockNativeSpeechPatched(pairId, { error: null }));
  }

  try {
    let result: Awaited<ReturnType<typeof adapter.initialize>> | null = null;
    for (let attempt = 0; ; attempt += 1) {
      result = yield* call(async () => {
        try {
          return await adapter.initialize();
        } catch {
          return null;
        }
      });
      // A stale probe never installs: unobserved availability is never published.
      if (!stillCurrent(scope)) return;
      if (result?.ok) break;
      // Refused (main admits a session only on a visible dock, so a pair opened while the
      // dock is hidden is refused): probe again with a bounded backoff while this scope is
      // current. A probe has no screen or microphone access; a scope change cancels this.
      yield* delay(Math.min(10_000, 1_000 * 2 ** Math.min(attempt, 4)));
      if (!stillCurrent(scope)) return;
    }
    if (!result?.ok) return;
    configureDockEvidenceNative(adapter.service);
    installed = true;
    yield* put(
      dockNativeSpeechSessionChanged(pairId, 'speech' in result.value ? result.value.speech : null),
    );
    yield* takeEveryFromElectronChannel<object>(
      DOCK_CAPTURE_EDITOR_CHANNELS.NOTE_DICTATION_REQUESTED,
      onNoteRequest,
      {
        bufferPolicy: { kind: 'lossless', rationale: 'Each note start or stop needs its answer.' },
      },
    );
    yield* takeEvery(dockSpeechStartRequested, function* ({ payload: [ws, agent] }) {
      if (ours(ws, agent)) yield* startSpeech();
    });
    yield* takeEvery(dockSpeechStopRequested, function* ({ payload: [ws, agent, requestId] }) {
      if (!ours(ws, agent)) return;
      const ok = yield* stopSpeech();
      yield* put(dockNativeSpeechStopSettled(pairId, requestId, ok));
    });
    yield* takeEvery(dockSpeechKeepLiveRequested, function* ({ payload: [ws, agent] }) {
      if (ours(ws, agent)) yield* keepLiveSpeech();
    });
    yield* takeEvery(dockSpeechToggleRequested, function* ({ payload: [ws, agent] }) {
      if (!ours(ws, agent)) return;
      if (speech) yield* stopSpeech();
      else yield* startSpeech();
    });
    // Accessibility trust: probed (never prompted) now and whenever the dock regains
    // focus, e.g. back from System Settings, so the pick error state clears by itself.
    function* probeAccessibility(): SagaGenerator<void> {
      const status = yield* call(async () => {
        try {
          return (await adapter.accessibilityStatus?.()) ?? null;
        } catch {
          return null;
        }
      });
      if (!status?.ok || !stillCurrent(scope)) return;
      const issue = evidenceOf(workspaceId, agentId)?.annotationIssue ?? null;
      const blocked = issue?.kind === 'pick' && issue.error === 'permission';
      if (status.value.trusted && blocked)
        yield* put(dockEvidenceAnnotationIssue(workspaceId, agentId, null));
      else if (!status.value.trusted && !blocked)
        yield* put(
          dockEvidenceAnnotationIssue(workspaceId, agentId, {
            sessionId: DOCK_ACCESSIBILITY_PROBE_ID,
            kind: 'pick',
            error: 'permission',
          }),
        );
    }
    if (adapter.accessibilityStatus) {
      yield* fork(probeAccessibility);
      const focus = eventChannel<true>((emit) => {
        if (typeof window === 'undefined') return () => {};
        const onFocus = () => emit(true);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
      }, buffers.sliding(1));
      yield* fork(function* () {
        try {
          while (true) {
            yield* take(focus);
            yield* probeAccessibility();
          }
        } finally {
          focus.close();
        }
      });
    }
    yield* takeEvery(dockEvidenceOpenSettingsRequested, function* ({ payload: [ws, agent, pane] }) {
      if (!ours(ws, agent)) return;
      yield* call(async () => {
        try {
          await adapter.openSettings(pane);
        } catch {
          // User-initiated and best-effort; the permission action stays available.
        }
      });
    });
    while (true) {
      const message = yield* take(channel);
      yield* onSpeechEvent(message.speechId, message.event);
    }
  } finally {
    channel.close();
    speech = null;
    // The session is going: a note dictation still running ends, once.
    if (note) {
      const live = note;
      note = null;
      reportNote({
        requestId: live.requestId,
        generation: live.generation,
        text: live.committed,
        final: true,
        error: 'failed',
      });
    }
    if (installed && retireDockEvidenceNative(adapter.service, workspaceId, agentId)) {
      if (appStore.state.dockConversation.nativeSpeech.pairId === pairId)
        appStore.dispatch(dockNativeSpeechSessionChanged(null, null));
    }
    yield* call(() => adapter.cancel().catch(() => undefined));
  }
}

export function* dockNativeSessionSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectDockNativeScope, runNativeSession);
}
