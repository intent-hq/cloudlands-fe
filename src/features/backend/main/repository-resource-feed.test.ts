import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
import {
  RepositoryResourceTargetSchema,
  RepositoryResourceResultSchema,
} from '$shared/types/repository-resource-read';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositoryResourceFeed } from './repository-resource-feed';

class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    if (frame.method === 'sourceControl.read.release')
      queueMicrotask(() => this.result(frame.id, { released: true }));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  result(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  notice(sequence = '1', ids = [fixture.capture.readLifetimeId]) {
    this.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'sourceControl.read.retired',
          params: {
            readLifetimeIds: ids,
            sequence,
            allRetired: false,
            terminal: false,
          },
        }) + '\n',
      ),
    );
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
async function harness(capability: unknown = 1) {
  const socket = new Socket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    helloParams: () => ({ clientId: 'original' }),
    heartbeatIntervalMs: 0,
  });
  const feed = createRepositoryResourceFeed(client);
  cleanup.push(() => {
    feed.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.frames).toHaveLength(1));
  socket.result(1, {
    clientId: 'original',
    server: { capabilities: { repositoryResourceRead: capability } },
  });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const connection = client.getRepositoryConnection()!;
  const acquire = async (reply: unknown = fixture.capture) => {
    const promise = feed.capture(connection, 'workspace-A');
    socket.result(socket.frames.at(-1)!.id, reply);
    return promise;
  };
  return { client, feed, socket, connection, acquire };
}
describe('resource read feed on the actual JSON-RPC connection', () => {
  it.each(['mergeRequest', 'issue'] as const)(
    'reads %s only through its original explicit resource route',
    async (key) => {
      const h = await harness();
      const lease = await h.acquire();
      const target = RepositoryResourceTargetSchema.parse(fixture[key].target);
      const pending = lease.detail(target);
      expect(h.socket.frames.at(-1)).toMatchObject({
        method: 'sourceControl.read.detail',
        params: {
          workspaceId: 'workspace-A',
          readLifetimeId: fixture.capture.readLifetimeId,
          target,
          refresh: false,
        },
      });
      h.socket.result(h.socket.frames.at(-1)!.id, fixture[key]);
      await expect(pending).resolves.toEqual(RepositoryResourceResultSchema.parse(fixture[key]));
      lease.dispose();
      lease.dispose();
      expect(h.socket.frames.filter((f) => f.method === 'sourceControl.read.release')).toHaveLength(
        1,
      );
    },
  );
  it.each([null, false, '1', 2])(
    'makes no resource request without exact capability %j',
    async (capability) => {
      const h = await harness(capability);
      await expect(h.feed.capture(h.connection, 'workspace-A')).rejects.toMatchObject({
        rpcCode: -32003,
      });
      expect(h.socket.frames).toHaveLength(1);
    },
  );
  it('does not send a foreign configured instance or malformed project to the provider', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const before = h.socket.frames.length;
    await expect(
      lease.detail({
        ...RepositoryResourceTargetSchema.parse(fixture.issue.target),
        repository: {
          ...fixture.issue.target.repository,
          provider: 'gitlab',
          instanceBaseUrl: 'https://foreign.example',
        },
      }),
    ).rejects.toBeDefined();
    expect(h.socket.frames).toHaveLength(before);
  });
  it.each(['success', 'error'])(
    'discards late %s after an original retirement',
    async (outcome) => {
      const h = await harness();
      const lease = await h.acquire();
      const retired = vi.fn();
      lease.onRetired(retired);
      const read = lease.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
      const frame = h.socket.frames.at(-1)!;
      const assertion = expect(read).rejects.toBeDefined();
      h.socket.notice();
      h.socket.notice();
      if (outcome === 'success') h.socket.result(frame.id, fixture.issue);
      else
        h.socket.emit(
          'data',
          Buffer.from(
            JSON.stringify({ id: frame.id, error: { code: -32003, message: 'Forbidden' } }) + '\n',
          ),
        );
      await assertion;
      expect(retired).toHaveBeenCalledTimes(1);
      expect(lease.isCurrent()).toBe(false);
    },
  );
  it('projects only hover snapshot facts across the original client boundary', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const read = lease.detail(RepositoryResourceTargetSchema.parse(fixture.mergeRequest.target));
    h.socket.result(h.socket.frames.at(-1)!.id, {
      ...fixture.mergeRequest,
      outcome: {
        ...fixture.mergeRequest.outcome,
        snapshot: {
          ...fixture.mergeRequest.outcome.snapshot,
          providerDiagnostic: {
            body: 'unapproved provider diagnostic',
            headers: { debug: 'unapproved' },
          },
        },
      },
    });
    const result = await read;
    expect(JSON.stringify(result)).not.toContain('unapproved');
    expect(result.outcome).toMatchObject({
      kind: 'merge-request',
      snapshot: {
        details: { title: fixture.mergeRequest.outcome.snapshot.details.title, mergeable: null },
      },
    });
  });
  it('retains typed failures and nullable quota rather than empty success', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const pending = lease.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
    const value = {
      ...fixture.issue,
      outcome: { kind: 'failure', code: 'rate-limited', status: 429 },
    };
    h.socket.result(h.socket.frames.at(-1)!.id, value);
    await expect(pending).resolves.toEqual(value);
  });
  it('fails closed when retirement notifications have a gap', async () => {
    const h = await harness();
    const lease = await h.acquire();
    h.socket.notice('2');
    expect(lease.isCurrent()).toBe(false);
    await expect(
      lease.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target)),
    ).rejects.toBeDefined();
  });
  it('retires on re-hello even when the visible identity and capability return unchanged', async () => {
    const h = await harness();
    const lease = await h.acquire();
    const old = h.connection;
    const hello = h.client.request('client.hello', { clientId: 'original' });
    await vi.waitFor(() =>
      expect(h.socket.frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(2),
    );
    const helloFrame = h.socket.frames.filter((frame) => frame.method === 'client.hello').at(-1)!;
    h.socket.result(helloFrame.id, {
      clientId: 'original',
      server: { capabilities: { repositoryResourceRead: 1 } },
    });
    await hello;
    expect(h.client.getRepositoryConnection()).not.toBe(old);
    expect(lease.isCurrent()).toBe(false);
    await expect(h.feed.capture(old, 'workspace-A')).rejects.toBeDefined();
  });
  it('bounds live captures and detail attempts without retaining result pages', async () => {
    const h = await harness();
    const leases = [];
    for (let index = 0; index < 64; index++)
      leases.push(await h.acquire({ ...fixture.capture, readLifetimeId: 'read-' + index }));
    const before = h.socket.frames.length;
    await expect(h.feed.capture(h.connection, 'workspace-A')).rejects.toBeDefined();
    expect(h.socket.frames).toHaveLength(before);
    leases.forEach((lease) => lease.dispose());
    const lease = await h.acquire();
    const target = RepositoryResourceTargetSchema.parse(fixture.issue.target);
    for (let index = 0; index < 64; index++) {
      const response = lease.detail(target);
      h.socket.result(h.socket.frames.at(-1)!.id, fixture.issue);
      await response;
    }
    await expect(lease.detail(target)).rejects.toBeDefined();
    expect(
      h.socket.frames.filter((frame) => frame.method === 'sourceControl.read.detail'),
    ).toHaveLength(64);
    expect(lease.isCurrent()).toBe(false);
  });
  it('fails closed on a malformed or terminal retirement feed', async () => {
    const h = await harness();
    const lease = await h.acquire();
    h.socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'sourceControl.read.retired',
          params: { sequence: 9007199254740992 },
        }) + '\n',
      ),
    );
    expect(lease.isCurrent()).toBe(false);
    await expect(h.feed.capture(h.connection, 'workspace-A')).rejects.toBeDefined();
  });
  it('expires without renewal and disposes a capture arriving after local timeout', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const pending = h.feed.capture(h.connection, 'workspace-A');
    const frame = h.socket.frames.at(-1)!;
    const rejected = expect(pending).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    h.socket.result(frame.id, fixture.capture);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.socket.frames.filter((f) => f.method === 'sourceControl.read.release')).toHaveLength(
      1,
    );
    const lease = await h.acquire({ ...fixture.capture, readLifetimeId: 'next' });
    await vi.advanceTimersByTimeAsync(300000);
    expect(lease.isCurrent()).toBe(false);
  });
});
