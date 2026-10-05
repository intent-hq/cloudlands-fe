import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositoryCheckoutFeed } from './repository-checkout-feed';
import { registerRepositoryCheckoutHandlers } from './repository-checkout-lifecycle';
const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const channels = IPC_CHANNELS.BACKEND.REPOSITORY_CHECKOUT;
const capture = {
  checkoutId: 'lease-A',
  revision: 'revision-A',
  provider: 'gitlab' as const,
  instanceBaseUrl: 'https://git.example:8443/Forge',
  expiresAfterMs: 600000,
};
const selection = {
  checkoutId: capture.checkoutId,
  revision: capture.revision,
  projectPath: 'group/subgroup/private',
  branch: 'release/next',
  commitSha: 'a'.repeat(40),
  mode: 'cached' as const,
};
const ready = <T>(value: T) => ({ status: 'ready' as const, value });
class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: unknown }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    if (frame.method === 'sourceControl.checkout.release')
      queueMicrotask(() => this.reply({ released: true }, frame.id));
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
  cleanup.splice(0).forEach((fn) => fn());
  windows.clear();
});
async function harness(capability: unknown = 1) {
  const socket = new Socket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    helloParams: () => ({ clientId: 'original' }),
    heartbeatIntervalMs: 0,
  });
  const feed = createRepositoryCheckoutFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.frames).toHaveLength(1));
  socket.reply({ clientId: 'original', server: { capabilities: { gitlabCheckout: capability } } });
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
  stampWindowWithBackend(window as unknown as BrowserWindow, 'target-A');
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => any>();
  const registry = registerRepositoryCheckoutHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => (id === 'target-A' ? client : undefined),
      capture: (_, connection, query) => feed.capture(connection, query),
      errorPayload: (error) => ({
        code: 'TEST_REFUSAL',
        message: error instanceof Error ? error.message : String(error),
        data: (error as { data?: unknown }).data,
      }),
    },
  );
  cleanup.push(() => registry.dispose());
  const call = (channel: string, value: unknown, source = event) =>
    handlers.get(channel)!(source, value);
  const acquire = async () => {
    const pending = call(channels.CAPTURE, {
      provider: 'gitlab',
      instanceBaseUrl: capture.instanceBaseUrl,
    });
    socket.reply(ready(capture));
    return (await pending).result.value.id as string;
  };
  return { socket, client, sender, window, event, registry, call, acquire };
}
describe('pre-workspace checkout on the original Electron document and target socket', () => {
  it.each([
    { workspaceId: 'fabricated' },
    { backendId: 'local' },
    { localMachine: true },
    { principalId: 'owner' },
  ])('refuses caller-authored authority %j before any RPC', async (extra) => {
    const h = await harness();
    expect(await h.call(channels.CAPTURE, { provider: 'gitlab', ...extra })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PARAMS' },
    });
    expect(h.socket.frames).toHaveLength(1);
  });
  it('refuses foreign frames and an unsupported capability before capture', async () => {
    const h = await harness(0);
    expect(await h.call(channels.CAPTURE, { provider: 'gitlab' })).toMatchObject({ ok: false });
    const supported = await harness();
    expect(
      await supported.call(channels.CAPTURE, { provider: 'gitlab' }, {
        ...supported.event,
        senderFrame: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false });
    expect(h.socket.frames).toHaveLength(1);
    expect(supported.socket.frames).toHaveLength(1);
  });
  it('preserves the producer’s pre-workspace guest refusal without inventing another identity', async () => {
    const h = await harness();
    const pending = h.call(channels.CAPTURE, { provider: 'gitlab' });
    h.socket.reply({ status: 'unavailable', reason: 'access-denied' });
    expect(await pending).toMatchObject({
      ok: true,
      result: { status: 'unavailable', reason: 'access-denied' },
    });
    expect(h.socket.frames[1].params).toEqual({ provider: 'gitlab' });
  });
  it.each(['direct', 'cached'] as const)(
    'creates %s with the exact observed selection and original progress operands',
    async (mode) => {
      const h = await harness();
      await h.acquire();
      const params = {
        repositoryCheckout: { ...selection, mode },
        progressId: 'original-progress',
        idempotencyKey: 'original-request',
        title: 'Private project',
        branch: 'workspace/new-local-branch',
        scope: 'packages/frontend',
        skipIsolation: false,
      };
      const pending = h.registry.create(h.event, params, 120000);
      expect(h.socket.frames.at(-1)).toMatchObject({ method: 'workspace.create', params });
      h.socket.reply({ id: 'created', path: '/owned/workspace' });
      expect(await pending).toEqual({
        ok: true,
        result: { id: 'created', path: '/owned/workspace' },
      });
    },
  );
  it.each([
    'githubUrl',
    'repositoryPath',
    'clonePath',
    'repositoryOwner',
    'repositoryName',
    'worktreePath',
    'baseCommitSha',
    'remote',
    'path',
    'baseRef',
    'environmentConfig',
    'skipIsolation',
  ])('refuses a second %s source before dispatch', async (field) => {
    const h = await harness();
    await h.acquire();
    const count = h.socket.frames.length;
    expect(
      await h.registry.create(h.event, { repositoryCheckout: selection, [field]: 'other' }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(h.socket.frames).toHaveLength(count);
  });
  it.each(['isRemote', 'isNewRepo', 'skipIsolation', 'skipWorktree'])(
    'refuses %s=true for qualified checkout creation',
    async (field) => {
      const h = await harness();
      await h.acquire();
      const count = h.socket.frames.length;
      expect(
        await h.registry.create(h.event, { repositoryCheckout: selection, [field]: true }),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
      expect(h.socket.frames).toHaveLength(count);
    },
  );
  it('releases a late capture when its original document navigates away', async () => {
    const h = await harness();
    const pending = h.call(channels.CAPTURE, { provider: 'gitlab' });
    h.sender.emit('did-start-navigation', {}, 'next', false, true);
    h.socket.reply(ready(capture));
    expect(await pending).toMatchObject({ ok: false });
    await vi.waitFor(() =>
      expect(h.socket.frames.at(-1)).toMatchObject({
        method: 'sourceControl.checkout.release',
        params: { checkoutId: capture.checkoutId, revision: capture.revision },
      }),
    );
  });
  it('does not publish late content after host A–B–A remapping', async () => {
    const h = await harness();
    const id = await h.acquire();
    const pending = h.call(channels.REQUEST, {
      id,
      kind: 'branches',
      params: { projectPath: selection.projectPath },
    });
    const wireId = h.socket.frames.at(-1)!.id;
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'target-B');
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'target-A');
    h.socket.reply(
      ready({ items: [{ name: selection.branch, commitSha: selection.commitSha }], cached: false }),
      wireId,
    );
    expect(await pending).toMatchObject({ ok: false });
    expect(await h.registry.create(h.event, { repositoryCheckout: selection })).toMatchObject({
      ok: false,
    });
  });
  it.each(['current', 'host-remapped', 'hello-retired', 'document-retired', 'denied'])(
    'transfers an original create rejection only while its owner is current: %s',
    async (lifetime) => {
      const h = await harness();
      const id = await h.acquire();
      const pending = h.registry.create(h.event, { repositoryCheckout: selection });
      const createId = h.socket.frames.at(-1)!.id;
      if (lifetime === 'host-remapped') {
        stampWindowWithBackend(h.window as unknown as BrowserWindow, 'target-B');
        stampWindowWithBackend(h.window as unknown as BrowserWindow, 'target-A');
      } else if (lifetime === 'hello-retired') {
        const hello = h.client.request('client.hello', { clientId: 'original' });
        await vi.waitFor(() => expect(h.socket.frames.at(-1)?.method).toBe('client.hello'));
        h.socket.reply({ clientId: 'original', server: { capabilities: { gitlabCheckout: 1 } } });
        await hello;
      } else if (lifetime === 'document-retired') {
        h.sender.emit('did-start-navigation', {}, 'next', false, true);
      } else if (lifetime === 'denied') {
        const branches = h.call(channels.REQUEST, {
          id,
          kind: 'branches',
          params: { projectPath: selection.projectPath },
        });
        h.socket.reply({ status: 'unavailable', reason: 'access-denied' });
        await branches;
      }
      h.socket.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            id: createId,
            error: {
              code: -32000,
              message: 'private original create detail',
              data: { privatePath: '/A/private' },
            },
          }) + '\n',
        ),
      );
      const result = await pending;
      if (lifetime === 'current') {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: 'TEST_REFUSAL',
            message: 'private original create detail',
            data: { privatePath: '/A/private' },
          },
        });
      } else {
        expect(result).toEqual({
          ok: false,
          error: {
            code: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
            message: 'REPOSITORY_CHECKOUT_UNAVAILABLE',
            rpcCode: -32003,
          },
        });
      }
    },
  );
  it('delivers known denial and prevents a same-lease cached-content request', async () => {
    const h = await harness();
    const id = await h.acquire();
    const pending = h.call(channels.REQUEST, {
      id,
      kind: 'branches',
      params: { projectPath: selection.projectPath, cached: true },
    });
    h.socket.reply({ status: 'unavailable', reason: 'access-denied' });
    expect(await pending).toMatchObject({
      ok: true,
      result: { status: 'unavailable', reason: 'access-denied' },
    });
    const count = h.socket.frames.length;
    expect(
      await h.call(channels.REQUEST, {
        id,
        kind: 'branches',
        params: { projectPath: selection.projectPath, cached: true },
      }),
    ).toMatchObject({ result: { reason: 'access-denied' } });
    expect(h.socket.frames).toHaveLength(count);
  });
  it.each(['direct', 'cached'] as const)(
    'keeps the current %s selection usable after an ordinary create error',
    async (mode) => {
      const h = await harness();
      const id = await h.acquire();
      const params = { repositoryCheckout: { ...selection, mode } };
      const pending = h.registry.create(h.event, params);
      const createId = h.socket.frames.at(-1)!.id;
      h.socket.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            id: createId,
            error: { code: -32000, message: 'current checkout failed; try again' },
          }) + '\n',
        ),
      );
      expect(await pending).toMatchObject({
        ok: false,
        error: { message: 'current checkout failed; try again' },
      });
      expect(h.sender.mainFrame.send).not.toHaveBeenCalled();
      expect(
        h.socket.frames.filter((frame) => frame.method === 'sourceControl.checkout.release'),
      ).toHaveLength(0);
      const retry = h.registry.create(h.event, params);
      expect(h.socket.frames.at(-1)).toMatchObject({ method: 'workspace.create', params });
      h.socket.reply({ workspace: { id: 'created-after-retry' } });
      expect(await retry).toEqual({
        ok: true,
        result: { workspace: { id: 'created-after-retry' } },
      });
      await h.call(channels.RELEASE, { id });
      expect(h.sender.mainFrame.send).toHaveBeenCalledOnce();
    },
  );
  it('recovers admission after release while retaining the simultaneous lease bound', async () => {
    const h = await harness();
    const ids: string[] = [];
    for (let i = 0; i < 64; i++) ids.push(await h.acquire());
    const count = h.socket.frames.length;
    expect(await h.call(channels.CAPTURE, { provider: 'gitlab' })).toMatchObject({ ok: false });
    expect(h.socket.frames).toHaveLength(count);
    await h.call(channels.RELEASE, { id: ids[0] });
    await vi.waitFor(() =>
      expect(h.socket.frames.at(-1)?.method).toBe('sourceControl.checkout.release'),
    );
    await Promise.resolve();
    expect(await h.acquire()).toEqual(expect.any(String));
  });
});
