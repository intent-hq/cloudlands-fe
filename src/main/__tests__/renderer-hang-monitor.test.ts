/**
 * Unit tests for the renderer hang monitor (src/main/renderer-hang-monitor.ts).
 * The stack capture, workspace lookup, dialog, and clock are injected, so no
 * electron debugger or native dialog is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
