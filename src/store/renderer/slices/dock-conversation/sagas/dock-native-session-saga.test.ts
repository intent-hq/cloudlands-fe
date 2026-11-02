import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
} from '../../../../../test/mocks/backend-transport.mock';
import { createAdmittedLegacyPrincipal } from '../../../../../test/fixtures/admitted-legacy-principal';
import { store as appStore } from '$store/renderer/store';
import { getPrincipalActionContext } from '../../principal/principal-context';
import type { DockEvidenceNativeEvent, DockEvidenceNativeService } from '$shared/dock-evidence';
import type { DockSpeechCapability, DockSpeechEvent } from '$shared/dock-speech';
import {
  dockConversationContextSet,
  dockConversationLoaded,
  dockEvidenceAnnotationChanged,
  dockEvidenceImageCaptured,
  dockEvidenceOpenSettingsRequested,
  dockSpeechStopRequested,
  dockSpeechToggleRequested,
  openDockConversationRequested,
} from '../dock-conversation-slice';
import {
  selectDockComposerEvidence,
  selectDockSpeechStopOutcome,
} from '../dock-conversation-selectors';
import {
  configureDockNativeFactory,
  dockNativeSessionSaga,
  type DockNativeAdapter,
} from './dock-native-session-saga';
import { __setDockMarkAnswerTimeoutForTests, dockEvidenceSaga } from './dock-evidence-saga';

const WS = 'ws-native-session';
const AGENT = 'agent-native-session';
let cleanups: (() => void)[] = [];
const view = () => selectDockComposerEvidence.select(appStore.state, WS, AGENT);

/** Scripted native at the adapter boundary: the real saga drives it through Redux. */
function scriptedNative(options: { initialize?: Promise<unknown>; probe?: boolean } = {}) {
  const order: string[] = [];
  let speechListener: ((payload: { speechId: string; event: DockSpeechEvent }) => void) | null =
    null;
  let evidenceListener: ((event: DockEvidenceNativeEvent) => void) | null = null;
  const emit = (speechId: string, event: DockSpeechEvent) => speechListener?.({ speechId, event });
  const answers = {
    failing: false,
    /** Native never replies to the answer (an unresolved control). */
    holding: false,
    sent: [] as [string, string, boolean][],
  };
  const service = {
    capabilities: { capture: true, annotate: true, record: false },
    syncMarks: async () => undefined,
    endAnnotation: async () => undefined,
    // Native's idempotent mark-result control; a lost answer reports failure.
    reportMarkAcceptance: async (annotationId: string, markId: string, accepted: boolean) => {
      answers.sent.push([annotationId, markId, accepted]);
      order.push(`answer:${markId}`);
      if (answers.holding) return new Promise(() => undefined);
      return answers.failing
        ? { ok: false as const, error: 'transport' as const }
        : { ok: true as const, value: undefined };
    },
    subscribe: (listener: (event: DockEvidenceNativeEvent) => void) => {
      order.push('install');
      evidenceListener = listener;
      return () => {
        order.push('uninstall');
        evidenceListener = null;
      };
    },
  } as unknown as DockEvidenceNativeService;
  const adapter = {
    initialize: vi.fn(async () => {
      order.push('initialize');
      await options.initialize;
      return options.probe === false
        ? { ok: false as const, error: 'unavailable' as const }
        : {
            ok: true as const,
            value: {
              capture: true,
              annotate: true,
              record: false,
              speech: {
                available: true,
                engine: 'analyzer',
                speech: 'authorized',
                microphone: 'authorized',
                locale: 'en-US',
                onDevice: true,
              } as DockSpeechCapability,
            },
          };
    }),
    cancel: vi.fn(async () => {
      order.push('cancel');
    }),
    openSettings: vi.fn(async () => ({ ok: true as const, value: undefined })),
    service,
    speech: {
      start: vi.fn(async () => ({ ok: true as const, value: undefined })),
      // Like native: stop always ends capture; while a mark answer is missing it
      // holds the buffered words/end and reports a bounded failure, and a repeat stop
      // after the answer arrives returns the original end (capture is never restarted).
      stop: vi.fn(async (speechId: string) => {
        order.push('stop');
        if (answers.failing || answers.holding)
          return { ok: false as const, error: 'transport' as const };
        const ended = { type: 'ended' as const, reason: 'stopped' as const, elapsedMs: 900 };
        emit(speechId, ended);
        return { ok: true as const, value: ended };
      }),
      mark: vi.fn(async () => undefined),
      subscribe: vi.fn((listener: typeof speechListener) => {
        speechListener = listener;
        return () => {
          speechListener = null;
        };
      }),
    },
  };
  return {
    adapter,
    order,
    emit,
    emitEvidence: (event: DockEvidenceNativeEvent) => evidenceListener?.(event),
    answers,
  };
}

