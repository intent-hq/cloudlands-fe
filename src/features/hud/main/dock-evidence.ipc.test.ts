import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  begin: vi.fn(),
  capture: vi.fn(),
  cancel: vi.fn(),
  context: vi.fn(),
  setCaptureExclusionIds: vi.fn(),
  recorder: {
    onEnded: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    setMicrophone: vi.fn(),
    setExcludedWindows: vi.fn(),
    capability: vi.fn(),
  },
  annotation: {
    onOverlayWindowsChanged: vi.fn(),
    subscribe: vi.fn(),
    onIssue: vi.fn(),
    overlayWindowIds: vi.fn(),
    configure: vi.fn(),
    startAnnotation: vi.fn(),
    endAnnotation: vi.fn(),
    retireResources: vi.fn(),
    refreshPicker: vi.fn(),
  },
  speech: vi.fn(),
  openExternal: vi.fn(),
  trusted: vi.fn((_prompt: boolean) => true),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/isolated-test-data', on: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  webContents: { getAllWebContents: () => [] },
  shell: { openExternal: mocks.openExternal },
  systemPreferences: {
    getMediaAccessStatus: () => 'granted',
    isTrustedAccessibilityClient: (prompt: boolean) => mocks.trusted(prompt),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
}));
vi.mock('./dock-evidence-session', () => ({
  dockEvidenceSessions: mocks,
  dockEvidenceRecorder: mocks.recorder,
}));
vi.mock('../../../main/dock-window', () => ({
  getDockVisibleSurfaceRegions: vi.fn(() => []),
  getDockVisibleSurfaceBounds: vi.fn(() => null),
  getDockPlacementSnapshot: vi.fn(() => null),
  getDockWindow: () => null,
}));
vi.mock('./dock-annotation-window', () => ({
  setupDockAnnotationIPC: vi.fn(),
  watchDockNavigation: vi.fn(),
  dockAnnotationController: mocks.annotation,
}));
vi.mock('./dock-screen-recorder', () => ({ cgWindowIdFromMediaSourceId: () => 42 }));
vi.mock('./dock-speech', () => ({ probeDockSpeech: vi.fn(), startDockSpeech: mocks.speech }));

import { setupDockEvidenceIPC } from './dock-evidence.ipc';
import { DOCK_EVIDENCE_CHANNELS } from '../../../shared/dock-evidence-ipc';

const scope = { workspaceId: 'workspace', agentId: 'agent', draftId: 'draft' };
const sessionId = '26d570f5-dfda-4f1b-8694-26cd9d23efea';
const requestId = 'e2505a43-3f77-4519-a6c4-3338a8970129';

