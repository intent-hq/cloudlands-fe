import { dockEvidenceSaga } from '$store/renderer/slices/dock-conversation/sagas/dock-evidence-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import { installMockBackend, resetMockBackend } from '../../../test/mocks/backend-transport.mock';
import { createAdmittedLegacyPrincipal } from '../../../test/fixtures/admitted-legacy-principal';
import { store as appStore } from '$store/renderer/store';
import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
import {
  dockConversationContextSet,
  dockConversationDraftChanged,
  dockConversationLoaded,
  dockEvidenceClipChanged,
  dockEvidenceImageCaptured,
  dockEvidenceInsertionQueued,
  dockEvidenceAnnotationChanged,
  dockEvidenceAnnotationIssue,
  dockEvidenceCapabilitiesChanged,
  dockEvidenceCaptureFailed,
  dockEvidenceMarkAdded,
  dockEvidenceOpenSettingsRequested,
  dockEvidenceToolSet,
  dockSpeechStopRequested,
  openDockConversationRequested,
} from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
import {
  selectDockComposerEvidence,
  selectDockSpeechStopOutcome,
} from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import { setComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import type { DockEvidenceNativeService } from '$shared/dock-evidence';
import type { DockSpeechCapability, DockSpeechEvent } from '$shared/dock-speech';
import {
  configureDockNativeFactory,
  dockNativeSessionSaga,
  type DockNativeAdapter,
} from '$store/renderer/slices/dock-conversation/sagas/dock-native-session-saga';
import type { DockComposerMediaLabels } from '$features/hud/components/dock-composer-media-presentation';
import {
  createDockComposerController,
  type DockComposerControllerDeps,
  type DockComposerLocalState,
} from './dock-composer-controller';
import { buildDockComposerMedia, dockClipPlaybackUrl } from './dock-composer-presentation';

const WS = 'ws-composer';
const AGENT = 'agent-composer';
let cleanups: (() => void)[] = [];

const labels = {
  tools: { pick: 'Pick', box: 'Box', pen: 'Pen', arrow: 'Arrow' },
  captureLimit: 'Up to 4 screenshots',
} as unknown as DockComposerMediaLabels;

const view = () => selectDockComposerEvidence.select(appStore.state, WS, AGENT);
const draft = () => appStore.state.dockConversation.drafts;

function fakeNative(options: { speech?: Partial<DockSpeechCapability> } = {}) {
  let speechListener: ((payload: { speechId: string; event: DockSpeechEvent }) => void) | null =
    null;
  const emit = (speechId: string, event: DockSpeechEvent) => speechListener?.({ speechId, event });
  const adapter = {
    initialize: vi.fn(async () => ({
      ok: true as const,
      value: {
        capture: true,
        annotate: false,
        record: false,
        speech: {
          available: true,
          engine: 'analyzer' as const,
          speech: 'authorized' as const,
          microphone: 'authorized' as const,
          locale: 'en-US',
          onDevice: true,
          ...options.speech,
        } as DockSpeechCapability,
      },
    })),
    cancel: vi.fn(async () => undefined),
    openSettings: vi.fn(async () => ({ ok: true as const, value: undefined })),
    service: {
      capabilities: { capture: true, annotate: false, record: false },
      subscribe: () => () => undefined,
    } as unknown as DockEvidenceNativeService,
    speech: {
      start: vi.fn(async () => ({ ok: true as const, value: undefined })),
      // Native stop is the final-transcript barrier: it emits `ended` before resolving.
      stop: vi.fn(async (speechId: string) => {
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
  return { adapter, emit };
}

/** A native that never installs: the UI-only controller runs without a session. */
const absentNative = (): DockNativeAdapter =>
  ({
    initialize: async () => ({ ok: false, error: 'unavailable' }),
    cancel: async () => undefined,
    speech: { subscribe: () => () => undefined },
  }) as unknown as DockNativeAdapter;

/**
 * Install `native` through the real root saga: re-entering the same scope starts a
 * fresh native session with the injected factory (identity, drafts and evidence kept).
 */
async function installNative(native: ReturnType<typeof fakeNative>) {
  configureDockNativeFactory(() => native.adapter as unknown as DockNativeAdapter);
  const authority = getPrincipalActionContext(appStore.state)!;
  appStore.dispatch(dockConversationContextSet('identity', 'reopening'));
  appStore.dispatch(dockConversationContextSet('identity', authority));
  await vi.waitFor(() => expect(view().speech.capability).not.toBeNull());
}

function deps(): Partial<DockComposerControllerDeps> {
  return {
    createPreviewUrl: vi.fn(async () => 'blob:preview'),
    revokeUrl: vi.fn(),
    tick: () => Promise.resolve(),
    ackTimeoutMs: 40,
    now: () => 10_000,
  };
}

beforeEach(() => {
  configureDockNativeFactory(absentNative);
  installMockBackend();
  cleanups = [appStore.init(createAdmittedLegacyPrincipal())];
  // `init` starts no app sagas in tests; the production root that owns the native
  // session must observe the scope from the start (the app forks it from its root).
  cleanups.push(appStore.runSaga(dockNativeSessionSaga));
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
  appStore.dispatch(dockConversationDraftChanged(WS, AGENT, 'typed'));
});
afterEach(() => {
  cleanups.reverse().forEach((dispose) => dispose());
  configureDockNativeFactory(null);
  resetMockBackend();
});

const scope = () => ({
  workspaceId: WS,
  agentId: AGENT,
  authority: getPrincipalActionContext(appStore.state)!,
});

describe('dock composer controller', () => {
  it('ends speech and sends anyway when the stop fails, surfacing the error', async () => {
    const native = fakeNative();
    await installNative(native);
    const controller = createDockComposerController(scope(), deps());
    controller.actions.onDictationToggle();
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
    await vi.waitFor(() => expect(view().dictation).toMatchObject({ status: 'listening' }));
    native.adapter.speech.stop.mockResolvedValueOnce({
      ok: false,
      error: 'failed',
    } as never);
    const before = draft();
    // No words were spoken, so nothing is added; Send is not refused.
    await expect(controller.beforeSubmit(() => true)).resolves.toBe(true);
    expect(draft()).toBe(before);
    expect(view().dictation).toBeNull();
    expect(view().speech.active).toBe(false);
    expect(view().speech.error).toBe('failed');
    // The failed stop is retried once when Send ends the session, so the microphone goes off.
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });

  it('settles concurrent stops sharing one native completion without overwriting, so the first send neither hangs nor flushes twice', async () => {
    const native = fakeNative();
    await installNative(native);
    const controller = createDockComposerController(scope(), { ...deps(), mac: () => true });
    controller.actions.onDictationToggle();
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
    let finish: () => void = () => undefined;
    native.adapter.speech.stop.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          finish = () => {
            native.emit(id, {
              type: 'transcript',
              utterance: 0,
              revision: 1,
              isFinal: true,
              text: 'spoken once',
              startMs: 0,
              endMs: 400,
              segments: [{ text: 'spoken once', startMs: 0, endMs: 400 }],
            });
            const ended = { type: 'ended' as const, reason: 'stopped' as const, elapsedMs: 900 };
            native.emit(id, ended);
            resolve({ ok: true, value: ended } as never);
          };
        }),
    );
    const spy = vi.spyOn(appStore, 'dispatch');
    let text = 'typed';
    const flushed: string[] = [];
    const flush = () => {
      const head = view().insertions[0];
      if (!head) return false;
      flushed.push(head.id);
      text += head.parts.map((part) => (part.kind === 'text' ? ` ${part.text}` : '')).join('');
      controller.insertionApplied(head.id, text);
      return true;
    };
    // Send starts the barrier; Escape and another owner stop while it is pending.
    const sending = controller.beforeSubmit(flush);
    await vi.waitFor(() => expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1));
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    appStore.dispatch(dockSpeechStopRequested(WS, AGENT, 'other-owner'));
    const requested = () =>
      spy.mock.calls
        .map(([action]) => action as { type: string; payload: unknown[] })
        .filter((action) => action.type === 'dockConversation/speechStopRequested');
    // The controller coalesced Send and Escape into one request.
    expect(requested().filter((action) => action.payload[2] !== 'other-owner')).toHaveLength(1);
    finish();
    await expect(sending).resolves.toBe(true);
    // Both requests settled on the one native completion; neither overwrote the other.
    const ids = requested().map((action) => action.payload[2] as string);
    for (const id of ids)
      expect(selectDockSpeechStopOutcome.select(appStore.state, id)).toEqual({
        requestId: id,
        ok: true,
      });
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1);
    expect(flushed).toEqual([`${speechId}:0`]);
    // The words were committed exactly once.
    expect(text.split('spoken once')).toHaveLength(2);
    spy.mockRestore();
    await controller.dispose();
  });

  it('bounds a stop that never settles: Send keeps the live words as typed text and sends once', async () => {
    const native = fakeNative();
    await installNative(native);
    const controller = createDockComposerController(scope(), { ...deps(), sendStopMs: 50 });
    controller.actions.onDictationToggle();
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
    native.emit(speechId, {
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: false,
      text: 'live words',
      startMs: 0,
      endMs: null,
      segments: [{ text: 'live words', startMs: 0, endMs: null }],
    });
    await vi.waitFor(() => expect(view().dictation?.interim?.length).toBeGreaterThan(0));
    // Native holds the stop (for example the recognizer never finalizes).
    let finish: () => void = () => undefined;
    native.adapter.speech.stop.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          finish = () => {
            native.emit(id, {
              type: 'transcript',
              utterance: 0,
              revision: 2,
              isFinal: true,
              text: 'live words',
              startMs: 0,
              endMs: 400,
              segments: [{ text: 'live words', startMs: 0, endMs: 400 }],
            });
            const ended = { type: 'ended' as const, reason: 'stopped' as const, elapsedMs: 900 };
            native.emit(id, ended);
            resolve({ ok: true, value: ended } as never);
          };
        }),
    );
    let text = '';
    const flush = () => {
      const head = view().insertions[0];
      if (!head) return false;
      text += head.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('');
      controller.insertionApplied(head.id, text);
      return true;
    };
    // Send does not refuse: the live words become typed text and the session ends.
    await expect(controller.beforeSubmit(flush)).resolves.toBe(true);
    expect(text).toBe('live words');
    expect(view().speech.active).toBe(false);
    expect(view().dictation).toBeNull();
    expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1);
    // Native's late final never adds the same words a second time.
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view().insertionsQueued).toBe(0);
    expect(view().speech.error).toBeNull();
    expect(text).toBe('live words');
    await controller.dispose();
  });

  it('retires a pending speech stop without reading the disposed store or sending the draft', async () => {
    const native = fakeNative();
    await installNative(native);
    native.adapter.speech.stop.mockImplementationOnce(() => new Promise(() => undefined));
    const controller = createDockComposerController(scope(), { ...deps(), sendStopMs: 1_000 });
    controller.actions.onDictationToggle();
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
    const flush = vi.fn(() => true);
    const sending = controller.beforeSubmit(flush);
    await vi.waitFor(() => expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1));

    controller.dispose();
    cleanups
      .splice(0)
      .reverse()
      .forEach((dispose) => dispose());

    await expect(sending).resolves.toBe(false);
    expect(flush).not.toHaveBeenCalled();
  });

  it('sends the known words when the stop ends in an error, surfacing the error without refusing', async () => {
    const native = fakeNative();
    await installNative(native);
    const controller = createDockComposerController(scope(), deps());
    controller.actions.onDictationToggle();
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
    native.emit(speechId, {
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: false,
      text: 'kept words',
      startMs: 0,
      endMs: null,
      segments: [{ text: 'kept words', startMs: 0, endMs: null }],
    });
    await vi.waitFor(() => expect(view().dictation?.interim?.length).toBeGreaterThan(0));
    // The watchdog fires: a fatal error and an error end arrive on the channel, then the
    // stop resolves failed. Send keeps the known words and proceeds.
    native.adapter.speech.stop.mockImplementationOnce(async (id: string) => {
      native.emit(id, {
        type: 'error',
        code: 'recognition-failed',
        message: 'finalization watchdog',
        fatal: true,
      });
      native.emit(id, { type: 'ended', reason: 'error', elapsedMs: 10_000 });
      return { ok: false, error: 'failed' } as never;
    });
    const before = draft();
    let text = 'typed';
    const flush = () => {
      const head = view().insertions[0];
      if (!head) return false;
      text += head.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('');
      controller.insertionApplied(head.id, text);
      return true;
    };
    expect(draft()).toBe(before);
    await expect(controller.beforeSubmit(flush)).resolves.toBe(true);
    // Nothing dropped: the known words are committed once; the error stays surfaced.
    expect(text.split('kept words')).toHaveLength(2);
    expect(view().speech).toMatchObject({ active: false, error: 'recognition-failed' });
    expect(view().dictation).toBeNull();
    expect(view().insertionsQueued).toBe(0);
    await controller.dispose();
  });

  it('ticks the local elapsed clock only while a clip records, notifying presentation, and stops on end and dispose', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let clock = 10_000;
      const controller = createDockComposerController(scope(), { ...deps(), now: () => clock });
      const seen: number[] = [];
      const stop = controller.local.subscribe((state) => seen.push(state.now));
      appStore.dispatch(
        dockEvidenceClipChanged(WS, AGENT, 'clip-1', {
          id: 'clip-1',
          status: 'recording',
          startedAt: 10_000,
          durationMs: 0,
          hasMicAudio: false,
        }),
      );
      controller.syncTicker(view());
      controller.syncTicker(view());
      // One interval however often presentation re-syncs.
      expect(vi.getTimerCount()).toBe(1);
      clock = 75_000;
      vi.advanceTimersByTime(250);
      expect(get(controller.local).now).toBe(75_000);
      expect(seen.at(-1)).toBe(75_000);
      const media = buildDockComposerMedia({
        workspaceId: WS,
        view: view(),
        items: [],
        local: get(controller.local),
        labels,
        actions: controller.actions,
        beforeSubmit: async () => true,
      });
      expect(media.state.recordingTime).toBe('1:05');
      // Recording ended: the ticker is torn down and the clock stops advancing.
      appStore.dispatch(
        dockEvidenceClipChanged(WS, AGENT, 'clip-1', {
          id: 'clip-1',
          status: 'placing',
          startedAt: 10_000,
          durationMs: 65_000,
          hasMicAudio: false,
        }),
      );
      controller.syncTicker(view());
      expect(vi.getTimerCount()).toBe(0);
      const notified = seen.length;
      clock = 90_000;
      vi.advanceTimersByTime(1_000);
      expect(get(controller.local).now).toBe(75_000);
      expect(seen).toHaveLength(notified);
      // A ticker running at dispose is cleared, and a disposed controller never restarts it.
      appStore.dispatch(
        dockEvidenceClipChanged(WS, AGENT, 'clip-2', {
          id: 'clip-2',
          status: 'recording',
          startedAt: 90_000,
          durationMs: 0,
          hasMicAudio: false,
        }),
      );
      controller.syncTicker(view());
      expect(vi.getTimerCount()).toBe(1);
      controller.dispose();
      expect(vi.getTimerCount()).toBe(0);
      controller.syncTicker(view());
      expect(vi.getTimerCount()).toBe(0);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops speech, then commits one queued head per editor acknowledgement before send', async () => {
    const controller = createDockComposerController(scope(), deps());
    appStore.dispatch(
      dockEvidenceInsertionQueued(WS, AGENT, { id: 'a', parts: [{ kind: 'text', text: ' one' }] }),
    );
    appStore.dispatch(
      dockEvidenceInsertionQueued(WS, AGENT, { id: 'b', parts: [{ kind: 'text', text: ' two' }] }),
    );
    let text = 'typed';
    const flushed: string[] = [];
    // The editor applies only the current head and acknowledges it with its full text.
    const flush = () => {
      const head = view().insertions[0];
      if (!head) return false;
      flushed.push(head.id);
      text += (head.parts[0] as { text: string }).text;
      controller.insertionApplied(head.id, text);
      return true;
    };
    await expect(controller.beforeSubmit(flush)).resolves.toBe(true);
    expect(flushed).toEqual(['a', 'b']);
    expect(view().insertions).toEqual([]);
    await controller.dispose();
  });

  it('keeps the draft and remaining insertions when an acknowledgement never arrives', async () => {
    const controller = createDockComposerController(scope(), deps());
    appStore.dispatch(
      dockEvidenceInsertionQueued(WS, AGENT, { id: 'a', parts: [{ kind: 'text', text: ' one' }] }),
    );
    const before = draft();
    await expect(controller.beforeSubmit(() => true)).resolves.toBe(false);
    expect(draft()).toBe(before);
    expect(view().insertions.map((row) => row.id)).toEqual(['a']);
    await controller.dispose();
  });

  it('projects evidence and ordinary attachments with their owners and honest capability states', async () => {
    appStore.dispatch(
      setComposerContextItems(WS, AGENT, [
        {
          id: 'raw-1',
          type: 'file',
          label: 'shot.png',
          imageData: 'AAAA',
          imageMimeType: 'image/png',
        },
        {
          id: 'notes',
          type: 'file',
          label: 'notes.pdf',
          attachmentId: 'att',
          placementStatus: 'placed',
        },
      ]),
    );
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
      dockEvidenceClipChanged(WS, AGENT, 'clip-1', {
        id: 'clip-1',
        status: 'placing',
        startedAt: 0,
        durationMs: 65_000,
        hasMicAudio: false,
      }),
    );
    const controller = createDockComposerController(scope(), deps());
    const media = buildDockComposerMedia({
      workspaceId: WS,
      view: view(),
      items: selectComposerContextItems.select(appStore.state, WS, AGENT),
      local: { ...get(controller.local), previews: { 'image-1': 'blob:preview' } },
      labels,
      actions: controller.actions,
      beforeSubmit: async () => true,
    });
    expect(media.attachments.map((row) => [row.kind, row.id, row.owner, row.status])).toEqual([
      ['image', 'raw-1', 'evidence', undefined],
      ['clip', 'clip-1', 'evidence', 'placing'],
      ['file', 'notes', 'attachment', undefined],
    ]);
    expect(media.state).toMatchObject({
      captureRevision: 1,
      captureDisabled: true,
      annotationDisabled: true,
      recordingDisabled: true,
      dictationDisabled: true,
    });
    // A finished clip uploading in the background never blocks the next recording.
    expect(media.state.recordingPending).toBeFalsy();
    await controller.dispose();
  });
});