function shot(n: number) {
  return {
    base64: btoa(`shot-${n}`),
    mimeType: 'image/png',
    width: 2880,
    height: 1800,
    displayScale: 2,
    capturedAt: `2026-10-29T18:12:0${n}Z`,
  };
}

/** Install, open a live annotate session and start listening dictation. */
async function listening(native: ReturnType<typeof scriptedNative>) {
  inject(native);
  openPair();
  await vi.waitFor(() => expect(view().speech.available).toBe(true));
  appStore.dispatch(
    dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-1', mode: 'live', imageId: null }),
  );
  appStore.dispatch(dockSpeechToggleRequested(WS, AGENT));
  await vi.waitFor(() => expect(native.adapter.speech.start).toHaveBeenCalledTimes(1));
  const speechId = native.adapter.speech.start.mock.calls[0][0] as string;
  native.emit(speechId, {
    type: 'ready',
    sessionId: speechId,
    engine: 'analyzer',
    locale: 'en-US',
    onDevice: true,
    startedAtEpochMs: 1_000,
  });
  await vi.waitFor(() => expect(view().dictation?.status).toBe('listening'));
  return speechId;
}

const nativeMark = (n: number, capture: boolean) => ({
  type: 'mark' as const,
  sessionId: 'session-1',
  tool: 'box' as const,
  geometry: { kind: 'rect' as const, x: n, y: n, w: 10, h: 10 },
  element: null,
  markId: `native-${n}`,
  gestureAtEpochMs: 2_000 + n,
  ...(capture ? { capture: shot(n) } : {}),
});

async function settledStop(requestId: string) {
  appStore.dispatch(dockSpeechStopRequested(WS, AGENT, requestId));
  await vi.waitFor(() =>
    expect(selectDockSpeechStopOutcome.select(appStore.state, requestId)).not.toBeNull(),
  );
  return selectDockSpeechStopOutcome.select(appStore.state, requestId)!.ok;
}

function inject(native: ReturnType<typeof scriptedNative>) {
  configureDockNativeFactory(() => native.adapter as unknown as DockNativeAdapter);
}

/** Open the pair under the live authority: the scope the root saga keys the session on. */
function openPair() {
  appStore.dispatch(openDockConversationRequested(WS));
  appStore.dispatch(
    dockConversationContextSet('identity', getPrincipalActionContext(appStore.state)!),
  );
  appStore.dispatch(
    dockConversationLoaded(
      appStore.state.dockConversation.generation,
      WS,
      'Workspace',
      [{ id: AGENT, name: 'Main', isMain: true }],
      AGENT,
    ),
  );
}

function revokeAuthority() {
  appStore.dispatch(dockConversationContextSet('identity', 'another-authority'));
}

afterEach(() => {
  __setDockMarkAnswerTimeoutForTests(null);
});
beforeEach(() => {
  const backend = installMockBackend();
  backend.onRequest('client.hello', () => ({ server: { capabilities: {} } }));
  cleanups = [appStore.init(createAdmittedLegacyPrincipal())];
  // `init` starts no app sagas in tests: run the production roots under test
  // (in the app, `dockConversationSaga` forks both from the root registry).
  cleanups.push(appStore.runSaga(dockEvidenceSaga));
  cleanups.push(appStore.runSaga(dockNativeSessionSaga));
});
afterEach(() => {
  cleanups.reverse().forEach((dispose) => dispose());
  configureDockNativeFactory(null);
  resetMockBackend();
});

