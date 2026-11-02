import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, Display } from 'electron';

vi.mock('electron', () => ({ desktopCapturer: {}, screen: {}, systemPreferences: {} }));
vi.mock('./dock-screen-recorder', () => ({
  createDockScreenRecorder: () => ({}),
  cgWindowIdFromMediaSourceId: vi.fn(),
}));
vi.mock('../../../main/dock-window', () => ({
  getDockPlacementSnapshot: vi.fn(),
  getDockWindow: vi.fn(),
  setDockHiddenForCapture: vi.fn(),
}));
vi.mock('../../../main/window-backend', () => ({
  getStrictBackendBindingForWebContents: vi.fn(),
  onStrictBackendBindingRetired: vi.fn(),
}));

import {
  DockEvidenceSessions,
  type DockEvidenceDependencies,
  type DockEvidenceOwner,
} from './dock-evidence-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let visible = true;
  let hidden = false;
  let retired = () => {};
  const frame = {} as Electron.WebFrameMain;
  const sender = { mainFrame: frame, isDestroyed: () => false } as Electron.WebContents;
  const window = {
    webContents: sender,
    isDestroyed: () => false,
    isVisible: () => visible,
  } as BrowserWindow;
  const binding = { window, backendId: 'remote-machine', frame, stamp: {} };
  let currentBinding: typeof binding | null = binding;
  let dock: BrowserWindow | null = window;
  const display = {
    id: 7,
    scaleFactor: 2,
    bounds: { x: -1440, y: -200, width: 1440, height: 900 },
  } as Display;
  const settle = deferred<void>();
  const pixels = { png: Buffer.from('clean PNG bytes'), width: 2880, height: 1800 };
  const capture = vi.fn(async () => pixels);
  const visibility = vi.fn((_window: BrowserWindow, value: boolean, restore: boolean) => {
    hidden = value;
    if (value) visible = false;
    else if (restore) visible = true;
  });
  const deps: DockEvidenceDependencies = {
    dock: () => dock,
    binding: () => currentBinding,
    retired: (_sender, listener) => {
      retired = listener;
      return vi.fn();
    },
    placement: () =>
      ({ displayId: display.id, captureHidden: hidden }) as ReturnType<
        DockEvidenceDependencies['placement']
      >,
    displays: () => [display],
    permissionDenied: () => false,
    hidden: visibility,
    settle: () => settle.promise,
    capture,
    id: vi.fn().mockReturnValueOnce('session').mockReturnValue('image'),
    now: () => 1_793_300_000_000,
  };
  const manager = new DockEvidenceSessions(deps);
  const owner: DockEvidenceOwner = { sender, frame };
  const request = { workspaceId: 'workspace', agentId: 'agent', draftId: 'draft' };
  const begun = manager.begin(owner, request);
  if (!begun.ok) throw new Error('Fixture could not begin');
  const scope = begun.value;
  return {
    manager,
    owner,
    request,
    scope,
    deps,
    pixels,
    capture,
    visibility,
    settle,
    window,
    display,
    retire: () => {
      currentBinding = null;
      retired();
    },
    replaceDock: () => {
      dock = {} as BrowserWindow;
    },
    restamp: () => {
      currentBinding = { ...binding, stamp: {} };
    },
  };
}

