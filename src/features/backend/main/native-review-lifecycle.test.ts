import fixture from '$shared/types/__fixtures__/native-review-v1.json';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { createNativeReviewFeed } from './native-review-feed';
import { registerNativeReviewHandlers } from './native-review-lifecycle';
const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const root = { workspaceId: 'same', kind: 'primary' as const },
  channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
const input = {
  workspaceId: root.workspaceId,
  action: 'create-pr' as const,
  review: { root, choice: { kind: 'saved' as const } },
};
const capture = {
  ...fixture.prepare,
  reviewPreparation: {
    ...fixture.prepare.reviewPreparation,
    operationId: 'private',
    root,
    scope: { daemonId: 'A', authorityScopeId: 'private', authorityGeneration: '1' },
    contextRevision: { epoch: 'private', sequence: '1' },
  },
  reviewOperation: {
    operationId: 'private',
    root,
    retirementSequence: '0',
    expiresAfterMs: 300000,
  },
};
const outcome = {
  operationId: 'private',
  root,
  state: 'settled',
  success: true,
  steps: [],
  reviewExecution: {
    ...fixture.execute.reviewExecution,
    requestId: 'private',
    preparation: capture.reviewPreparation,
  },
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
async function harness(companionCapability: unknown = null) {
  const socket = new Socket(),
    client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'original' }),
    });
  const feed = createNativeReviewFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.frames).toHaveLength(1));
  socket.reply({
    clientId: 'original',
    server: { capabilities: { nativeReview: 1, nativeReviewCompanion: companionCapability } },
  });
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
  const registry = registerNativeReviewHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => (id === 'A' ? client : undefined),
      prepare: (_, connection, value) => feed.prepare(connection, value),
    },
  );
  cleanup.push(() => registry.dispose());
  const call = (channel: string, value: unknown, source = event) =>
    handlers.get(channel)!(source, value);
  async function acquire() {
    const result = call(channels.PREPARE, { input });
    socket.reply(capture);
    return (await result).result.id as string;
  }
  return { socket, client, sender, window, event, call, acquire };
}
describe('native review original window and private operation', () => {
  it('rejects an unbound or forged frame before preparation', async () => {
    const h = await harness();
    expect(
      await h.call(channels.PREPARE, { input }, {
        ...h.event,
        senderFrame: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false });
    expect(h.socket.frames).toHaveLength(1);
  });
  it.each([
    { backendId: 'local' },
    { operationId: 'foreign' },
    { scope: {} },
    { localMachine: true },
  ])('refuses renderer authority %j', async (extra) => {
    const h = await harness();
    expect(await h.call(channels.PREPARE, { input, ...extra })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PARAMS' },
    });
  });
  it('disposes an awaited preparation when the original document navigates', async () => {
    const h = await harness(),
      pending = h.call(channels.PREPARE, { input });
    h.sender.emit('did-start-navigation', {}, 'new', false, true);
    h.socket.reply(capture);
    expect(await pending).toMatchObject({ ok: false });
    expect(h.socket.frames.at(-1)?.method).toBe('accept-changes.release');
  });
  it('never sends a completed old receipt to a replacement document', async () => {
    const h = await harness(),
      id = await h.acquire();
    const pending = h.call(channels.EXECUTE, { id, root, command: { prTitle: 'T' } }),
      wireId = h.socket.frames.at(-1)!.id;
    h.sender.emit('did-start-navigation', {}, 'new', false, true);
    expect(h.socket.frames.at(-1)?.method).toBe('accept-changes.release');
    h.socket.reply(outcome, wireId);
    expect(await pending).toMatchObject({ ok: false });
  });
  it('rejects another sender, wrong root, widened command and A-B-A binding', async () => {
    const h = await harness(),
      id = await h.acquire();
    expect(
      await h.call(channels.EXECUTE, { id, root, command: { prTitle: 'T' } }, {
        ...h.event,
        sender: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false });
    expect(
      await h.call(channels.EXECUTE, { id, root: { ...root, workspaceId: 'other' }, command: {} }),
    ).toMatchObject({ ok: false });
    expect(await h.call(channels.EXECUTE, { id, root, command: { action: 'push' } })).toMatchObject(
      { ok: false },
    );
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'B');
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'A');
    expect(await h.call(channels.RECONCILE, { id, root })).toMatchObject({ ok: false });
    expect(h.socket.frames.filter((f) => f.method === 'accept-changes.execute')).toHaveLength(0);
  });
  it('notifies only the original frame with the opaque ID, preserving normal-retirement history', async () => {
    const h = await harness(),
      id = await h.acquire();
    h.socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'accept-changes.retired',
          params: {
            operationIds: ['private'],
            sequence: '1',
            allRetired: false,
            terminal: false,
          },
        }) + '\n',
      ),
    );
    expect(h.sender.mainFrame.send).toHaveBeenCalledWith(channels.RETIRED, {
      id,
      kind: 'admission',
    });
    const read = h.call(channels.RECONCILE, { id, root });
    const { success: _success, steps: _steps, ...reconcile } = outcome;
    h.socket.reply(reconcile);
    expect(await read).toMatchObject({
      ok: true,
      result: { current: false, reconciliation: reconcile },
    });
  });
});