describe('root-owned dock native session', () => {
  it('initializes before installing, publishes availability, then retires and cancels with the scope', async () => {
    const native = scriptedNative();
    inject(native);
    openPair();
    await vi.waitFor(() => expect(view().speech.available).toBe(true));
    expect(view().capabilities).toEqual({ capture: true, annotate: true, record: false });
    expect(native.order).toEqual(['initialize', 'install']);
    revokeAuthority();
    await vi.waitFor(() =>
      expect(native.order).toEqual(['initialize', 'install', 'uninstall', 'cancel']),
    );
    expect(appStore.state.dockConversation.nativeCapabilities).toBeNull();
    expect(appStore.state.dockConversation.nativeSpeech.pairId).toBeNull();
  });

  it('never installs a probe that settles after the scope changed, and cancels it', async () => {
    let release: () => void = () => undefined;
    const native = scriptedNative({
      initialize: new Promise<void>((resolve) => (release = resolve)),
    });
    inject(native);
    openPair();
    await vi.waitFor(() => expect(native.adapter.initialize).toHaveBeenCalledTimes(1));
    revokeAuthority();
    release();
    await vi.waitFor(() => expect(native.adapter.cancel).toHaveBeenCalledTimes(1));
    expect(native.order).not.toContain('install');
    expect(appStore.state.dockConversation.nativeCapabilities).toBeNull();
    expect(view().speech.capability).toBeNull();
  });

  it('does not install or publish availability when the probe fails', async () => {
    const native = scriptedNative({ probe: false });
    inject(native);
    openPair();
    await vi.waitFor(() => expect(native.adapter.cancel).toHaveBeenCalledTimes(1));
    expect(native.order).toEqual(['initialize', 'cancel']);
    expect(view().capabilities).toEqual({ capture: false, annotate: false, record: false });
    expect(view().speech.available).toBe(false);
  });

  it('routes live speech to evidence actions and stamps only accepted marks while listening', async () => {
    const native = scriptedNative();
    inject(native);
    openPair();
    await vi.waitFor(() => expect(view().speech.available).toBe(true));
    appStore.dispatch(
      dockEvidenceImageCaptured(WS, AGENT, {
        id: 'image-1',
        contextItemId: 'raw-1',
        width: 100,
        height: 80,
        displayScale: 2,
        capturedAt: '2026-10-29T20:00:00Z',
        source: 'capture',
      }),
    );
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, {
        id: 'session-1',
        mode: 'live',
        imageId: 'image-1',
      }),
    );
    appStore.dispatch(dockSpeechToggleRequested(WS, AGENT));
    await vi.waitFor(() => expect(native.adapter.speech.start).toHaveBeenCalledTimes(1));
    const speechId = native.adapter.speech.start.mock.calls[0][0] as string;
    expect(view().speech).toMatchObject({ active: true, pending: true });
    native.emit(speechId, {
      type: 'ready',
      sessionId: speechId,
      engine: 'analyzer',
      locale: 'en-US',
      onDevice: true,
      startedAtEpochMs: 1_000,
    });
    await vi.waitFor(() =>
      expect(view().dictation).toMatchObject({
        id: speechId,
        status: 'listening',
        startedAt: 1_000,
      }),
    );
    expect(view().speech.pending).toBe(false);
    // A renderer-minted mark accepted while listening is stamped on the audio clock once.
    native.emitEvidence({
      type: 'mark',
      sessionId: 'session-1',
      tool: 'box',
      geometry: { kind: 'rect', x: 1, y: 1, w: 10, h: 10 },
      element: null,
    });
    await vi.waitFor(() => expect(native.adapter.speech.mark).toHaveBeenCalledTimes(1));
    const markId = view().evidence!.marks[0].id;
    expect(native.adapter.speech.mark).toHaveBeenCalledWith(speechId, markId);
    native.emit(speechId, { type: 'level', elapsedMs: 30, level: 0.6 });
    await vi.waitFor(() => expect(view().speech.levels).toEqual([0.6]));
    native.emit(speechId, {
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: true,
      text: 'this one',
      startMs: 0,
      endMs: 400,
      segments: [{ text: 'this one', startMs: 0, endMs: 400 }],
    });
    await vi.waitFor(() =>
      expect(view().evidence?.insertions.map((row) => row.id)).toEqual([`${speechId}:0`]),
    );
    native.emit(speechId, {
      type: 'transcript',
      utterance: 1,
      revision: 1,
      isFinal: false,
      text: 'still',
      startMs: 500,
      endMs: null,
      segments: [{ text: 'still', startMs: 500, endMs: null }],
    });
    await vi.waitFor(() => expect(view().dictation?.interim?.length).toBeGreaterThan(0));
    appStore.dispatch(dockSpeechToggleRequested(WS, AGENT));
    await vi.waitFor(() => expect(view().dictation).toBeNull());
    expect(view().speech).toMatchObject({ active: false, pending: false, levels: [] });
    // After the session ended, a later accepted mark is no longer stamped.
    native.emitEvidence({
      type: 'mark',
      sessionId: 'session-1',
      tool: 'box',
      geometry: { kind: 'rect', x: 20, y: 20, w: 10, h: 10 },
      element: null,
    });
    await vi.waitFor(() => expect(view().evidence?.marks).toHaveLength(2));
    expect(native.adapter.speech.mark).toHaveBeenCalledTimes(1);
  });

  it('settles a stop whose native result ended in error as a failed barrier with the error surfaced', async () => {
    const native = scriptedNative();
    inject(native);
    openPair();
    await vi.waitFor(() => expect(view().speech.available).toBe(true));
    appStore.dispatch(dockSpeechToggleRequested(WS, AGENT));
    await vi.waitFor(() => expect(native.adapter.speech.start).toHaveBeenCalledTimes(1));
    const speechId = native.adapter.speech.start.mock.calls[0][0] as string;
    native.emit(speechId, {
      type: 'ready',
      sessionId: speechId,
      engine: 'analyzer',
      locale: 'en-US',
      onDevice: true,
      startedAtEpochMs: 1_000,
    });
    await vi.waitFor(() => expect(view().dictation?.status).toBe('listening'));
    // The stop resolves "ok" but its ended reason is an error: not a clean barrier.
    native.adapter.speech.stop.mockResolvedValueOnce({
      ok: true,
      value: { type: 'ended', reason: 'error', elapsedMs: 8_000 },
    } as never);
    appStore.dispatch(dockSpeechStopRequested(WS, AGENT, 'req-1'));
    await vi.waitFor(() =>
      expect(selectDockSpeechStopOutcome.select(appStore.state, 'req-1')).toEqual({
        requestId: 'req-1',
        ok: false,
      }),
    );
    expect(view().speech).toMatchObject({ active: false, error: 'recognition-failed' });
    expect(view().dictation).toBeNull();
    // A stop raced by the already-error-ended session is refused too, never passed.
    appStore.dispatch(dockSpeechStopRequested(WS, AGENT, 'req-2'));
    await vi.waitFor(() =>
      expect(selectDockSpeechStopOutcome.select(appStore.state, 'req-2')).toEqual({
        requestId: 'req-2',
        ok: false,
      }),
    );
  });

  it('records a qualified native annotate issue for its live session only', async () => {
    const native = scriptedNative();
    inject(native);
    openPair();
    await vi.waitFor(() => expect(view().capabilities.annotate).toBe(true));
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-1', mode: 'live', imageId: null }),
    );
    // Outside the schema, or for another session: dropped.
    native.emitEvidence({
      type: 'annotation-issue',
      sessionId: 'session-1',
      kind: 'hover',
      error: 'permission',
    } as unknown as DockEvidenceNativeEvent);
    native.emitEvidence({
      type: 'annotation-issue',
      sessionId: 'other-session',
      kind: 'pick',
      error: 'permission',
    });
    native.emitEvidence({
      type: 'annotation-issue',
      sessionId: 'session-1',
      kind: 'pick',
      error: 'permission',
    });
    await vi.waitFor(() =>
      expect(view().annotationIssue).toEqual({
        sessionId: 'session-1',
        kind: 'pick',
        error: 'permission',
      }),
    );
    // No mark was fabricated for the failed pick.
    expect(view().evidence?.marks ?? []).toEqual([]);
  });

  it('an explicit Stop with an undelivered accepted-mark answer still stops capture once, refuses the send, and recovers without restarting', async () => {
    const native = scriptedNative();
    await listening(native);
    // The answer for an accepted mark is lost before native receives it.
    native.answers.failing = true;
    native.emitEvidence(nativeMark(1, true));
    await vi.waitFor(() => expect(native.answers.sent).toEqual([['session-1', 'native-1', true]]));
    expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']);
    // The user's Stop (and the send barrier): the helper is stopped regardless.
    await expect(settledStop('req-1')).resolves.toBe(false);
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1);
    expect(native.adapter.speech.start).toHaveBeenCalledTimes(1);
    expect(view().speech.error).toBe('mark-answer-failed');
    // Nothing was dropped: the mark and the unended session (held words) remain.
    expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']);
    expect(view().dictation?.id).toBeDefined();
    // Explicit retry after recovery: the same decided answer, then native's original end.
    native.answers.failing = false;
    await expect(settledStop('req-2')).resolves.toBe(true);
    // At the gesture, before and after the failed stop, then delivered by the retry: always true.
    expect(native.answers.sent.filter(([, id]) => id === 'native-1')).toEqual([
      ['session-1', 'native-1', true],
      ['session-1', 'native-1', true],
      ['session-1', 'native-1', true],
      ['session-1', 'native-1', true],
    ]);
    // No fresh capture: no second start; the repeat stop only collects the original end.
    expect(native.adapter.speech.start).toHaveBeenCalledTimes(1);
    expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']);
    expect(view().dictation).toBeNull();
    expect(view().speech).toMatchObject({ active: false, error: null });
  });

  it('an explicit Stop with an undelivered fifth-capture refusal still stops capture, refuses the send, and retries the refusal, never an acceptance', async () => {
    const native = scriptedNative();
    await listening(native);
    for (const n of [1, 2, 3, 4]) {
      native.emitEvidence(nativeMark(n, true));
      await vi.waitFor(() => expect(view().evidence?.marks).toHaveLength(n));
    }
    native.answers.failing = true;
    native.emitEvidence(nativeMark(5, true));
    await vi.waitFor(() => expect(view().captureError).toBe('limit'));
    await vi.waitFor(() =>
      expect(native.answers.sent.at(-1)).toEqual(['session-1', 'native-5', false]),
    );
    await expect(settledStop('req-1')).resolves.toBe(false);
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1);
    expect(view().speech.error).toBe('mark-answer-failed');
    expect(view().tiles).toHaveLength(4);
    expect(view().evidence?.marks).toHaveLength(4);
    native.answers.failing = false;
    await expect(settledStop('req-2')).resolves.toBe(true);
    // Refused at the gesture, retried by both Stop flushes, never turned into an acceptance.
    const refusals = native.answers.sent.filter(([, id]) => id === 'native-5');
    expect(refusals.length).toBeGreaterThanOrEqual(3);
    expect(refusals.every(([, , accepted]) => accepted === false)).toBe(true);
    expect(view().evidence?.marks).toHaveLength(4);
    expect(native.adapter.speech.start).toHaveBeenCalledTimes(1);
    expect(view().dictation).toBeNull();
  });

  it('stops capture before a never-settling mark answer, bounds the answer, and recovers with the same answer and no new audio', async () => {
    __setDockMarkAnswerTimeoutForTests(50);
    const native = scriptedNative();
    await listening(native);
    // Native never replies to this mark's answer; event processing still continues.
    native.answers.holding = true;
    native.emitEvidence(nativeMark(1, true));
    await vi.waitFor(() =>
      expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']),
    );
    native.order.length = 0;
    await expect(settledStop('req-1')).resolves.toBe(false);
    // The helper stop was issued first, before any retry of the held answer.
    expect(native.order[0]).toBe('stop');
    expect(native.order.slice(1).every((entry) => entry === 'answer:native-1')).toBe(true);
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1);
    expect(native.adapter.speech.start).toHaveBeenCalledTimes(1);
    expect(view().speech.error).toBe('mark-answer-failed');
    expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']);
    // Native recovers: the retry delivers the same decided answer and collects the end.
    native.answers.holding = false;
    await expect(settledStop('req-2')).resolves.toBe(true);
    expect(native.answers.sent.every(([, id, accepted]) => id === 'native-1' && accepted)).toBe(
      true,
    );
    expect(native.adapter.speech.start).toHaveBeenCalledTimes(1);
    expect(view().evidence?.marks.map((row) => row.id)).toEqual(['native-1']);
    expect(view().dictation).toBeNull();
    expect(view().speech).toMatchObject({ active: false, error: null });
  });

  it('opens a privacy pane only on an explicit request for the open pair', async () => {
    const native = scriptedNative();
    inject(native);
    openPair();
    await vi.waitFor(() => expect(view().speech.available).toBe(true));
    expect(native.adapter.openSettings).not.toHaveBeenCalled();
    appStore.dispatch(dockEvidenceOpenSettingsRequested('another-workspace', AGENT, 'microphone'));
    appStore.dispatch(dockEvidenceOpenSettingsRequested(WS, AGENT, 'microphone'));
    await vi.waitFor(() => expect(native.adapter.openSettings).toHaveBeenCalledTimes(1));
    expect(native.adapter.openSettings).toHaveBeenCalledWith('microphone');
  });
});
