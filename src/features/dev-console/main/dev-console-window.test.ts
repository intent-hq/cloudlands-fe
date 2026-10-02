import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { RpcTrafficObserver } from '$features/backend/main/rpc-traffic';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  failLoad: false,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    id = mocks.windows.length + 1;
    dead = false;
    minimized = false;
    url = 'about:blank';
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => this.dead,
      getURL: () => this.url,
      mainFrame: {},
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    });
    constructor() {
      super();
      mocks.windows.push(this);
    }
    static fromWebContents(wc: unknown) {
      return mocks.windows.find((w) => w.webContents === wc) ?? null;
    }
    isDestroyed() {
      return this.dead;
    }
    isMinimized() {
      return this.minimized;
    }
    restore = vi.fn(() => {
      this.minimized = false;
    });
    focus = vi.fn();
    show = vi.fn();
    destroy() {
      if (this.dead) return;
      this.dead = true;
      this.emit('closed');
      this.webContents.emit('destroyed');
    }
    async loadURL(url: string) {
      this.webContents.emit('did-start-navigation', {}, url, false, true);
      this.url = url;
      if (mocks.failLoad) throw new Error('load failed');
    }
  }
  return {
    BrowserWindow: Window,
    app: new EventEmitter(),
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => any) => mocks.handlers.set(channel, fn),
      removeHandler: (channel: string) => mocks.handlers.delete(channel),
    },
  };
});
import { DevConsoleWindows, registerDevConsoleIPC } from './dev-console-window';
import { DevConsoleCaptureService } from './dev-console-capture';
import { BrowserWindow, app } from 'electron';
import { stampWindowWithBackend } from '../../../main/window-backend';

const url = 'app://workspaces/dev-console';
let capture: DevConsoleCaptureService;
let manager: DevConsoleWindows;
let stop: () => void;
const sender = (window: BrowserWindow) =>
  ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) as IpcMainInvokeEvent;
const call = (channel: string, window: BrowserWindow, request = {}) =>
  mocks.handlers.get('dev-console:' + channel)!(sender(window), request);
