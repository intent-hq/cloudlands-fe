/**
 * Workspace Path Service tests (monorepo#1759).
 *
 * The seam resolves a workspace's checkout dir ONLY from daemon-reported data
 * (`workspace.get`, PROTOCOL.md §5.1): daemon path returned; virtual → null;
 * unknown → null; remote backend / remote workspace → null; cache hit skips
 * the second RPC; workspace:updated / workspace:deleted invalidate the cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestSpy, notificationHandlers, reconnectHandlers, remoteActive } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  notificationHandlers: [] as Array<(n: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
  remoteActive: { value: false },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestSpy }),
  isRemoteBackendActive: () => remoteActive.value,
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

beforeEach(() => {
  vi.clearAllMocks();
  notificationHandlers.length = 0;
  reconnectHandlers.length = 0;
  remoteActive.value = false;
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

  it('returns null when a remote backend is active, without any RPC', async () => {
    remoteActive.value = true;
    mockDaemon({ 'ws-1': { worktreePath: '/checkouts/ws-1' } });
    expect(await getWorkspacePath('ws-1')).toBeNull();
    expect(getCallCount()).toBe(0);
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
});
