import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  publish: vi.fn(async (_text: string) => {}),
  getPath: vi.fn(),
  fromWebContents: vi.fn(),
  backend: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  clipboard: { writeText: mocks.publish },
  ipcMain: { handle: mocks.handle },
}));
vi.mock('../../backend/main/backend.ipc', () => ({ getBackendClientForIpcEvent: mocks.backend }));
// Override the global test setup's bridge stub: exercise the production router.
vi.unmock('$lib/electron-bridge');
import { invoke } from '$lib/electron-bridge';
import { resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerSourceClipboardBridge } from '$store/renderer/seeders/source-clipboard-bridge-seeder';
import { registerSourceClipboardIPC } from './source-clipboard.ipc';
import { stampWindowWithBackend } from '../../../main/window-backend';
import type { BrowserWindow } from 'electron';
import {
  openNoteSourceClipboardSink,
  SourceClipboardCleanupError,
} from '$lib/utils/source-clipboard';
import { IPC_CHANNELS } from '$shared/ipc-registry';
const c = IPC_CHANNELS.SYSTEM;
const originalElectronAPI = window.electronAPI;
afterEach(() => {
  window.electronAPI = originalElectronAPI;
  resetMockIpcRouter();
});
const handlers = new Map<string, (event: unknown, params: unknown) => Promise<unknown>>();
let directory: string;
let sender: EventEmitter & { mainFrame: object; isDestroyed(): boolean };
let client: EventEmitter & { getStatus(): string };
let mainWindow: BrowserWindow;
let event: { sender: typeof sender; senderFrame: object };
beforeAll(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'source-clipboard-ipc-'));
  mocks.getPath.mockReturnValue(directory);
  mocks.handle.mockImplementation((channel, handler) => {
    handlers.set(channel, handler);
  });
  registerSourceClipboardIPC();
});
afterAll(async () => {
  expect(await fs.readdir(directory)).toEqual([]);
  await fs.rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
  mocks.publish.mockReset();
  mocks.publish.mockResolvedValue(undefined);
  resetMockIpcRouter();
  registerSourceClipboardBridge();
  registerSourceClipboardBridge(); // Reinstallation must not duplicate forwarding.
  window.electronAPI = {
    versions: { electron: '42.0.0' },
    invoke: mocks.invoke,
  } as unknown as Window['electronAPI'];
  sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  mainWindow = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  }) as unknown as BrowserWindow;
  mocks.fromWebContents.mockReturnValue(mainWindow);
  stampWindowWithBackend(mainWindow, 'b');
  client = Object.assign(new EventEmitter(), { getStatus: () => 'connected' });
  event = { sender, senderFrame: sender.mainFrame };
  mocks.backend.mockReturnValue({ backendId: 'b', client });
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (channel, params) => {
    const h = handlers.get(channel);
    if (!h) throw new Error('Unregistered channel');
    return h(event, params);
  });
});
const input = (length: number) => ({ id: randomUUID(), length, expiresAt: Date.now() + 50000 });
it('connects real renderer adapter to registered main handlers and awaits native publication', async () => {
  expect(vi.isMockFunction(invoke)).toBe(false);
  const sink = await openNoteSourceClipboardSink(input(8));
  await sink.write('abc');
  await sink.write('😀\r\nz');
  let resolve!: () => void;
  const held = new Promise<void>((r) => {
    resolve = r;
  });
  mocks.publish.mockReturnValue(held);
  let done = false;
  const pending = Promise.resolve(sink.commit()).then(() => {
    done = true;
  });
  await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledWith('abc😀\r\nz'));
  expect(done).toBe(false);
  expect(await fs.readdir(directory)).toHaveLength(1);
  resolve();
  await pending;
  expect(await fs.readdir(directory)).toEqual([]);
  expect(sender.listenerCount('destroyed')).toBe(1); // Existing strict document binding observer.
  expect(client.listenerCount('status')).toBe(0);
  expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
    c.SOURCE_CLIPBOARD_BEGIN,
    c.SOURCE_CLIPBOARD_WRITE,
    c.SOURCE_CLIPBOARD_WRITE,
    c.SOURCE_CLIPBOARD_COMMIT,
  ]);
});
it.each(['frame', 'backend', 'disconnect', 'restamp'])(
  'refuses %s owner replacement before native handoff',
  async (kind) => {
    const sink = await openNoteSourceClipboardSink(input(1));
    await sink.write('a');
    if (kind === 'frame') sender.emit('did-start-navigation', {}, 'other', false, true);
    if (kind === 'restamp') {
      stampWindowWithBackend(mainWindow, 'other');
      stampWindowWithBackend(mainWindow, 'b');
    }
    if (kind === 'backend') {
      stampWindowWithBackend(mainWindow, 'other');
      mocks.backend.mockReturnValue({ backendId: 'other', client });
    }
    if (kind === 'disconnect') {
      client.emit('status', 'disconnected');
      client.emit('status', 'connected');
    }
    await expect(sink.commit()).rejects.toThrow(/REVOKED|UNKNOWN|OWNER/);
    await sink.abort().catch(() => undefined);
    await vi.waitFor(async () => expect(await fs.readdir(directory)).toEqual([]));
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  },
);
it('rejects non-main-frame IPC and malformed/unbounded chunks without native calls', async () => {
  const begin = handlers.get(c.SOURCE_CLIPBOARD_BEGIN);
  if (!begin) throw new Error('Missing registered handler');
  expect(await begin({ ...event, senderFrame: {} }, input(1))).toMatchObject({
    success: false,
    error: { code: 'SOURCE_CLIPBOARD_OWNER' },
  });
  const sink = await openNoteSourceClipboardSink(input(5000));
  await expect(sink.write('x'.repeat(4097))).rejects.toThrow('INVALID');
  await sink.abort();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('cleans an allocated operation after a lost begin acknowledgement', async () => {
  const invoke = mocks.invoke.getMockImplementation();
  if (!invoke) throw new Error('Missing registered bridge');
  mocks.invoke.mockImplementation(async (channel, params) => {
    const result = await invoke(channel, params);
    if (channel === c.SOURCE_CLIPBOARD_BEGIN) throw new Error('Lost acknowledgement');
    return result;
  });
  await expect(openNoteSourceClipboardSink(input(1))).rejects.toThrow('Lost acknowledgement');
  expect(await fs.readdir(directory)).toEqual([]);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('refuses unavailable platforms without browser clipboard fallback or IPC', async () => {
  window.electronAPI = undefined as unknown as Window['electronAPI'];
  await expect(openNoteSourceClipboardSink(input(1))).rejects.toThrow('UNSUPPORTED');
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('rejects a corrupted receipt without retrying or rolling back the clipboard', async () => {
  const invoke = mocks.invoke.getMockImplementation();
  if (!invoke) throw new Error('Missing registered bridge');
  mocks.invoke.mockImplementation(async (channel, params) => {
    const result = await invoke(channel, params);
    if (channel === c.SOURCE_CLIPBOARD_COMMIT) return { success: true, data: {} };
    return result;
  });
  const sink = await openNoteSourceClipboardSink(input(1));
  await sink.write('a');
  await expect(sink.commit()).rejects.toThrow();
  await sink.abort();
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith('a');
});

it('forwards renderer cancellation during held main hydration before native invocation', async () => {
  let entered!: () => void, resume!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const open = fs.open.bind(fs);
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const read = handle.readFile.bind(handle);
    vi.spyOn(handle, 'readFile').mockImplementation(async () => {
      entered();
      await held;
      return read({ encoding: 'utf8' });
    });
    return handle;
  });
  try {
    const sink = await openNoteSourceClipboardSink(input(1));
    await sink.write('a');
    const refused = expect(sink.commit()).rejects.toThrow('REVOKED');
    await reading;
    let aborted = false;
    const abort = sink.abort().then(() => {
      aborted = true;
    });
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        c.SOURCE_CLIPBOARD_ABORT,
        expect.objectContaining({ token: expect.any(String) }),
      ),
    );
    expect(aborted).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toHaveLength(1);
    expect(client.listenerCount('status')).toBe(1);
    resume();
    await refused;
    await abort;
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
    expect(client.listenerCount('status')).toBe(0);
  } finally {
    resume();
    spy.mockRestore();
  }
});

it('retains native acknowledgement ownership after renderer cancellation without rollback or replay', async () => {
  let resume!: () => void;
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  mocks.publish.mockReturnValue(held);
  const sink = await openNoteSourceClipboardSink(input(1));
  await sink.write('a');
  let committed = false,
    aborted = false;
  const commit = Promise.resolve(sink.commit()).then(() => {
    committed = true;
  });
  await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledExactlyOnceWith('a'));
  const abort = sink.abort().then(() => {
    aborted = true;
  });
  await expect(sink.commit()).rejects.toThrow('BUSY');
  expect(committed).toBe(false);
  expect(aborted).toBe(false);
  expect(await fs.readdir(directory)).toHaveLength(1);
  expect(client.listenerCount('status')).toBe(1);
  resume();
  await Promise.all([commit, abort]);
  await sink.abort();
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith('a');
  expect(await fs.readdir(directory)).toEqual([]);
  expect(client.listenerCount('status')).toBe(0);
});

it.each([
  c.SOURCE_CLIPBOARD_BEGIN,
  c.SOURCE_CLIPBOARD_WRITE,
  c.SOURCE_CLIPBOARD_COMMIT,
  c.SOURCE_CLIPBOARD_ABORT,
])('refuses browser mock recursion on %s through the actual generated router', async (channel) => {
  window.electronAPI = {
    versions: { electron: '0.0.0-browser' },
    invoke: mocks.invoke,
  } as unknown as Window['electronAPI'];
  await expect(invoke(channel, { id: randomUUID() })).rejects.toThrow(
    'SOURCE_CLIPBOARD_UNSUPPORTED',
  );
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
});

it('rejects the browser adapter before allocation without claiming unknown cleanup', async () => {
  window.electronAPI = {
    versions: { electron: '0.0.0-browser' },
    invoke: mocks.invoke,
  } as unknown as Window['electronAPI'];
  const result = await openNoteSourceClipboardSink(input(1)).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
  expect(result).toMatchObject({ message: 'SOURCE_CLIPBOARD_UNSUPPORTED' });
  expect(result).not.toBeInstanceOf(SourceClipboardCleanupError);
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
});

it('cancels a pending begin by id and joins its late physical cleanup', async () => {
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const make = fs.mkdtemp.bind(fs);
  const spy = vi.spyOn(fs, 'mkdtemp').mockImplementation(async (...args) => {
    entered();
    await held;
    return make(...args);
  });
  const controller = new AbortController();
  const opening = expect(openNoteSourceClipboardSink(input(1), controller.signal)).rejects.toThrow(
    'REVOKED',
  );
  try {
    await started;
    controller.abort();
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        c.SOURCE_CLIPBOARD_ABORT,
        expect.objectContaining({ id: expect.any(String) }),
      ),
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    resume();
    await opening;
    expect(await fs.readdir(directory)).toHaveLength(0);
  } finally {
    resume();
    spy.mockRestore();
  }
});
it('distinguishes lost begin and cleanup acknowledgements from no allocation', async () => {
  const original = mocks.invoke.getMockImplementation()!;
  const request = input(1);
  mocks.invoke.mockImplementation(async (channel, params) => {
    if (channel === c.SOURCE_CLIPBOARD_ABORT) throw new Error('lost cleanup');
    const result = await original(channel, params);
    if (channel === c.SOURCE_CLIPBOARD_BEGIN) throw new Error('lost begin');
    return result;
  });
  try {
    await expect(openNoteSourceClipboardSink(request)).rejects.toBeInstanceOf(
      SourceClipboardCleanupError,
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toHaveLength(1);
  } finally {
    mocks.invoke.mockImplementation(original);
    await original(c.SOURCE_CLIPBOARD_ABORT, { id: request.id });
  }
});
