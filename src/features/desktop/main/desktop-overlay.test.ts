import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';

const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  failLoad: false,
  focused: null as { isDestroyed: () => boolean } | null,
  displays: [
    {
      id: 1,
      scaleFactor: 2,
      bounds: { x: -1440, y: 0, width: 1440, height: 900 },
      workArea: { x: -1440, y: 30, width: 1440, height: 870 },
    },
    {
      id: 2,
      scaleFactor: 1.25,
      bounds: { x: 0, y: -100, width: 1920, height: 1080 },
      workArea: { x: 0, y: -100, width: 1920, height: 1040 },
    },
  ],
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static getFocusedWindow = () => mocks.focused;
    id = mocks.windows.length + 1;
    dead = false;
    visible = false;
    url = '';
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      getURL: () => this.url,
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    });
    constructor(readonly options: BrowserWindowConstructorOptions) {
      super();
      mocks.windows.push(this);
    }
    isDestroyed = () => this.dead;
    isVisible = () => this.visible;
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setContentProtection = vi.fn();
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    show = vi.fn();
    focus = vi.fn();
    getMediaSourceId = vi.fn(() => `window:${this.id}:0`);
    destroy = vi.fn(() => {
      this.dead = true;
      this.emit('closed');
    });
    async loadURL(url: string) {
      this.url = url;
      if (mocks.failLoad) throw new Error('failed');
    }
  }
  return {
    app: new EventEmitter(),
    BrowserWindow: Window,
    ipcMain: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), { getAllDisplays: () => mocks.displays }),
    powerMonitor: new EventEmitter(),
  };
});
vi.mock('./desktop-overlay-navigation', () => ({
  openDesktopControllingAgent: vi.fn(),
  focusDesktopOwningWindow: vi.fn(),
}));
vi.mock('../../../main/window-backend', () => ({ stampWindowWithBackend: vi.fn() }));
import { app, ipcMain, powerMonitor, screen } from 'electron';
import { DESKTOP_AGENT_SWITCH_GRACE_MS, DesktopControlOverlay } from './desktop-overlay';
import { DesktopNativeAdapter } from './desktop-native';
import { DesktopExecutor, type DesktopNative } from './desktop-executor';

const session = {
  backendId: 'backend-a',
  workspaceId: 'ws-a',
  agentId: 'agent-a',
  agentName: 'Agent',
  sessionId: 'session-a',
  computerName: 'Desktop',
  computerId: 'computer-a',
};
let overlay: DesktopControlOverlay;
let stop: ReturnType<typeof vi.fn>;
let invalidate: ReturnType<typeof vi.fn>;
let navigate: ReturnType<typeof vi.fn>;
let refocus: ReturnType<typeof vi.fn>;
function send(window: any, action: string, ...args: unknown[]) {
  ipcMain.emit(
    `desktop-overlay:${action}`,
    { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    ...args,
  );
}
function ready() {
  for (const window of mocks.windows.filter((w) => !w.dead)) {
    send(window, 'ready');
    window.emit('ready-to-show');
  }
}
async function activate() {
  const starting = overlay.activate(session, stop, invalidate);
  ready();
  await starting;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.windows.length = 0;
  mocks.failLoad = false;
  mocks.focused = null;
  stop = vi.fn();
  invalidate = vi.fn();
  navigate = vi.fn().mockResolvedValue(undefined);
  refocus = vi.fn().mockReturnValue(true);
  overlay = new DesktopControlOverlay({
    url: 'app://workspaces/desktop-overlay',
    preload: '/preload.js',
    platform: 'darwin',
    navigate,
    refocus,
  });
});
afterEach(async () => {
  await overlay.deactivate(session.sessionId);
  vi.useRealTimers();
});

