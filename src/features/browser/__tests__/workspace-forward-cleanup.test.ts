/**
 * Workspace forward-ownership registry + cleanup service tests.
 *
 * Covers: ownership registration through the provider wrapper (workspace vs
 * app-lifetime), shared-port refcount semantics (a forward closes only when
 * the LAST owning workspace goes away), and archive/delete-driven cleanup via
 * the daemon `workspace:updated` / `workspace:deleted` events (own
 * `events.subscribe`, strict subscription-id match — PROTOCOL.md §6.5:
 * archive emits `changes: { archived: true, status: "Archived", ... }`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requestSpy,
  primaryClient,
  notificationHandlers,
  notificationBackendIds,
  reconnectHandlers,
  reconnectBackendIds,
} = vi.hoisted(() => {
  const request = vi.fn();
  return {
    requestSpy: request,
    primaryClient: { request },
    notificationHandlers: [] as Array<(n: unknown) => void>,
    notificationBackendIds: [] as Array<string | undefined>,
    reconnectHandlers: [] as Array<() => void>,
    reconnectBackendIds: [] as Array<string | undefined>,
  };
});

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => primaryClient,
  getLocalBackendClient: () => primaryClient,
  onBackendNotification: (handler: (n: unknown) => void, backendId?: string) => {
    notificationHandlers.push(handler);
    notificationBackendIds.push(backendId);
    return () => {};
  },
  onBackendReconnected: (handler: () => void, backendId?: string) => {
    reconnectHandlers.push(handler);
    reconnectBackendIds.push(backendId);
    return () => {};
  },
}));

import type { TunnelProvider } from '../main/loopback-url-resolver';
import {
  ForwardOwnershipRegistry,
  wrapTunnelProviderWithOwnership,
} from '../main/tunnel-forward-ownership';
import {
  ensureWorkspaceForwardCleanup,
  __resetWorkspaceForwardCleanupForTesting,
} from '../main/workspace-forward-cleanup.service';

const SUB_ID = 'sub-forward-cleanup';

function emitEvent(type: string, data: Record<string, unknown>, subscriptionId = SUB_ID): void {
  for (const handler of notificationHandlers) {
    handler({ method: 'events.event', params: { subscriptionId, event: { type, data } } });
  }
}

function emitBackendEvent(
  backendId: string,
  type: string,
  data: Record<string, unknown>,
  subscriptionId: string,
): void {
  notificationHandlers.forEach((handler, index) => {
    if (notificationBackendIds[index] === backendId) {
      handler({ method: 'events.event', params: { subscriptionId, event: { type, data } } });
    }
  });
}

/** Let fire-and-forget subscribe promises settle before emitting events. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  notificationHandlers.length = 0;
  notificationBackendIds.length = 0;
  reconnectHandlers.length = 0;
  reconnectBackendIds.length = 0;
  requestSpy.mockResolvedValue({ subscriptionId: SUB_ID });
  __resetWorkspaceForwardCleanupForTesting();
});

describe('ForwardOwnershipRegistry', () => {
  it('releases only ports whose last owner went away (refcount semantics)', () => {
    const registry = new ForwardOwnershipRegistry();
    registry.record(3000, 'ws-a');
    registry.record(3000, 'ws-b');
    registry.record(4000, 'ws-a');

    expect(registry.releaseWorkspace('ws-a')).toEqual([4000]);
    expect(registry.releaseWorkspace('ws-b')).toEqual([3000]);
  });

  it('never releases app-lifetime ports, even when shared with a workspace', () => {
    const registry = new ForwardOwnershipRegistry();
    registry.record(3000);
    registry.record(3000, 'ws-a');
    registry.record(5000);

    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
    expect(registry.releaseWorkspace('nonexistent')).toEqual([]);
  });

  it('re-recording after release re-arms ownership; clearPort drops it', () => {
    const registry = new ForwardOwnershipRegistry();
    registry.record(3000, 'ws-a');
    expect(registry.releaseWorkspace('ws-a')).toEqual([3000]);
    registry.record(3000, 'ws-a');
    registry.clearPort(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
  });
});

describe('wrapTunnelProviderWithOwnership', () => {
  function makeProvider(): TunnelProvider & { closeForward: ReturnType<typeof vi.fn> } {
    return {
      forwardPort: vi.fn(async (remotePort: number) => remotePort + 40000),
      activeForwards: vi.fn(() => [{ remotePort: 3000, localPort: 43000 }]),
      closeForward: vi.fn(() => true),
      backend: 'tunnel' as const,
    };
  }

  it('records ownership on successful forwardPort and passes the result through', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await expect(wrapped.forwardPort(3000)).resolves.toBe(43000);
    expect(provider.forwardPort).toHaveBeenCalledWith(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([3000]);
  });

  it('does not record ownership when forwardPort rejects', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    (provider.forwardPort as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await expect(wrapped.forwardPort(3000)).rejects.toThrow('boom');
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
  });

  it('records app-lifetime ownership when no workspaceId is given', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry);
    const workspaceWrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await wrapped.forwardPort(3000);
    await workspaceWrapped.forwardPort(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
  });

  it('clears ownership on explicit closeForward and passes through the seam', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await wrapped.forwardPort(3000);
    expect(wrapped.closeForward!(3000)).toBe(true);
    expect(provider.closeForward).toHaveBeenCalledWith(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
    expect(wrapped.activeForwards!()).toEqual([{ remotePort: 3000, localPort: 43000 }]);
    expect(wrapped.backend).toBe('tunnel');
  });

  it('clears ownership when the provider drops a forward internally (refused connect/OPEN)', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await wrapped.forwardPort(3000);
    // The provider drops the forward itself (e.g. refused OPEN): the wrapper
    // wired onForwardDropped to the registry, so ownership goes with it.
    provider.onForwardDropped!(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
  });

  it('a re-minted port after an internal drop starts with fresh refcounts', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    const wrappedA = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');
    const wrappedB = wrapTunnelProviderWithOwnership(provider, registry, 'ws-b');

    await wrappedA.forwardPort(3000);
    await wrappedB.forwardPort(3000);
    provider.onForwardDropped!(3000);

    // Only the re-minting workspace owns the fresh forward — the pre-drop
    // owner no longer inflates the refcount.
    await wrappedB.forwardPort(3000);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
    expect(registry.releaseWorkspace('ws-b')).toEqual([3000]);
  });

  it('clears ownership even when closeForward reports no forward (already dropped)', async () => {
    const registry = new ForwardOwnershipRegistry();
    const provider = makeProvider();
    provider.closeForward.mockReturnValue(false);
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'ws-a');

    await wrapped.forwardPort(3000);
    expect(wrapped.closeForward!(3000)).toBe(false);
    expect(registry.releaseWorkspace('ws-a')).toEqual([]);
  });

  it('keeps same-port ownership isolated when one pooled provider disconnects', async () => {
    const registry = new ForwardOwnershipRegistry();
    const providerA = makeProvider();
    const providerB = makeProvider();
    const wrappedA = wrapTunnelProviderWithOwnership(providerA, registry, 'ws-a');
    const wrappedB = wrapTunnelProviderWithOwnership(providerB, registry, 'ws-b');
    const closeForward = vi.fn((remotePort: number, provider?: TunnelProvider) => {
      provider?.closeForward?.(remotePort);
    });
    ensureWorkspaceForwardCleanup({ registry, closeForward });

    await wrappedA.forwardPort(8080);
    await wrappedB.forwardPort(8080);
    await flush();
    providerA.onForwardDropped!(8080);

    emitEvent('workspace:deleted', { workspaceId: 'ws-b' });
    expect(closeForward).toHaveBeenCalledWith(8080, providerB);
    expect(providerB.closeForward).toHaveBeenCalledWith(8080);
    expect(providerA.closeForward).not.toHaveBeenCalled();
  });
});

describe('workspace-forward-cleanup.service', () => {
  function arm(): { registry: ForwardOwnershipRegistry; closeForward: ReturnType<typeof vi.fn> } {
    const registry = new ForwardOwnershipRegistry();
    const closeForward = vi.fn();
    ensureWorkspaceForwardCleanup({ registry, closeForward });
    return { registry, closeForward };
  }

  it('subscribes once to workspace:updated + workspace:deleted', async () => {
    arm();
    ensureWorkspaceForwardCleanup({
      registry: new ForwardOwnershipRegistry(),
      closeForward: vi.fn(),
    });
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['workspace:updated', 'workspace:deleted'],
    });
    expect(notificationHandlers).toHaveLength(1);
  });

  it('closes owned forwards on workspace:deleted', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(4000, 'ws-a');
    await flush();

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).toHaveBeenCalledWith(3000);
    expect(closeForward).toHaveBeenCalledWith(4000);
  });

  it('closes owned forwards on an archive transition (changes.archived / changes.status)', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(4000, 'ws-b');
    await flush();

    emitEvent('workspace:updated', {
      workspaceId: 'ws-a',
      changes: { archived: true, status: 'Archived', archivedAt: '2026-08-16T00:00:00Z' },
    });
    expect(closeForward).toHaveBeenCalledTimes(1);
    expect(closeForward).toHaveBeenCalledWith(3000);

    emitEvent('workspace:updated', { workspaceId: 'ws-b', changes: { status: 'Archived' } });
    expect(closeForward).toHaveBeenCalledWith(4000);
  });

  it('ignores non-archive workspace:updated deltas', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();

    emitEvent('workspace:updated', { workspaceId: 'ws-a', changes: { title: 'Renamed' } });
    emitEvent('workspace:updated', {
      workspaceId: 'ws-a',
      changes: { archived: false, status: 'Active', archivedAt: null },
    });
    expect(closeForward).not.toHaveBeenCalled();
  });

  it('keeps a shared forward open until the LAST owning workspace goes away', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(3000, 'ws-b');
    await flush();

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).not.toHaveBeenCalled();

    emitEvent('workspace:deleted', { workspaceId: 'ws-b' });
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('never closes app-lifetime forwards on workspace cleanup', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000);
    registry.record(3000, 'ws-a');
    await flush();

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).not.toHaveBeenCalled();
  });

  it('ignores events from other subscriptions (strict subscription-id match)', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' }, 'someone-elses-sub');
    expect(closeForward).not.toHaveBeenCalled();
  });

  it('survives closeForward throwing and still processes remaining ports', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(4000, 'ws-a');
    closeForward.mockImplementationOnce(() => {
      throw new Error('provider gone');
    });
    await flush();

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).toHaveBeenCalledTimes(2);
  });

  /** events.subscribe calls only — reconciliation adds workspace.list calls. */
  function subscribeCallCount(): number {
    return requestSpy.mock.calls.filter(([method]) => method === 'events.subscribe').length;
  }

  it('re-subscribes on backend reconnect and drops the stale subscription id', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    expect(subscribeCallCount()).toBe(1);

    requestSpy.mockResolvedValue({ subscriptionId: 'sub-fresh' });
    for (const handler of reconnectHandlers) handler();
    await flush();
    expect(subscribeCallCount()).toBe(2);

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' }, SUB_ID);
    expect(closeForward).not.toHaveBeenCalled();
    emitEvent('workspace:deleted', { workspaceId: 'ws-a' }, 'sub-fresh');
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('retries a failed subscribe on the next ensure call', async () => {
    requestSpy.mockRejectedValueOnce(new Error('daemon down'));
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    expect(subscribeCallCount()).toBe(1);

    ensureWorkspaceForwardCleanup({ registry, closeForward });
    await flush();
    expect(subscribeCallCount()).toBe(2);

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).toHaveBeenCalledWith(3000);
  });
});

