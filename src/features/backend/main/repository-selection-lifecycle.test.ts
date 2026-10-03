import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositorySelectionFeed } from './repository-selection-feed';
import { registerRepositorySelectionHandlers } from './repository-selection-lifecycle';
const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const root = { workspaceId: 'same', kind: 'primary' as const },
  channels = IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION;
const capture = {
  selectionId: 'private',
  root,
  scope: { daemonId: 'A', authorityScopeId: 'private', authorityGeneration: '1' },
  snapshot: {
    root,
    rootIncarnation: '1',
    selectionRevision: '0',
    selection: { kind: 'neverSaved' },
  },
  retirementSequence: '0',
  expiresAfterMs: 300000,
};
class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: unknown }> = [];
  write(line: string) {
    this.frames.push(JSON.parse(line));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  reply(result: unknown, id = this.frames.at(-1)!.id) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
  windows.clear();
});
async function harness() {
  const socket = new Socket(),
    client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'original' }),
    });
  const feed = createRepositorySelectionFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.frames).toHaveLength(1));
  socket.reply({ clientId: 'original', server: { capabilities: { repositorySelection: 1 } } });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: { send: vi.fn() },
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  windows.set(sender, window);
  stampWindowWithBackend(window as unknown as BrowserWindow, 'A');
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => any>();
  const registry = registerRepositorySelectionHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => (id === 'A' ? client : undefined),
      capture: (_, connection, root) => feed.capture(connection, root),
    },
  );
  cleanup.push(() => registry.dispose());
  const call = (channel: string, value: unknown, source = event) =>
    handlers.get(channel)!(source, value);
  async function acquire() {
    const result = call(channels.CAPTURE, { root });
    socket.reply(capture);
    return (await result).result.id as string;
  }
  return { socket, client, sender, window, event, call, acquire };
}
describe('strict selection window and original operation ownership', () => {
  it('rejects a forged frame or unbound sender before capture', async () => {
    const h = await harness();
    expect(
      await h.call(channels.CAPTURE, { root }, {
        ...h.event,
        senderFrame: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false });
    expect(h.socket.frames).toHaveLength(1);
  });
  it.each([
    { backendId: 'local' },
    { selectionId: 'foreign' },
    { scope: {} },
    { localMachine: true },
  ])('refuses capture authority injection %j', async (extra) => {
    const h = await harness();
    expect(await h.call(channels.CAPTURE, { root, ...extra })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PARAMS' },
    });
    expect(h.socket.frames).toHaveLength(1);
  });
  it('abandons an awaited capture after navigation and releases only its original reference', async () => {
    const h = await harness(),
      pending = h.call(channels.CAPTURE, { root });
    h.sender.emit('did-start-navigation', {}, 'new', false, true);
    h.socket.reply(capture);
    expect(await pending).toMatchObject({ ok: false });
    await Promise.resolve();
    expect(h.socket.frames.at(-1)?.method).toContain('.release');
  });
  it('does not disclose a completed response to a replacement document', async () => {
    const h = await harness(),
      id = await h.acquire();
    const pending = h.call(channels.CONFIRM, { id, root, command: { kind: 'reset' } }),
      wireId = h.socket.frames.at(-1)!.id;
    h.sender.emit('did-start-navigation', {}, 'next', false, true);
    h.socket.reply(
      {
        selectionId: 'private',
        root,
        attempt: {
          status: 'settled',
          receipt: { result: { kind: 'missingRoot' }, persistence: { kind: 'noEffect' } },
        },
      },
      wireId,
    );
    expect(await pending).toMatchObject({ ok: false });
  });
  it('rejects same host rebind A-B-A and exact-root widening', async () => {
    const h = await harness(),
      id = await h.acquire();
    expect(
      await h.call(channels.RECONCILE, {
        id,
        root: { workspaceId: 'same', kind: 'registered', gitRootId: 'child' },
      }),
    ).toMatchObject({ ok: false });
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'B');
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'A');
    expect(await h.call(channels.CONFIRM, { id, root, command: { kind: 'reset' } })).toMatchObject({
      ok: false,
    });
  });
});
