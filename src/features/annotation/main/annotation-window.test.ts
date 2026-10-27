import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';

interface FixtureWindow {
  options: BrowserWindowConstructorOptions;
  setOpacity: Mock;
  setIgnoreMouseEvents: Mock;
  showInactive: Mock;
  focus: Mock;
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
});
