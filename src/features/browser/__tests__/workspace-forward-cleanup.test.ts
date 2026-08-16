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

const { requestSpy, notificationHandlers, reconnectHandlers } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  notificationHandlers: [] as Array<(n: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
}));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestSpy }),
  onBackendNotification: (handler: (n: unknown) => void) => {
    notificationHandlers.push(handler);
    return () => {};
  },
  onBackendReconnected: (handler: () => void) => {
    reconnectHandlers.push(handler);
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

/** Let fire-and-forget subscribe promises settle before emitting events. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  notificationHandlers.length = 0;
  reconnectHandlers.length = 0;
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
    const wrapped = wrapTunnelProviderWithOwnership(makeProvider(), registry);

    await wrapped.forwardPort(3000);
    registry.record(3000, 'ws-a');
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

  it('re-subscribes on backend reconnect and drops the stale subscription id', async () => {
    const { registry, closeForward } = arm();
    registry.record(3000, 'ws-a');
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(1);

    requestSpy.mockResolvedValue({ subscriptionId: 'sub-fresh' });
    for (const handler of reconnectHandlers) handler();
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(2);

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
    expect(requestSpy).toHaveBeenCalledTimes(1);

    ensureWorkspaceForwardCleanup({ registry, closeForward });
    await flush();
    expect(requestSpy).toHaveBeenCalledTimes(2);

    emitEvent('workspace:deleted', { workspaceId: 'ws-a' });
    expect(closeForward).toHaveBeenCalledWith(3000);
  });
});
