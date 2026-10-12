// Actual renderer transport; controlled preload delivery, not native/main acceptance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { BackendError } from './backend-transport-types';
import {
  createElectronWorkspaceLoadTransport,
  type WorkspaceLoadBridgeChannels,
} from './workspace-load-route-transport';

const channels: WorkspaceLoadBridgeChannels = {
  OBSERVE_ORIGIN: 'test:workspace-load:observe',
  PREPARE: 'test:workspace-load:prepare',
  READ: 'test:workspace-load:read',
  RELEASE: 'test:workspace-load:release',
  RELEASE_ORIGIN: 'test:workspace-load:release-origin',
  RETIRED: 'test:workspace-load:retired',
};
const ref = {
  originId: 'origin-a',
  requestId: 'request-a',
  workspaceId: 'workspace-a',
  routeId: 'route-a',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tuple = { originId: ref.originId, requestId: ref.requestId, workspaceId: ref.workspaceId };
const envelope = (result: unknown) => ({ ok: true, result });
const fulfilled = (value: unknown, selected = ref) =>
  envelope({ ref: selected, current: true, settlement: { status: 'fulfilled', value } });

function bridge() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let serial = 0;
  const invoke = vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === channels.OBSERVE_ORIGIN) return envelope({ originId: ref.originId });
    if (channel === channels.PREPARE) return envelope({ ...ref, ...Object(args[0]) });
    if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN)
      return envelope(undefined);
    throw new Error(`Unexpected channel ${channel}`);
  });
  const apiValue = {
    invoke,
    send: vi.fn(),
    on: vi.fn((_channel: string, callback: (...args: unknown[]) => void) => {
      const id = `listener-${++serial}`;
      listeners.set(id, callback);
      return id;
    }),
    off: vi.fn(),
    offById: vi.fn((_channel: string, id: string) => {
      listeners.delete(id);
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    once: vi.fn(),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
  };
  const api: Window['electronAPI'] = apiValue;
  return {
    api,
    invoke,
    listeners,
    emit(payload: unknown) {
      for (const listener of [...listeners.values()]) listener(payload);
    },
  };
}
function install(value = bridge()) {
  vi.stubGlobal('window', { electronAPI: value.api });
  return value;
}
async function ready(value = install()) {
  const origin = await createElectronWorkspaceLoadTransport(channels).observeOrigin();
  if (!origin) throw new Error('Expected controlled origin');
  const route = await origin.prepare(ref.requestId, ref.workspaceId, new AbortController().signal);
  if (!route) throw new Error('Expected controlled route');
  return { ...value, origin, route };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('captured workspace load IPC eligibility', () => {
  it('constructs inertly, subscribes before OBSERVE, and releases the original bridge once', async () => {
    const value = install();
    const transport = createElectronWorkspaceLoadTransport(channels);
    expect(value.invoke).not.toHaveBeenCalled();
    expect(value.api.on).not.toHaveBeenCalled();
    const origin = await transport.observeOrigin();
    expect(origin).not.toBeNull();
    expect(value.api.on).toHaveBeenCalledWith(channels.RETIRED, expect.any(Function));
    expect(vi.mocked(value.api.on).mock.invocationCallOrder[0]).toBeLessThan(
      value.invoke.mock.invocationCallOrder[0]!,
    );
    expect(value.invoke).toHaveBeenCalledWith(channels.OBSERVE_ORIGIN);
    const replacement = install();
    origin!.release();
    origin!.release();
    expect(origin!.signal.aborted).toBe(true);
    expect(value.invoke).toHaveBeenCalledWith(channels.RELEASE_ORIGIN, { originId: ref.originId });
    expect(
      value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE_ORIGIN),
    ).toHaveLength(1);
    expect(value.api.offById).toHaveBeenCalledWith(channels.RETIRED, 'listener-1');
    expect(value.listeners.size).toBe(0);
    expect(replacement.invoke).not.toHaveBeenCalled();
  });

  it('buffers retirement before OBSERVE reply and releases the late origin', async () => {
    const value = install();
    const reply = deferred<unknown>();
    value.invoke.mockImplementationOnce(() => reply.promise);
    const observed = createElectronWorkspaceLoadTransport(channels).observeOrigin();
    value.emit({ kind: 'origin', originId: ref.originId });
    reply.resolve(envelope({ originId: ref.originId }));
    expect(await observed).toBeNull();
    expect(value.listeners.size).toBe(0);
    expect(value.invoke).toHaveBeenCalledWith(channels.RELEASE_ORIGIN, { originId: ref.originId });
  });

  it('bounds pre-reply notices and detaches after synchronous listener reentry', async () => {
    const value = install();
    const originalOn = value.api.on;
    value.api.on = vi.fn((channel, callback) => {
      for (let i = 0; i < 33; i++) callback({ kind: 'origin', originId: `early-${i}` });
      return originalOn(channel, callback);
    });
    expect(await createElectronWorkspaceLoadTransport(channels).observeOrigin()).toBeNull();
    expect(value.invoke).not.toHaveBeenCalled();
    expect(value.api.offById).toHaveBeenCalledOnce();
    expect(value.listeners.size).toBe(0);
  });

  it('matches the full PREPARE tuple and refuses a reply retired before delivery', async () => {
    const value = install();
    const origin = await createElectronWorkspaceLoadTransport(channels).observeOrigin();
    const reply = deferred<unknown>();
    value.invoke.mockImplementationOnce(() => reply.promise);
    const prepared = origin!.prepare(ref.requestId, ref.workspaceId, new AbortController().signal);
    expect(value.invoke).toHaveBeenLastCalledWith(channels.PREPARE, {
      originId: ref.originId,
      requestId: ref.requestId,
      workspaceId: ref.workspaceId,
    });
    value.emit({ kind: 'route', ...ref });
    reply.resolve(envelope(ref));
    expect(await prepared).toBeNull();
    expect(origin!.signal.aborted).toBe(true);
    expect(value.invoke).toHaveBeenCalledWith(channels.RELEASE, ref);
  });

  it('removes cancelled admission before earlier abort callbacks can deliver route notices', async () => {
    const value = install();
    const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
    const cancelled = new AbortController();
    // Registered before transport's listener to exercise synchronous abort reentry.
    cancelled.signal.addEventListener('abort', () => {
      value.emit({ kind: 'route', ...ref, workspaceId: 'foreign' });
    });
    const add = vi.spyOn(cancelled.signal, 'addEventListener');
    const remove = vi.spyOn(cancelled.signal, 'removeEventListener');
    const reply = deferred<unknown>();
    value.invoke.mockImplementationOnce(() => reply.promise);
    const pending = origin.prepare(ref.requestId, ref.workspaceId, cancelled.signal);
    value.emit({ kind: 'route', ...ref });
    const listener = add.mock.calls[0]![1];
    cancelled.abort();
    expect(origin.isCurrent()).toBe(true);
    value.emit({ kind: 'route', ...ref, workspaceId: 'foreign' });
    reply.resolve(envelope(ref));
    expect(await pending).toBeNull();
    expect(remove).toHaveBeenCalledWith('abort', listener);
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
      [channels.RELEASE, tuple],
      [channels.RELEASE, ref],
    ]);
    expect(
      await origin.prepare(ref.requestId, ref.workspaceId, new AbortController().signal),
    ).toBeNull();
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toHaveLength(1);
    expect(origin.isCurrent()).toBe(true);
  });

  it('consumes an already cancelled request without sending PREPARE', async () => {
    const value = install();
    const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
    const cancelled = new AbortController();
    cancelled.abort();
    const add = vi.spyOn(cancelled.signal, 'addEventListener');
    const remove = vi.spyOn(cancelled.signal, 'removeEventListener');
    expect(await origin.prepare(ref.requestId, ref.workspaceId, cancelled.signal)).toBeNull();
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    expect(
      await origin.prepare(ref.requestId, ref.workspaceId, new AbortController().signal),
    ).toBeNull();
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toHaveLength(0);
    expect(origin.isCurrent()).toBe(true);
  });

  it.each(['add-getter', 'remove-getter', 'subscribe', 'bridge-getter', 'signal-getter'] as const)(
    'rechecks original ownership after the %s callback before sending PREPARE',
    async (boundary) => {
      const value = install();
      const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
      const request = new AbortController();
      const add = request.signal.addEventListener;
      const remove = request.signal.removeEventListener;
      if (boundary === 'add-getter' || boundary === 'remove-getter')
        Object.defineProperty(
          request.signal,
          boundary === 'add-getter' ? 'addEventListener' : 'removeEventListener',
          {
            configurable: true,
            get() {
              origin.retire();
              return boundary === 'add-getter' ? add : remove;
            },
          },
        );
      else if (boundary === 'signal-getter')
        vi.spyOn(request.signal, 'aborted', 'get').mockImplementation(() => {
          origin.retire();
          return false;
        });
      else {
        let subscribed = false;
        vi.spyOn(request.signal, 'addEventListener').mockImplementation((...args) => {
          Reflect.apply(add, request.signal, args);
          subscribed = true;
          if (boundary === 'subscribe') origin.retire();
        });
        if (boundary === 'bridge-getter')
          Object.defineProperty(window, 'electronAPI', {
            configurable: true,
            get() {
              if (subscribed) origin.retire();
              return value.api;
            },
          });
      }
      expect(await origin.prepare(ref.requestId, ref.workspaceId, request.signal)).toBeNull();
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toHaveLength(0);
      expect(origin.signal.aborted).toBe(true);
    },
  );

  it('checks cancellation reentered during subscription before sending PREPARE', async () => {
    const value = install();
    const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
    const request = new AbortController();
    const add = request.signal.addEventListener;
    vi.spyOn(request.signal, 'addEventListener').mockImplementation((...args) => {
      Reflect.apply(add, request.signal, args);
      request.abort();
    });
    expect(await origin.prepare(ref.requestId, ref.workspaceId, request.signal)).toBeNull();
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toHaveLength(0);
    expect(origin.isCurrent()).toBe(true);
  });

  it.each(['origin', 'request'] as const)(
    'refuses route insertion when abort-listener cleanup retires the %s',
    async (boundary) => {
      const value = install();
      const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
      const request = new AbortController();
      const remove = request.signal.removeEventListener;
      vi.spyOn(request.signal, 'removeEventListener').mockImplementation((...args) => {
        Reflect.apply(remove, request.signal, args);
        if (boundary === 'origin') origin.retire();
        else request.abort();
      });
      expect(await origin.prepare(ref.requestId, ref.workspaceId, request.signal)).toBeNull();
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
        ...(boundary === 'request' ? [[channels.RELEASE, tuple]] : []),
        [channels.RELEASE, ref],
      ]);
      expect(origin.isCurrent()).toBe(boundary !== 'origin');
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.READ)).toHaveLength(0);
    },
  );

  it.each(['originId', 'requestId', 'workspaceId'] as const)(
    'does not release a foreign PREPARE %s tuple',
    async (field) => {
      const value = install();
      const origin = await createElectronWorkspaceLoadTransport(channels).observeOrigin();
      value.invoke.mockResolvedValueOnce(envelope({ ...ref, [field]: 'foreign' }));
      expect(
        await origin!.prepare(ref.requestId, ref.workspaceId, new AbortController().signal),
      ).toBeNull();
      expect(origin!.signal.aborted).toBe(true);
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toHaveLength(0);
      expect(value.invoke).toHaveBeenCalledWith(channels.RELEASE_ORIGIN, {
        originId: ref.originId,
      });
    },
  );

  it.each([
    ['same-reply retired', envelope({ ref, current: false, reason: 'retired' })],
    ['mismatched tuple', fulfilled({ workspace: {} }, { ...ref, requestId: 'foreign' })],
    ['malformed settlement', envelope({ ref, current: true, settlement: { status: 'unknown' } })],
    ['outer failure', { ok: false, error: { code: 'TRANSPORT_ERROR', message: 'offline' } }],
    ['raw fallback', { ref, current: true, settlement: { status: 'fulfilled', value: {} } }],
  ])('retires all listeners before rejecting %s', async (_label, response) => {
    const value = await ready();
    const seen: boolean[] = [];
    value.origin.onRetired(() => {
      throw new Error('listener failure');
    });
    value.origin.onRetired(() => {
      seen.push(value.origin.signal.aborted);
    });
    value.invoke.mockResolvedValueOnce(response);
    await expect(value.route.read('open')).rejects.toBeDefined();
    expect(seen).toEqual([true]);
    expect(value.origin.isCurrent()).toBe(false);
    expect(value.route.signal.aborted).toBe(true);
    expect(value.listeners.size).toBe(0);
    const late = vi.fn();
    value.origin.onRetired(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('retires on outer invoke rejection without guessing from the error message', async () => {
    const value = await ready();
    const error = new Error('ordinary-looking message');
    value.invoke.mockRejectedValueOnce(error);
    await expect(value.route.read('get')).rejects.toMatchObject({
      code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    });
    expect(value.origin.signal.aborted).toBe(true);
  });

  it('preserves current ordinary error fields and fulfilled object identity', async () => {
    const value = await ready();
    const data = { code: 'daemon-denial', detail: 'original' };
    const error = { code: 'FORBIDDEN', message: 'original daemon message', rpcCode: -32003, data };
    value.invoke.mockResolvedValueOnce(
      envelope({ ref, current: true, settlement: { status: 'rejected', error } }),
    );
    const caught = await value.route.read('get').catch((error) => error);
    expect(caught).toBeInstanceOf(BackendError);
    if (!(caught instanceof BackendError)) throw caught;
    expect(caught).toMatchObject(error);
    expect(caught.data).toBe(data);
    expect(value.origin.isCurrent()).toBe(true);
    const payload = { workspace: { id: ref.workspaceId, title: 'wire' } };
    value.invoke.mockResolvedValueOnce(fulfilled(payload));
    expect(await value.route.read('get')).toBe(payload);
    expect(value.invoke).toHaveBeenCalledWith(channels.READ, { ...ref, operation: 'get' });
    value.origin.release();
  });

  it('refuses a true settlement delivered after retirement, without a second READ', async () => {
    const value = await ready();
    const reply = deferred<unknown>();
    value.invoke.mockImplementationOnce(() => reply.promise);
    const result = value.route.read('get');
    value.emit({ kind: 'origin', originId: ref.originId });
    reply.resolve(fulfilled({ workspace: { id: ref.workspaceId } }));
    await expect(result).rejects.toBeDefined();
    await expect(value.route.read('get')).rejects.toBeDefined();
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.READ)).toHaveLength(1);
  });

  it('documents the after-settlement delivery limit and then forbids further reads', async () => {
    const value = await ready();
    value.invoke.mockResolvedValueOnce(fulfilled('already settled'));
    expect(await value.route.read('get')).toBe('already settled');
    value.emit({ kind: 'origin', originId: ref.originId });
    await expect(value.route.read('get')).rejects.toBeDefined();
    expect(value.origin.signal.aborted).toBe(true);
  });

  it('cannot heal retirement through a getter returning the original bridge', async () => {
    const value = await ready();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      get() {
        value.origin.retire();
        return value.api;
      },
    });
    expect(value.origin.isCurrent()).toBe(false);
    expect(value.route.isCurrent()).toBe(false);
    expect(value.origin.signal.aborted).toBe(true);
  });

  it('captures original method receivers and never redirects cleanup to replacement methods', async () => {
    const value = await ready();
    const replacement = vi.fn();
    value.api.invoke = replacement;
    value.api.offById = replacement;
    value.route.release();
    value.origin.release();
    expect(replacement).not.toHaveBeenCalled();
    expect(value.invoke).toHaveBeenCalledWith(channels.RELEASE, ref);
    expect(value.invoke.mock.contexts.every((context) => context === value.api)).toBe(true);
  });

  it('keeps normal route release local and ignores its delayed retirement notification', async () => {
    const value = await ready();
    value.route.release();
    value.route.release();
    value.emit({ kind: 'route', ...ref });
    expect(value.origin.isCurrent()).toBe(true);
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toHaveLength(1);
    value.origin.release();
  });

  it.each(['originId', 'requestId', 'workspaceId'] as const)(
    'retires a known route receiving a conflicting %s retirement tuple',
    async (field) => {
      const value = await ready();
      value.emit({ kind: 'route', ...ref, [field]: 'foreign' });
      expect(value.origin.signal.aborted).toBe(true);
      expect(value.route.isCurrent()).toBe(false);
    },
  );

  it.each(['retired', 'malformed', 'outer', 'rejection'] as const)(
    'does not let a late %s reply for a released route retire its successor',
    async (kind) => {
      const value = await ready();
      const reply = deferred<unknown>();
      value.invoke.mockImplementationOnce(() => reply.promise);
      const pending = value.route.read('get');
      const denied = expect(pending).rejects.toBeDefined();
      value.route.release();
      const nextRef = { ...ref, requestId: 'request-b', routeId: 'route-b' };
      value.invoke.mockResolvedValueOnce(envelope(nextRef));
      const successor = await value.origin.prepare(
        nextRef.requestId,
        nextRef.workspaceId,
        new AbortController().signal,
      );
      if (kind === 'rejection') reply.reject(new Error('old invoke failed'));
      else
        reply.resolve(
          kind === 'retired'
            ? envelope({ ref, current: false, reason: 'retired' })
            : kind === 'malformed'
              ? envelope({ ref, current: true, settlement: { status: 'invalid' } })
              : { ok: false, error: { code: 'TRANSPORT_ERROR', message: 'old bridge failure' } },
        );
      await denied;
      expect(value.origin.isCurrent()).toBe(true);
      expect(successor!.isCurrent()).toBe(true);
      value.invoke.mockResolvedValueOnce(fulfilled('successor-result', nextRef));
      expect(await successor!.read('get')).toBe('successor-result');
      value.origin.release();
    },
  );

  it('finishes retirement callbacks before reentrant cleanup reaches the original bridge', async () => {
    const value = await ready();
    const order: string[] = [];
    const original = value.invoke.getMockImplementation()!;
    value.invoke.mockImplementation(async (channel, ...args) => {
      if (channel === channels.RELEASE || channel === channels.RELEASE_ORIGIN)
        order.push('release');
      return original(channel, ...args);
    });
    value.origin.signal.addEventListener('abort', () => value.route.release());
    value.origin.onRetired(() => {
      order.push('listener');
      throw new Error('boom');
    });
    value.origin.onRetired(() => order.push('other-listener'));
    value.origin.retire();
    expect(order).toEqual(['listener', 'other-listener', 'release', 'release']);
    expect(value.origin.signal.aborted).toBe(true);
  });

  it('retains all four ordinary domain channels on the original bridge', async () => {
    const value = await ready();
    const transport = value.route.createDomainReadTransport();
    for (const channel of [
      WORKSPACE_CHANNELS.LIST,
      WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
      WORKSPACE_CHANNELS.GET_GIT_SUMMARY,
      WORKSPACE_CHANNELS.GET_TASKS,
    ]) {
      const data =
        channel === WORKSPACE_CHANNELS.LIST ? { lite: true } : { workspaceId: ref.workspaceId };
      const response = { success: true, data: [] };
      value.invoke.mockResolvedValueOnce(response);
      expect(await transport.invoke(channel, data)).toBe(response);
      expect(value.invoke).toHaveBeenLastCalledWith(channel, data);
    }
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.READ)).toHaveLength(0);
    value.origin.release();
  });
});

