import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositorySelectionFeed } from './repository-selection-feed';

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
      Buffer.from(
        JSON.stringify({ method: 'workspace.repositorySelection.retired', params }) + '\n',
      ),
    );
  }
}
const root = { kind: 'primary' as const, workspaceId: 'workspace-1' };
const query = { workspaceId: root.workspaceId };
// Authored directly from accepted Core repository_request.rs; not generated Rust output.
const captureReply = (selectionId = 'lease-1', sequence = '0') => ({
  selectionId,
  scope: {
    daemonId: 'host-A',
    authorityScopeId: selectionId,
    authorityGeneration: '9007199254740995',
  },
  root,
  snapshot: {
    root,
    rootIncarnation: '18446744073709551615',
    selectionRevision: '9007199254740993',
    selection: { kind: 'neverSaved' },
  },
  retirementSequence: sequence,
  expiresAfterMs: 300000,
});
const retire = (sequence = '1', id = 'lease-1') => ({
  selectionIds: [id],
  sequence,
  allRetired: false,
  terminal: false,
});
const command = {
  kind: 'save' as const,
  choice: { mode: 'explicit-remote' as const, remoteName: 'upstream' },
};
const receipt = {
  result: { kind: 'failed', code: 'admission-retired' },
  persistence: { kind: 'committed', selectionRevision: '9007199254740994' },
};
const attempt = (value: unknown = { status: 'settled', receipt }) => ({
  selectionId: 'lease-1',
  root,
  attempt: value,
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
  const feed = createRepositorySelectionFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  sockets[0].emit('connect');
  await vi.waitFor(() => expect(sockets[0].frames).toHaveLength(1));
  sockets[0].result(1, {
    clientId: 'original',
    server: { capabilities: { repositorySelection: capability } },
  });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const connection = client.getRepositoryConnection()!;
  const socket = sockets[0];
  async function acquire(reply: unknown = captureReply()) {
    const pending = feed.capture(connection, root);
    socket.result(socket.frames.at(-1)!.id, reply);
    return await pending;
  }
  return { client, feed, connection, socket, sockets, acquire };
}

describe('original socket selection admission and retained outcomes', () => {
  it('captures before confirmation and sends exactly one immutable command with private reference', async () => {
    const h = await harness(),
      op = await h.acquire();
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'workspace.repositorySelection.capture',
      params: query,
    });
    expect(op.preview.snapshot.selection).toEqual({ kind: 'neverSaved' });
    const first = op.confirm(command),
      again = op.confirm(command);
    expect(again).toBe(first);
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'workspace.repositorySelection.save',
      params: { ...query, selectionId: 'lease-1', choice: command.choice },
    });
    await expect(op.confirm({ kind: 'reset' })).rejects.toThrow('COMMAND_CHANGED');
    h.socket.notice(retire());
    expect(op.isAdmitted()).toBe(false);
    expect(op.isLive()).toBe(true);
    h.socket.result(h.socket.frames.at(-1)!.id, attempt());
    await expect(first).resolves.toEqual({
      current: false,
      attempt: { status: 'settled', receipt },
      uncertain: false,
    });
    const known = await op.confirm(command);
    expect(known.attempt).toEqual({ status: 'settled', receipt });
    expect(h.socket.frames.filter((f) => f.method.endsWith('.save'))).toHaveLength(1);
    const reconcile = op.reconcile();
    h.socket.result(h.socket.frames.at(-1)!.id, attempt());
    expect((await reconcile).attempt).toEqual({ status: 'settled', receipt });
  });
  it('retains an original conflict without adopting its newer snapshot or issuing another save', async () => {
    const h = await harness(),
      op = await h.acquire(),
      original = structuredClone(op.preview.snapshot);
    const pending = op.confirm(command);
    const conflict = {
      result: {
        kind: 'conflict',
        snapshot: {
          ...original,
          selectionRevision: '9007199254740994',
          selection: { kind: 'reset' },
        },
      },
      persistence: { kind: 'noEffect' },
    };
    h.socket.result(h.socket.frames.at(-1)!.id, attempt({ status: 'settled', receipt: conflict }));
    expect((await pending).attempt).toEqual({ status: 'settled', receipt: conflict });
    expect(op.preview.snapshot).toEqual(original);
    await op.confirm(command);
    expect(h.socket.frames.filter((f) => f.method.endsWith('.save'))).toHaveLength(1);
  });
  it.each([undefined, false, 2, '1'])(
    'refuses unsupported capability %j without fallback',
    async (cap) => {
      const h = await harness(cap === undefined ? null : cap);
      await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
      expect(h.socket.frames).toHaveLength(1);
    },
  );
  it.each([
    { retirementSequence: '01' },
    { retirementSequence: 1 },
    { retirementSequence: '18446744073709551616' },
    { root: { ...root, workspaceId: 'other' } },
    { scope: { daemonId: 'host-A', authorityScopeId: 'foreign', authorityGeneration: '1' } },
    {
      snapshot: {
        ...captureReply().snapshot,
        root: { ...root, kind: 'registered', gitRootId: 'foreign' },
      },
    },
    { extra: true },
  ])(
    'rejects malformed or cross-root capture and disposes known original reference %j',
    async (change) => {
      const h = await harness();
      await expect(h.acquire({ ...captureReply(), ...change })).rejects.toThrow();
      expect(h.socket.frames.at(-1)?.method).toBe('workspace.repositorySelection.release');
    },
  );
  it('reconciles notices crossing acquisition and never publishes a retired edit', async () => {
    const h = await harness();
    const acquire = h.feed.capture(h.connection, root),
      id = h.socket.frames.at(-1)!.id;
    h.socket.notice(retire());
    h.socket.result(id, captureReply('lease-1', '1'));
    await expect(acquire).rejects.toThrow();
    expect(h.socket.frames.at(-1)?.method).toContain('release');
  });
  it('waits for contiguous notice catch-up rather than adopting a newer cursor', async () => {
    const h = await harness();
    let done = false;
    const acquire = h.feed.capture(h.connection, root).then((op) => {
      done = true;
      return op;
    });
    h.socket.result(h.socket.frames.at(-1)!.id, captureReply('lease-1', '1'));
    await Promise.resolve();
    expect(done).toBe(false);
    h.socket.notice(retire('1', 'other'));
    const op = await acquire;
    expect(op.isAdmitted()).toBe(true);
  });
  it.each([
    { ...retire(), sequence: '2' },
    { ...retire(), sequence: '0' },
    { ...retire(), sequence: 1 },
    { ...retire(), allRetired: true },
    { ...retire(), selectionIds: [] },
    { ...retire(), selectionIds: ['a', 'b'] },
  ])('closes the entire feed for invalid ordering/content %j', async (notice) => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice(notice);
    expect(op.isLive()).toBe(false);
    await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
  });
  it('allows only an exact duplicate; conflicting duplicates close the feed', async () => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice(retire('1', 'other'));
    h.socket.notice(retire('1', 'other'));
    expect(op.isAdmitted()).toBe(true);
    h.socket.notice(retire('1', 'different'));
    expect(op.isLive()).toBe(false);
  });
  it('terminal MAX closes the feed and same-socket re-hello cannot repair it', async () => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.notice({
      selectionIds: [],
      sequence: '18446744073709551615',
      allRetired: true,
      terminal: true,
    });
    expect(op.isLive()).toBe(false);
    const hello = h.client.request('client.hello', {});
    await vi.waitFor(() => expect(h.socket.frames.at(-1)?.method).toBe('client.hello'));
    h.socket.result(h.socket.frames.at(-1)!.id, {
      clientId: 'again',
      server: { capabilities: { repositorySelection: 1 } },
    });
    await hello;
    await expect(h.feed.capture(h.client.getRepositoryConnection()!, root)).rejects.toThrow();
  });
  it('a lost response stays uncertain and reconciliation observes only the original operation', async () => {
    const h = await harness(),
      op = await h.acquire();
    vi.useFakeTimers();
    const save = op.confirm(command);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await save).toMatchObject({ uncertain: true, current: true });
    const reconcile = op.reconcile();
    expect(h.socket.frames.at(-1)?.params).toEqual({ ...query, selectionId: 'lease-1' });
    h.socket.result(h.socket.frames.at(-1)!.id, attempt());
    expect(await reconcile).toMatchObject({ uncertain: false, attempt: { receipt } });
  });
  it('disposes a late capture on the original connection after UI timeout', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const capture = h.feed.capture(h.connection, root);
    const reject = expect(capture).rejects.toThrow();
    const id = h.socket.frames.at(-1)!.id;
    await vi.advanceTimersByTimeAsync(5001);
    await reject;
    h.socket.result(id, captureReply());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'workspace.repositorySelection.release',
      params: { ...query, selectionId: 'lease-1' },
    });
  });
  it('holds release until the active client call settles and does not erase the receipt', async () => {
    const h = await harness(),
      op = await h.acquire(),
      pending = op.confirm(command);
    const id = h.socket.frames.at(-1)!.id;
    const released = op.release();
    expect(h.socket.frames.at(-1)?.method).toContain('.save');
    h.socket.result(id, attempt());
    expect(await pending).toMatchObject({ current: false, attempt: { receipt } });
    await Promise.resolve();
    expect(h.socket.frames.at(-1)?.method).toContain('.release');
    h.socket.result(h.socket.frames.at(-1)!.id, { released: true });
    await released;
  });
  it('retires before first dispatch after same client socket loss, without reconnect fallback', async () => {
    const h = await harness(),
      op = await h.acquire();
    h.socket.emit('close');
    const count = h.socket.frames.length;
    await expect(op.confirm(command)).rejects.toThrow();
    expect(h.socket.frames).toHaveLength(count);
    expect(op.isLive()).toBe(false);
  });
  it('counts known abandoned captures until their original cleanup response finishes', async () => {
    const h = await harness();
    for (let i = 0; i < 64; i++) {
      await expect(h.acquire({ ...captureReply(`invalid-${i}`), extra: true })).rejects.toThrow();
    }
    const count = h.socket.frames.length;
    const denied = h.feed.capture(h.connection, root).then(
      () => true,
      () => false,
    );
    if (h.socket.frames.length > count)
      h.socket.result(h.socket.frames.at(-1)!.id, captureReply('overflow'));
    expect(await denied).toBe(false);
    expect(h.socket.frames).toHaveLength(count);
    const release = h.socket.frames.find((frame) => frame.method.endsWith('.release'))!;
    h.socket.result(release.id, { released: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const next = await h.acquire(captureReply('after-cleanup'));
    expect(next.isAdmitted()).toBe(true);
  });
  it('counts closed operations while their original release is still pending', async () => {
    const h = await harness();
    const cleanups: Promise<void>[] = [];
    for (let i = 0; i < 64; i++) {
      const op = await h.acquire(captureReply(`closed-${i}`));
      cleanups.push(op.release());
      await Promise.resolve();
    }
    const count = h.socket.frames.length;
    const denied = h.feed.capture(h.connection, root).then(
      () => true,
      () => false,
    );
    if (h.socket.frames.length > count)
      h.socket.result(h.socket.frames.at(-1)!.id, captureReply('overflow'));
    expect(await denied).toBe(false);
    expect(h.socket.frames).toHaveLength(count);
    const release = h.socket.frames.find((frame) => frame.method.endsWith('.release'))!;
    h.socket.result(release.id, { released: true });
    await cleanups[0];
    expect((await h.acquire(captureReply('after-release'))).isAdmitted()).toBe(true);
  });
  it('bounds reconciliation and action expiry independently of a pending command', async () => {
    const h = await harness(),
      op = await h.acquire();
    for (let i = 0; i < 64; i++) {
      const pending = op.reconcile();
      h.socket.result(h.socket.frames.at(-1)!.id, attempt({ status: 'notStarted' }));
      await pending;
    }
    await expect(op.reconcile()).rejects.toThrow();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(300001);
    await expect(op.confirm(command)).rejects.toThrow();
  });
});

it('reserves the call lane before a synchronous notification can reenter receipt observation', async () => {
  const h = await harness(),
    op = await h.acquire();
  let reentered: Promise<unknown> | undefined;
  op.onRetired(() => {
    reentered = op.reconcile().catch((error) => error);
  });
  const write = h.socket.write.bind(h.socket);
  vi.spyOn(h.socket, 'write').mockImplementation((line) => {
    const result = write(line);
    if (JSON.parse(line).method.endsWith('.save')) h.socket.notice(retire());
    return result;
  });
  const result = op.confirm(command);
  const wire = h.socket.frames.find((f) => f.method.endsWith('.save'))!;
  expect(h.socket.frames.filter((f) => f.method.endsWith('.reconcile'))).toHaveLength(0);
  h.socket.result(wire.id, attempt());
  await result;
  expect(await reentered).toBeInstanceOf(Error);
});
