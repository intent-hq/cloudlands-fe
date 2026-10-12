// Actual renderer scope + transport with controlled declared preload only.
// Physical ownership and daemon contract are exercised separately by main composition tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceGitPrepareSchema,
  type WorkspaceLoadPrepare,
  type WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import {
  createElectronWorkspaceLoadTransport,
  type WorkspaceLoadBridgeChannels,
} from './workspace-load-route-transport';
import { acquireWorkspaceGitReadScope } from './workspace-git-read-scope';

type GitSettlement<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; error: unknown };

function observeGitSettlement<T>(pending: Promise<T>): Promise<GitSettlement<T>> {
  return pending.then(
    (value): GitSettlement<T> => ({ status: 'fulfilled', value }),
    (error: unknown): GitSettlement<T> => ({ status: 'rejected', error }),
  );
}

function gitFulfilledValue<T>(settlement: GitSettlement<T>): T {
  expect(settlement.status).toBe('fulfilled');
  if (settlement.status === 'rejected') throw settlement.error;
  return settlement.value;
}

function expectGitUnavailable<T>(settlement: GitSettlement<T>): void {
  expect(settlement.status).toBe('rejected');
  if (settlement.status !== 'rejected') throw new Error('Expected a rejected Git read');
  const { error } = settlement;
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error) || !('code' in error)) throw error;
  expect(error.code).toBe('WORKSPACE_LOAD_ROUTE_UNAVAILABLE');
}

const channels: WorkspaceLoadBridgeChannels = {
  OBSERVE_ORIGIN: 'git-scope:observe',
  PREPARE: 'git-scope:prepare',
  READ: 'git-scope:read',
  RELEASE: 'git-scope:release',
  RELEASE_ORIGIN: 'git-scope:release-origin',
  RETIRED: 'git-scope:retired',
};
const envelope = (result: unknown) => ({ ok: true, result });
const refused = {
  ok: false,
  error: { code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE', message: 'Unavailable' },
};
const cleanups: Array<() => void> = [];
const holds: Array<() => void> = [];
const drains: Promise<unknown>[] = [];
function hold<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  holds.push(() => resolve(fallback));
  return { promise, resolve };
}
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const release of holds.splice(0)) {
    try {
      release();
    } catch (error) {
      errors.push(error);
    }
  }
  const settled = await Promise.allSettled(drains.splice(0));
  for (const result of settled) if (result.status === 'rejected') errors.push(result.reason);
  vi.restoreAllMocks();
  if (errors.length) throw new AggregateError(errors, 'Git scope fixture cleanup failed');
});

