import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';

interface FixtureWindow {
  options: BrowserWindowConstructorOptions;
  setOpacity: Mock;
  setIgnoreMouseEvents: Mock;
  showInactive: Mock;
  show: Mock;
  hide: Mock;
  focus: Mock;
  once: Mock;
  webContents: { send: Mock };
  isDestroyed(): boolean;
}

const mock = vi.hoisted(() => ({
  windows: new Map<number, FixtureWindow>(),
  capture: vi.fn(),
  display: {
    id: 1,
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1280, height: 900 },
    workArea: { x: 0, y: 24, width: 1280, height: 876 },
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      isDestroyed: () => false,
      send: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
    };
    destroyed = false;
    setAlwaysOnTop = vi.fn();
    setFullScreenable = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setOpacity = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    showInactive = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    hide = vi.fn();
    setBounds = vi.fn();
    on = vi.fn();
    once = vi.fn();
    removeListener = vi.fn();
    loadURL = vi.fn(async () => {});
    constructor(public options: BrowserWindowConstructorOptions) {
      mock.windows.set(mock.windows.size, this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return true;
    }
    destroy() {
      this.destroyed = true;
    }
    getBounds() {
      return this.options;
    }
  },
  desktopCapturer: { getSources: mock.capture },
  screen: {
    getAllDisplays: () => [mock.display],
    getDisplayNearestPoint: () => mock.display,
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  globalShortcut: { isRegistered: () => false, register: () => true, unregister: vi.fn() },
  systemPreferences: { getMediaAccessStatus: () => 'granted' },
}));
vi.mock('../../backend/main/connections-store', () => ({
  getActiveId: async () => 'test-backend',
}));
vi.mock('../../../main/dock-window', () => ({
  getDockWindow: () => null,
  setDockHiddenForCapture: vi.fn(),
}));
vi.mock('../../../main/window-backend', () => ({
  getBackendIdForWindow: () => 'test-backend',
  stampWindowWithBackend: vi.fn(),
}));
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    warn() {}
  },
}));

import {
  closeAnnotationMode,
  getAnnotationState,
  setAnnotationTool,
  startAnnotationMode,
  requestAnnotationSend,
  requestAnnotationScreenshot,
  reportAnnotationScreenshot,
  reportAnnotationDelivery,
  appendAnnotationTranscript,
  setAnnotationDestination,
  focusAnnotationMode,
  reviewAnnotation,
} from './annotation-window';

const settleCapture = async (operation: Promise<boolean>) => {
  await vi.advanceTimersByTimeAsync(60);
  return operation;
};

