import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositoryCheckoutFeed } from './repository-checkout-feed';
import type { CheckoutSelection } from '$shared/types/repository-checkout';

const capture = {
  checkoutId: 'checkout-A',
  revision: 'revision-A',
  provider: 'gitlab' as const,
  instanceBaseUrl: 'https://gitlab.example:8443/Forge',
  expiresAfterMs: 300_000,
};
const project = {
  projectPath: 'group/subgroup/private',
  name: 'private',
  namespace: 'group/subgroup',
  webUrl: capture.instanceBaseUrl + '/group/subgroup/private',
  cloneUrl: capture.instanceBaseUrl + '/group/subgroup/private.git',
  defaultBranch: 'trunk',
};
const selection: CheckoutSelection = {
  checkoutId: capture.checkoutId,
  revision: capture.revision,
  projectPath: project.projectPath,
  branch: 'release/next',
  commitSha: 'a'.repeat(40),
  mode: 'cached',
};
const ready = <T>(value: T) => ({ status: 'ready' as const, value });

class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    if (frame.method === 'sourceControl.checkout.release')
      queueMicrotask(() => this.result(frame.id, { released: true }));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  result(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  last() {
    return this.frames.at(-1)!;
  }
}
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});

async function harness(capability: unknown = 1, avatarCapability?: unknown) {
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
  socket.result(1, {
    clientId: 'original',
    server: {
      capabilities: { gitlabCheckout: capability, gitlabCheckoutOwnerAvatar: avatarCapability },
    },
  });
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const connection = client.getRepositoryConnection()!;
  const acquire = async (value: unknown = ready(capture)) => {
    const promise = feed.capture(connection, {
      provider: 'gitlab',
      instanceBaseUrl: capture.instanceBaseUrl,
    });
    socket.result(socket.last().id, value);
    return promise;
  };
  const lease = async () => {
    const result = await acquire();
    if (result.status !== 'ready') throw new Error('Capture refused');
    return result.value;
  };
  return { client, feed, socket, connection, acquire, lease };
}

