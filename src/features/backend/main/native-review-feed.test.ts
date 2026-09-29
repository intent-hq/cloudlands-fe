import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from './json-rpc-client';
import { createNativeReviewFeed } from './native-review-feed';
import fixture from '$shared/types/__fixtures__/native-review-v1.json';

class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  write(line: string) {
    this.frames.push(JSON.parse(line));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  result(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  notice(params: unknown) {
    this.emit(
      'data',
      Buffer.from(JSON.stringify({ method: 'accept-changes.retired', params }) + '\n'),
    );
  }
}
const root = { kind: 'primary' as const, workspaceId: 'workspace-1' };
const input = {
  workspaceId: root.workspaceId,
  action: 'create-pr' as const,
  review: { root, choice: { kind: 'saved' as const } },
};
// Authored from the immutable Core8f serialization, not generated Rust output.
const captureReply = (operationId = 'lease-1', sequence = '0') => {
  const preparation = structuredClone(fixture.prepare.reviewPreparation);
  Object.assign(preparation, {
    operationId,
    root,
    contextRevision: { epoch: operationId, sequence: '1' },
    scope: {
      daemonId: 'host-A',
      authorityScopeId: operationId,
      authorityGeneration: '9007199254740995',
    },
  });
  Reflect.deleteProperty(preparation.source, 'connection');
  Reflect.deleteProperty(preparation.target, 'connection');
  return {
    ...fixture.prepare,
    reviewPreparation: preparation,
    reviewOperation: { operationId, root, retirementSequence: sequence, expiresAfterMs: 300000 },
  };
};
const retire = (sequence = '1', id = 'lease-1') => ({
  operationIds: [id],
  sequence,
  allRetired: false,
  terminal: false,
});
const command = { prTitle: 'Submitted title', prBody: 'Submitted body' };
function state(status: 'settled' | 'pending' | 'prepared' = 'settled') {
  return {
    operationId: 'lease-1',
    root,
    state: status,
    ...(status === 'settled'
      ? {
          reviewExecution: {
            ...fixture.execute.reviewExecution,
            requestId: 'lease-1',
            preparation: captureReply().reviewPreparation,
            gitReceipts: [{ stage: 'commit', commitHash: 'actual-B' }],
            outcome: { status: 'failed', stage: 'create-pr', code: null, message: 'refused' },
          },
        }
      : {}),
  };
}
const executeReply = () => ({
  ...state(),
  success: false,
  steps: [{ id: 'commit', name: 'Commit', status: 'completed', message: 'actual-B' }],
  result: { commitHash: 'actual-B' },
  error: 'refused',
});
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.useRealTimers();
});
async function harness(capability: unknown = 1) {
  const sockets: Socket[] = [];
  const client = new JsonRpcClient({
    socketFactory: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as Duplex;
    },
    helloParams: () => ({ clientId: 'original' }),
    reconnectDelayMs: 1,
  });
  const feed = createNativeReviewFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  sockets[0].emit('connect');
  await vi.waitFor(() => expect(sockets[0].frames).toHaveLength(1));
  sockets[0].result(1, {
    clientId: 'original',
    server: { capabilities: { nativeReview: capability } },
  });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const connection = client.getRepositoryConnection()!;
  const socket = sockets[0];
  async function acquire(reply: unknown = captureReply()) {
    const pending = feed.prepare(connection, input);
    socket.result(socket.frames.at(-1)!.id, reply);
    return await pending;
  }
  return { client, feed, connection, socket, sockets, acquire };
}