function bridge() {
  let originId = 0,
    routeId = 0;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const controls: {
    observe?: () => Promise<unknown>;
    prepare?: (ref: WorkspaceLoadRouteRef) => Promise<unknown>;
    read?: (ref: WorkspaceLoadRouteRef, input: Record<string, unknown>) => Promise<unknown>;
    release?: () => void;
  } = {};
  let current: NonNullable<Window['electronAPI']>;
  const invoke = vi.fn(function (
    this: NonNullable<Window['electronAPI']>,
    channel: string,
    payload?: unknown,
  ): Promise<unknown> {
    expect(this).toBe(api);
    const pending = (async () => {
      if (channel === channels.OBSERVE_ORIGIN)
        return controls.observe?.() ?? envelope({ originId: `origin-${++originId}` });
      if (channel === channels.PREPARE) {
        if (payload && typeof payload === 'object' && 'operation' in payload) {
          const input = WorkspaceGitPrepareSchema.parse(payload);
          const ref = {
            originId: input.originId,
            requestId: input.requestId,
            workspaceId: input.workspaceId,
            routeId: `route-${++routeId}`,
          };
          return (
            controls.prepare?.(ref) ??
            envelope({ ref, provenance: { physicalOwnerId: 'physical-owner-a' } })
          );
        }
        const ref = { ...(payload as WorkspaceLoadPrepare), routeId: `route-${++routeId}` };
        return controls.prepare?.(ref) ?? envelope(ref);
      }
      if (channel === channels.READ) {
        const input = payload as WorkspaceLoadRouteRef & Record<string, unknown>;
        const ref = {
          originId: input.originId,
          requestId: input.requestId,
          workspaceId: input.workspaceId,
          routeId: input.routeId,
        };
        return (
          controls.read?.(ref, input) ??
          envelope({
            ref,
            current: true,
            settlement: {
              status: 'fulfilled',
              value: { changes: [], truncated: false, totalCount: 0 },
            },
          })
        );
      }
      if (channel === channels.RELEASE) {
        controls.release?.();
        return envelope(undefined);
      }
      if (channel === channels.RELEASE_ORIGIN) return envelope(undefined);
      throw new Error(`Unexpected bridge call ${channel}`);
    })();
    drains.push(pending);
    return pending;
  });
  const api: NonNullable<Window['electronAPI']> = {
    invoke,
    send: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    once: vi.fn(),
    platform: 'linux',
    arch: 'x64',
    versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
    devInstance: null,
    devPort: null,
    on: vi.fn((_channel, listener) => {
      const id = `listener-${listeners.size}`;
      listeners.set(id, listener);
      return id;
    }),
    offById: vi.fn((_channel, id) => {
      listeners.delete(id);
    }),
  };
  current = api;
  const transport = createElectronWorkspaceLoadTransport(channels, () => current);
  const controller = new AbortController();
  // Register before any acquisition; later assertions may fail at any partial setup point.
  cleanups.push(() => controller.abort());
  async function acquire(signal = controller.signal) {
    return acquireWorkspaceGitReadScope(transport, 'workspace-a', signal);
  }
  async function ready(signal = controller.signal) {
    const result = await acquire(signal);
    if (result.kind !== 'acquired') throw new Error('Expected controlled scope');
    cleanups.push(result.scope.release);
    return result.scope;
  }
  return {
    api,
    invoke,
    controls,
    listeners,
    transport,
    controller,
    acquire,
    ready,
    replace(value: NonNullable<Window['electronAPI']>) {
      current = value;
    },
    emit(value: unknown) {
      for (const listener of [...listeners.values()]) listener(value);
    },
    calls(channel: string) {
      return invoke.mock.calls.filter(([name]) => name === channel);
    },
  };
}