describe('dock composer permission alerts', () => {
  const copy = {
    idle: 'idle',
    captured: 'captured',
    annotating: 'annotating',
    permission: 'Allow screen recording',
    openSettings: 'Open Settings',
    speechPermission: 'Allow microphone',
    accessibilityPermission: 'Allow accessibility',
    annotationUnavailable: 'Annotation is unavailable here',
  };
  function build(local: Partial<DockComposerLocalState> = {}) {
    const controller = createDockComposerController(scope(), deps());
    const onOpenSettings = vi.fn();
    const media = buildDockComposerMedia({
      workspaceId: WS,
      view: view(),
      items: [],
      local: { ...get(controller.local), ...local },
      labels,
      actions: { ...controller.actions, onOpenSettings },
      beforeSubmit: async () => true,
      copy,
    });
    return { media, onOpenSettings, controller };
  }

  it('marks no control without a permission problem', async () => {
    const { media, onOpenSettings, controller } = build();
    expect(media.state.alerts).toBeUndefined();
    expect(media.settingsPane).toBeUndefined();
    media.onAlert?.('capture');
    expect(onOpenSettings).not.toHaveBeenCalled();
    await controller.dispose();
  });

  it('marks the mic from the initial denied capability before any start; its click opens Microphone', async () => {
    // The native session's initial probe reports a denied microphone before any start.
    await installNative(
      fakeNative({
        speech: {
          available: false,
          engine: null,
          microphone: 'denied',
          reason: 'microphone-permission-denied',
        },
      }),
    );
    const { media, onOpenSettings, controller } = build();
    expect(media.settingsPane).toBe('microphone');
    expect(media.state.alerts).toEqual({ mic: expect.any(String) });
    // Clickable so the click can open Settings; never opened automatically.
    expect(media.state.dictationDisabled).toBe(false);
    expect(onOpenSettings).not.toHaveBeenCalled();
    media.onAlert?.('mic');
    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('microphone');
    await controller.dispose();
  });

  it('maps annotate issues: pick permission to annotate+pick (Accessibility), a refused mark to annotate (Screen), unavailable to a hint', async () => {
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-1', mode: 'live', imageId: null }),
    );
    appStore.dispatch(
      dockEvidenceAnnotationIssue(WS, AGENT, {
        sessionId: 'session-1',
        kind: 'pick',
        error: 'permission',
      }),
    );
    let built = build();
    // During the session the annotate button still ends it; only pick is marked.
    expect(built.media.state.alerts).toEqual({ pick: 'Allow accessibility' });
    built.media.onAlert?.('pick');
    expect(built.onOpenSettings).toHaveBeenCalledExactlyOnceWith('accessibility');
    await built.controller.dispose();

    // The missing grant outlives the session: with pick current, a click opens Settings.
    appStore.dispatch(dockEvidenceAnnotationChanged(WS, AGENT, null));
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-2', mode: 'live', imageId: null }),
    );
    appStore.dispatch(dockEvidenceAnnotationChanged(WS, AGENT, null));
    built = build();
    expect(built.media.state.alerts).toEqual({
      pick: 'Allow accessibility',
      annotate: 'Allow accessibility',
    });
    built.media.onAlert?.('annotate');
    expect(built.onOpenSettings).toHaveBeenCalledExactlyOnceWith('accessibility');
    await built.controller.dispose();
    // Box, pen and arrow do not need Accessibility: the annotate button starts them.
    appStore.dispatch(dockEvidenceToolSet(WS, 'box'));
    built = build();
    expect(built.media.state.alerts).toEqual({ pick: 'Allow accessibility' });
    await built.controller.dispose();
    // Opening the pane is the fix: the next click tries again.
    appStore.dispatch(dockEvidenceOpenSettingsRequested(WS, AGENT, 'accessibility'));
    expect(view().annotationIssue).toBeNull();

    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-3', mode: 'live', imageId: null }),
    );
    appStore.dispatch(
      dockEvidenceAnnotationIssue(WS, AGENT, {
        sessionId: 'session-3',
        kind: 'capture',
        error: 'permission',
      }),
    );
    built = build();
    expect(built.media.settingsPane).toBe('screen');
    // The alert marks the refused tool, not capture or record; while the session runs
    // the annotate button still ends it, so the dot waits for the session to end.
    expect(built.media.state.alerts).toBeUndefined();
    await built.controller.dispose();
    appStore.dispatch(dockEvidenceAnnotationChanged(WS, AGENT, null));
    built = build();
    expect(built.media.state.alerts).toEqual({ annotate: 'Allow screen recording' });
    built.media.onAlert?.('annotate');
    expect(built.onOpenSettings).toHaveBeenCalledExactlyOnceWith('screen');
    await built.controller.dispose();
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-3', mode: 'live', imageId: null }),
    );

    // Unavailable is not a settings problem: a localized hint, no pane, no alert.
    appStore.dispatch(
      dockEvidenceAnnotationIssue(WS, AGENT, {
        sessionId: 'session-3',
        kind: 'target',
        error: 'unavailable',
      }),
    );
    built = build();
    expect(built.media.settingsPane).toBeUndefined();
    expect(built.media.state.alerts).toBeUndefined();
    expect(built.media.annotationNotice).toBe('Annotation is unavailable here');
    await built.controller.dispose();

    // A new annotate session starts without the previous session's issue.
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session-4', mode: 'live', imageId: null }),
    );
    expect(view().annotationIssue).toBeNull();
    built = build();
    expect(built.media.annotationNotice).toBeUndefined();
    await built.controller.dispose();
  });

  it('marks capture and record after a Screen Recording refusal until Settings is opened', async () => {
    appStore.dispatch(dockEvidenceCaptureFailed(WS, AGENT, 'permission'));
    let built = build();
    expect(built.media.state.alerts).toEqual({
      capture: 'Allow screen recording',
      record: 'Allow screen recording',
    });
    built.media.onAlert?.('capture');
    expect(built.onOpenSettings).toHaveBeenCalledExactlyOnceWith('screen');
    await built.controller.dispose();
    appStore.dispatch(dockEvidenceOpenSettingsRequested(WS, AGENT, 'screen'));
    built = build();
    expect(built.media.state.alerts).toBeUndefined();
    await built.controller.dispose();
  });
});