describe('original socket native review ownership', () => {
  it('captures before confirmation, refuses rebinding, and issues one immutable command', async () => {
    const h = await harness(),
      op = await h.acquire();
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'accept-changes.prepare',
      params: input,
    });
    expect(op.preview.reviewPreparation.source).not.toHaveProperty('connection');
    const first = op.confirm(command);
    expect(op.confirm(command)).toBe(first);
    await expect(op.confirm({ prTitle: 'changed' })).rejects.toThrow('COMMAND_CHANGED');
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'accept-changes.execute',
      params: {
        workspaceId: root.workspaceId,
        action: 'create-pr',
        review: { operationId: 'lease-1', root },
        ...command,
      },
    });
    h.socket.result(h.socket.frames.at(-1)!.id, executeReply());
    const result = await first;
    expect(result.execute).toEqual(executeReply());
    expect(result.reconciliation).toBeNull();
    expect(result.current).toBe(false);
    expect(result.uncertain).toBe(false);
    const count = h.socket.frames.length;
    expect(await op.confirm(command)).toEqual(result);
    expect(h.socket.frames).toHaveLength(count);
    const reconcile = op.reconcile();
    h.socket.result(h.socket.frames.at(-1)!.id, state());
    const observed = await reconcile;
    expect(observed.execute).toEqual(executeReply());
    expect(observed.reconciliation).toEqual(state());
    expect(observed.reconciliation).not.toHaveProperty('success');
  });
  it('allows same-owner reconciliation after normal retirement without a new execution', async () => {
    const h = await harness(),
      op = await h.acquire(),
      retired = vi.fn();
    op.onRetired(retired);
    h.socket.notice(retire());
    expect(retired).toHaveBeenCalledWith('admission');
    await expect(op.confirm(command)).rejects.toThrow();
    const read = op.reconcile();
    h.socket.result(h.socket.frames.at(-1)!.id, state('prepared'));
    expect(await read).toMatchObject({
      current: false,
      uncertain: false,
      reconciliation: { state: 'prepared' },
    });
    expect(h.socket.frames.some((f) => f.method === 'accept-changes.execute')).toBe(false);
  });
  it('retains an old original completion while cancellation sends release immediately', async () => {
    const h = await harness(),
      op = await h.acquire();
    const executing = op.confirm(command),
      executeId = h.socket.frames.at(-1)!.id;
    const release = op.release(),
      releaseFrame = h.socket.frames.at(-1)!;
    expect(releaseFrame.method).toBe('accept-changes.release');
    expect(releaseFrame.id).not.toBe(executeId);
    h.socket.result(releaseFrame.id, { released: true });
    await release;
    h.socket.result(executeId, executeReply());
    expect(await executing).toMatchObject({
      current: false,
      uncertain: false,
      execute: { result: { commitHash: 'actual-B' } },
    });
    await expect(op.reconcile()).rejects.toThrow();
  });
  it('never shortens an executing stage to the UI preparation deadline', async () => {
    const h = await harness(),
      op = await h.acquire();
    vi.useFakeTimers();
    const work = op.confirm(command),
      id = h.socket.frames.at(-1)!.id;
    await vi.advanceTimersByTimeAsync(121_000);
    expect(h.socket.frames.filter((f) => f.method === 'accept-changes.execute')).toHaveLength(1);
    h.socket.result(id, executeReply());
    expect(await work).toMatchObject({ uncertain: false, execute: { state: 'settled' } });
  });
  it('does not assert no effects on a lost original reply or retry it on reconnect', async () => {
    const h = await harness(),
      op = await h.acquire();
    const work = op.confirm(command);
    h.socket.emit('close');
    expect(await work).toMatchObject({ current: false, uncertain: true, execute: null });
    await expect(op.reconcile()).rejects.toThrow();
    expect(h.socket.frames.filter((f) => f.method === 'accept-changes.execute')).toHaveLength(1);
  });
  it.each([undefined, 0, '1', true])(
    'requires the exact original hello capability %j',
    async (capability) => {
      const h = await harness(capability === undefined ? null : capability);
      await expect(h.feed.prepare(h.connection, input)).rejects.toThrow();
      expect(h.socket.frames).toHaveLength(1);
    },
  );
  it('rejects another connection object, invalid command widening and oversized command without sending', async () => {
    const h = await harness();
    await expect(h.feed.prepare({}, input)).rejects.toThrow();
    const op = await h.acquire(),
      count = h.socket.frames.length;
    expect(() => op.confirm({ ...command, action: 'push' } as never)).toThrow();
    await expect(op.confirm({ prBody: 'x'.repeat(65536) })).rejects.toThrow();
    expect(h.socket.frames).toHaveLength(count);
  });
  it('retires an acquisition noticed before its prepare reply and cleans up only on that socket', async () => {
    const h = await harness();
    const promise = h.feed.prepare(h.connection, input),
      frame = h.socket.frames.at(-1)!;
    h.socket.notice(retire());
    h.socket.result(frame.id, captureReply('lease-1', '1'));
    await expect(promise).rejects.toThrow();
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'accept-changes.release',
      params: { operationId: 'lease-1', root },
    });
  });
  it('waits for contiguous acquisition-gap notices without treating a greater number as repair', async () => {
    const h = await harness();
    const promise = h.feed.prepare(h.connection, input);
    h.socket.result(h.socket.frames.at(-1)!.id, captureReply('lease-1', '1'));
    let ready = false;
    void promise.then(() => {
      ready = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    h.socket.notice(retire('1', 'unrelated'));
    expect((await promise).isAdmitted()).toBe(true);
  });
  it.each([
    { ...retire(), sequence: '2' },
    { ...retire(), sequence: '00' },
    { ...retire(), operationIds: [] },
    { ...retire(), allRetired: true },
    { ...retire(), terminal: true },
    { ...retire(), extra: true },
    { operationIds: [], sequence: '18446744073709551615', allRetired: true, terminal: true },
  ])('fails closed for invalid/gapped/terminal notice %j', async (notice) => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice(notice);
    expect(op.isLive()).toBe(false);
    await expect(op.reconcile()).rejects.toThrow();
  });
  it('ignores only an identical full notice; conflicting duplicate retires the whole feed', async () => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice(retire('1', 'other'));
    h.socket.notice(retire('1', 'other'));
    expect(op.isAdmitted()).toBe(true);
    h.socket.notice(retire('1', 'different'));
    expect(op.isLive()).toBe(false);
  });
  it('keeps the same physical cursor across re-hello and rejects old identity operations', async () => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice(retire('1', 'other'));
    const hello = h.client.request('client.hello', { clientId: 'new' });
    await vi.waitFor(() => expect(h.socket.frames.at(-1)?.method).toBe('client.hello'));
    h.socket.result(h.socket.frames.at(-1)!.id, {
      clientId: 'new',
      server: { capabilities: { nativeReview: 1 } },
    });
    await hello;
    expect(op.isLive()).toBe(false);
    const next = h.feed.prepare(h.client.getRepositoryConnection()!, input);
    h.socket.result(h.socket.frames.at(-1)!.id, captureReply('new', '1'));
    const newOp = await next;
    h.socket.notice(retire('1', 'different'));
    expect(newOp.isLive()).toBe(false);
  });
  it('accounts expiry from dispatch and retains a late reply for original-only disposal', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const acquiring = h.feed.prepare(h.connection, input),
      frame = h.socket.frames.at(-1)!;
    const rejected = expect(acquiring).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    h.socket.result(frame.id, captureReply());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.socket.frames.at(-1)?.method).toBe('accept-changes.release');
  });
  it('does not renew retention by reconciliation and bounds concurrent acquisitions', async () => {
    const h = await harness(),
      op = await h.acquire();
    vi.useFakeTimers();
    const run = op.confirm(command);
    h.socket.result(h.socket.frames.at(-1)!.id, executeReply());
    await run;
    await vi.advanceTimersByTimeAsync(599000);
    const read = op.reconcile();
    h.socket.result(h.socket.frames.at(-1)!.id, state());
    await read;
    await vi.advanceTimersByTimeAsync(1001);
    expect(op.isLive()).toBe(false);
  });
  it('caps outstanding preparations at the server per-connection bound without eviction', async () => {
    const h = await harness();
    const pending = Array.from({ length: 32 }, () =>
      h.feed.prepare(h.connection, input).catch(() => undefined),
    );
    await expect(h.feed.prepare(h.connection, input)).rejects.toThrow();
    h.client.dispose();
    await Promise.all(pending);
    expect(h.socket.frames.filter((f) => f.method === 'accept-changes.prepare')).toHaveLength(32);
  });
  it('rejects mismatched root/scope replies without exposing their facts', async () => {
    const h = await harness();
    const reply = captureReply();
    reply.reviewPreparation.scope.authorityScopeId = 'wrong';
    await expect(h.acquire(reply)).rejects.toThrow();
    expect(h.socket.frames.at(-1)?.method).toBe('accept-changes.release');
  });
  it('preserves explicitly uncertain outcome alongside actual completed commit receipts', async () => {
    const h = await harness(),
      op = await h.acquire();
    const run = op.confirm(command),
      response = executeReply();
    const outcome = { status: 'uncertain', stage: 'create-pr', message: 'response lost' };
    h.socket.result(h.socket.frames.at(-1)!.id, {
      ...response,
      reviewExecution: { ...response.reviewExecution, outcome },
    });
    expect(await run).toMatchObject({
      uncertain: true,
      execute: {
        reviewExecution: { outcome, gitReceipts: [{ stage: 'commit', commitHash: 'actual-B' }] },
      },
    });
  });
});