describe('dock evidence capture ownership', () => {
  it('keeps the dock visible with native exclusions and preserves the actual scaled pixels', async () => {
    const f = fixture();
    const overlay = { isDestroyed: () => false, isVisible: () => true } as BrowserWindow;
    f.manager.setCaptureExclusions(() => [overlay]);
    const pixels = {
      base64: f.pixels.png.toString('base64'),
      mimeType: 'image/png' as const,
      width: 2160,
      height: 1350,
      displayScale: 1.5,
      capturedAt: '2026-10-29T00:00:00.000Z',
      hash: 'a'.repeat(64),
    };
    f.deps.captureVisible = vi.fn(async () => ({ ok: true, value: pixels }));
    const result = await f.manager.capture(f.owner, { ...f.scope, requestId: 'still' });
    expect(f.deps.captureVisible).toHaveBeenCalledExactlyOnceWith(
      f.window,
      f.display,
      [overlay],
      [],
    );
    expect(f.visibility).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.window.isVisible()).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      value: {
        pixels,
        image: {
          width: 2160,
          height: 1350,
          displayScale: 1.5,
          capturedAt: pixels.capturedAt,
          hash: pixels.hash,
        },
      },
    });
  });

  it.each(['permission', 'failed', 'unavailable'] as const)(
    'never hides or falls back after a native %s result',
    async (error) => {
      const f = fixture();
      f.deps.captureVisible = async () => ({ ok: false, error, detail: 'exclusion-missing' });
      expect(await f.manager.capture(f.owner, { ...f.scope, requestId: 'still' })).toEqual({
        ok: false,
        error,
        detail: 'exclusion-missing',
      });
      expect(f.visibility).not.toHaveBeenCalled();
      expect(f.capture).not.toHaveBeenCalled();
    },
  );

  it('uses the clean-hide fallback only for an unsupported OS with no visible overlay', async () => {
    const f = fixture();
    f.deps.captureVisible = async () => ({ ok: false, error: 'unavailable', detail: 'os-version' });
    f.settle.resolve();
    expect((await f.manager.capture(f.owner, { ...f.scope, requestId: 'legacy' })).ok).toBe(true);
    expect(f.visibility.mock.calls).toEqual([
      [f.window, true, false],
      [f.window, false, true],
    ]);
    f.visibility.mockClear();
    f.capture.mockClear();
    f.manager.setCaptureExclusions(() => [
      { isDestroyed: () => false, isVisible: () => true } as BrowserWindow,
    ]);
    expect((await f.manager.capture(f.owner, { ...f.scope, requestId: 'with-overlay' })).ok).toBe(
      false,
    );
    expect(f.visibility).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });

  it('discards an excluded native capture after binding retirement without touching visibility', async () => {
    const f = fixture();
    const native = deferred<any>();
    f.deps.captureVisible = () => native.promise;
    const pending = f.manager.capture(f.owner, { ...f.scope, requestId: 'still' });
    f.retire();
    native.resolve({
      ok: true,
      value: {
        base64: 'cG5n',
        width: 10,
        height: 10,
        displayScale: 1,
        mimeType: 'image/png',
        capturedAt: '2026-10-29T00:00:00.000Z',
      },
    });
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(f.visibility).not.toHaveBeenCalled();
  });

  it('retires helper contexts exactly once and never lets an old cancellation retire a new draft', () => {
    const f = fixture();
    const context = f.manager.context(f.owner, f.scope);
    expect(context?.backendId).toBe('remote-machine');
    expect(context?.display.id).toBe(7);
    const retired = vi.fn();
    context?.onDispose(retired);
    expect(f.manager.begin(f.owner, { ...f.request, draftId: 'replacement' }).ok).toBe(true);
    expect(retired).toHaveBeenCalledTimes(1);
    expect(context?.isCurrent()).toBe(false);
    expect(f.manager.cancel(f.owner, f.scope).ok).toBe(false);
    expect(retired).toHaveBeenCalledTimes(1);
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.visibility).not.toHaveBeenCalled();
  });

  it('waits for clean hide, captures the dock display and returns actual pixels with stable identity', async () => {
    const f = fixture();
    const request = { ...f.scope, requestId: 'capture' };
    const pending = f.manager.capture(f.owner, request);
    expect(f.visibility).toHaveBeenCalledExactlyOnceWith(f.window, true, false);
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.manager.capture(f.owner, request)).toBe(pending);
    f.settle.resolve();
    const result = await pending;
    expect(f.capture).toHaveBeenCalledExactlyOnceWith(f.display);
    expect(result).toEqual({
      ok: true,
      value: {
        ...f.scope,
        requestId: 'capture',
        image: {
          id: 'image',
          contextItemId: 'dock-evidence:image',
          width: 2880,
          height: 1800,
          displayScale: 2,
          capturedAt: new Date(f.deps.now()).toISOString(),
          source: 'capture',
        },
        pixels: {
          base64: f.pixels.png.toString('base64'),
          mimeType: 'image/png',
          width: 2880,
          height: 1800,
          displayScale: 2,
          capturedAt: new Date(f.deps.now()).toISOString(),
        },
      },
    });
    expect(f.visibility).toHaveBeenLastCalledWith(f.window, false, true);
    expect(await f.manager.capture(f.owner, request)).toBe(result);
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect(await f.manager.capture(f.owner, { ...request, source: 'annotate' })).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('rejects wrong sender, frame, session and draft without hiding', async () => {
    const f = fixture();
    for (const owner of [
      { ...f.owner, sender: {} as Electron.WebContents },
      { ...f.owner, frame: {} as Electron.WebFrameMain },
    ])
      expect(await f.manager.capture(owner, { ...f.scope, requestId: 'capture' })).toEqual({
        ok: false,
        error: 'unavailable',
      });
    for (const field of ['sessionId', 'workspaceId', 'agentId', 'draftId']) {
      expect(
        await f.manager.capture(f.owner, { ...f.scope, [field]: 'stale', requestId: 'capture' }),
      ).toEqual({ ok: false, error: 'unavailable' });
    }
    expect(f.visibility).not.toHaveBeenCalled();
  });

  it('rejects simultaneous distinct capture and replacement until cancelled capture settles', async () => {
    const f = fixture();
    const pending = f.manager.capture(f.owner, { ...f.scope, requestId: 'first' });
    expect(await f.manager.capture(f.owner, { ...f.scope, requestId: 'second' })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(f.manager.cancel(f.owner, f.scope)).toEqual({ ok: true, value: true });
    expect(f.manager.begin(f.owner, { ...f.request, draftId: 'next' }).ok).toBe(false);
    f.settle.resolve();
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.visibility).toHaveBeenLastCalledWith(f.window, false, true);
    expect(f.manager.begin(f.owner, { ...f.request, draftId: 'next' }).ok).toBe(true);
  });

  it('discards late bytes after cancellation and restores only once', async () => {
    const f = fixture();
    const native = deferred<typeof f.pixels>();
    f.capture.mockReturnValueOnce(native.promise);
    const pending = f.manager.capture(f.owner, { ...f.scope, requestId: 'first' });
    f.settle.resolve();
    await Promise.resolve();
    expect(f.capture).toHaveBeenCalledTimes(1);
    f.manager.cancel(f.owner, f.scope);
    expect(f.visibility).toHaveBeenLastCalledWith(f.window, false, true);
    native.resolve(f.pixels);
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(f.visibility.mock.calls).toEqual([
      [f.window, true, false],
      [f.window, false, true],
    ]);
  });

  it.each(['retire', 'restamp', 'replaceDock'] as const)(
    'cannot reveal a replaced document/window after %s',
    async (change) => {
      const f = fixture();
      const pending = f.manager.capture(f.owner, { ...f.scope, requestId: 'first' });
      f[change]();
      f.settle.resolve();
      expect(await pending).toEqual({ ok: false, error: 'unavailable' });
      expect(f.capture).not.toHaveBeenCalled();
      expect(
        f.visibility.mock.calls.filter(([, value, restore]) => !value && restore),
      ).toHaveLength(0);
      if (change !== 'replaceDock')
        expect(f.visibility).toHaveBeenLastCalledWith(f.window, false, false);
    },
  );

  it('restores on capture failure, preserving the session for a new request', async () => {
    const f = fixture();
    f.capture.mockRejectedValueOnce(new Error('native capture failed'));
    f.settle.resolve();
    const request = { ...f.scope, requestId: 'first' };
    expect(await f.manager.capture(f.owner, request)).toEqual({ ok: false, error: 'failed' });
    expect(f.visibility).toHaveBeenLastCalledWith(f.window, false, true);
    expect(await f.manager.capture(f.owner, request)).toEqual({ ok: false, error: 'failed' });
    expect(f.capture).toHaveBeenCalledTimes(1);
    expect((await f.manager.capture(f.owner, { ...request, requestId: 'retry' })).ok).toBe(true);
  });

  it('refuses denied permission, missing display and an already hidden dock', async () => {
    for (const reason of ['permission', 'display', 'hidden']) {
      const f = fixture();
      if (reason === 'permission') f.deps.permissionDenied = () => true;
      if (reason === 'display') f.deps.displays = () => [];
      if (reason === 'hidden')
        f.deps.placement = () =>
          ({ displayId: 7, captureHidden: true }) as ReturnType<
            DockEvidenceDependencies['placement']
          >;
      expect(await f.manager.capture(f.owner, { ...f.scope, requestId: 'first' })).toEqual({
        ok: false,
        error: reason === 'permission' ? 'permission' : 'unavailable',
      });
      expect(f.visibility).not.toHaveBeenCalled();
      expect(f.capture).not.toHaveBeenCalled();
    }
  });
});