function source(backend = 'one') {
  const observers = new Set<RpcTrafficObserver>();
  const unregister = capture.registerClient(backend, backend, {
    observeTraffic(observer) {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
  });
  return {
    observers,
    unregister,
    emit() {
      for (const observer of observers)
        observer({
          type: 'notification',
          method: 'events.event',
          payload: { event: { type: 'agent:updated', private: 'secret' } },
          connectionGeneration: 1,
        });
    },
  };
}
beforeEach(() => {
  mocks.windows.length = 0;
  mocks.failLoad = false;
  vi.useFakeTimers();
  capture = new DevConsoleCaptureService();
  manager = new DevConsoleWindows(capture, { preload: '/preload.js', url });
  stop = registerDevConsoleIPC(manager, capture);
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('Dev Console native lifecycle', () => {
  it('opens one window per native backend, focuses duplicates, and observes pooled replacements', async () => {
    const initial = source();
    const opener = new BrowserWindow();
    stampWindowWithBackend(opener, 'one');
    await opener.loadURL('app://workspaces/workspace/new');
    const { windowId } = call('open', opener);
    const window = mocks.windows.find((w) => w.id === windowId);
    window.minimized = true;
    expect(call('open', opener).windowId).toBe(windowId);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(initial.observers.size).toBe(1);
    const identity = call('connect', window);
    initial.emit();
    const replacement = source();
    initial.unregister();
    expect(initial.observers.size).toBe(0);
    expect(replacement.observers.size).toBe(1);
    replacement.emit();
    expect(
      call('read', window, { sessionId: identity.sessionId, afterRevision: -1 }).recordIds,
    ).toHaveLength(2);
    const other = manager.open('two');
    expect(other.id).not.toBe(window.id);
    expect(
      call('read', other, { sessionId: call('connect', other).sessionId, afterRevision: -1 })
        .recordIds,
    ).toEqual([]);
  });

  it.each(['closed', 'destroyed', 'render-process-gone', 'did-fail-load'])(
    'cleans capture on %s and reopening has no records or choices',
    (event) => {
      const client = source();
      const window = manager.open('one');
      const identity = call('connect', window);
      call('select', window, {
        sessionId: identity.sessionId,
        selection: { direction: 'inbound', kind: 'notification', method: 'agent:updated' },
        enabled: true,
      });
      client.emit();
      if (event === 'closed') window.destroy();
      else window.webContents.emit(event, {}, -1, 'failed', url, true);
      expect(client.observers.size).toBe(0);
      expect(capture.getSnapshot('one', identity.sessionId)).toBeNull();
      const reopened = manager.open('one');
      const next = call('connect', reopened);
      expect(next.sessionId).not.toBe(identity.sessionId);
      expect(
        call('read', reopened, { sessionId: next.sessionId, afterRevision: -1 }),
      ).toMatchObject({ recordIds: [], fullCapture: [] });
    },
  );

  it('reload replaces the session, rejects stale reads, and close cancels pending invalidations', async () => {
    const client = source();
    const window = manager.open('one');
    const previous = call('connect', window);
    client.emit();
    await window.loadURL(url);
    expect(capture.getSnapshot('one', previous.sessionId)).toBeNull();
    expect(() =>
      call('read', window, { sessionId: previous.sessionId, afterRevision: -1 }),
    ).toThrow('Unauthorized');
    expect(client.observers.size).toBe(1);
    client.emit();
    window.destroy();
    vi.runAllTimers();
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('coalesces bursts and applies backpressure until READ, with payload-free deltas', () => {
    const client = source();
    const window = manager.open('one');
    const { sessionId } = call('connect', window);
    for (let i = 0; i < 2000; i++) client.emit();
    vi.advanceTimersByTime(100);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    client.emit();
    vi.advanceTimersByTime(500);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    const update = call('read', window, { sessionId, afterRevision: -1 });
    expect(update.upserts).toHaveLength(2001);
    expect(JSON.stringify(update)).not.toContain('secret');
    expect(
      call('record', window, { sessionId, recordId: update.recordIds[0] }).payload.text,
    ).toContain('secret');
    expect(call('read', window, { sessionId, afterRevision: update.revision }).upserts).toEqual([]);
    client.emit();
    vi.advanceTimersByTime(100);
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('rejects app windows, foreign sessions, subframes, and untrusted origins', async () => {
    const window = manager.open('one');
    const { sessionId } = call('connect', window);
    const other = manager.open('two');
    expect(() => call('read', other, { sessionId, afterRevision: -1 })).toThrow('Unauthorized');
    const opener = new BrowserWindow();
    stampWindowWithBackend(opener, 'one');
    await opener.loadURL('app://workspaces/workspace/new');
    expect(() => call('read', opener, { sessionId, afterRevision: -1 })).toThrow('Unauthorized');
    expect(() =>
      manager.authorize({ ...sender(window), senderFrame: {} } as IpcMainInvokeEvent),
    ).toThrow('Unauthorized');
    await opener.loadURL('https://untrusted.invalid');
    expect(() => call('open', opener)).toThrow('Unauthorized');
    expect(() =>
      call('read', window, { sessionId, afterRevision: -1, backendId: 'two' }),
    ).toThrow();
  });

  it('cleans a failed invalidation send and cannot be resurrected by a stale navigation', () => {
    const client = source();
    const window = manager.open('one');
    vi.mocked(window.webContents.send).mockImplementationOnce(() => {
      throw new Error('renderer gone');
    });
    client.emit();
    vi.advanceTimersByTime(100);
    expect(client.observers.size).toBe(0);
    window.webContents.emit('did-start-navigation', {}, url, false, true);
    expect(client.observers.size).toBe(0);
  });

  it('cleans a rejected load and shutdown without leaving subscriptions', async () => {
    const client = source();
    mocks.failLoad = true;
    manager.open('one');
    await Promise.resolve();
    expect(client.observers.size).toBe(0);
    mocks.failLoad = false;
    manager.open('one');
    app.emit('will-quit');
    expect(client.observers.size).toBe(0);
  });
});
