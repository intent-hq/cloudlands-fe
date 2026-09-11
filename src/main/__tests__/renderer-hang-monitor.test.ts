/**
 * Unit tests for the renderer hang monitor (src/main/renderer-hang-monitor.ts).
 * The monitor tests inject stack capture, workspace lookup, dialog, and clock.
 * The capture tests drive the real `captureRendererStack` against a fake CDP
 * debugger whose commands can be held pending, so no native Electron is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = loggerMocks.debug;
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
  },
}));

import { stampWindowWithBackend } from '../window-backend';
import {
  attachRendererHangMonitor,
  captureRendererStack,
  type RendererHangFrame,
  type RendererHangMonitorDeps,
} from '../renderer-hang-monitor';

type Listener = (...args: unknown[]) => void;

/** Minimal BrowserWindow + WebContents stand-in capturing the attached listeners. */
function createFakeWindow(id = 7) {
  const contentsListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  let destroyed = false;
  const reload = vi.fn();

  const add = (map: Map<string, Set<Listener>>) => (event: string, listener: Listener) => {
    if (!map.has(event)) map.set(event, new Set());
    map.get(event)!.add(listener);
  };
  const remove = (map: Map<string, Set<Listener>>) => (event: string, listener: Listener) => {
    map.get(event)?.delete(listener);
  };

  const webContents = {
    on: vi.fn(add(contentsListeners)),
    removeListener: vi.fn(remove(contentsListeners)),
    isDestroyed: () => destroyed,
    getURL: () => 'app://renderer/index.html',
    reload,
  };
  const window = {
    id,
    webContents,
    on: vi.fn(add(windowListeners)),
    once: vi.fn(add(windowListeners)),
    removeListener: vi.fn(remove(windowListeners)),
    isDestroyed: () => destroyed,
  };

  const emit = (map: Map<string, Set<Listener>>, event: string) => {
    for (const listener of [...(map.get(event) ?? [])]) listener();
  };
  return {
    window: window as unknown as BrowserWindow,
    reload,
    emitUnresponsive: () => emit(contentsListeners, 'unresponsive'),
    emitResponsive: () => emit(contentsListeners, 'responsive'),
    emitClosed: () => {
      destroyed = true;
      emit(windowListeners, 'closed');
    },
    listenerCount: (event: string) => contentsListeners.get(event)?.size ?? 0,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

interface Harness {
  deps: Partial<RendererHangMonitorDeps>;
  showMessageBox: ReturnType<typeof vi.fn>;
  captureStack: ReturnType<typeof vi.fn>;
  clock: { now: number };
  /** Resolve the currently open dialog with the given button index. */
  answerDialog: (response: number) => void;
}

function createHarness(overrides: Partial<RendererHangMonitorDeps> = {}): Harness {
  const clock = { now: 10_000 };
  let pending: ((value: MessageBoxReturnValue) => void) | null = null;
  const showMessageBox = vi.fn(
    (_parent: BrowserWindow, options: MessageBoxOptions) =>
      new Promise<MessageBoxReturnValue>((resolve) => {
        pending = resolve;
        options.signal?.addEventListener('abort', () =>
          resolve({ response: options.cancelId ?? 1, checkboxChecked: false }),
        );
      }),
  );
  const captureStack = vi.fn(async (): Promise<RendererHangFrame[] | null> => [
    { functionName: 'busyLoop', url: 'app://renderer/main.js', lineNumber: 12, columnNumber: 3 },
  ]);
  return {
    deps: {
      resolveWorkspaceId: vi.fn(async () => 'ws-123'),
      captureStack,
      showMessageBox,
      now: () => clock.now,
      ...overrides,
    },
    showMessageBox,
    captureStack,
    clock,
    answerDialog: (response) => {
      pending?.({ response, checkboxChecked: false });
      pending = null;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('attachRendererHangMonitor', () => {
  it('logs window id, backend id, workspace id, and time since responsive on unresponsive', async () => {
    const fake = createFakeWindow(42);
    stampWindowWithBackend(fake.window, 'remote-backend');
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    h.clock.now = 10_500;
    fake.emitResponsive();
    h.clock.now = 25_500;
    fake.emitUnresponsive();
    await flush();

    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Renderer unresponsive',
      expect.objectContaining({
        windowId: 42,
        backendId: 'remote-backend',
        workspaceId: 'ws-123',
        msSinceResponsive: 15_000,
        url: 'app://renderer/index.html',
      }),
    );
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Renderer hang stack',
      expect.objectContaining({
        windowId: 42,
        frames: ['busyLoop (app://renderer/main.js:12:3)'],
      }),
    );
  });

  it('shows the dialog once per unresponsive episode', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();
    fake.emitUnresponsive();
    await flush();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);

    h.answerDialog(1);
    await flush();
    fake.emitUnresponsive();
    await flush();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    expect(fake.reload).not.toHaveBeenCalled();

    fake.emitResponsive();
    fake.emitUnresponsive();
    await flush();
    expect(h.showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('skips the dialog when responsive fires before stack capture finishes', async () => {
    const fake = createFakeWindow();
    let finishCapture: (() => void) | null = null;
    const h = createHarness({
      captureStack: vi.fn(
        () =>
          new Promise<RendererHangFrame[] | null>((resolve) => {
            finishCapture = () => resolve(null);
          }),
      ),
    });
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();
    fake.emitResponsive();
    finishCapture!();
    await flush();

    expect(loggerMocks.error).toHaveBeenCalledWith('Renderer unresponsive', expect.anything());
    expect(h.showMessageBox).not.toHaveBeenCalled();
    expect(loggerMocks.info).toHaveBeenCalledWith(
      'Renderer responsive again',
      expect.objectContaining({ windowId: 7 }),
    );
  });

  it('reports msUnresponsive as the duration of the episode, not the healthy time before it', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    h.clock.now = 60_000;
    fake.emitUnresponsive();
    await flush();
    h.clock.now = 64_000;
    fake.emitResponsive();

    expect(loggerMocks.info).toHaveBeenCalledWith(
      'Renderer responsive again',
      expect.objectContaining({ msUnresponsive: 4_000 }),
    );
  });

  it('aborts an open dialog when responsive fires and does not reload', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    const options = h.showMessageBox.mock.calls[0][1] as MessageBoxOptions;
    expect(options.signal?.aborted).toBe(false);

    fake.emitResponsive();
    await flush();
    expect(options.signal?.aborted).toBe(true);
    expect(fake.reload).not.toHaveBeenCalled();
  });

  it('reloads the webContents when the user picks the non-cancel (Reload) button', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();
    const options = h.showMessageBox.mock.calls[0][1] as MessageBoxOptions;
    const reloadIndex = options.buttons!.findIndex((_, i) => i !== options.cancelId);
    h.answerDialog(reloadIndex);
    await flush();

    expect(fake.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the user picks Wait (the cancel button)', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();
    const options = h.showMessageBox.mock.calls[0][1] as MessageBoxOptions;
    h.answerDialog(options.cancelId!);
    await flush();

    expect(fake.reload).not.toHaveBeenCalled();
  });

  it('swallows stack-capture failures and still shows the dialog', async () => {
    const fake = createFakeWindow();
    const h = createHarness({
      captureStack: vi.fn(async () => {
        throw new Error('debugger attach failed');
      }),
    });
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Renderer hang stack capture failed',
      expect.objectContaining({ error: 'debugger attach failed' }),
    );
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('falls back to an undefined workspace when the lookup fails', async () => {
    const fake = createFakeWindow();
    const h = createHarness({
      resolveWorkspaceId: vi.fn(async () => {
        throw new Error('lookup failed');
      }),
    });
    attachRendererHangMonitor(fake.window, h.deps);

    fake.emitUnresponsive();
    await flush();

    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Renderer unresponsive',
      expect.objectContaining({ workspaceId: undefined }),
    );
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('removes listeners and aborts the dialog when the window closes', async () => {
    const fake = createFakeWindow();
    const h = createHarness();
    attachRendererHangMonitor(fake.window, h.deps);
    expect(fake.listenerCount('unresponsive')).toBe(1);
    expect(fake.listenerCount('responsive')).toBe(1);

    fake.emitUnresponsive();
    await flush();
    const options = h.showMessageBox.mock.calls[0][1] as MessageBoxOptions;

    fake.emitClosed();
    await flush();
    expect(options.signal?.aborted).toBe(true);
    expect(fake.listenerCount('unresponsive')).toBe(0);
    expect(fake.listenerCount('responsive')).toBe(0);
    expect(fake.reload).not.toHaveBeenCalled();
  });
});

type CdpCommand = 'Debugger.enable' | 'Debugger.pause' | 'Debugger.resume' | 'Debugger.disable';
type DebuggerMessage = (event: unknown, method: string, params: unknown) => void;

/**
 * Fake `webContents` with a CDP debugger. One command can be held pending
 * (`hold`) and released later via `release()`, modelling a wedged renderer that
 * replies after the deadline. `Debugger.pause` emits `Debugger.paused` when it
 * completes, like V8 does.
 */
function createFakeDebuggerWindow(
  options: { hold?: CdpCommand; devToolsOpen?: boolean; attachFails?: boolean } = {},
) {
  let attached = false;
  const listeners = new Set<DebuggerMessage>();
  const commands: string[] = [];
  let release: () => void = () => {};
  const detach = vi.fn(() => {
    attached = false;
  });
  const emitPaused = () => {
    for (const listener of [...listeners]) {
      listener({}, 'Debugger.paused', {
        callFrames: [
          {
            functionName: 'busyLoop',
            url: 'app://renderer/main.js',
            location: { lineNumber: 11, columnNumber: 2 },
          },
        ],
      });
    }
  };
  const dbg = {
    isAttached: () => attached,
    attach: vi.fn(() => {
      if (options.attachFails) throw new Error('Cannot attach: renderer is gone');
      attached = true;
    }),
    detach,
    on: vi.fn((_event: string, listener: DebuggerMessage) => listeners.add(listener)),
    removeListener: vi.fn((_event: string, listener: DebuggerMessage) =>
      listeners.delete(listener),
    ),
    sendCommand: vi.fn((method: string) => {
      commands.push(method);
      const reply = () => {
        if (method === 'Debugger.pause') emitPaused();
      };
      if (method === options.hold) {
        return new Promise<object>((resolve) => {
          release = () => {
            reply();
            resolve({});
          };
        });
      }
      queueMicrotask(reply);
      return Promise.resolve({});
    }),
  };
  const window = {
    id: 9,
    webContents: {
      debugger: dbg,
      isDevToolsOpened: () => options.devToolsOpen ?? false,
      isDestroyed: () => false,
    },
    isDestroyed: () => false,
  };
  return {
    window: window as unknown as BrowserWindow,
    commands,
    detach,
    isAttached: () => attached,
    listenerCount: () => listeners.size,
    release: () => release(),
  };
}

describe('captureRendererStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses, reads the paused call frames, then resumes and detaches', async () => {
    const fake = createFakeDebuggerWindow();
    const frames = await captureRendererStack(fake.window, 3000);

    expect(frames).toEqual([
      { functionName: 'busyLoop', url: 'app://renderer/main.js', lineNumber: 12, columnNumber: 3 },
    ]);
    expect(fake.commands).toEqual([
      'Debugger.enable',
      'Debugger.pause',
      'Debugger.resume',
      'Debugger.disable',
    ]);
    expect(fake.detach).toHaveBeenCalledTimes(1);
    expect(fake.isAttached()).toBe(false);
    expect(fake.listenerCount()).toBe(0);
  });

  it('skips capture entirely while DevTools is open, even though no debugger is attached', async () => {
    const fake = createFakeDebuggerWindow({ devToolsOpen: true });
    const frames = await captureRendererStack(fake.window, 3000);

    expect(frames).toBeNull();
    expect(fake.commands).toEqual([]);
    expect(fake.isAttached()).toBe(false);
  });

  it.each<CdpCommand>(['Debugger.enable', 'Debugger.pause', 'Debugger.resume', 'Debugger.disable'])(
    'gives up at the deadline and detaches when %s stalls, and a late reply issues no further commands',
    async (held) => {
      const fake = createFakeDebuggerWindow({ hold: held });
      const pending = captureRendererStack(fake.window, 3000);

      await vi.advanceTimersByTimeAsync(2999);
      expect(fake.isAttached()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeNull();
      expect(fake.commands.at(-1)).toBe(held);
      expect(fake.detach).toHaveBeenCalledTimes(1);
      expect(fake.isAttached()).toBe(false);
      expect(fake.listenerCount()).toBe(0);

      const issuedAtDeadline = [...fake.commands];
      fake.release();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fake.commands).toEqual(issuedAtDeadline);
      expect(fake.detach).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates an attach failure without issuing commands so the caller can log it', async () => {
    const fake = createFakeDebuggerWindow({ attachFails: true });

    await expect(captureRendererStack(fake.window, 3000)).rejects.toThrow(
      'Cannot attach: renderer is gone',
    );
    expect(fake.commands).toEqual([]);
    expect(fake.isAttached()).toBe(false);
  });
});