describe('dock composer keyboard shortcuts', () => {
  const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };
  function annotateWithMark() {
    appStore.dispatch(
      dockEvidenceCapabilitiesChanged({ capture: true, annotate: true, record: false }),
    );
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
      dockEvidenceMarkAdded(WS, AGENT, {
        id: 'mark-1',
        imageId: 'image-1',
        tool: 'box',
        geometry: { kind: 'rect', x: 1, y: 1, w: 5, h: 5 },
        bounds: { x: 1, y: 1, w: 5, h: 5 },
        element: null,
        createdAt: 0,
      }),
    );
    appStore.dispatch(
      dockEvidenceAnnotationChanged(WS, AGENT, { id: 'session', mode: 'live', imageId: 'image-1' }),
    );
  }
  function dispatched() {
    return vi
      .mocked(appStore.dispatch)
      .mock.calls.map(([action]) => (action as { type: string }).type);
  }

  it('maps the dock chords only where the capability exists and consumes only acted events', async () => {
    const controller = createDockComposerController(scope(), {
      ...deps(),
      mac: () => true,
    });
    const spy = vi.spyOn(appStore, 'dispatch');
    const disabled = key({ key: 'S', metaKey: true, shiftKey: true });
    expect(controller.handleKey(disabled)).toBe(false);
    expect(disabled.defaultPrevented).toBe(false);
    appStore.dispatch(
      dockEvidenceCapabilitiesChanged({ capture: true, annotate: true, record: false }),
    );
    const capture = key({ key: 'S', metaKey: true, shiftKey: true });
    expect(controller.handleKey(capture)).toBe(true);
    expect(capture.defaultPrevented).toBe(true);
    // The same event (e.g. a duplicate listener) is never acted on twice.
    expect(controller.handleKey(capture)).toBe(false);
    expect(controller.handleKey(key({ key: 'A', metaKey: true, shiftKey: true }))).toBe(true);
    // Record is not available: the chord is left to the platform.
    expect(controller.handleKey(key({ key: 'R', metaKey: true, shiftKey: true }))).toBe(false);
    // Ctrl is not the macOS modifier.
    expect(controller.handleKey(key({ key: 'S', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(dispatched().filter((type) => type.startsWith('dockConversation/evidence'))).toEqual([
      'dockConversation/evidenceCapabilitiesChanged',
      'dockConversation/evidenceCaptureRequested',
      'dockConversation/evidenceAnnotationToggleRequested',
    ]);
    spy.mockRestore();
    await controller.dispose();
  });

  it.each(['native', 'aria', 'edit-context'])(
    'switches tools only with the %s field unfocused and undoes the last mark from the field',
    async (kind) => {
      // Undo and redo run in the evidence saga (they also move the image's composer item).
      cleanups.push(appStore.runSaga(dockEvidenceSaga));
      const controller = createDockComposerController(scope(), {
        ...deps(),
        mac: () => true,
      });
      annotateWithMark();
      const spy = vi.spyOn(appStore, 'dispatch');
      const field = document.createElement(kind === 'native' ? 'textarea' : 'div');
      field.tabIndex = 0;
      if (kind === 'aria') field.setAttribute('role', 'textbox');
      if (kind === 'edit-context') Object.defineProperty(field, 'editContext', { value: {} });
      document.body.append(field);
      field.focus();
      expect(controller.handleKey(key({ key: '2' }, field))).toBe(false);
      field.blur();
      expect(controller.handleKey(key({ key: '2' }))).toBe(true);
      expect(controller.handleKey(key({ key: '2', repeat: true }))).toBe(false);
      // Sessions never take focus from the field, so undo works while it is focused.
      field.focus();
      expect(controller.handleKey(key({ key: 'z', metaKey: true }, field))).toBe(true);
      await vi.waitFor(() => expect(view().evidence?.marks).toEqual([]));
      // Nothing left to undo: the chord stays with the platform (text undo).
      expect(controller.handleKey(key({ key: 'z', metaKey: true }))).toBe(false);
      // Cmd+Shift+Z brings the mark back with its number.
      expect(controller.handleKey(key({ key: 'z', metaKey: true, shiftKey: true }))).toBe(true);
      await vi.waitFor(() =>
        expect(view().evidence?.marks.map((row) => row.id)).toEqual(['mark-1']),
      );
      expect(controller.handleKey(key({ key: 'z', metaKey: true, shiftKey: true }))).toBe(false);
      expect(dispatched()).toContain('dockConversation/evidenceToolSelectRequested');
      field.remove();
      spy.mockRestore();
      await controller.dispose();
    },
  );

  it('backs out one level per Escape: live speech first, then annotation, then nothing', async () => {
    const native = fakeNative();
    await installNative(native);
    const controller = createDockComposerController(scope(), { ...deps(), mac: () => true });
    annotateWithMark();
    controller.actions.onDictationToggle();
    await vi.waitFor(() => expect(native.adapter.speech.start).toHaveBeenCalledTimes(1));
    // A suggestion list or menu owns its own Escape.
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    expect(controller.handleKey(key({ key: 'Escape' }, list))).toBe(false);
    expect(controller.handleKey(key({ key: 'Escape', isComposing: true }))).toBe(false);
    expect(controller.handleKey(key({ key: 'Escape' }))).toBe(true);
    await vi.waitFor(() => expect(native.adapter.speech.stop).toHaveBeenCalledTimes(1));
    // Marks survive; the annotate session is the next level.
    expect(view().evidence?.marks.map((mark) => mark.id)).toEqual(['mark-1']);
    const spy = vi.spyOn(appStore, 'dispatch');
    expect(controller.handleKey(key({ key: 'Escape' }))).toBe(true);
    expect(dispatched()).toContain('dockConversation/evidenceAnnotationEndRequested');
    spy.mockRestore();
    await controller.dispose();
  });
});

describe('dock clip playback', () => {
  it('builds a workspace-file video URL only from a daemon placement path', () => {
    expect(dockClipPlaybackUrl('ws-1', '.intent/attachments/clip a.webm')).toBe(
      'workspace-file://ws-1/.intent/attachments/clip%20a.webm',
    );
    expect(dockClipPlaybackUrl('ws-1', '.intent/attachments/notes.pdf')).toBeUndefined();
    expect(dockClipPlaybackUrl('ws-1', '../outside.webm')).toBeUndefined();
    expect(dockClipPlaybackUrl('ws-1', undefined)).toBeUndefined();
  });
});