describe('reconnect reconciliation (#2646)', () => {
  /**
   * Route requests per method: `events.subscribe` always succeeds;
   * `workspace.list` serves the given rows (or a rejection).
   */
  function mockBackend(workspaces: unknown[] | Error): void {
    requestSpy.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
      if (method === 'workspace.list') {
        if (workspaces instanceof Error) throw workspaces;
        return { workspaces };
      }
      return {};
    });
  }

  function arm(): { registry: ForwardOwnershipRegistry; closeForward: ReturnType<typeof vi.fn> } {
    const registry = new ForwardOwnershipRegistry();
    const closeForward = vi.fn();
    ensureWorkspaceForwardCleanup({ registry, closeForward });
    return { registry, closeForward };
  }

  function reconnect(): void {
    for (const handler of reconnectHandlers) handler();
  }

  function workspaceListCalls(): unknown[][] {
    return requestSpy.mock.calls.filter(([method]) => method === 'workspace.list');
  }

  it('closes forwards whose owner was archived while disconnected (lost-event gap)', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();

    // The archive event fired during the outage — no workspace:updated was
    // ever delivered. Reconnect must reconcile against the daemon's state.
    mockBackend([{ id: 'ws-a', archived: true, status: 'Archived' }]);
    reconnect();
    await flush();

    expect(closeForward).toHaveBeenCalledWith(3000);
    expect(workspaceListCalls().at(-1)).toEqual(['workspace.list', { includeArchived: true }]);
  });

  it('closes forwards whose owner was deleted while disconnected (absent from workspace.list)', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();

    mockBackend([{ id: 'ws-other', archived: false, status: 'Active' }]);
    reconnect();
    await flush();

    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('mops up a forward recorded after the archive event (record-after-archive race)', async () => {
    mockBackend([{ id: 'ws-a', archived: true, status: 'Archived' }]);
    const { registry, closeForward } = arm();
    await flush();

    // The archive event arrives while forwardPort() is still in flight: the
    // registry holds nothing yet, so the event-driven cleanup is a no-op...
    emitEvent('workspace:updated', {
      workspaceId: 'ws-a',
      changes: { archived: true, status: 'Archived' },
    });
    expect(closeForward).not.toHaveBeenCalled();

    // ...then the late record() re-adds ownership for the archived workspace.
    // The record itself triggers a reconciliation pass — no reconnect or
    // later event is needed for the sweep.
    registry.record(3000, 'ws-a');
    await flush();
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('keeps forwards owned by active workspaces and app-lifetime forwards open', async () => {
    mockBackend([
      { id: 'ws-a', archived: false, status: 'Active' },
      { id: 'ws-b', archived: false, status: 'Active' },
    ]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(4000);
    registry.record(5000, 'ws-b');
    await flush();
    closeForward.mockClear();

    mockBackend([
      { id: 'ws-a', archived: false, status: 'Active' },
      { id: 'ws-b', archived: true, status: 'Archived' },
    ]);
    reconnect();
    await flush();

    expect(closeForward).toHaveBeenCalledTimes(1);
    expect(closeForward).toHaveBeenCalledWith(5000);
  });

  it('keeps a shared port until reconciliation finds every owner archived/deleted', async () => {
    mockBackend([
      { id: 'ws-a', archived: false, status: 'Active' },
      { id: 'ws-b', archived: false, status: 'Active' },
    ]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    registry.record(3000, 'ws-b');
    await flush();
    closeForward.mockClear();

    mockBackend([
      { id: 'ws-a', archived: true, status: 'Archived' },
      { id: 'ws-b', archived: false, status: 'Active' },
    ]);
    reconnect();
    await flush();
    expect(closeForward).not.toHaveBeenCalled();

    mockBackend([{ id: 'ws-b', archived: true, status: 'Archived' }]);
    reconnect();
    await flush();
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('skips the workspace.list RPC when no forward is workspace-owned', async () => {
    mockBackend([]);
    const { registry } = arm();
    registry.record(4000); // app-lifetime only
    await flush();

    reconnect();
    await flush();
    expect(workspaceListCalls()).toHaveLength(0);
  });

  it('tolerates a failed workspace.list and reconciles on the next reconnect', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();

    mockBackend(new Error('daemon down'));
    reconnect();
    await flush();
    expect(closeForward).not.toHaveBeenCalled();

    mockBackend([{ id: 'ws-a', archived: true, status: 'Archived' }]);
    reconnect();
    await flush();
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('retries a failed reconciliation on the next ensure call while still subscribed', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();

    // A pass fails while the subscription is already up (record-triggered):
    // no reconnect follows, so the retry has to ride the next ensure call —
    // subscribeToWorkspaceEvents early-returns on an active subscription.
    mockBackend(new Error('daemon down'));
    registry.record(5000, 'ws-b');
    await flush();
    expect(closeForward).not.toHaveBeenCalled();

    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    ensureWorkspaceForwardCleanup({ registry, closeForward });
    await flush();
    expect(closeForward).toHaveBeenCalledWith(5000); // ws-b absent → deleted
  });

  it('never treats a malformed workspace.list response as everything-deleted', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();

    requestSpy.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
      return {}; // workspace.list → no `workspaces` array
    });
    reconnect();
    await flush();
    expect(closeForward).not.toHaveBeenCalled();

    // An array carrying a malformed row (no string id) is equally suspect:
    // aborting must win over classifying every owner as deleted.
    mockBackend([{}]);
    reconnect();
    await flush();
    expect(closeForward).not.toHaveBeenCalled();
  });

  it('reconciles after the initial subscribe too (events fired before subscribe resolved)', async () => {
    mockBackend([{ id: 'ws-a', archived: true, status: 'Archived' }]);
    const registry = new ForwardOwnershipRegistry();
    const closeForward = vi.fn();
    registry.record(3000, 'ws-a');
    ensureWorkspaceForwardCleanup({ registry, closeForward });
    await flush();

    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  /** Deferred workspace.list: subscribe resolves immediately, list is held. */
  function mockBackendDeferred(): Array<(response: unknown) => void> {
    const resolvers: Array<(response: unknown) => void> = [];
    requestSpy.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
      return new Promise((resolve) => resolvers.push(resolve));
    });
    return resolvers;
  }

  it('coalesces triggers during an in-flight pass into one trailing workspace.list', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();
    requestSpy.mockClear();
    const resolvers = mockBackendDeferred();

    reconnect();
    await flush();
    expect(workspaceListCalls()).toHaveLength(1); // pass in flight

    // Three more triggers land while the list is in flight...
    reconnect();
    reconnect();
    reconnect();
    await flush();
    expect(workspaceListCalls()).toHaveLength(1); // ...none starts a pass

    resolvers[0]!({ workspaces: [{ id: 'ws-a', archived: false, status: 'Active' }] });
    await flush();
    // Exactly one trailing pass, not three.
    expect(workspaceListCalls()).toHaveLength(2);

    resolvers[1]!({ workspaces: [{ id: 'ws-a', archived: true, status: 'Archived' }] });
    await flush();
    expect(closeForward).toHaveBeenCalledWith(3000);
  });

  it('drops a stale workspace.list response that raced a reconnect', async () => {
    mockBackend([{ id: 'ws-a', archived: false, status: 'Active' }]);
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    closeForward.mockClear();
    const resolvers = mockBackendDeferred();

    reconnect();
    await flush(); // pass 1's workspace.list in flight
    reconnect(); // bumps the epoch; queues the trailing pass

    // The stale pre-reconnect response claims everything is archived — it
    // must be dropped, not applied against the new connection.
    resolvers[0]!({ workspaces: [{ id: 'ws-a', archived: true, status: 'Archived' }] });
    await flush();
    expect(closeForward).not.toHaveBeenCalled();

    // The trailing (current-epoch) pass sees the live state and keeps it.
    resolvers[1]!({ workspaces: [{ id: 'ws-a', archived: false, status: 'Active' }] });
    await flush();
    expect(closeForward).not.toHaveBeenCalled();
  });

  it('reconciles and subscribes a background remote against its originating client', async () => {
    requestSpy.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-local' };
      return { workspaces: [] };
    });
    const remoteRequest = vi.fn(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-remote-a' };
      return { workspaces: [{ id: 'remote-ws', archived: false, status: 'Active' }] };
    });
    const remoteClient = { request: remoteRequest };
    const provider: TunnelProvider = {
      forwardPort: vi.fn(async () => 48080),
      closeForward: vi.fn(() => true),
      backend: 'tunnel',
    };
    const registry = new ForwardOwnershipRegistry();
    const closeForward = vi.fn();
    const wrapped = wrapTunnelProviderWithOwnership(provider, registry, 'remote-ws');

    ensureWorkspaceForwardCleanup({
      registry,
      closeForward,
      client: remoteClient as never,
      backendId: 'remote-a',
      provider,
    });
    await wrapped.forwardPort(8080);
    await flush();

    expect(remoteRequest).toHaveBeenCalledWith('workspace.list', { includeArchived: true });
    expect(requestSpy).not.toHaveBeenCalledWith('workspace.list', expect.anything());
    expect(notificationBackendIds).toContain('remote-a');
    expect(reconnectBackendIds).toContain('remote-a');
    expect(closeForward).not.toHaveBeenCalled();

    emitBackendEvent('remote-a', 'workspace:deleted', { workspaceId: 'remote-ws' }, 'sub-remote-a');
    expect(closeForward).toHaveBeenCalledWith(8080, provider);
  });
});
