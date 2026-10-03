import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositoryAuthorityFeed } from './repository-authority-feed';

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
      Buffer.from(JSON.stringify({ method: 'workspace.repositoryContext.retired', params }) + '\n'),
    );
  }
}
const root = { kind: 'primary' as const, workspaceId: 'workspace-1' };
const query = { workspaceId: root.workspaceId };
const scope = {
  daemonId: 'host-A',
  authorityScopeId: 'native',
  authorityGeneration: '9007199254740995',
};
const captureReply = (lifetimeId = 'lease-1', sequence = '0') => ({
  lifetimeId,
  scope,
  coverage: { kind: 'workspaceInventory', workspaceId: root.workspaceId },
  retirementSequence: sequence,
  expiresAfterMs: 300_000,
});
const context = (id = 'lease-1') => ({ ...fixture, scope, revision: { epoch: id, sequence: '1' } });
const retire = (sequence = '1', id = 'lease-1') => ({
  lifetimeIds: [id],
  sequence,
  allRetired: false,
  terminal: false,
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
  const feed = createRepositoryAuthorityFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  sockets[0].emit('connect');
  await vi.waitFor(() => expect(sockets[0].frames).toHaveLength(1));
  sockets[0].result(1, {
    clientId: 'original',
    server: { capabilities: { repositoryContext: capability } },
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

describe('compiled native repository authority over the actual JsonRpcClient', () => {
  it('reads the exact captured inventory with a main-owned reference and canonical counters', async () => {
    const h = await harness();
    const lease = await h.acquire();
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'workspace.repositoryContext.capture',
      params: query,
    });
    const read = lease.request('workspace.repositoryContext', query);
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: 'workspace.repositoryContext',
      params: { ...query, repositoryLifetimeId: 'lease-1' },
    });
    h.socket.result(h.socket.frames.at(-1)!.id, context());
    await expect(read).resolves.toEqual(context());
    lease.dispose();
    lease.dispose();
    expect(h.socket.frames.filter((frame) => frame.method.endsWith('.release'))).toHaveLength(1);
    expect(h.socket.frames.at(-1)?.params).toEqual({ ...query, repositoryLifetimeId: 'lease-1' });
    h.socket.result(h.socket.frames.at(-1)!.id, { released: true });
  });

  it.each([undefined, false, 2, '1'])(
    'does not acquire without exact original capability %j',
    async (capability) => {
      const h = await harness(capability === undefined ? null : capability);
      await expect(h.feed.capture(h.connection, root)).rejects.toMatchObject({ rpcCode: -32003 });
      expect(h.socket.frames).toHaveLength(1);
    },
  );

  it.each([
    { scope: { ...scope, authorityGeneration: 1 } },
    { retirementSequence: '01' },
    { retirementSequence: '18446744073709551616' },
    { retirementSequence: 1 },
    { expiresAfterMs: 300_001 },
    { coverage: { kind: 'registeredRoot', workspaceId: root.workspaceId, gitRootId: 'other' } },
    { coverage: { kind: 'workspaceInventory', workspaceId: 'other' } },
    { extra: 'not-in-contract' },
  ])('rejects an invalid capture and releases its known reference %j', async (change) => {
    const h = await harness();
    await expect(h.acquire({ ...captureReply(), ...change })).rejects.toThrow();
    expect(h.socket.frames.at(-1)?.method).toBe('workspace.repositoryContext.release');
  });

  it.each([
    ['workspace.repositoryContext.capture', query],
    ['workspace.repositoryContext.release', query],
    ['git.push', query],
    ['workspace.repositoryContext', { ...query, repositoryLifetimeId: 'forged' }],
    ['workspace.repositoryContext', { ...query, gitRootId: 'wider' }],
    ['workspace.repositoryContext', { ...query, backendId: 'local' }],
    ['workspace.repositoryContext', { workspaceId: 'other' }],
  ] as const)('rejects method/reference/target widening: %s %j', async (method, params) => {
    const h = await harness();
    const lease = await h.acquire();
    await expect(lease.request(method, params)).rejects.toThrow();
    expect(h.socket.frames).toHaveLength(2);
  });

  it('reconciles retirement arriving before the capture reply and never publishes that lease', async () => {
    const h = await harness();
    const pending = h.feed.capture(h.connection, root);
    const id = h.socket.frames.at(-1)!.id;
    h.socket.notice(retire());
    h.socket.result(id, captureReply('lease-1', '0'));
    await expect(pending).rejects.toThrow();
    expect(h.socket.frames.at(-1)?.method).toBe('workspace.repositoryContext.release');
  });

  it('waits for contiguous catch-up when capture reply overtakes an unrelated notice', async () => {
    const h = await harness();
    const pending = h.feed.capture(h.connection, root);
    h.socket.result(h.socket.frames.at(-1)!.id, captureReply('lease-1', '1'));
    let published = false;
    void pending.then(() => {
      published = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(published).toBe(false);
    h.socket.notice(retire('1', 'another-lease'));
    expect((await pending).isCurrent()).toBe(true);
  });

  it('accepts only an exact duplicate, retaining the cursor across re-hello on the same socket', async () => {
    const h = await harness();
    const first = await h.acquire();
    h.socket.notice(retire('1', 'unrelated'));
    h.socket.notice(retire('1', 'unrelated'));
    expect(first.isCurrent()).toBe(true);
    const hello = h.client.request('client.hello');
    expect(first.isCurrent()).toBe(false);
    await vi.waitFor(() => expect(h.socket.frames.at(-1)?.method).toBe('client.hello'));
    h.socket.result(h.socket.frames.at(-1)!.id, {
      clientId: 'original',
      server: { capabilities: { repositoryContext: 1 } },
    });
    await hello;
    const next = h.feed.capture(h.client.getRepositoryConnection()!, root);
    h.socket.result(h.socket.frames.at(-1)!.id, captureReply('lease-2', '1'));
    expect((await next).isCurrent()).toBe(true);
    h.socket.notice(retire('2', 'lease-2'));
    expect((await next).isCurrent()).toBe(false);
  });

  it.each([
    retire('3'),
    retire('0'),
    { ...retire('1'), sequence: 1 },
    { ...retire('1'), allRetired: true },
    { ...retire('1'), terminal: true },
    { ...retire('1'), lifetimeIds: ['same', 'same'] },
    { ...retire('1'), extra: true },
  ])('fails the physical feed closed on bad ordering or shape %j', async (notice) => {
    const h = await harness();
    const lease = await h.acquire();
    h.socket.notice(notice);
    expect(lease.isCurrent()).toBe(false);
    await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
  });

  it('fails closed on conflicting duplicates and does not revive on a larger number', async () => {
    const h = await harness();
    const lease = await h.acquire();
    h.socket.notice(retire('1', 'other'));
    h.socket.notice(retire('1', 'different'));
    h.socket.notice(retire('2', 'unrelated'));
    expect(lease.isCurrent()).toBe(false);
    await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
  });

  it('honors terminal MAX even repeatedly and permanently prevents capture on that physical feed', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const terminal = {
      lifetimeIds: [],
      sequence: '18446744073709551615',
      allRetired: true,
      terminal: true,
    };
    h.socket.notice(terminal);
    h.socket.notice(terminal);
    expect(lease.isCurrent()).toBe(false);
    await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
  });

  it('bounds pending capture tombstones and refuses overflow rather than losing a retirement', async () => {
    const h = await harness();
    const pending = h.feed.capture(h.connection, root);
    const id = h.socket.frames.at(-1)!.id;
    for (let n = 1; n <= 65; n++) h.socket.notice(retire(String(n), `other-${n}`));
    h.socket.result(id, captureReply());
    await expect(pending).rejects.toThrow();
    await expect(h.feed.capture(h.connection, root)).rejects.toThrow();
  });

  it('disposes a late capture on the original session after the acquisition deadline', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const pending = h.feed.capture(h.connection, root);
    const rejection = expect(pending).rejects.toMatchObject({ rpcCode: -32003 });
    const id = h.socket.frames.at(-1)!.id;
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    h.socket.result(id, captureReply());
    await vi.waitFor(() =>
      expect(h.socket.frames.at(-1)?.method).toBe('workspace.repositoryContext.release'),
    );
  });

  it('expires conservatively from dispatch and emits retirement for already-delivered facts', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const pending = h.feed.capture(h.connection, root);
    const id = h.socket.frames.at(-1)!.id;
    await vi.advanceTimersByTimeAsync(1_000);
    h.socket.result(id, { ...captureReply(), expiresAfterMs: 2_000 });
    const lease = await pending;
    const retired = vi.fn();
    lease.onRetired(retired);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retired).toHaveBeenCalledOnce();
    expect(lease.isCurrent()).toBe(false);
  });

  it('retains an original read result privately when a notice retires its lifetime before delivery', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const pending = lease.request('workspace.repositoryContext', query);
    const id = h.socket.frames.at(-1)!.id;
    h.socket.notice(retire());
    h.socket.result(id, context());
    await expect(pending).resolves.toEqual(context());
    expect(lease.isCurrent()).toBe(false);
  });

  it.each(['scope', 'epoch', 'root', 'duplicate', 'sequence'])(
    'rejects mismatched read %s',
    async (kind) => {
      const h = await harness();
      const lease = await h.acquire();
      const reply = structuredClone(context());
      if (kind === 'scope') reply.scope.daemonId = 'local-B';
      if (kind === 'epoch') reply.revision.epoch = 'foreign';
      if (kind === 'sequence') reply.revision.sequence = '2';
      if (kind === 'root') reply.roots[0].root.workspaceId = 'foreign';
      if (kind === 'duplicate') reply.roots.push(reply.roots[0]);
      const pending = lease.request('workspace.repositoryContext', query);
      h.socket.result(h.socket.frames.at(-1)!.id, reply);
      await expect(pending).rejects.toThrow();
      expect(lease.isCurrent()).toBe(false);
    },
  );

  it('permits only one read in flight and retires after the finite read budget', async () => {
    const h = await harness();
    const lease = await h.acquire();
    for (let n = 0; n < 64; n++) {
      const pending = lease.request('workspace.repositoryContext', query);
      if (n === 0)
        await expect(lease.request('workspace.repositoryContext', query)).rejects.toThrow();
      h.socket.result(h.socket.frames.at(-1)!.id, context());
      await pending;
    }
    await expect(lease.request('workspace.repositoryContext', query)).rejects.toThrow();
    expect(lease.isCurrent()).toBe(false);
  });
});
