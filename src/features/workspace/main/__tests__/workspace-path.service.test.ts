/**
 * Workspace Path Service tests (monorepo#1759).
 *
 * The seam resolves a workspace's checkout dir ONLY from daemon-reported data
 * (`workspace.get`, PROTOCOL.md §5.1): daemon path returned; virtual → null;
 * unknown → null; remote backend / remote workspace → null; cache hit skips
 * the second RPC; workspace:updated / workspace:deleted invalidate the cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requestSpy,
  compatibilityRequestSpy,
  backendState,
  notificationHandlers,
  reconnectHandlers,
} = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  compatibilityRequestSpy: vi.fn(),
  backendState: { primaryId: 'local' },
  notificationHandlers: [] as Array<(n: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: compatibilityRequestSpy }),
  getBackendClientForConnection: (id: string) =>
    id === 'local' ? { request: requestSpy } : undefined,
  getPrimaryBackendId: () => backendState.primaryId,
  onBackendNotification: (handler: (n: unknown) => void) => {
    notificationHandlers.push(handler);
    return () => {};
  },
  onBackendReconnected: (handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => {};
  },
}));

import {
  getWorkspacePath,
  getWorkspacePathInfo,
  __resetWorkspacePathServiceForTesting,
} from '../workspace-path.service';
import { CHIEF_WORKSPACE_ID } from '../../../../shared/types/branded-ids';

const SUB_ID = 'sub-workspace-events';

function mockDaemon(workspaces: Record<string, object | undefined>): void {
  requestSpy.mockImplementation(async (method: string, params?: { workspaceId?: string }) => {
    if (method === 'events.subscribe') return { subscriptionId: SUB_ID };
    if (method === 'workspace.get') {
      const ws = workspaces[params?.workspaceId ?? ''];
      if (!ws) throw new Error(`Workspace not found: ${params?.workspaceId}`);
      return { workspace: ws };
    }
    throw new Error(`unexpected method ${method}`);
  });
}

function emitWorkspaceEvent(type: string, workspaceId: string, subscriptionId = SUB_ID): void {
  for (const handler of notificationHandlers) {
    handler({
      method: 'events.event',
      params: { subscriptionId, event: { type, data: { workspaceId } } },
    });
  }
}

function getCallCount(): number {
  return requestSpy.mock.calls.filter(([method]) => method === 'workspace.get').length;
}

/** Let fire-and-forget subscribe promises settle before emitting events. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  backendState.primaryId = 'local';
  notificationHandlers.length = 0;
  reconnectHandlers.length = 0;
  __resetWorkspacePathServiceForTesting();
});

describe('workspace-path.service', () => {
  it('returns the daemon-reported path (worktreePath precedence) and scope', async () => {
    mockDaemon({
      'ws-1': { worktreePath: '/checkouts/ws-1/repo', repositoryPath: '/repos/main', scope: 'pkg' },
    });
    expect(await getWorkspacePathInfo('ws-1')).toEqual({
      path: '/checkouts/ws-1/repo',
      scope: 'pkg',
    });
  });

  it('falls back repositoryPath → path when worktreePath is absent', async () => {
    mockDaemon({
      'ws-repo': { repositoryPath: '/repos/main' },
      'ws-path': { path: '/somewhere/checkout' },
    });
    expect(await getWorkspacePath('ws-repo')).toBe('/repos/main');
    expect(await getWorkspacePath('ws-path')).toBe('/somewhere/checkout');
  });

  it('returns null for virtual workspaces without any RPC', async () => {
    mockDaemon({});
    expect(await getWorkspacePath('background-request')).toBeNull();
    expect(await getWorkspacePath('http-bridge-workspace')).toBeNull();
    expect(await getWorkspacePath(CHIEF_WORKSPACE_ID)).toBeNull();
    expect(getCallCount()).toBe(0);
  });

  it('returns null for unknown workspaces (daemon not-found error)', async () => {
    mockDaemon({});
    expect(await getWorkspacePath('nope')).toBeNull();
  });

  it('uses the local pooled client when the compatibility client is remote', async () => {
    backendState.primaryId = 'remote-1';
    compatibilityRequestSpy.mockRejectedValue(new Error('remote compatibility client used'));
    mockDaemon({ 'ws-local': { worktreePath: '/local/checkouts/ws-local' } });

    expect(await getWorkspacePath('ws-local', 'local')).toBe('/local/checkouts/ws-local');
    expect(requestSpy).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-local' });
    expect(compatibilityRequestSpy).not.toHaveBeenCalled();
  });

  it('does not start a local path subscription for a remote-bound window', async () => {
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/ws-1' } });
    expect(await getWorkspacePath('ws-1', 'remote-1')).toBeNull();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(notificationHandlers).toHaveLength(0);
    expect(reconnectHandlers).toHaveLength(0);
  });

  it('returns null for remote workspaces (isRemote / environmentConfig)', async () => {
    mockDaemon({
      'ws-ssh': { isRemote: true, worktreePath: '/remote/checkout' },
      'ws-env': { environmentConfig: { type: 'remote' }, worktreePath: '/remote/checkout' },
    });
    expect(await getWorkspacePath('ws-ssh')).toBeNull();
    expect(await getWorkspacePath('ws-env')).toBeNull();
  });

  it('caches resolved paths and invalidates on workspace:updated', async () => {
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/a' } });
    expect(await getWorkspacePath('ws-1')).toBe('/checkouts/a');
    expect(await getWorkspacePath('ws-1')).toBe('/checkouts/a');
    expect(getCallCount()).toBe(1);

    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/b' } });
    emitWorkspaceEvent('workspace:updated', 'ws-1');
    expect(await getWorkspacePath('ws-1')).toBe('/checkouts/b');
  });

  it('invalidates on workspace:deleted and ignores foreign subscription ids', async () => {
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/a' } });
    await getWorkspacePath('ws-1');

    emitWorkspaceEvent('workspace:updated', 'ws-1', 'someone-elses-subscription');
    await getWorkspacePath('ws-1');
    expect(getCallCount()).toBe(1);

    emitWorkspaceEvent('workspace:deleted', 'ws-1');
    mockDaemon({});
    expect(await getWorkspacePath('ws-1')).toBeNull();
  });

  it('does not cache null results and clears the cache on reconnect', async () => {
    mockDaemon({});
    expect(await getWorkspacePath('ws-late')).toBeNull();
    mockDaemon({ 'ws-late': { worktreePath: '/checkouts/late' } });
    expect(await getWorkspacePath('ws-late')).toBe('/checkouts/late');

    mockDaemon({ 'ws-late': { worktreePath: '/other-backend/late' } });
    for (const handler of reconnectHandlers) handler();
    expect(await getWorkspacePath('ws-late')).toBe('/other-backend/late');
  });

  it('retries a failed initial events.subscribe on the next lookup', async () => {
    let subscribeAttempt = 0;
    requestSpy.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') {
        subscribeAttempt += 1;
        if (subscribeAttempt === 1) throw new Error('transient subscribe failure');
        return { subscriptionId: SUB_ID };
      }
      return { workspace: { worktreePath: '/checkouts/a' } };
    });

    await getWorkspacePath('ws-1');
    await flush();
    expect(subscribeAttempt).toBe(1);
    // While the subscription is down, events are ignored (no invalidation)…
    emitWorkspaceEvent('workspace:updated', 'ws-1');
    // …but the next lookup retries the subscription (cache hit, no RPC).
    await getWorkspacePath('ws-1');
    await flush();
    expect(subscribeAttempt).toBe(2);
    expect(getCallCount()).toBe(1);
    // Now live: events invalidate again.
    emitWorkspaceEvent('workspace:updated', 'ws-1');
    await getWorkspacePath('ws-1');
    expect(getCallCount()).toBe(2);
    // Once live, no further subscribe attempts are made.
    await getWorkspacePath('ws-1');
    await flush();
    expect(subscribeAttempt).toBe(2);
  });

  it('ignores a stale pre-reconnect events.subscribe result', async () => {
    let resolveStale: ((v: { subscriptionId: string }) => void) | undefined;
    let subscribeAttempt = 0;
    requestSpy.mockImplementation((method: string) => {
      if (method === 'events.subscribe') {
        subscribeAttempt += 1;
        if (subscribeAttempt === 1) {
          return new Promise((resolve) => {
            resolveStale = resolve;
          });
        }
        return Promise.resolve({ subscriptionId: SUB_ID });
      }
      return Promise.resolve({ workspace: { worktreePath: '/checkouts/a' } });
    });

    // First lookup starts the (hanging) pre-reconnect subscribe.
    await getWorkspacePath('ws-1');
    // Reconnect issues the replacement subscription (SUB_ID)…
    for (const handler of reconnectHandlers) handler();
    await flush();
    // …then the stale pre-reconnect response resolves late.
    resolveStale?.({ subscriptionId: 'stale-old-connection-sub' });
    await flush();

    // Events on the CURRENT subscription must still invalidate the cache.
    await getWorkspacePath('ws-1');
    emitWorkspaceEvent('workspace:updated', 'ws-1');
    await getWorkspacePath('ws-1');
    expect(getCallCount()).toBe(3);
  });

  it('deduplicates concurrent lookups for the same workspace (single-flight)', async () => {
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/a' } });
    const results = await Promise.all([
      getWorkspacePath('ws-1'),
      getWorkspacePath('ws-1'),
      getWorkspacePath('ws-1'),
    ]);
    expect(results).toEqual(['/checkouts/a', '/checkouts/a', '/checkouts/a']);
    expect(getCallCount()).toBe(1);
  });

  it('does not cache a workspace.get response that raced an invalidation', async () => {
    let resolveGet: ((v: unknown) => void) | undefined;
    requestSpy.mockImplementation((method: string) => {
      if (method === 'events.subscribe') return Promise.resolve({ subscriptionId: SUB_ID });
      return new Promise((resolve) => {
        resolveGet = resolve;
      });
    });

    const lookup = getWorkspacePath('ws-1');
    await flush();
    // Invalidation arrives while workspace.get is in flight…
    emitWorkspaceEvent('workspace:updated', 'ws-1');
    // …then the (possibly pre-update) response resolves.
    resolveGet?.({ workspace: { worktreePath: '/checkouts/stale' } });
    expect(await lookup).toBe('/checkouts/stale');

    // The stale value must not have been cached: the next lookup re-fetches.
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/fresh' } });
    expect(await getWorkspacePath('ws-1')).toBe('/checkouts/fresh');
  });
});