describe('prompt pending preparation cancellation', () => {
  it.each(['reply', 'rejection'] as const)(
    'settles before a held %s and drains the old invocation',
    async (settlement) => {
      const value = install();
      const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
      const held = deferred<unknown>();
      value.invoke.mockImplementationOnce(() => held.promise);
      const request = new AbortController();
      const pending = origin.prepare(ref.requestId, ref.workspaceId, request.signal);
      request.abort();
      // Await BEFORE releasing the IPC edge: the old implementation cannot complete this.
      expect(await pending).toBeNull();
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
        [channels.RELEASE, tuple],
      ]);
      const sibling = await origin.prepare(
        'sibling',
        ref.workspaceId,
        new AbortController().signal,
      );
      if (settlement === 'reply') held.resolve(envelope({ ...ref, routeId: 'late-route' }));
      else held.reject(new Error('late transport rejection'));
      await held.promise.catch(() => {});
      expect(origin.isCurrent()).toBe(true);
      expect(sibling!.isCurrent()).toBe(true);
      expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
        [channels.RELEASE, tuple],
        ...(settlement === 'reply' ? [[channels.RELEASE, { ...ref, routeId: 'late-route' }]] : []),
      ]);
      origin.release();
    },
  );

  it('consumes an already aborted tuple on main without invoking PREPARE', async () => {
    const value = install();
    const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
    const request = new AbortController();
    request.abort();
    expect(await origin.prepare(ref.requestId, ref.workspaceId, request.signal)).toBeNull();
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
      [channels.RELEASE, tuple],
    ]);
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.PREPARE)).toEqual([]);
    origin.release();
  });

  it('settles a held preparation on origin retirement without sending request cancellation', async () => {
    const value = install();
    const origin = (await createElectronWorkspaceLoadTransport(channels).observeOrigin())!;
    const held = deferred<unknown>();
    value.invoke.mockImplementationOnce(() => held.promise);
    const pending = origin.prepare(ref.requestId, ref.workspaceId, new AbortController().signal);
    origin.release();
    expect(await pending).toBeNull();
    expect(value.listeners.size).toBe(0);
    held.resolve(envelope(ref));
    await held.promise;
    expect(value.invoke.mock.calls.filter(([name]) => name === channels.RELEASE)).toEqual([
      [channels.RELEASE, ref],
    ]);
  });
});