describe('desktop overlay native lifecycle', () => {
  it.each(['darwin', 'win32'] as const)(
    'uses per-display DIP bounds, native exclusions and no focus on %s',
    async (platform) => {
      overlay = new DesktopControlOverlay({
        url: 'app://workspaces/desktop-overlay',
        preload: '/preload.js',
        platform,
      });
      const starting = overlay.activate(session, stop, invalidate);
      expect(mocks.windows).toHaveLength(4);
      expect(mocks.windows.every((w) => !w.visible)).toBe(true);
      // Native first paint alone is insufficient: the narrow bridge must also be mounted.
      for (const window of mocks.windows) window.emit('ready-to-show');
      await Promise.resolve();
      expect(mocks.windows.every((w) => !w.visible)).toBe(true);
      ready();
      await starting;
      expect(mocks.windows[0].options).toMatchObject({
        ...mocks.displays[0].bounds,
        focusable: false,
        transparent: true,
        skipTaskbar: true,
      });
      expect(mocks.windows[2].options).toMatchObject(mocks.displays[1].bounds);
      expect(mocks.windows[1].options).toMatchObject({ x: -960, y: 836, width: 480, height: 48 });
      for (const window of mocks.windows) {
        expect(window.setContentProtection).toHaveBeenCalledWith(true);
        expect(window.showInactive).toHaveBeenCalledOnce();
        expect(window.focus).not.toHaveBeenCalled();
        expect(window.show).not.toHaveBeenCalled();
        if (platform === 'darwin')
          expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
            visibleOnFullScreen: true,
          });
        else expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
      }
      expect(overlay.excludedWindows()).toEqual(['1', '2', '3', '4']);
    },
  );

  it('authorizes only its own top-frame controls and keeps glow click-through', async () => {
    await activate();
    const [glow, controls] = mocks.windows;
    send(glow, 'stop');
    send(glow, 'interactive', true);
    ipcMain.emit('desktop-overlay:stop', { sender: controls.webContents, senderFrame: {} });
    expect(stop).not.toHaveBeenCalled();
    expect(glow.setIgnoreMouseEvents).toHaveBeenCalledTimes(1);
    send(controls, 'interactive', true);
    expect(controls.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
    send(controls, 'interactive', false);
    expect(controls.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    send(controls, 'open-agent');
    expect(navigate).toHaveBeenCalledWith(session);
  });

  it('stops locally before destroying windows without any network dependency', async () => {
    stop.mockImplementation(() => expect(mocks.windows.every((w) => !w.dead)).toBe(true));
    await activate();
    send(mocks.windows[1], 'stop');
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.windows.every((w) => w.dead)).toBe(true);
    expect(overlay.excludedWindows()).toEqual([]);
    send(mocks.windows[1], 'stop');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('pulses glow only for the current session and removes listeners on end', async () => {
    await activate();
    overlay.pulse('stale');
    expect(mocks.windows.every((w) => w.webContents.send.mock.calls.length === 0)).toBe(true);
    overlay.pulse(session.sessionId);
    expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('desktop-overlay:pulse');
    expect(mocks.windows[1].webContents.send).not.toHaveBeenCalled();
    await overlay.deactivate('stale');
    expect(mocks.windows.every((w) => !w.dead)).toBe(true);
    await overlay.deactivate(session.sessionId);
    expect(ipcMain.listenerCount('desktop-overlay:stop')).toBe(0);
    expect(screen.listenerCount('display-added')).toBe(0);
    expect(powerMonitor.listenerCount('lock-screen')).toBe(0);
    expect(stop).not.toHaveBeenCalled();
  });

  it.each([
    'display-added',
    'display-removed',
    'display-metrics-changed',
    'lock-screen',
    'suspend',
    'render-process-gone',
    'closed',
  ])('invalidates locally on %s', async (event) => {
    await activate();
    if (event.startsWith('display-')) screen.emit(event);
    else if (event === 'closed') mocks.windows[0].emit(event);
    else if (event === 'render-process-gone') mocks.windows[0].webContents.emit(event);
    else powerMonitor.emit(event);
    expect(stop).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith(
      event.startsWith('display-')
        ? 'unsupported_environment'
        : event === 'lock-screen' || event === 'suspend'
          ? 'screen_locked'
          : 'executor_failed',
    );
    expect(mocks.windows.every((w) => w.dead)).toBe(true);
  });

  it('rejects readiness after cancellation and never reveals a late renderer', async () => {
    const starting = overlay.activate(session, stop, invalidate);
    const rejected = expect(starting).rejects.toThrow('closed before ready');
    await overlay.deactivate(session.sessionId);
    ready();
    await rejected;
    expect(mocks.windows.every((w) => w.showInactive.mock.calls.length === 0)).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    await activate();
    send(mocks.windows[1], 'stop');
    expect(stop).not.toHaveBeenCalled();
  });

  it('rejects failed load and missing native exclusion IDs', async () => {
    mocks.failLoad = true;
    await expect(overlay.activate(session, stop, invalidate)).rejects.toThrow('failed to load');
    expect(stop).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith('executor_failed');
    mocks.failLoad = false;
    const starting = overlay.activate(session, stop, invalidate);
    mocks.windows.at(-1).getMediaSourceId.mockReturnValue('invalid');
    ready();
    await expect(starting).rejects.toThrow('capture exclusion');
    expect(mocks.windows.every((w) => w.dead)).toBe(true);
  });

  it('times out if renderer never mounts', async () => {
    const starting = overlay.activate(session, stop, invalidate);
    const rejected = expect(starting).rejects.toThrow('did not become ready');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(stop).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith('executor_failed');
  });
});

describe('desktop executor and overlay startup failures', () => {
  function execution() {
    const native: DesktopNative = {
      identity: vi.fn(async () => ({
        computerId: session.computerId,
        computerName: session.computerName,
        platform: 'macos',
      })),
      acquire: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
      check: vi.fn(async () => {}),
      validateExclusion: vi.fn(async () => {}),
      layout: vi.fn(async () => []),
      capture: vi.fn(async () => []),
      windows: vi.fn(async () => ({ windows: [] })),
      focusWindow: vi.fn(async () => {}),
      frontmostPid: vi.fn(async () => undefined),
      input: vi.fn(async () => {}),
    };
    const reports = { retain: vi.fn(async () => {}), queue: vi.fn(async () => {}) };
    const connection = {
      backendId: session.backendId,
      saveAsset: vi.fn(),
      revoke: vi.fn(async () => ({})),
    };
    const executor = new DesktopExecutor(native, overlay, reports);
    const binding = {
      workspaceId: session.workspaceId,
      agentId: session.agentId,
      principalId: 'human',
      connectionEpoch: 'epoch',
    };
    const start = async () => {
      await executor.handle(connection, { operation: 'prepare', ...binding });
      return executor.handle(connection, {
        operation: 'startControl',
        ...binding,
        computerId: session.computerId,
        sessionId: session.sessionId,
        agentName: session.agentName,
        leaseMs: 15000,
        stopReportToken: 'a'.repeat(43),
      });
    };
    return { native, reports, connection, executor, start };
  }

  it.each(['darwin', 'win32'] as const)(
    'passes every glow and control window to native screenshot exclusion on %s',
    async (platform) => {
      overlay = new DesktopControlOverlay({
        url: 'app://workspaces/desktop-overlay',
        preload: '/preload.js',
        platform,
      });
      const t = execution();
      const display = {
        displayId: '1',
        width: 2880,
        height: 1800,
        originX: -2880,
        originY: 0,
        scaleFactor: 2,
      };
      const request = vi.fn(async (operation: string) =>
        operation === 'layout'
          ? [display]
          : operation === 'capture'
            ? [{ ...display, data: 'cG5n' }]
            : operation === 'windows'
              ? { windows: [] }
              : { ok: true },
      );
      const adapter = new DesktopNativeAdapter(request);
      t.native.validateExclusion = adapter.validateExclusion.bind(adapter);
      t.native.layout = adapter.layout.bind(adapter);
      t.native.capture = adapter.capture.bind(adapter);
      t.native.windows = adapter.windows.bind(adapter);
      t.connection.saveAsset.mockResolvedValue({
        assetId: 'asset',
        url: 'workspace-asset://ws-a/asset',
      });
      const starting = t.start();
      await vi.waitFor(() => expect(mocks.windows).toHaveLength(4));
      ready();
      await starting;
      expect(request).toHaveBeenCalledWith('validateExclusion', {
        excludedWindows: ['1', '2', '3', '4'],
      });
      const binding = {
        workspaceId: session.workspaceId,
        agentId: session.agentId,
        principalId: 'human',
        connectionEpoch: 'epoch',
        computerId: session.computerId,
        sessionId: session.sessionId,
        commandId: 'capture',
        sequence: 1,
      };
      const ticket = (await t.executor.handle(t.connection, {
        operation: 'prepareCommand',
        ...binding,
        action: { kind: 'screenshot' },
      })) as { deadlineId: string };
      await t.executor.handle(t.connection, {
        operation: 'execute',
        ...binding,
        deadlineId: ticket.deadlineId,
      });
      expect(request).toHaveBeenCalledWith('capture', {
        excludedWindows: ['1', '2', '3', '4'],
        display,
        layout: [display],
      });
      // Window metadata never lists the glow or control panels either.
      expect(request).toHaveBeenCalledWith('windows', {
        excludedWindows: ['1', '2', '3', '4'],
        display,
        layout: [display],
      });
      expect(mocks.windows.every((w) => w.visible && !w.dead)).toBe(true);
      expect(mocks.windows[1].webContents.send).not.toHaveBeenCalledWith('desktop-overlay:pulse');
      await t.executor.invalidate('user_stop');
    },
  );

  it('returns a failed start after overlay load failure without a competing session-ended report', async () => {
    const t = execution();
    mocks.failLoad = true;
    await expect(t.start()).rejects.toMatchObject({ data: { code: 'desktop-execution-failed' } });
    expect(t.connection.revoke).not.toHaveBeenCalled();
    expect(t.reports.queue).not.toHaveBeenCalled();
    expect(t.native.release).toHaveBeenCalledOnce();
    expect(t.native.input).not.toHaveBeenCalled();
    expect(mocks.windows).toHaveLength(4);
    expect(mocks.windows.every((w) => w.dead && !w.visible)).toBe(true);
  });

  it('returns a failed start when overlay readiness times out, even if ready arrives later', async () => {
    const t = execution();
    const result = t.start().catch((error) => error);
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(4));
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatchObject({ data: { code: 'desktop-execution-failed' } });
    for (const window of mocks.windows) {
      send(window, 'ready');
      window.emit('ready-to-show');
    }
    expect(t.connection.revoke).not.toHaveBeenCalled();
    expect(t.native.release).toHaveBeenCalledOnce();
    expect(mocks.windows.every((w) => w.dead && !w.visible)).toBe(true);
    expect(t.native.validateExclusion).not.toHaveBeenCalled();
  });

  it('reports executor failure if native cleanup cannot be confirmed after overlay load failure', async () => {
    const t = execution();
    mocks.failLoad = true;
    vi.mocked(t.native.release).mockRejectedValue(new Error('release unavailable'));
    await expect(t.start()).rejects.toMatchObject({
      data: {
        code: 'desktop-execution-failed',
        detail: 'Local desktop cleanup could not be confirmed',
      },
    });
    expect(t.connection.revoke).toHaveBeenCalledExactlyOnceWith({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      reason: 'executor_failed',
    });
    expect(t.reports.queue).not.toHaveBeenCalled();
    expect(mocks.windows.every((w) => w.dead)).toBe(true);
  });
});