const parentId = 'aaaaaaaa-0000-4000-8000-000000000001',
  childId = 'aaaaaaaa-0000-4000-8000-000000000002';
const marked = {
  ...input,
  action: 'commit' as const,
  review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' as const } },
};
function companionCapture(id: string) {
  return {
    ...capture,
    reviewOperation: { ...capture.reviewOperation, operationId: id },
    reviewPreparation: {
      ...capture.reviewPreparation,
      operationId: id,
      scope: { ...capture.reviewPreparation.scope, authorityScopeId: id },
      contextRevision: { epoch: id, sequence: '1' },
    },
  };
}
async function committedParent(h: Awaited<ReturnType<typeof harness>>) {
  const opened = h.call(channels.PREPARE, { input: marked });
  h.socket.reply(companionCapture(parentId));
  const id = (await opened).result.id as string;
  const committed = h.call(channels.EXECUTE, {
    id,
    root,
    command: { commitMessage: 'Staged only' },
  });
  h.socket.reply({
    ...outcome,
    operationId: parentId,
    reviewExecution: {
      ...outcome.reviewExecution,
      requestId: parentId,
      preparation: companionCapture(parentId).reviewPreparation,
      gitReceipts: [{ stage: 'commit', commitHash: 'actual-parent' }],
      outcome: { status: 'not-attempted' },
    },
  });
  expect(await committed).toMatchObject({
    ok: true,
    result: { current: false, execute: { success: true } },
  });
  return id;
}
describe('same document companion capture through actual main routes', () => {
  it('issues one capture for duplicate callers and gives the child its own local identity', async () => {
    const h = await harness(1),
      id = await committedParent(h);
    const before = h.socket.frames.length;
    const first = h.call(channels.PREPARE, { companionOf: id, root });
    const second = h.call(channels.PREPARE, { companionOf: id, root });
    await vi.waitFor(() => expect(h.socket.frames).toHaveLength(before + 1));
    const wire = h.socket.frames.at(-1)!;
    expect(wire.params).toMatchObject({
      action: 'create-pr',
      review: { choice: { kind: 'afterCommit', operationId: parentId } },
    });
    h.socket.reply(companionCapture(childId));
    const a = await first,
      b = await second;
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.result.id).not.toBe(id);
    expect(a.result.id).not.toBe(childId);
    expect(h.socket.frames).toHaveLength(before + 1);
    expect(
      await h.call(channels.PREPARE, { companionOf: id, root, captureId: childId }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    expect(
      await h.call(channels.PREPARE, { companionOf: id, root: { ...root, workspaceId: 'other' } }),
    ).toMatchObject({ ok: false });
    expect(
      await h.call(channels.PREPARE, { companionOf: id, root }, {
        ...h.event,
        senderFrame: {},
      } as IpcMainInvokeEvent),
    ).toMatchObject({ ok: false });
  });
  it('retains a failed claim without another socket request', async () => {
    const h = await harness(1),
      id = await committedParent(h);
    const first = h.call(channels.PREPARE, { companionOf: id, root });
    await vi.waitFor(() =>
      expect((h.socket.frames.at(-1)?.params as any)?.review?.choice?.kind).toBe('afterCommit'),
    );
    const frame = h.socket.frames.at(-1)!;
    h.socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({ id: frame.id, error: { code: -32003, message: 'refused' } }) + '\n',
      ),
    );
    expect(await first).toMatchObject({ ok: false });
    const count = h.socket.frames.length;
    expect(await h.call(channels.PREPARE, { companionOf: id, root })).toMatchObject({ ok: false });
    expect(h.socket.frames).toHaveLength(count);
  });
  it('cleans an awaited child after original document retirement and refuses cached disclosure', async () => {
    const h = await harness(1),
      id = await committedParent(h);
    const work = h.call(channels.PREPARE, { companionOf: id, root });
    await vi.waitFor(() =>
      expect((h.socket.frames.at(-1)?.params as any)?.review?.choice?.kind).toBe('afterCommit'),
    );
    const frame = h.socket.frames.at(-1)!;
    h.sender.emit('did-start-navigation', {}, 'replacement', false, true);
    h.socket.reply({ released: true });
    h.socket.reply(companionCapture(childId), frame.id);
    await vi.waitFor(() =>
      expect(h.socket.frames.at(-1)).toMatchObject({
        method: 'accept-changes.release',
        params: { operationId: childId },
      }),
    );
    h.socket.reply({ released: true });
    expect(await work).toMatchObject({ ok: false });
    expect(await h.call(channels.PREPARE, { companionOf: id, root })).toMatchObject({ ok: false });
  });
});