describe('qualified checkout on the original JSON-RPC socket', () => {
  it.each([undefined, null, false, '1', 2, 1])(
    'negotiates owner avatars only on the original exact capability %j',
    async (avatarCapability) => {
      const h = await harness(1, avatarCapability);
      await h.lease();
      expect(h.socket.frames[1].params).toEqual({
        provider: 'gitlab',
        instanceBaseUrl: capture.instanceBaseUrl,
        ...(avatarCapability === 1 ? { includeOwnerAvatar: true } : {}),
      });
      expect(h.socket.frames).toHaveLength(2);
    },
  );

  it('does not adopt avatar capability from a replacement connection for an old capture', async () => {
    const h = await harness(1);
    const session = await h.lease();
    const pending = session.projects({});
    const page = h.socket.last();
    const hello = h.client.request('client.hello', { clientId: 'original' });
    await vi.waitFor(() => expect(h.socket.last().method).toBe('client.hello'));
    h.socket.result(h.socket.last().id, {
      clientId: 'original',
      server: { capabilities: { gitlabCheckout: 1, gitlabCheckoutOwnerAvatar: 1 } },
    });
    await hello;
    h.socket.result(
      page.id,
      ready({ items: [{ ...project, ownerAvatarUrl: 'https://images.example/old.png' }] }),
    );
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'retired' });
    const frameCount = h.socket.frames.length;
    await expect(h.feed.capture(h.connection, { provider: 'gitlab' })).resolves.toMatchObject({
      reason: 'retired',
    });
    expect(h.socket.frames).toHaveLength(frameCount);
    const fresh = h.feed.capture(h.client.getRepositoryConnection()!, { provider: 'gitlab' });
    expect(h.socket.last().params).toEqual({ provider: 'gitlab', includeOwnerAvatar: true });
    h.socket.result(h.socket.last().id, ready(capture));
    expect((await fresh).status).toBe('ready');
  });

  it('retains authoritative owner avatars in project pages and detail without extra requests', async () => {
    const h = await harness(1, 1);
    const session = await h.lease();
    const illustrated = {
      ...project,
      ownerAvatarUrl: 'https://images.example:8443/Forge/owner.png',
    };
    const page = session.projects({});
    h.socket.result(h.socket.last().id, ready({ items: [illustrated] }));
    await expect(page).resolves.toEqual(ready({ items: [illustrated] }));
    const detail = session.project({ projectPath: project.projectPath });
    h.socket.result(h.socket.last().id, ready({ project: illustrated }));
    await expect(detail).resolves.toEqual(ready({ project: illustrated }));
    expect(h.socket.frames.map((frame) => frame.method)).toEqual([
      'client.hello',
      'sourceControl.checkout.capture',
      'sourceControl.checkout.projects',
      'sourceControl.checkout.project',
    ]);
  });

  it.each([
    null,
    '',
    '/uploads/owner.png',
    'http://images.example/a.png',
    'https://user:secret@images.example/a.png',
    'data:image/png,avatar',
  ])(
    'falls back for unusable owner avatar metadata %j without discarding the project',
    async (ownerAvatarUrl) => {
      const h = await harness(1, 1);
      const session = await h.lease();
      const page = session.projects({});
      h.socket.result(h.socket.last().id, ready({ items: [{ ...project, ownerAvatarUrl }] }));
      await expect(page).resolves.toEqual(
        ready({ items: [{ ...project, ownerAvatarUrl: undefined }] }),
      );
      expect(session.isCurrent()).toBe(true);
      expect(h.socket.frames).toHaveLength(3);
    },
  );

  it('preserves full instance, project, query and opaque page operands without a workspace', async () => {
    const h = await harness();
    const session = await h.lease();
    expect(h.socket.frames[1]).toMatchObject({
      method: 'sourceControl.checkout.capture',
      params: { provider: 'gitlab', instanceBaseUrl: capture.instanceBaseUrl },
    });
    const query = {
      projectPath: project.projectPath,
      query: 'release/',
      cursor: 'branch-page-2',
      limit: 20,
      cached: true,
    };
    const promise = session.branches(query);
    expect(h.socket.last().params).toEqual({
      ...query,
      checkoutId: capture.checkoutId,
      revision: capture.revision,
    });
    const value = {
      items: [{ name: selection.branch, commitSha: selection.commitSha, protected: true }],
      cached: true,
      defaultBranch: 'trunk',
    };
    h.socket.result(h.socket.last().id, ready(value));
    await expect(promise).resolves.toEqual(ready(value));
  });

  it.each([undefined, null, false, '1', 2])(
    'does not request without exact capability %j',
    async (capability) => {
      const h = await harness(capability === undefined ? 0 : capability);
      await expect(h.feed.capture(h.connection, { provider: 'gitlab' })).resolves.toMatchObject({
        status: 'unavailable',
      });
      expect(h.socket.frames).toHaveLength(1);
    },
  );

  it('keeps original context URLs and typed refusals instead of empty successful pages', async () => {
    const h = await harness();
    const session = await h.lease();
    const url = project.webUrl + '/-/merge_requests/42?view=parallel#note_7';
    const detail = session.project({ url });
    expect(h.socket.last().params.url).toBe(url);
    h.socket.result(h.socket.last().id, ready({ project, contextUrl: url }));
    await expect(detail).resolves.toEqual(ready({ project, contextUrl: url }));
    const page = session.projects({ query: 'private' });
    h.socket.result(h.socket.last().id, {
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 4000,
    });
    await expect(page).resolves.toEqual({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 4000,
    });
  });

  it('denies late A content and warm completion after a known refusal; a fresh lease can recover', async () => {
    const h = await harness();
    const session = await h.lease();
    const warming = session.warm(selection);
    const warmId = h.socket.last().id;
    const browsing = session.projects({});
    const pageId = h.socket.last().id;
    const branches = session.branches({ projectPath: project.projectPath });
    h.socket.result(h.socket.last().id, { status: 'unavailable', reason: 'access-denied' });
    await expect(branches).resolves.toEqual({ status: 'unavailable', reason: 'access-denied' });
    h.socket.result(
      warmId,
      ready({
        projectPath: selection.projectPath,
        branch: selection.branch,
        commitSha: selection.commitSha,
        cached: true,
      }),
    );
    h.socket.result(pageId, ready({ items: [project] }));
    await expect(warming).resolves.toEqual({ status: 'unavailable', reason: 'access-denied' });
    await expect(browsing).resolves.toEqual({ status: 'unavailable', reason: 'access-denied' });
    const count = h.socket.frames.length;
    await expect(session.create({ repositoryCheckout: selection })).rejects.toThrow(
      'REPOSITORY_CHECKOUT_RETIRED',
    );
    await expect(
      session.branches({ projectPath: project.projectPath, cached: true }),
    ).resolves.toMatchObject({ reason: 'access-denied' });
    expect(h.socket.frames).toHaveLength(count);
    session.dispose();
    const refusedB = await h.acquire({ status: 'unavailable', reason: 'access-denied' });
    expect(refusedB).toEqual({ status: 'unavailable', reason: 'access-denied' });
    const recovery = await h.lease();
    const recovered = recovery.projects({});
    h.socket.result(h.socket.last().id, ready({ items: [project] }));
    await expect(recovered).resolves.toEqual(ready({ items: [project] }));
  });

  it.each(['direct', 'cached'] as const)(
    'preserves exact %s selection and creation metadata',
    async (mode) => {
      const h = await harness();
      const session = await h.lease();
      const params = {
        name: 'checkout',
        repositoryCheckout: { ...selection, mode },
        progressId: 'progress-A',
        idempotencyKey: 'request-A',
        initialAgent: { prompt: 'Investigate' },
      };
      const creating = session.create(params, 120_000);
      expect(h.socket.last()).toMatchObject({ method: 'workspace.create', params });
      const result = { id: 'created', path: '/private/created' };
      h.socket.result(h.socket.last().id, result);
      await expect(creating).resolves.toEqual(result);
    },
  );

  it('rejects a warm result for another revision or branch', async () => {
    const h = await harness();
    const session = await h.lease();
    const count = h.socket.frames.length;
    await expect(session.warm({ ...selection, revision: 'other' })).rejects.toThrow(
      'BINDING_MISMATCH',
    );
    expect(h.socket.frames).toHaveLength(count);
    const warming = session.warm(selection);
    h.socket.result(
      h.socket.last().id,
      ready({
        projectPath: selection.projectPath,
        branch: 'trunk',
        commitSha: selection.commitSha,
        cached: true,
      }),
    );
    await expect(warming).rejects.toThrow('RESULT_MISMATCH');
    expect(session.isCurrent()).toBe(false);
  });

  it('retires the original lease and pending content when the same visible account re-hellos', async () => {
    const h = await harness();
    const session = await h.lease();
    const pending = session.projects({});
    const page = h.socket.last();
    const retired = vi.fn();
    session.onRetired(retired);
    const hello = h.client.request('client.hello', { clientId: 'original' });
    await vi.waitFor(() => expect(h.socket.last().method).toBe('client.hello'));
    h.socket.result(h.socket.last().id, {
      clientId: 'original',
      server: { capabilities: { gitlabCheckout: 1 } },
    });
    await hello;
    h.socket.result(page.id, ready({ items: [project] }));
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'retired' });
    expect(retired).toHaveBeenCalledOnce();
    expect(session.isCurrent()).toBe(false);
  });

  it('releases a named malformed capture instead of leaking the allocated lease', async () => {
    const h = await harness();
    await expect(h.acquire(ready({ ...capture, expiresAfterMs: 'invalid' }))).rejects.toBeDefined();
    expect(h.socket.frames.filter((f) => f.method === 'sourceControl.checkout.release')).toEqual([
      expect.objectContaining({
        params: { checkoutId: capture.checkoutId, revision: capture.revision },
      }),
    ]);
  });

  it('joins original late acquisition and cleanup after UI timeout without switching sockets', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const finished = vi.spyOn(h.client, 'finishOriginalProducer');
    const pending = h.feed.capture(h.connection, { provider: 'gitlab' });
    const frame = h.socket.last();
    await vi.advanceTimersByTimeAsync(5001);
    await expect(pending).resolves.toMatchObject({ reason: 'retired' });
    expect(finished).not.toHaveBeenCalled();
    h.socket.result(frame.id, ready(capture));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      h.socket.frames.filter((f) => f.method === 'sourceControl.checkout.release'),
    ).toHaveLength(1);
    expect(finished).toHaveBeenCalledOnce();
  });
});