describe('desktop overlay hands focus back to Intent', () => {
  const intentWindow = { isDestroyed: () => false };
  const owner = expect.objectContaining({ backendId: 'backend-a', workspaceId: 'ws-a' });
  /** The agent clicks another app; the OS reports Intent's blur shortly after. */
  function agentSwitchesApp(blurAfterMs = 50) {
    overlay.agentInput(session.sessionId, true);
    overlay.agentInput(session.sessionId, false);
    vi.advanceTimersByTime(blurAfterMs);
    mocks.focused = null;
    app.emit('browser-window-blur');
    vi.advanceTimersByTime(200);
  }
  /** The executor restores focus only after native release has drained input. */
  async function endSession() {
    await overlay.deactivate(session.sessionId);
    await overlay.restoreFocus(session.sessionId);
  }
  function userSwitchesApp() {
    mocks.focused = null;
    app.emit('browser-window-blur');
    vi.advanceTimersByTime(200);
  }

  it('refocuses the owning window when the agent ends after moving to another app', async () => {
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    await endSession();
    expect(refocus).toHaveBeenCalledOnce();
    expect(refocus).toHaveBeenCalledWith(owner, 'darwin');
  });

  it.each([
    [
      'user Stop',
      () =>
        send(
          mocks.windows.find((w) => w.url.endsWith('controls')),
          'stop',
        ),
    ],
    ['lock / expiry style invalidation', () => powerMonitor.emit('lock-screen')],
  ])('refocuses after %s', async (_name, end) => {
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    end();
    expect(refocus).not.toHaveBeenCalled();
    await overlay.restoreFocus(session.sessionId);
    expect(stop.mock.calls.length + invalidate.mock.calls.length).toBe(1);
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('attributes a slow app activation inside the grace window to the agent', async () => {
    mocks.focused = intentWindow;
    await activate();
    // A Dock click that launches Safari activates it seconds later.
    agentSwitchesApp(DESKTOP_AGENT_SWITCH_GRACE_MS - 1_000);
    await endSession();
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('attributes a blur while an agent input is still running to the agent', async () => {
    mocks.focused = intentWindow;
    await activate();
    overlay.agentInput(session.sessionId, true);
    vi.advanceTimersByTime(DESKTOP_AGENT_SWITCH_GRACE_MS * 2);
    userSwitchesApp();
    overlay.agentInput(session.sessionId, false);
    await endSession();
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('leaves the user where they are when they switched apps themselves', async () => {
    mocks.focused = intentWindow;
    await activate();
    userSwitchesApp();
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('honours a user switch that the session ends before confirming', async () => {
    mocks.focused = intentWindow;
    await activate();
    mocks.focused = null;
    app.emit('browser-window-blur');
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('ignores a pending blur between Intent windows when the session ends', async () => {
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    vi.advanceTimersByTime(DESKTOP_AGENT_SWITCH_GRACE_MS);
    mocks.focused = intentWindow;
    app.emit('browser-window-blur');
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('waits for the executor before refocusing, then refocuses once', async () => {
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    await overlay.deactivate(session.sessionId);
    expect(refocus).not.toHaveBeenCalled();
    await overlay.restoreFocus('other-session');
    expect(refocus).not.toHaveBeenCalled();
    await overlay.restoreFocus(session.sessionId);
    await overlay.restoreFocus(session.sessionId);
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('treats an app switch after the grace window as the user', async () => {
    mocks.focused = intentWindow;
    await activate();
    overlay.agentInput(session.sessionId, true);
    overlay.agentInput(session.sessionId, false);
    vi.advanceTimersByTime(DESKTOP_AGENT_SWITCH_GRACE_MS + 1);
    userSwitchesApp();
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('ignores focus moving between Intent windows', async () => {
    mocks.focused = intentWindow;
    await activate();
    app.emit('browser-window-blur');
    vi.advanceTimersByTime(200);
    agentSwitchesApp();
    await endSession();
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('ignores input reports for another session', async () => {
    mocks.focused = intentWindow;
    await activate();
    overlay.agentInput('other-session', true);
    userSwitchesApp();
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('does not refocus when Intent was not focused at start', async () => {
    await activate();
    agentSwitchesApp();
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('does not refocus when an Intent window is already focused at the end', async () => {
    mocks.focused = intentWindow;
    await activate();
    await endSession();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('stops tracking focus after the session ends', async () => {
    mocks.focused = intentWindow;
    await activate();
    await endSession();
    expect(app.listenerCount('browser-window-blur')).toBe(0);
  });

  it('leaves the user where they are when the native check sees their switch', async () => {
    const userSwitchedForeground = vi.fn().mockResolvedValue(true);
    overlay = new DesktopControlOverlay({
      url: 'app://workspaces/desktop-overlay',
      preload: '/preload.js',
      platform: 'darwin',
      refocus,
      userSwitchedForeground,
    });
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    await endSession();
    expect(userSwitchedForeground).toHaveBeenCalledWith(owner);
    expect(refocus).not.toHaveBeenCalled();
  });

  it.each([
    ['cannot tell', () => Promise.resolve(undefined)],
    ['reports no user switch', () => Promise.resolve(false)],
    ['fails', () => Promise.reject(new Error('helper gone'))],
  ])('falls back to blur tracking when the native check %s', async (_name, check) => {
    overlay = new DesktopControlOverlay({
      url: 'app://workspaces/desktop-overlay',
      preload: '/preload.js',
      platform: 'darwin',
      refocus,
      userSwitchedForeground: check,
    });
    mocks.focused = intentWindow;
    await activate();
    agentSwitchesApp();
    await endSession();
    expect(refocus).toHaveBeenCalledOnce();
  });

  it('skips the native check when blur tracking already saw the user switch', async () => {
    const userSwitchedForeground = vi.fn().mockResolvedValue(false);
    overlay = new DesktopControlOverlay({
      url: 'app://workspaces/desktop-overlay',
      preload: '/preload.js',
      platform: 'darwin',
      refocus,
      userSwitchedForeground,
    });
    mocks.focused = intentWindow;
    await activate();
    userSwitchesApp();
    await endSession();
    expect(userSwitchedForeground).not.toHaveBeenCalled();
    expect(refocus).not.toHaveBeenCalled();
  });

  it('never fails teardown when refocusing throws', async () => {
    mocks.focused = intentWindow;
    refocus.mockImplementation(() => {
      throw new Error('window gone');
    });
    await activate();
    agentSwitchesApp();
    await overlay.deactivate(session.sessionId);
    await expect(overlay.restoreFocus(session.sessionId)).resolves.toBeUndefined();
    expect(mocks.windows.every((w) => w.dead)).toBe(true);
  });
});