describe('live annotation surface and background evidence', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mock.windows.clear();
    let frame = 0;
    mock.capture.mockReset().mockImplementation(async () => [
      {
        display_id: '1',
        thumbnail: {
          isEmpty: () => false,
          toDataURL: () => `data:image/png;base64,frame-${++frame}`,
        },
      },
    ]);
    expect(await startAnnotationMode({ workspaceId: 'live', workspaceTitle: 'Live UI' })).toEqual({
      success: true,
    });
  });
  afterEach(() => {
    closeAnnotationMode();
    vi.useRealTimers();
  });

  it('reveals the live app in Mouse mode while retaining its annotated evidence', async () => {
    const overlay = mock.windows.get(0)!;
    const toolbar = mock.windows.get(1)!;
    expect(await settleCapture(setAnnotationTool('draw'))).toBe(true);
    const revision = getAnnotationState()!.screenshotRevision;
    const drawingFrame = getAnnotationState()!.screenshotDataUrl;
    expect(overlay.setOpacity).toHaveBeenLastCalledWith(1);
    expect(overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(await settleCapture(setAnnotationTool('mouse'))).toBe(true);
    expect(overlay.setOpacity).toHaveBeenLastCalledWith(0);
    expect(overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
    expect(getAnnotationState()!.screenshotRevision).toBe(revision);
    expect(getAnnotationState()!.screenshotDataUrl).not.toBe(drawingFrame);
    expect(overlay.focus).not.toHaveBeenCalled();
    expect(toolbar.focus).not.toHaveBeenCalled();
    expect(toolbar.showInactive).toHaveBeenCalled();
    if (process.platform === 'darwin') {
      expect(overlay.options.type).toBe('panel');
      expect(toolbar.options.type).toBe('panel');
    }
  });

  it('sends fresh clean background pixels without detaching active marks from their frame', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const state = getAnnotationState()!;
    const capturesBefore = mock.capture.mock.calls.length;
    expect(await settleCapture(requestAnnotationSend({ startedAt: state.startedAt }))).toBe(true);
    const sending = getAnnotationState()!;
    expect(mock.capture).toHaveBeenCalledTimes(capturesBefore + 1);
    expect(sending.screenshotDataUrl).not.toBe(state.screenshotDataUrl);
    expect(sending.screenshotRevision).toBe(state.screenshotRevision);
    expect(sending.delivery?.status).toBe('sending');
    expect(mock.windows.get(0)!.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
  });

  it('starts a separate fresh evidence moment when sending after live Mouse interaction', async () => {
    await settleCapture(setAnnotationTool('draw'));
    await settleCapture(setAnnotationTool('mouse'));
    const annotated = getAnnotationState()!;
    expect(await settleCapture(requestAnnotationSend({ startedAt: annotated.startedAt }))).toBe(
      true,
    );
    const sending = getAnnotationState()!;
    expect(sending.screenshotRevision).toBe(annotated.screenshotRevision + 1);
    expect(sending.screenshotDataUrl).not.toBe(annotated.screenshotDataUrl);
  });

  it('retains the current evidence when background capture fails', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const state = getAnnotationState()!;
    mock.capture.mockRejectedValueOnce(new Error('capture unavailable'));
    expect(await settleCapture(setAnnotationTool('mouse'))).toBe(false);
    expect(getAnnotationState()!.screenshotRevision).toBe(state.screenshotRevision);
    expect(getAnnotationState()!.screenshotDataUrl).toBe(state.screenshotDataUrl);
    expect(mock.windows.get(0)!.setOpacity).toHaveBeenLastCalledWith(1);
    expect(mock.windows.get(0)!.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
  });

  it('reviews a fresh Mouse moment separately from earlier marks', async () => {
    await settleCapture(setAnnotationTool('draw'));
    await settleCapture(setAnnotationTool('mouse'));
    const annotated = getAnnotationState()!;
    expect(await settleCapture(reviewAnnotation())).toBe(true);
    const reviewed = getAnnotationState()!;
    expect(reviewed.phase).toBe('review');
    expect(reviewed.screenshotRevision).toBe(annotated.screenshotRevision + 1);
    expect(reviewed.screenshotDataUrl).not.toBe(annotated.screenshotDataUrl);
  });

  it('sends the exact reviewed screen without recapturing changed live content', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const drawing = getAnnotationState()!;
    expect(await settleCapture(reviewAnnotation())).toBe(true);
    const reviewed = getAnnotationState()!;
    expect(reviewed.screenshotRevision).toBe(drawing.screenshotRevision);
    expect(reviewed.screenshotDataUrl).not.toBe(drawing.screenshotDataUrl);
    const capturesBefore = mock.capture.mock.calls.length;
    expect(await requestAnnotationSend({ startedAt: reviewed.startedAt })).toBe(true);
    expect(mock.capture).toHaveBeenCalledTimes(capturesBefore);
    expect(getAnnotationState()!.screenshotDataUrl).toBe(reviewed.screenshotDataUrl);
    expect(getAnnotationState()!.screenshotRevision).toBe(reviewed.screenshotRevision);
  });

  it('preserves reviewed evidence on return to Mouse and starts a new drawing moment', async () => {
    await settleCapture(setAnnotationTool('draw'));
    await settleCapture(reviewAnnotation());
    const reviewed = getAnnotationState()!;
    const capturesBefore = mock.capture.mock.calls.length;
    expect(await setAnnotationTool('mouse')).toBe(true);
    expect(mock.capture).toHaveBeenCalledTimes(capturesBefore);
    expect(getAnnotationState()!.screenshotDataUrl).toBe(reviewed.screenshotDataUrl);
    expect(getAnnotationState()!.screenshotRevision).toBe(reviewed.screenshotRevision);
    expect(await settleCapture(setAnnotationTool('draw'))).toBe(true);
    expect(getAnnotationState()!.screenshotRevision).toBe(reviewed.screenshotRevision + 1);
    expect(getAnnotationState()!.screenshotDataUrl).not.toBe(reviewed.screenshotDataUrl);
  });

  it('archives the reviewed moment when returning directly to a drawing tool', async () => {
    await settleCapture(setAnnotationTool('draw'));
    await settleCapture(reviewAnnotation());
    const reviewed = getAnnotationState()!;
    expect(await settleCapture(setAnnotationTool('rectangle'))).toBe(true);
    expect(getAnnotationState()!.phase).toBe('capturing');
    expect(getAnnotationState()!.screenshotRevision).toBe(reviewed.screenshotRevision + 1);
    expect(getAnnotationState()!.screenshotDataUrl).not.toBe(reviewed.screenshotDataUrl);
  });

  it.each(['mouse', 'draw'] as const)(
    'captures one explicit screenshot in %s without changing the marks baseline until acknowledgement',
    async (tool) => {
      if (tool === 'draw') await settleCapture(setAnnotationTool(tool));
      const before = getAnnotationState()!;
      const overlay = mock.windows.get(0)!;
      const toolbar = mock.windows.get(1)!;
      const captureCount = mock.capture.mock.calls.length;
      const operation = requestAnnotationScreenshot({ startedAt: before.startedAt });
      const pending = getAnnotationState()!.screenshotCapture!;
      expect(pending.status).toBe('capturing');
      expect(overlay.webContents.send).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ screenshotCapture: pending }),
      );
      expect(mock.capture).toHaveBeenCalledTimes(captureCount);
      expect(overlay.setOpacity).toHaveBeenLastCalledWith(0);
      expect(overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true);
      expect(toolbar.hide).toHaveBeenCalled();
      expect(await settleCapture(operation)).toBe(true);
      const readyState = getAnnotationState()!;
      const ready = readyState.screenshotCapture!;
      expect(ready).toMatchObject({
        status: 'ready',
        requestId: pending.requestId,
        width: mock.display.bounds.width,
        height: mock.display.bounds.height,
        elapsedMs: expect.any(Number),
      });
      expect(mock.capture).toHaveBeenCalledTimes(captureCount + 1);
      expect(readyState.screenshotDataUrl).toBe(before.screenshotDataUrl);
      expect(readyState.screenshotRevision).toBe(before.screenshotRevision);
      expect(readyState.tool).toBe(tool);
      expect(readyState.phase).toBe('capturing');
      expect(overlay.setOpacity).toHaveBeenLastCalledWith(tool === 'mouse' ? 0 : 1);
      expect(overlay.setIgnoreMouseEvents).toHaveBeenLastCalledWith(tool === 'mouse');
      expect(toolbar.showInactive).toHaveBeenCalled();
      expect(overlay.focus).not.toHaveBeenCalled();
      expect(toolbar.focus).not.toHaveBeenCalled();
      expect(overlay.show).not.toHaveBeenCalled();
      expect(toolbar.show).not.toHaveBeenCalled();
      const report = { startedAt: before.startedAt, requestId: ready.requestId, saved: true };
      expect(reportAnnotationScreenshot(report)).toBe(true);
      expect(getAnnotationState()!.screenshotCapture).toEqual({
        status: 'saved',
        requestId: ready.requestId,
      });
      if (ready.status !== 'ready') throw new Error('Expected ready screenshot');
      expect(ready.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(ready.elapsedMs).toBeLessThanOrEqual(Date.now() - before.startedAt);
      expect(ready.screenshotDataUrl).not.toBe(before.screenshotDataUrl);
      expect(getAnnotationState()!.screenshotDataUrl).toBe(
        tool === 'mouse' ? before.screenshotDataUrl : ready.screenshotDataUrl,
      );
      expect(getAnnotationState()!.screenshotRevision).toBe(before.screenshotRevision);
      expect(reportAnnotationScreenshot(report)).toBe(true);
      expect(reportAnnotationScreenshot({ ...report, saved: false })).toBe(false);
      expect(mock.capture).toHaveBeenCalledTimes(captureCount + 1);
    },
  );

  it('keeps the held drawing baseline when a separate Mouse screenshot is saved', async () => {
    await settleCapture(setAnnotationTool('draw'));
    await settleCapture(setAnnotationTool('mouse'));
    const heldDrawing = getAnnotationState()!;
    expect(
      await settleCapture(requestAnnotationScreenshot({ startedAt: heldDrawing.startedAt })),
    ).toBe(true);
    const ready = getAnnotationState()!.screenshotCapture!;
    if (ready.status !== 'ready') throw new Error('Expected ready screenshot');
    expect(ready.screenshotDataUrl).not.toBe(heldDrawing.screenshotDataUrl);
    expect(
      reportAnnotationScreenshot({
        startedAt: heldDrawing.startedAt,
        requestId: ready.requestId,
        saved: true,
      }),
    ).toBe(true);
    expect(getAnnotationState()).toMatchObject({
      tool: 'mouse',
      screenshotDataUrl: heldDrawing.screenshotDataUrl,
      screenshotRevision: heldDrawing.screenshotRevision,
      screenshotCapture: { status: 'saved', requestId: ready.requestId },
    });
  });

  it('locks other capture mutations while pending and ready but preserves ongoing narration', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const before = getAnnotationState()!;
    const operation = requestAnnotationScreenshot({ startedAt: before.startedAt });
    const requestId = getAnnotationState()!.screenshotCapture!.requestId;
    const assertLocked = async (retryReady = false) => {
      const captureCount = mock.capture.mock.calls.length;
      const capture = getAnnotationState()!.screenshotCapture;
      expect(await requestAnnotationScreenshot({ startedAt: before.startedAt })).toBe(retryReady);
      expect(mock.capture).toHaveBeenCalledTimes(captureCount);
      expect(getAnnotationState()!.screenshotCapture).toEqual(capture);
      expect(await requestAnnotationSend({ startedAt: before.startedAt })).toBe(false);
      expect(await setAnnotationTool('mouse')).toBe(false);
      expect(await reviewAnnotation()).toBe(false);
      expect(
        setAnnotationDestination({
          startedAt: before.startedAt,
          destination: { workspaceId: 'different', workspaceTitle: 'Different', agentId: null },
        }),
      ).toBe(true);
    };
    await assertLocked();
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(false);
    expect(appendAnnotationTranscript('during capture', before.startedAt)).toBe(true);
    expect(await settleCapture(operation)).toBe(true);
    await assertLocked(true);
    expect(appendAnnotationTranscript('awaiting save', before.startedAt)).toBe(true);
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(true);
    expect(getAnnotationState()!.transcripts).toEqual(['during capture', 'awaiting save']);
    expect(getAnnotationState()!.destination).toEqual({
      workspaceId: 'different',
      workspaceTitle: 'Different',
      agentId: null,
    });
    expect(await setAnnotationTool('rectangle')).toBe(true);
  });

  it('leaves old pixels and revision intact after a save-limit rejection and permits another request', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const before = getAnnotationState()!;
    expect(await settleCapture(requestAnnotationScreenshot({ startedAt: before.startedAt }))).toBe(
      true,
    );
    const requestId = getAnnotationState()!.screenshotCapture!.requestId;
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: false }),
    ).toBe(true);
    expect(getAnnotationState()!).toMatchObject({
      tool: before.tool,
      screenshotDataUrl: before.screenshotDataUrl,
      screenshotRevision: before.screenshotRevision,
      screenshotCapture: { status: 'failed', requestId, error: 'limit' },
    });
    expect(await settleCapture(requestAnnotationScreenshot({ startedAt: before.startedAt }))).toBe(
      true,
    );
    expect(getAnnotationState()!.screenshotCapture!.requestId).not.toBe(requestId);
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(false);
  });

  it('restores the original tool after capture failure without losing narration or old pixels', async () => {
    await settleCapture(setAnnotationTool('draw'));
    const before = getAnnotationState()!;
    mock.capture.mockRejectedValueOnce(new Error('capture unavailable'));
    const operation = requestAnnotationScreenshot({ startedAt: before.startedAt });
    expect(appendAnnotationTranscript('keep this narration', before.startedAt)).toBe(true);
    expect(await settleCapture(operation)).toBe(false);
    expect(getAnnotationState()!).toMatchObject({
      tool: before.tool,
      screenshotDataUrl: before.screenshotDataUrl,
      screenshotRevision: before.screenshotRevision,
      transcripts: ['keep this narration'],
      screenshotCapture: { status: 'failed', error: 'capture' },
    });
    expect(mock.windows.get(0)!.setOpacity).toHaveBeenLastCalledWith(1);
    expect(mock.windows.get(0)!.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(mock.windows.get(1)!.showInactive).toHaveBeenCalled();
    expect(await setAnnotationTool('rectangle')).toBe(true);
  });

  it('does not reveal capture UI on focus or ready-to-show while screenshot pixels are being captured', async () => {
    const before = getAnnotationState()!;
    const operation = requestAnnotationScreenshot({ startedAt: before.startedAt });
    for (const window of mock.windows.values()) {
      window.showInactive.mockClear();
      const ready = window.once.mock.calls.find(([event]) => event === 'ready-to-show')?.[1];
      ready?.();
    }
    expect(focusAnnotationMode()).toBe(true);
    for (const window of mock.windows.values()) {
      expect(window.show).not.toHaveBeenCalled();
      expect(window.showInactive).not.toHaveBeenCalled();
      expect(window.focus).not.toHaveBeenCalled();
    }
    expect(await settleCapture(operation)).toBe(true);
  });

  it('rejects screenshot requests during another native capture, Review, and delivery locks', async () => {
    const startedAt = getAnnotationState()!.startedAt;
    const toolCapture = setAnnotationTool('draw');
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
    expect(await settleCapture(toolCapture)).toBe(true);
    const reviewCapture = reviewAnnotation();
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
    expect(await settleCapture(reviewCapture)).toBe(true);
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
    await setAnnotationTool('mouse');
    const sending = requestAnnotationSend({ startedAt });
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
    expect(await settleCapture(sending)).toBe(true);
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
    const requestId = getAnnotationState()!.delivery!.requestId!;
    expect(reportAnnotationDelivery({ startedAt, requestId, status: 'uncertain' })).toBe(true);
    expect(await requestAnnotationScreenshot({ startedAt })).toBe(false);
  });

  it('rejects stale request/report identities and does not resurrect a cancelled capture', async () => {
    const before = getAnnotationState()!;
    expect(await requestAnnotationScreenshot({ startedAt: before.startedAt - 1 })).toBe(false);
    let finishCapture!: (value: unknown[]) => void;
    mock.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        }),
    );
    const operation = requestAnnotationScreenshot({ startedAt: before.startedAt });
    await vi.advanceTimersByTimeAsync(60);
    const requestId = getAnnotationState()!.screenshotCapture!.requestId;
    const oldWindows = [...mock.windows.values()];
    closeAnnotationMode();
    expect(oldWindows.every((window) => window.isDestroyed())).toBe(true);
    finishCapture([
      { display_id: '1', thumbnail: { isEmpty: () => false, toDataURL: () => 'late' } },
    ]);
    expect(await operation).toBe(false);
    expect(getAnnotationState()).toBeNull();
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(false);
    expect(oldWindows.every((window) => window.showInactive.mock.calls.length === 0)).toBe(true);
    expect(await startAnnotationMode({ workspaceId: 'next', workspaceTitle: 'Next' })).toEqual({
      success: true,
    });
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(false);
  });

  it('rejects a late acknowledgement after cancellation without mutating the replacement session', async () => {
    const before = getAnnotationState()!;
    await settleCapture(requestAnnotationScreenshot({ startedAt: before.startedAt }));
    const requestId = getAnnotationState()!.screenshotCapture!.requestId;
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt + 1, requestId, saved: true }),
    ).toBe(false);
    expect(
      reportAnnotationScreenshot({
        startedAt: before.startedAt,
        requestId: 'old-request',
        saved: true,
      }),
    ).toBe(false);
    closeAnnotationMode();
    await startAnnotationMode({ workspaceId: 'next', workspaceTitle: 'Next' });
    const replacement = getAnnotationState()!;
    expect(
      reportAnnotationScreenshot({ startedAt: before.startedAt, requestId, saved: true }),
    ).toBe(false);
    expect(getAnnotationState()).toEqual(replacement);
  });
});