describe('dock evidence IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.context.mockReturnValue(null);
    mocks.annotation.overlayWindowIds.mockReturnValue([]);
    setupDockEvidenceIPC();
  });
  function event() {
    const frame = {};
    return { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  }
  function mediaContext() {
    let current = true;
    let dispose = () => {};
    const send = vi.fn();
    const context = {
      scope: { ...scope, sessionId },
      backendId: 'remote',
      window: { webContents: { send }, getMediaSourceId: () => 'window:42:0' },
      display: { id: 7 },
      isCurrent: () => current,
      onDispose: (listener: () => void) => {
        dispose = listener;
        return () => {};
      },
    };
    // Match the real session registry: a retired session cannot be resolved again.
    mocks.context.mockImplementation(() => (current ? context : null));
    const invoke = (control: unknown) =>
      mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.CONTROL)!(event(), {
        ...scope,
        sessionId,
        control,
      });
    return {
      send,
      invoke,
      retire: () => {
        current = false;
        dispose();
      },
    };
  }

  async function speakingAnnotation() {
    const f = mediaContext();
    mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
    await f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'box' },
    });
    const host = mocks.annotation.configure.mock.calls.at(-1)![0];
    const speechId = 'f198558e-36d8-4ea3-b6d9-45f0fe7a8bc3';
    let deliver!: (event: unknown) => void;
    const handle = {
      sessionId: speechId,
      dispose: vi.fn(),
      mark: vi.fn(),
      stop: vi.fn(),
      activity: vi.fn(),
    };
    mocks.speech.mockImplementation((options) => {
      deliver = options.onEvent;
      return handle;
    });
    const starting = f.invoke({ action: 'speech-start', speechId });
    deliver({ type: 'ready', sessionId: speechId, startedAtEpochMs: 20 });
    await starting;
    f.send.mockClear();
    return { ...f, host, handle, deliver, speechId };
  }

  it('stamps at gesture start but publishes only accepted references before buffered final text', async () => {
    const f = await speakingAnnotation();
    f.host.onGestureStart(requestId, 'mark-1');
    expect(f.handle.mark).toHaveBeenCalledExactlyOnceWith('mark-1');
    f.deliver({ type: 'transcript', utterance: 0, revision: 1, isFinal: true, text: 'here' });
    // Native capture can finish before the helper's stamp response arrives.
    mocks.annotation.subscribe.mock.calls[0][0]({
      type: 'mark',
      sessionId: requestId,
      markId: 'mark-1',
      gestureAtEpochMs: 30,
    });
    f.host.onGestureSettled(requestId, 'mark-1', 'committed');
    expect(f.send.mock.calls.map(([, payload]) => payload.kind)).toEqual(['evidence']);
    f.deliver({ type: 'mark', markId: 'mark-1', elapsedMs: 10 });
    expect(f.send.mock.calls.map(([, payload]) => payload.kind)).toEqual(['evidence']);
    expect(
      await f.invoke({
        action: 'annotation-mark-result',
        annotationId: requestId,
        markId: 'mark-1',
        accepted: true,
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(f.send.mock.calls.map(([, payload]) => [payload.kind, payload.event.type])).toEqual([
      ['evidence', 'mark'],
      ['speech', 'mark'],
      ['speech', 'transcript'],
    ]);
    f.deliver({ type: 'mark', markId: 'mark-1', elapsedMs: 10 });
    f.host.onGestureSettled(requestId, 'mark-1', 'committed');
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it('drops a renderer-refused new-image reference while preserving words and releasing Stop', async () => {
    const f = await speakingAnnotation();
    f.host.onGestureStart(requestId, 'fifth-image-mark');
    expect(
      await f.invoke({
        action: 'annotation-mark-result',
        annotationId: requestId,
        markId: 'fifth-image-mark',
        accepted: true,
      }),
    ).toEqual({ ok: false, error: 'unavailable' });
    f.deliver({ type: 'mark', markId: 'fifth-image-mark', elapsedMs: 10 });
    f.deliver({
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: true,
      text: 'keep these words',
    });
    mocks.annotation.subscribe.mock.calls[0][0]({
      type: 'mark',
      sessionId: requestId,
      markId: 'fifth-image-mark',
      capture: { image: { id: 'new-screen' } },
    });
    f.host.onGestureSettled(requestId, 'fifth-image-mark', 'committed');
    // The model may end its native annotation before reporting its capacity refusal.
    await f.invoke({ action: 'annotation-end', annotationId: requestId });
    const ended = { type: 'ended', reason: 'stopped', elapsedMs: 20 };
    f.handle.stop.mockImplementation(async () => {
      f.deliver(ended);
      return ended;
    });
    let stopped = false;
    const stopping = Promise.resolve(
      f.invoke({ action: 'speech-stop', speechId: f.speechId }),
    ).then((value) => {
      stopped = true;
      return value;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(f.send.mock.calls.map(([, payload]) => payload.kind)).toEqual(['evidence']);
    const refusal = {
      action: 'annotation-mark-result',
      annotationId: requestId,
      markId: 'fifth-image-mark',
      accepted: false,
    };
    expect(await f.invoke({ ...refusal, annotationId: sessionId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(await f.invoke(refusal)).toEqual({ ok: true, value: undefined });
    expect(await stopping).toEqual({ ok: true, value: ended });
    expect(
      f.send.mock.calls
        .filter(([, payload]) => payload.kind === 'speech')
        .map(([, payload]) => payload.event),
    ).toEqual([expect.objectContaining({ type: 'transcript', text: 'keep these words' }), ended]);
    const count = f.send.mock.calls.length;
    expect(await f.invoke(refusal)).toEqual({ ok: true, value: undefined });
    expect(await f.invoke({ ...refusal, accepted: true })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    f.deliver({ type: 'mark', markId: 'fifth-image-mark', elapsedMs: 10 });
    expect(f.send).toHaveBeenCalledTimes(count);
    f.retire();
    expect(await f.invoke(refusal)).toEqual({ ok: false, error: 'unavailable' });
  });

  it.each(['rejected', 'cancelled'])(
    'drops %s gesture references including late helper stamps',
    async (outcome) => {
      const f = await speakingAnnotation();
      f.host.onGestureStart(requestId, 'mark-1');
      f.deliver({ type: 'transcript', utterance: 0, revision: 1, isFinal: true, text: 'keep' });
      expect(f.send).not.toHaveBeenCalled();
      f.host.onGestureSettled(requestId, 'mark-1', outcome);
      f.deliver({ type: 'mark', markId: 'mark-1', elapsedMs: 10 });
      expect(f.send.mock.calls.map(([, payload]) => payload.event.type)).toEqual(['transcript']);
      f.host.onGestureStart('stale-annotation', 'mark-2');
      f.retire();
      f.host.onGestureStart(requestId, 'mark-3');
      expect(f.handle.mark).toHaveBeenCalledTimes(1);
    },
  );

  it('holds speech stop behind gesture settlement and releases it on retirement', async () => {
    const f = await speakingAnnotation();
    f.host.onGestureStart(requestId, 'mark-1');
    const ended = { type: 'ended', reason: 'stopped', elapsedMs: 10 };
    f.handle.stop.mockImplementation(async () => {
      f.deliver(ended);
      return ended;
    });
    let settled = false;
    const stopping = Promise.resolve(
      f.invoke({ action: 'speech-stop', speechId: f.speechId }),
    ).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    f.retire();
    expect(await stopping).toEqual({ ok: false, error: 'unavailable' });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('fails a watchdog-ended Stop after mark acknowledgement while preserving known speech events', async () => {
    const f = await speakingAnnotation();
    f.host.onGestureStart(requestId, 'mark-timeout');
    f.deliver({ type: 'mark', markId: 'mark-timeout', elapsedMs: 10 });
    f.deliver({
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: false,
      text: 'known words',
    });
    mocks.annotation.subscribe.mock.calls[0][0]({
      type: 'mark',
      sessionId: requestId,
      markId: 'mark-timeout',
    });
    f.host.onGestureSettled(requestId, 'mark-timeout', 'committed');
    const ended = { type: 'ended', reason: 'error', elapsedMs: 20 };
    f.handle.stop.mockImplementation(async () => {
      f.deliver({
        type: 'error',
        code: 'recognition-failed',
        message: 'finalization timeout',
        fatal: true,
      });
      f.deliver(ended);
      return ended;
    });
    let settled = false;
    const stopping = Promise.resolve(
      f.invoke({ action: 'speech-stop', speechId: f.speechId }),
    ).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(
      await f.invoke({
        action: 'annotation-mark-result',
        annotationId: requestId,
        markId: 'mark-timeout',
        accepted: false,
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(await stopping).toEqual({ ok: false, error: 'failed' });
    expect(
      f.send.mock.calls
        .filter(([, payload]) => payload.kind === 'speech')
        .map(([, payload]) => payload.event),
    ).toEqual([
      expect.objectContaining({ type: 'error', fatal: true }),
      expect.objectContaining({ type: 'transcript', text: 'known words' }),
      ended,
    ]);
    expect(f.handle.stop).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'bounds a lost model ACK and recovers its accepted=%s decision without duplicate words or refs',
    async (accepted) => {
      vi.useFakeTimers();
      try {
        const f = await speakingAnnotation();
        f.host.onGestureStart(requestId, 'recover-mark');
        f.deliver({ type: 'mark', markId: 'recover-mark', elapsedMs: 10 });
        f.deliver({
          type: 'transcript',
          utterance: 0,
          revision: 1,
          isFinal: true,
          text: 'retain the draft',
        });
        mocks.annotation.subscribe.mock.calls[0][0]({
          type: 'mark',
          sessionId: requestId,
          markId: 'recover-mark',
          capture: { image: { id: accepted ? 'accepted-image' : 'fifth-refused-image' } },
        });
        f.host.onGestureSettled(requestId, 'recover-mark', 'committed');
        const ended = { type: 'ended', reason: 'stopped', elapsedMs: 20 };
        f.handle.stop
          .mockImplementationOnce(async () => {
            f.deliver(ended);
            return ended;
          })
          .mockResolvedValue(ended);
        // The renderer's first ACK never reached main; neither value is inferred.
        const firstStop = f.invoke({ action: 'speech-stop', speechId: f.speechId });
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await firstStop).toEqual({
          ok: false,
          error: 'transport',
          detail: 'mark-ack-timeout',
        });
        expect(vi.getTimerCount()).toBe(0);
        expect(f.send.mock.calls.map(([, payload]) => payload.kind)).toEqual(['evidence']);
        const receipt = {
          action: 'annotation-mark-result',
          annotationId: requestId,
          markId: 'recover-mark',
          accepted,
        };
        // Recovery can also lose its success reply; replaying it must stay idempotent.
        await f.invoke(receipt);
        expect(await f.invoke(receipt)).toEqual({ ok: true, value: undefined });
        expect(await f.invoke({ action: 'speech-stop', speechId: f.speechId })).toEqual({
          ok: true,
          value: ended,
        });
        const speech = f.send.mock.calls
          .filter(([, payload]) => payload.kind === 'speech')
          .map(([, payload]) => payload.event);
        expect(speech.filter((event) => event.type === 'mark')).toEqual(
          accepted ? [{ type: 'mark', markId: 'recover-mark', elapsedMs: 10 }] : [],
        );
        expect(speech.filter((event) => event.type === 'transcript')).toEqual([
          expect.objectContaining({ text: 'retain the draft' }),
        ]);
        expect(speech.filter((event) => event.type === 'ended')).toEqual([ended]);
        expect(mocks.capture).not.toHaveBeenCalled();
        expect(f.handle.mark).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('rejects media control when the exact session is stale', async () => {
    expect(
      await mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.CONTROL)!(event(), {
        ...scope,
        sessionId,
        control: { action: 'clip-start', clipId: requestId, maxMs: 120000 },
      }),
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(mocks.recorder.start).not.toHaveBeenCalled();
    expect(mocks.speech).not.toHaveBeenCalled();
  });

  it('forwards typed annotation issues only to the current owning session without opening settings', async () => {
    const f = mediaContext();
    mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
    await f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'pick' },
    });
    const issue = mocks.annotation.onIssue.mock.calls[0][0];
    issue({ sessionId: sessionId, kind: 'pick', error: 'permission' });
    issue({ sessionId: requestId, kind: 'unknown', error: 'permission' });
    expect(f.send).not.toHaveBeenCalled();
    for (const [kind, error] of [
      ['pick', 'permission'],
      ['target', 'permission'],
      ['capture', 'unavailable'],
    ]) {
      issue({ sessionId: requestId, kind, error, detail: 'must not be forwarded' });
      expect(f.send).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.EVENT, {
        ...scope,
        sessionId,
        kind: 'evidence',
        event: { type: 'annotation-issue', sessionId: requestId, kind, error },
      });
    }
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    await f.invoke({ action: 'annotation-end', annotationId: requestId });
    issue({ sessionId: requestId, kind: 'pick', error: 'permission' });
    expect(f.send).toHaveBeenCalledTimes(3);
    f.retire();
    issue({ sessionId: requestId, kind: 'capture', error: 'unavailable' });
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it('opens only a fixed privacy pane for the current dock session on an explicit action', async () => {
    const originalProcess = process;
    vi.stubGlobal('process', { ...originalProcess, platform: 'darwin' });
    try {
      const f = mediaContext();
      expect(mocks.openExternal).not.toHaveBeenCalled();
      for (const [pane, suffix] of [
        ['screen', 'ScreenCapture'],
        ['microphone', 'Microphone'],
        ['speech', 'SpeechRecognition'],
        ['accessibility', 'Accessibility'],
      ]) {
        expect(await f.invoke({ action: 'open-settings', pane })).toEqual({
          ok: true,
          value: undefined,
        });
        expect(mocks.openExternal).toHaveBeenLastCalledWith(
          `x-apple.systempreferences:com.apple.preference.security?Privacy_${suffix}`,
        );
      }
      expect(
        await f.invoke({ action: 'open-settings', pane: 'screen', url: 'file:///secret' }),
      ).toEqual({ ok: false, error: 'unavailable' });
      expect(await f.invoke({ action: 'open-settings', pane: 'https://example.com' })).toEqual({
        ok: false,
        error: 'unavailable',
      });
      expect(await f.invoke({ action: 'open-settings', pane: 'camera' })).toEqual({
        ok: false,
        error: 'unavailable',
      });
      expect(mocks.openExternal).toHaveBeenCalledTimes(4);
      f.retire();
      expect(await f.invoke({ action: 'open-settings', pane: 'screen' })).toEqual({
        ok: false,
        error: 'unavailable',
      });
      expect(mocks.openExternal).toHaveBeenCalledTimes(4);
    } finally {
      vi.stubGlobal('process', originalProcess);
    }
  });

  it('retires a pending annotation start and rejects its late success', async () => {
    const f = mediaContext();
    let finish!: (value: unknown) => void;
    mocks.annotation.startAnnotation.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'box' },
    });
    f.retire();
    expect(mocks.annotation.retireResources).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: undefined });
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('starts recording on the authoritative display and enables mic only after actual speech ready', async () => {
    const f = mediaContext();
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
    mocks.recorder.setMicrophone.mockResolvedValue({ ok: true, value: { micActive: true } });
    expect(
      await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 }),
    ).toMatchObject({ ok: true });
    expect(mocks.recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({ displayId: 7, excludeWindowIds: [42], includeMic: false }),
    );
    let deliver!: (event: unknown) => void;
    const speechId = 'f198558e-36d8-4ea3-b6d9-45f0fe7a8bc3';
    const handle = {
      sessionId: speechId,
      dispose: vi.fn(),
      mark: vi.fn(),
      stop: vi.fn(),
      activity: vi.fn(),
    };
    mocks.speech.mockImplementation((options) => {
      deliver = options.onEvent;
      return handle;
    });
    let settled = false;
    const pending = Promise.resolve(f.invoke({ action: 'speech-start', speechId })).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mocks.recorder.setMicrophone).not.toHaveBeenCalled();
    deliver({
      type: 'ready',
      sessionId: speechId,
      startedAtEpochMs: 20,
      engine: 'recognizer',
      locale: 'en-US',
      onDevice: true,
    });
    expect(await pending).toEqual({ ok: true, value: undefined });
    expect(mocks.recorder.setMicrophone).toHaveBeenLastCalledWith(requestId, true);
    deliver({ type: 'state', state: 'finalizing' });
    expect(mocks.recorder.setMicrophone).toHaveBeenLastCalledWith(requestId, false);
    deliver({ type: 'ended', reason: 'silence', elapsedMs: 8000 });
    expect(mocks.recorder.setMicrophone).toHaveBeenLastCalledWith(requestId, false);
    const sent = f.send.mock.calls.length;
    f.retire();
    deliver({ type: 'level', elapsedMs: 9000, level: 1 });
    expect(f.send).toHaveBeenCalledTimes(sent);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.recorder.cancel).toHaveBeenCalledWith(requestId);
  });

  it('settles a speech start on document retirement even before helper readiness', async () => {
    const f = mediaContext();
    const dispose = vi.fn();
    mocks.speech.mockReturnValue({ sessionId: requestId, dispose });
    const pending = f.invoke({ action: 'speech-start', speechId: requestId });
    f.retire();
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('releases only the session-owned finished clip and cleans finished files on retirement', async () => {
    const f = mediaContext();
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
    await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 });
    expect(await f.invoke({ action: 'clip-release', clipId: requestId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(mocks.recorder.cancel).not.toHaveBeenCalled();
    mocks.recorder.onEnded.mock.calls[0][0](requestId, {
      ok: true,
      value: { sourcePath: '/private/known.mp4' },
    });
    expect(await f.invoke({ action: 'clip-release', clipId: sessionId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(
      await f.invoke({
        action: 'clip-release',
        clipId: requestId,
        sourcePath: '/private/other.mp4',
      }),
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(mocks.recorder.cancel).not.toHaveBeenCalled();
    expect(await f.invoke({ action: 'clip-release', clipId: requestId })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(mocks.recorder.cancel).toHaveBeenCalledExactlyOnceWith(requestId);
    f.retire();
    expect(mocks.recorder.cancel).toHaveBeenCalledTimes(2);
    expect(await f.invoke({ action: 'clip-release', clipId: requestId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
  it('cleans up a late retired clip start before admitting a replacement with the same id', async () => {
    const f = mediaContext();
    let started!: (value: unknown) => void;
    mocks.recorder.start.mockReturnValue(
      new Promise((resolve) => {
        started = resolve;
      }),
    );
    const command = { action: 'clip-start', clipId: requestId, maxMs: 120000 };
    const pending = f.invoke(command);
    f.retire();
    expect(mocks.recorder.cancel).toHaveBeenCalledWith(requestId);
    const replacement = mediaContext();
    expect(await replacement.invoke(command)).toEqual({ ok: false, error: 'unavailable' });
    expect(mocks.recorder.start).toHaveBeenCalledTimes(1);
    let cleaned!: () => void;
    mocks.recorder.cancel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        cleaned = resolve;
      }),
    );
    started({ ok: true, value: { startedAt: 10 } });
    await Promise.resolve();
    expect(mocks.recorder.cancel).toHaveBeenCalledTimes(2);
    expect(await replacement.invoke(command)).toEqual({ ok: false, error: 'unavailable' });
    cleaned();
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 20 } });
    expect(await replacement.invoke(command)).toMatchObject({ ok: true });
    expect(mocks.recorder.start).toHaveBeenCalledTimes(2);
  });
  it('withholds overlay reveal approval until the active recorder acknowledges its exclusion', async () => {
    const f = mediaContext();
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
    await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 });
    mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
    await f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'box' },
    });
    const host = mocks.annotation.configure.mock.calls.at(-1)![0];
    let acknowledge!: (value: unknown) => void;
    mocks.recorder.setExcludedWindows.mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
    );
    let settled = false;
    const revealing = host.beforeOverlayShow(99).then((value: boolean) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mocks.recorder.setExcludedWindows).toHaveBeenLastCalledWith(requestId, [42, 99]);
    expect(mocks.setCaptureExclusionIds.mock.calls[0][0]()).toEqual([99]);
    acknowledge({ ok: true, value: undefined });
    expect(await revealing).toBe(true);
  });

  it.each(['failed', 'retired'])(
    'refuses overlay reveal after an exclusion update is %s',
    async (outcome) => {
      const f = mediaContext();
      mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
      await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 });
      mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
      await f.invoke({
        action: 'annotation-start',
        annotation: { id: requestId, mode: 'live', tool: 'box' },
      });
      const host = mocks.annotation.configure.mock.calls.at(-1)![0];
      let acknowledge!: (value: unknown) => void;
      mocks.recorder.setExcludedWindows.mockReturnValueOnce(
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
      );
      const revealing = host.beforeOverlayShow(99);
      await Promise.resolve();
      if (outcome === 'retired') f.retire();
      acknowledge(
        outcome === 'failed' ? { ok: false, error: 'failed' } : { ok: true, value: undefined },
      );
      expect(await revealing).toBe(false);
      expect(mocks.setCaptureExclusionIds.mock.calls[0][0]()).toEqual([]);
    },
  );

  it('includes the reserved hidden overlay when a recording starts before its show callback', async () => {
    const f = mediaContext();
    mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
    await f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'box' },
    });
    const host = mocks.annotation.configure.mock.calls.at(-1)![0];
    expect(await host.beforeOverlayShow(99)).toBe(true);
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
    await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 });
    expect(mocks.recorder.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludeWindowIds: [42, 99] }),
    );
  });

  it('serializes an older exclusion update before the pre-show barrier', async () => {
    const f = mediaContext();
    mocks.recorder.start.mockResolvedValue({ ok: true, value: { startedAt: 10 } });
    await f.invoke({ action: 'clip-start', clipId: requestId, maxMs: 120000 });
    mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
    await f.invoke({
      action: 'annotation-start',
      annotation: { id: requestId, mode: 'live', tool: 'box' },
    });
    const host = mocks.annotation.configure.mock.calls.at(-1)![0];
    let releaseOld!: (value: unknown) => void;
    const oldReply = new Promise((resolve) => {
      releaseOld = resolve;
    });
    mocks.recorder.setExcludedWindows
      .mockReturnValueOnce(oldReply)
      .mockResolvedValueOnce({ ok: true, value: undefined });
    mocks.annotation.onOverlayWindowsChanged.mock.calls[0][0]();
    await Promise.resolve();
    const revealing = host.beforeOverlayShow(99);
    await Promise.resolve();
    expect(mocks.recorder.setExcludedWindows.mock.calls).toEqual([[requestId, [42]]]);
    releaseOld({ ok: true, value: undefined });
    expect(await revealing).toBe(true);
    expect(mocks.recorder.setExcludedWindows.mock.calls).toEqual([
      [requestId, [42]],
      [requestId, [42, 99]],
    ]);
  });
  it('passes the exact main-frame identity and validated scope into the lifecycle', () => {
    const caller = event();
    const request = { ...scope, sessionId, requestId, source: 'capture' };
    mocks.capture.mockReturnValue({ ok: false, error: 'permission' });
    expect(mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.CAPTURE)!(caller, request)).toEqual({
      ok: false,
      error: 'permission',
    });
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(
      { sender: caller.sender, frame: caller.senderFrame },
      request,
    );
  });
  it('rejects subframe, detached frame and destroyed sender before any native work', () => {
    const caller = event();
    for (const invalid of [
      { ...caller, senderFrame: {} },
      { ...caller, senderFrame: null },
      { ...caller, sender: { ...caller.sender, isDestroyed: () => true } },
    ]) {
      expect(mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.BEGIN)!(invalid, scope)).toEqual({
        ok: false,
        error: 'unavailable',
      });
    }
    expect(mocks.begin).not.toHaveBeenCalled();
  });
  it('rejects invalid or extra routing inputs and oversized identities', () => {
    for (const request of [
      null,
      {},
      { ...scope, workspaceId: '' },
      { ...scope, backendId: 'other' },
      { ...scope, draftId: 'x'.repeat(513) },
    ]) {
      expect(mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.BEGIN)!(event(), request)).toEqual({
        ok: false,
        error: 'unavailable',
      });
    }
    for (const request of [
      { ...scope, sessionId, requestId: 'bad' },
      { ...scope, sessionId, requestId, source: 'fake' },
    ]) {
      expect(mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.CAPTURE)!(event(), request)).toEqual({
        ok: false,
        error: 'unavailable',
      });
    }
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('routes cancellation with the original complete session scope only', () => {
    const caller = event();
    const request = { ...scope, sessionId };
    mocks.handlers.get(DOCK_EVIDENCE_CHANNELS.CANCEL)!(caller, request);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(
      { sender: caller.sender, frame: caller.senderFrame },
      request,
    );
  });

  it('asks macOS for Accessibility only on a user action, never on a probe or an implicit pick', async () => {
    const originalProcess = process;
    vi.stubGlobal('process', { ...originalProcess, platform: 'darwin' });
    let trusted = false;
    mocks.trusted.mockImplementation(() => trusted);
    try {
      const f = mediaContext();
      mocks.annotation.startAnnotation.mockResolvedValue({ ok: true, value: undefined });
      // Probes (status) and the mic's implicit pick session never prompt.
      expect(await f.invoke({ action: 'accessibility-status' })).toEqual({
        ok: true,
        value: { trusted: false },
      });
      await f.invoke({
        action: 'annotation-start',
        annotation: { id: requestId, mode: 'dictation', tool: 'pick' },
      });
      expect(mocks.trusted.mock.calls.every(([prompt]) => prompt === false)).toBe(true);
      // The first explicit pick start prompts once (registering the app in the pane)…
      await f.invoke({
        action: 'annotation-start',
        annotation: { id: 'b17f2e7c-5b5e-4b0c-9a3b-6d2f0f6b1f11', mode: 'live', tool: 'pick' },
      });
      expect(mocks.trusted.mock.calls.filter(([prompt]) => prompt)).toHaveLength(1);
      // …later starts do not nag.
      await f.invoke({
        action: 'annotation-start',
        annotation: { id: 'c27f2e7c-5b5e-4b0c-9a3b-6d2f0f6b1f12', mode: 'live', tool: 'pick' },
      });
      expect(mocks.trusted.mock.calls.filter(([prompt]) => prompt)).toHaveLength(1);
      // Clicking the blocked pick control prompts again and opens the pane.
      await f.invoke({ action: 'open-settings', pane: 'accessibility' });
      expect(mocks.trusted.mock.calls.filter(([prompt]) => prompt)).toHaveLength(2);
      expect(mocks.openExternal).toHaveBeenLastCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
      // Granted while running: the next probe sees it and the idle picker restarts.
      trusted = true;
      expect(await f.invoke({ action: 'accessibility-status' })).toEqual({
        ok: true,
        value: { trusted: true },
      });
      expect(mocks.annotation.refreshPicker).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal('process', originalProcess);
      mocks.trusted.mockImplementation(() => true);
    }
  });

  it('annotating keeps live dictation from ending on silence, and ending annotation never stops speech', async () => {
    const f = await speakingAnnotation();
    f.host.onActivity();
    expect(f.handle.activity).toHaveBeenCalledOnce();
    await f.invoke({ action: 'annotation-end', annotationId: requestId });
    expect(f.handle.stop).not.toHaveBeenCalled();
    expect(f.handle.dispose).not.toHaveBeenCalled();
  });
});