describe('inactive captured Git scope', () => {
  it('constructs inertly and uses one observation with distinct children for three raw reads', async () => {
    const h = bridge();
    expect(h.invoke).not.toHaveBeenCalled();
    const scope = await h.ready();
    const seen = new Map<string, unknown>();
    h.controls.read = async (ref, input) => {
      seen.set(String(input.operation), ref);
      return envelope({
        ref,
        current: true,
        settlement: { status: 'fulfilled', value: input.operation },
      });
    };
    expect(
      await Promise.all([
        scope.read({ operation: 'git-status', forceRefresh: true }),
        scope.read({ operation: 'tracked-changes' }),
        scope.read({ operation: 'commits-with-boundary', includeOlder: false }),
      ]),
    ).toEqual(['git-status', 'tracked-changes', 'commits-with-boundary']);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    const requests = h.calls(channels.PREPARE).map(([, value]) => value as WorkspaceLoadPrepare);
    expect(requests.map((ref) => ref.workspaceId)).toEqual([
      'workspace-a',
      'workspace-a',
      'workspace-a',
    ]);
    expect(new Set(requests.map((ref) => ref.originId)).size).toBe(1);
    expect(new Set(requests.map((ref) => ref.requestId)).size).toBe(3);
    expect(h.calls(channels.READ).map(([, value]) => value)).toEqual([
      { ...Object(seen.get('git-status')), operation: 'git-status', forceRefresh: true },
      { ...Object(seen.get('tracked-changes')), operation: 'tracked-changes' },
      {
        ...Object(seen.get('commits-with-boundary')),
        operation: 'commits-with-boundary',
        includeOlder: false,
      },
    ]);
    expect(h.calls(channels.RELEASE)).toHaveLength(3);
    scope.release();
    scope.release();
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([
      [channels.RELEASE_ORIGIN, { originId: 'origin-1' }],
    ]);
    expect(h.listeners.size).toBe(0);
  });

  it('keeps refused acquisition distinct and does not retry before a separate demand', async () => {
    const h = bridge();
    h.controls.observe = async () => refused;
    expect(await h.acquire()).toEqual({ kind: 'unavailable' });
    expect(h.calls(channels.PREPARE)).toEqual([]);
    expect(h.calls(channels.READ)).toEqual([]);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
    h.controls.observe = undefined;
    const next = await h.ready();
    expect(next.isCurrent()).toBe(true);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(2);
  });

  it('refuses pre-aborted acquisition without allocating an origin', async () => {
    const h = bridge();
    h.controller.abort();
    expect(await h.acquire()).toEqual({ kind: 'unavailable' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
  });

  it('returns unavailable before an aborted observation reply and drains its original release', async () => {
    const h = bridge();
    const reply = hold(envelope({ originId: 'late-observation' }));
    h.controls.observe = () => reply.promise;
    const pending = observeGitSettlement(h.acquire());
    const original = h.invoke.mock.results[0].value as Promise<unknown>;
    h.controller.abort();
    expect(gitFulfilledValue(await pending)).toEqual({ kind: 'unavailable' });
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
    reply.resolve(envelope({ originId: 'late-observation' }));
    await original;
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([
      [channels.RELEASE_ORIGIN, { originId: 'late-observation' }],
    ]);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it('cancels a pending prepare tuple promptly then releases its original late full ref once', async () => {
    const h = bridge();
    const scope = await h.ready();
    let fullRef!: WorkspaceLoadRouteRef;
    const reply = hold<unknown>(refused);
    h.controls.prepare = (ref) => {
      fullRef = ref;
      return reply.promise;
    };
    const pending = observeGitSettlement(scope.read({ operation: 'git-status' }));
    const original = h.invoke.mock.results.at(-1)!.value as Promise<unknown>;
    const { routeId: _routeId, ...tuple } = fullRef;
    scope.release();
    expectGitUnavailable(await pending);
    expect(h.calls(channels.RELEASE)).toEqual([[channels.RELEASE, tuple]]);
    reply.resolve(envelope(fullRef));
    await original;
    expect(h.calls(channels.RELEASE)).toEqual([
      [channels.RELEASE, tuple],
      [channels.RELEASE, fullRef],
    ]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.calls(channels.READ)).toEqual([]);
  });

  it('cleans acquired and late preparing siblings after one child preparation is refused', async () => {
    const h = bridge();
    const scope = await h.ready();
    const readReply = hold<unknown>(refused);
    const readEntered = hold<WorkspaceLoadRouteRef | null>(null);
    h.controls.read = (ref) => {
      readEntered.resolve(ref);
      return readReply.promise;
    };
    const first = observeGitSettlement(scope.read({ operation: 'git-status' }));
    const firstRef = (await readEntered.promise)!;
    const secondReply = hold<unknown>(refused);
    const thirdReply = hold<unknown>(refused);
    let calls = 0;
    let thirdRef!: WorkspaceLoadRouteRef;
    h.controls.prepare = (ref) => {
      if (++calls === 1) return secondReply.promise;
      thirdRef = ref;
      return thirdReply.promise;
    };
    const second = observeGitSettlement(scope.read({ operation: 'tracked-changes' }));
    const third = observeGitSettlement(scope.read({ operation: 'commits-with-boundary' }));
    const originalThird = h.invoke.mock.results.at(-1)!.value as Promise<unknown>;
    secondReply.resolve(refused);
    expectGitUnavailable(await second);
    expectGitUnavailable(await third);
    readReply.resolve(
      envelope({ ref: firstRef, current: true, settlement: { status: 'fulfilled', value: [] } }),
    );
    thirdReply.resolve(envelope(thirdRef));
    await originalThird;
    expectGitUnavailable(await first);
    expect(
      h
        .calls(channels.RELEASE)
        .filter(
          ([, value]) => (value as Partial<WorkspaceLoadRouteRef>).routeId === firstRef.routeId,
        ),
    ).toHaveLength(1);
    expect(
      h
        .calls(channels.RELEASE)
        .filter(
          ([, value]) => (value as Partial<WorkspaceLoadRouteRef>).routeId === thirdRef.routeId,
        ),
    ).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(scope.signal.aborted).toBe(true);
    expect(h.listeners.size).toBe(0);
  });

  it('consumes an operation only once without reusing its request or recapturing', async () => {
    const h = bridge();
    const scope = await h.ready();
    expect(await scope.read({ operation: 'tracked-changes' })).toEqual({
      changes: [],
      truncated: false,
      totalCount: 0,
    });
    await expect(scope.read({ operation: 'tracked-changes' })).rejects.toMatchObject({
      code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    });
    expect(h.calls(channels.PREPARE)).toHaveLength(1);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
  });

  it('returns the current ordinary daemon failure unchanged rather than an empty result', async () => {
    const h = bridge();
    const scope = await h.ready();
    const error = {
      code: 'rate-limited',
      message: 'quota exhausted',
      rpcCode: -32603,
      data: { code: 'rate-limited' },
    };
    h.controls.read = async (ref) =>
      envelope({ ref, current: true, settlement: { status: 'rejected', error } });
    await expect(scope.read({ operation: 'pr-refresh', automatic: true })).rejects.toMatchObject(
      error,
    );
    expect(scope.isCurrent()).toBe(true);
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
  });

  it('retires malformed child replies without exposing their data', async () => {
    const h = bridge();
    const scope = await h.ready();
    h.controls.read = async (ref) =>
      envelope({
        ref: { ...ref, workspaceId: 'foreign' },
        current: true,
        settlement: { status: 'fulfilled', value: [] },
      });
    await expect(scope.read({ operation: 'tracked-changes' })).rejects.toMatchObject({
      code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    });
    expect(scope.isCurrent()).toBe(false);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
  });

  it('keeps a same-workspace successor independent while the original bridge reply drains', async () => {
    const a = bridge();
    const scopeA = await a.ready();
    let oldRef!: WorkspaceLoadRouteRef;
    const reply = hold<unknown>(refused);
    const entered = hold(false);
    a.controls.read = (ref) => {
      oldRef = ref;
      entered.resolve(true);
      return reply.promise;
    };
    const old = observeGitSettlement(scopeA.read({ operation: 'tracked-changes' }));
    await entered.promise;
    const b = bridge();
    a.replace(b.api);
    const scopeB = await b.ready();
    expect(scopeA.identity).not.toBe(scopeB.identity);
    reply.resolve(
      envelope({ ref: oldRef, current: true, settlement: { status: 'fulfilled', value: [] } }),
    );
    expectGitUnavailable(await old);
    scopeA.release();
    expect(scopeB.isCurrent()).toBe(true);
    expect(b.calls(channels.RELEASE_ORIGIN)).toEqual([]);
    expect(await scopeB.read({ operation: 'tracked-changes' })).toEqual({
      changes: [],
      truncated: false,
      totalCount: 0,
    });
    expect(a.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(b.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
  });

  it('refuses reentrant option getters that abort before child preparation', async () => {
    const h = bridge();
    const scope = await h.ready();
    const input = {
      operation: 'git-status' as const,
      get forceRefresh() {
        h.controller.abort();
        return true;
      },
    };
    await expect(scope.read(input)).rejects.toMatchObject({
      code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    });
    expect(h.calls(channels.PREPARE)).toEqual([]);
    expect(h.calls(channels.READ)).toEqual([]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
  });

  it('does not accept unapproved options supplied through structural typing', async () => {
    const h = bridge();
    const scope = await h.ready();
    const input = { operation: 'pr-refresh' as const, automatic: true, method: 'git.push' };
    await expect(scope.read(input)).rejects.toMatchObject({
      code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
    });
    expect(h.calls(channels.PREPARE)).toEqual([]);
    expect(h.calls(channels.READ)).toEqual([]);
    expect(scope.signal.aborted).toBe(true);
  });
});

describe('prepared PR provenance without a PR command', () => {
  it('attests once, releases without a read, and frees every temporary origin', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    expect(prepared.provenance).toEqual({ physicalOwnerId: 'physical-owner-a' });
    expect(prepared.isCurrent()).toBe(true);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(h.calls(channels.PREPARE)).toHaveLength(1);
    expect(h.calls(channels.READ)).toEqual([]);
    const request = h.calls(channels.PREPARE)[0][1];
    expect(request).toMatchObject({
      originId: 'origin-1',
      workspaceId: 'workspace-a',
      operation: 'pr-refresh',
    });
    prepared.release();
    prepared.release();
    scope.release();
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.calls(channels.READ)).toEqual([]);
    expect(h.listeners.size).toBe(0);
    expect(prepared.isCurrent()).toBe(false);
    expect(scope.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
  });

  it.each([undefined, false, true])(
    'reads the same prepared child once with automatic=%s',
    async (automatic) => {
      const h = bridge();
      const scope = await h.ready();
      const prepared = await scope.preparePrRefresh();
      const value = {
        outcome: 'skipped',
        prNumber: null,
        prUrl: null,
        prStatus: null,
        pullRequests: [],
      };
      let readRef: WorkspaceLoadRouteRef | undefined;
      h.controls.read = async (ref) => {
        readRef = ref;
        return envelope({ ref, current: true, settlement: { status: 'fulfilled', value } });
      };
      expect(
        await prepared.read({
          operation: 'pr-refresh',
          ...(automatic === undefined ? {} : { automatic }),
        }),
      ).toEqual(value);
      expect(h.calls(channels.PREPARE)).toHaveLength(1);
      expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
      expect(h.calls(channels.READ)).toEqual([
        [
          channels.READ,
          {
            ...readRef,
            operation: 'pr-refresh',
            ...(automatic === undefined ? {} : { automatic }),
          },
        ],
      ]);
      expect(h.calls(channels.RELEASE)).toEqual([[channels.RELEASE, readRef]]);
      expect(scope.isCurrent()).toBe(true);
      expect(prepared.isCurrent()).toBe(true);
      expect(scope.signal.aborted).toBe(false);
      expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
      expect(h.listeners.size).toBe(1);
      expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
      expect(h.calls(channels.READ)).toHaveLength(1);
      expect(scope.isCurrent()).toBe(true);
      expect(prepared.isCurrent()).toBe(true);
      expect(scope.signal.aborted).toBe(false);
      expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
      // The caller owns finalization after its synchronous mapping/publication work.
      prepared.release();
      scope.release();
      expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
      expect(h.listeners.size).toBe(0);
      expect(h.calls(channels.RELEASE)).toEqual([[channels.RELEASE, readRef]]);
      expect(scope.signal.aborted).toBe(true);
      expect(prepared.isCurrent()).toBe(false);
    },
  );

  it('consumes PR once at preparation and leaves a passive sibling current until scope release', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    expectGitUnavailable(await observeGitSettlement(scope.preparePrRefresh()));
    expectGitUnavailable(await observeGitSettlement(scope.read({ operation: 'pr-refresh' })));
    expect(await scope.read({ operation: 'tracked-changes' })).toEqual({
      changes: [],
      truncated: false,
      totalCount: 0,
    });
    expect(prepared.isCurrent()).toBe(true);
    expect(h.calls(channels.PREPARE)).toHaveLength(2);
    expect(h.calls(channels.READ)).toHaveLength(1);
    prepared.release();
    expect(h.listeners.size).toBe(0);
  });

  it('drains an aborted prepared reply on the original bridge and releases its full ref once', async () => {
    const h = bridge();
    const scope = await h.ready();
    const reply = hold<unknown>(refused);
    let ref!: WorkspaceLoadRouteRef;
    h.controls.prepare = (value) => {
      ref = value;
      return reply.promise;
    };
    const settled = observeGitSettlement(scope.preparePrRefresh());
    const original = h.invoke.mock.results.at(-1)!.value as Promise<unknown>;
    scope.release();
    expectGitUnavailable(await settled);
    const successor = bridge();
    h.replace(successor.api);
    reply.resolve(envelope({ ref, provenance: { physicalOwnerId: 'physical-owner-a' } }));
    await original;
    const { routeId: _routeId, ...tuple } = ref;
    expect(h.calls(channels.RELEASE)).toEqual([
      [channels.RELEASE, tuple],
      [channels.RELEASE, ref],
    ]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(successor.invoke).not.toHaveBeenCalled();
    expect(h.calls(channels.READ)).toEqual([]);
  });

  it('retains an ordinary PR error and releases the attested scope after rejection', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    const error = {
      code: 'FORBIDDEN',
      message: 'Membership required',
      rpcCode: -32003,
      data: { code: 'FORBIDDEN' },
    };
    h.controls.read = async (ref) =>
      envelope({ ref, current: true, settlement: { status: 'rejected', error } });
    const settled = await observeGitSettlement(
      prepared.read({ operation: 'pr-refresh', automatic: true }),
    );
    expect(settled.status).toBe('rejected');
    if (settled.status !== 'rejected') throw new Error('Expected original PR rejection');
    expect(settled.error).toMatchObject(error);
    expect(settled.error).toBeInstanceOf(Error);
    if (!(settled.error instanceof Error) || !('code' in settled.error)) throw settled.error;
    expect(settled.error.code).toBe('FORBIDDEN');
    expect(scope.isCurrent()).toBe(false);
    expect(prepared.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    prepared.release();
    scope.release();
    expect(h.calls(channels.PREPARE)).toHaveLength(1);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it('refuses malformed or denied attestation without fallback or a PR read', async () => {
    const h = bridge();
    h.controls.prepare = async (ref) => envelope({ ref, provenance: { physicalOwnerId: '' } });
    const scope = await h.ready();
    expectGitUnavailable(await observeGitSettlement(scope.preparePrRefresh()));
    expect(h.calls(channels.READ)).toEqual([]);
    expect(h.calls(channels.PREPARE)).toHaveLength(1);
    expect(h.calls(channels.OBSERVE_ORIGIN)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it('rejects late PR completion after cancellation while preserving a successor acquisition', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    const reply = hold<unknown>(refused);
    const entered = hold<WorkspaceLoadRouteRef | null>(null);
    h.controls.read = (ref) => {
      entered.resolve(ref);
      return reply.promise;
    };
    const settled = observeGitSettlement(
      prepared.read({ operation: 'pr-refresh', automatic: true }),
    );
    const ref = await entered.promise;
    prepared.release();
    const successor = await h.ready();
    reply.resolve(
      envelope({ ref, current: true, settlement: { status: 'fulfilled', value: null } }),
    );
    expectGitUnavailable(await settled);
    expect(successor.isCurrent()).toBe(true);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
  });
});

it('rejects a non-PR operation on the prepared child and releases without any read', async () => {
  const h = bridge();
  const scope = await h.ready();
  const prepared = await scope.preparePrRefresh();
  const invalid = Reflect.apply(prepared.read, prepared, [{ operation: 'git-status' }]);
  expectGitUnavailable(await observeGitSettlement(invalid));
  expect(h.calls(channels.READ)).toEqual([]);
  expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
  expect(h.listeners.size).toBe(0);
});

describe('prepared PR publication lifetime', () => {
  it.each(['abort', 'origin-notice', 'bridge'] as const)(
    'retires the surviving publication parent after post-success %s',
    async (boundary) => {
      const h = bridge();
      const scope = await h.ready();
      const prepared = await scope.preparePrRefresh();
      const value = { outcome: 'unchanged', pullRequests: [] };
      h.controls.read = async (ref) =>
        envelope({ ref, current: true, settlement: { status: 'fulfilled', value } });
      expect(
        gitFulfilledValue(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' }))),
      ).toEqual(value);
      expect(prepared.isCurrent()).toBe(true);
      expect(scope.isCurrent()).toBe(true);
      expect(scope.signal.aborted).toBe(false);
      expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
      expect(h.listeners.size).toBe(1);
      const successor = bridge();
      if (boundary === 'abort') h.controller.abort();
      else if (boundary === 'origin-notice') h.emit({ kind: 'origin', originId: 'origin-1' });
      else h.replace(successor.api);
      expect(prepared.isCurrent()).toBe(false);
      expect(scope.isCurrent()).toBe(false);
      expect(scope.signal.aborted).toBe(true);
      expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
      prepared.release();
      scope.release();
      expect(h.calls(channels.PREPARE)).toHaveLength(1);
      expect(h.calls(channels.READ)).toHaveLength(1);
      expect(h.calls(channels.RELEASE)).toHaveLength(1);
      expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([
        [channels.RELEASE_ORIGIN, { originId: 'origin-1' }],
      ]);
      expect(h.listeners.size).toBe(0);
      expect(successor.invoke).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate while the original read is pending without retiring its parent', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    const reply = hold<unknown>(refused);
    const entered = hold<WorkspaceLoadRouteRef | null>(null);
    h.controls.read = (ref) => {
      entered.resolve(ref);
      return reply.promise;
    };
    const settled = observeGitSettlement(
      prepared.read({ operation: 'pr-refresh', automatic: false }),
    );
    const ref = await entered.promise;
    if (!ref) throw new Error('Original prepared read did not enter the bridge');
    expectGitUnavailable(
      await observeGitSettlement(prepared.read({ operation: 'pr-refresh', automatic: true })),
    );
    expect(prepared.isCurrent()).toBe(true);
    expect(scope.isCurrent()).toBe(true);
    expect(scope.signal.aborted).toBe(false);
    expect(h.calls(channels.READ)).toEqual([
      [channels.READ, { ...ref, operation: 'pr-refresh', automatic: false }],
    ]);
    expect(h.calls(channels.RELEASE)).toEqual([]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
    const value = { outcome: 'linked', prNumber: 17, pullRequests: [] };
    reply.resolve(envelope({ ref, current: true, settlement: { status: 'fulfilled', value } }));
    expect(gitFulfilledValue(await settled)).toEqual(value);
    expect(prepared.isCurrent()).toBe(true);
    expect(scope.signal.aborted).toBe(false);
    expect(h.calls(channels.RELEASE)).toEqual([[channels.RELEASE, ref]]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
    scope.release();
    prepared.release();
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it('rechecks surviving origin currentness when consumed-child release reenters cancellation', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    h.controls.read = async (ref) =>
      envelope({
        ref,
        current: true,
        settlement: { status: 'fulfilled', value: { outcome: 'unchanged' } },
      });
    h.controls.release = () => h.controller.abort();
    expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
    expect(scope.isCurrent()).toBe(false);
    expect(prepared.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
    prepared.release();
    scope.release();
    expect(h.calls(channels.PREPARE)).toHaveLength(1);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });

  it('fully releases on cancellation before the original daemon rejection drains', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh();
    const reply = hold<unknown>(refused);
    const entered = hold<WorkspaceLoadRouteRef | null>(null);
    h.controls.read = (ref) => {
      entered.resolve(ref);
      return reply.promise;
    };
    const settled = observeGitSettlement(
      prepared.read({ operation: 'pr-refresh', automatic: true }),
    );
    const ref = await entered.promise;
    if (!ref) throw new Error('Original prepared read did not enter the bridge');
    h.controller.abort();
    // Full cleanup is immediate even though the original invoke has not settled.
    expect(scope.signal.aborted).toBe(true);
    expect(prepared.isCurrent()).toBe(false);
    expect(h.calls(channels.RELEASE)).toEqual([[channels.RELEASE, ref]]);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
    reply.resolve(
      envelope({
        ref,
        current: true,
        settlement: {
          status: 'rejected',
          error: {
            code: 'FORBIDDEN',
            message: 'Old membership denied',
            rpcCode: -32003,
            data: { code: 'FORBIDDEN' },
          },
        },
      }),
    );
    expectGitUnavailable(await settled);
    prepared.release();
    scope.release();
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
  });
});

describe('explicit current PR failure publication lifetime', () => {
  it('retains only the opted-in current failure parent and consumes its child exactly once', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh({ retainCurrentFailure: true });
    const error = {
      code: 'FORBIDDEN',
      message: 'member required',
      rpcCode: -32003,
      data: { code: 'FORBIDDEN' },
    };
    h.controls.read = async (ref) =>
      envelope({ ref, current: true, settlement: { status: 'rejected', error } });
    const settled = await observeGitSettlement(
      prepared.read({ operation: 'pr-refresh', automatic: true }),
    );
    expect(settled.status).toBe('rejected');
    if (settled.status !== 'rejected') throw new Error('Expected original denial');
    expect(settled.error).toMatchObject(error);
    expect(prepared.isCurrent()).toBe(true);
    expect(scope.isCurrent()).toBe(true);
    expect(scope.signal.aborted).toBe(false);
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([]);
    expect(h.listeners.size).toBe(1);
    expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(scope.isCurrent()).toBe(true);
    prepared.release();
    scope.release();
    expect(h.calls(channels.RELEASE)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });
  it.each(['abort', 'origin-notice', 'bridge'] as const)(
    'revokes retained failure publication after %s without affecting a successor',
    async (boundary) => {
      const h = bridge();
      const scope = await h.ready();
      const prepared = await scope.preparePrRefresh({ retainCurrentFailure: true });
      h.controls.read = async (ref) =>
        envelope({
          ref,
          current: true,
          settlement: { status: 'rejected', error: { code: 'FORBIDDEN', message: 'denied' } },
        });
      const settled = await observeGitSettlement(prepared.read({ operation: 'pr-refresh' }));
      expect(settled.status).toBe('rejected');
      if (settled.status !== 'rejected') throw new Error('Expected retained original denial');
      expect(settled.error).toMatchObject({ code: 'FORBIDDEN', message: 'denied' });
      expect(scope.isCurrent()).toBe(true);
      const successor = bridge();
      const next = await successor.ready();
      if (boundary === 'abort') h.controller.abort();
      else if (boundary === 'origin-notice') h.emit({ kind: 'origin', originId: 'origin-1' });
      else h.replace(successor.api);
      expect(prepared.isCurrent()).toBe(false);
      expect(scope.isCurrent()).toBe(false);
      expect(scope.signal.aborted).toBe(true);
      expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
      expect(next.isCurrent()).toBe(true);
      expect(successor.calls(channels.READ)).toEqual([]);
      expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([
        [channels.RELEASE_ORIGIN, { originId: 'origin-1' }],
      ]);
      expect(h.listeners.size).toBe(0);
    },
  );
  it('does not retain a late rejection after external retirement or touch a new same-workspace origin', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh({ retainCurrentFailure: true });
    const reply = hold<unknown>(refused);
    let captured: WorkspaceLoadRouteRef | undefined;
    h.controls.read = async (ref) => {
      captured = ref;
      return reply.promise;
    };
    const pending = observeGitSettlement(prepared.read({ operation: 'pr-refresh' }));
    const readCall = h.calls(channels.READ)[0];
    if (!readCall || !captured) throw new Error('Original read must be admitted');
    h.emit({ kind: 'origin', originId: captured.originId });
    const next = await h.ready();
    reply.resolve(
      envelope({
        ref: captured,
        current: true,
        settlement: { status: 'rejected', error: { code: 'FORBIDDEN', message: 'old denial' } },
      }),
    );
    expectGitUnavailable(await pending);
    expect(next.isCurrent()).toBe(true);
    expect(h.calls(channels.RELEASE_ORIGIN)).toEqual([
      [channels.RELEASE_ORIGIN, { originId: 'origin-1' }],
    ]);
    next.release();
    expect(h.listeners.size).toBe(0);
  });
  it('does not grant a failure publication parent when child cleanup reenters cancellation', async () => {
    const h = bridge();
    const scope = await h.ready();
    const prepared = await scope.preparePrRefresh({ retainCurrentFailure: true });
    h.controls.read = async (ref) =>
      envelope({
        ref,
        current: true,
        settlement: {
          status: 'rejected',
          error: { code: 'FORBIDDEN', message: 'denied before cleanup' },
        },
      });
    h.controls.release = () => h.controller.abort();
    expectGitUnavailable(await observeGitSettlement(prepared.read({ operation: 'pr-refresh' })));
    expect(scope.isCurrent()).toBe(false);
    expect(prepared.isCurrent()).toBe(false);
    expect(h.calls(channels.READ)).toHaveLength(1);
    expect(h.calls(channels.RELEASE_ORIGIN)).toHaveLength(1);
    expect(h.listeners.size).toBe(0);
  });
});
