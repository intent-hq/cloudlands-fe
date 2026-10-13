import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonRpcClient, RepositoryConnectionEvent } from '../json-rpc-client';
const mock = vi.hoisted(() => ({
  client: undefined as unknown,
  notifications: new Set<(n: unknown) => void>(),
  reconnects: new Set<() => void>(),
  statuses: new Set<(s: string) => void>(),
}));
vi.mock('../backend.ipc', () => ({
  getLocalBackendClient: () => mock.client,
  getBackendClientForConnection: () => mock.client,
  onBackendNotification: (fn: (n: unknown) => void) => {
    mock.notifications.add(fn);
    return () => mock.notifications.delete(fn);
  },
  onBackendReconnected: (fn: () => void) => {
    mock.reconnects.add(fn);
    return () => mock.reconnects.delete(fn);
  },
  onBackendStatus: (fn: (s: string) => void) => {
    mock.statuses.add(fn);
    return () => mock.statuses.delete(fn);
  },
}));
import * as settings from '../../../workspace/main/app-settings.service';
import * as paths from '../../../workspace/main/workspace-path.service';
import {
  ensureWorkspaceForwardCleanup,
  resetWorkspaceForwardCleanup,
} from '../../../browser/main/workspace-forward-cleanup.service';
import { ForwardOwnershipRegistry } from '../../../browser/main/tunnel-forward-ownership';
function daemon(supported = true, connected = true) {
  let connection: { incarnation: object; eventStreamRecovery: boolean } | null = connected
    ? { incarnation: {}, eventStreamRecovery: supported }
    : null;
  const feed = new Set<(event: RepositoryConnectionEvent) => void>();
  const values: Record<string, string> = {
    'workspace.branchPrefix': 'old/',
    'workspace.worktreesLocation': '/old',
    'workspace.sshKeyPath': '/old-key',
  };
  let workspacePath = '/old';
  let workspaces: Array<{ id: string; archived?: boolean }> = [{ id: 'w' }];
  const request = vi.fn(
    async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      if (method === 'events.subscribe')
        return {
          subscriptionId: 'own',
          ...(params?.lossRecovery === 1 ? { lossRecovery: 1 } : {}),
        };
      if (method === 'events.unsubscribe') return {};
      if (method === 'events.fence') return params;
      if (method === 'settings.get') return { value: values[String(params?.path)] };
      if (method === 'workspace.get') return { workspace: { id: 'w', path: workspacePath } };
      if (method === 'workspace.list') return { workspaces };
      throw new Error(method);
    },
  );
  const client = {
    request,
    getRepositoryConnection: () => connection,
    onRepositoryConnectionEvent: (fn: (event: RepositoryConnectionEvent) => void) => {
      feed.add(fn);
      return () => feed.delete(fn);
    },
    requestOnCapturedConnection: async (
      captured: object,
      method: string,
      params?: Record<string, unknown>,
      options?: { observe?: (r: unknown) => void },
    ) => {
      if (captured !== connection) throw new Error('retired');
      const result = await request(method, params);
      options?.observe?.(result);
      return result;
    },
  } as unknown as JsonRpcClient;
  mock.client = client;
  const emit = (method: string, params: unknown) => {
    const notification = { method, params };
    if (connection)
      for (const fn of [...feed])
        fn({ type: 'notification', incarnation: connection.incarnation, notification });
    for (const fn of mock.notifications) fn(notification);
  };
  return {
    client,
    values,
    request,
    feed,
    connect: (reconnect = false) => {
      connection = { incarnation: {}, eventStreamRecovery: supported };
      for (const fn of mock.statuses) fn('connected');
      if (reconnect) for (const fn of mock.reconnects) fn();
    },
    setPath: (value: string) => {
      workspacePath = value;
    },
    setWorkspaces: (value: typeof workspaces) => {
      workspaces = value;
    },
    loss: (generation = '1', subscriptionId = 'own') =>
      emit('events.lost', { subscriptionId, generation, scope: { workspaceId: null } }),
    push: (type: string, data: unknown) =>
      emit('events.event', { subscriptionId: 'own', event: { type, workspaceId: null, data } }),
    retire: () => {
      const old = connection!;
      connection = null;
      for (const fn of [...feed]) fn({ type: 'identity-retired', connection: old as never });
    },
  };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
function calls(d: ReturnType<typeof daemon>, method: string) {
  return d.request.mock.calls.filter((c) => c[0] === method);
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.notifications.clear();
  mock.reconnects.clear();
  mock.statuses.clear();
});
afterEach(() => {
  settings.__resetAppSettingsForTesting();
  paths.__resetWorkspacePathServiceForTesting();
  resetWorkspaceForwardCleanup();
  vi.useRealTimers();
});
describe('main-process generic loss recovery', () => {
  it('explicit incomplete hydration must join an active loss recovery', async () => {
    const d = daemon();
    const original = d.request.getMockImplementation();
    d.request.mockImplementation((method, params) =>
      method === 'settings.get' && params?.path === 'workspace.branchPrefix'
        ? Promise.reject(new Error('temporary startup failure'))
        : (original?.(method, params) ?? Promise.resolve()),
    );
    await settings.initAppSettingsService();
    await flush();
    const held: Array<(value: unknown) => void> = [];
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? new Promise((resolve) => held.push(resolve))
        : (original?.(method, params) ?? Promise.resolve()),
    );
    d.loss();
    await flush();
    expect(held).toHaveLength(3);
    await settings.initAppSettingsService();
    await flush();
    expect(
      held,
      'ordinary missing-path hydration must not overlap the active recovery',
    ).toHaveLength(3);
    for (const resolve of held) resolve({ value: '/fresh' });
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(held).toHaveLength(3);
    expect(settings.getBranchPrefix()).toBe('/fresh');
  });
  it('settings resume after replacement identity without a socket reconnect', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    d.retire();
    d.values['workspace.branchPrefix'] = 'renewed/';
    d.connect(false);
    await settings.initAppSettingsService();
    await flush();
    expect(settings.getBranchPrefix()).toBe('renewed/');
  });

  it('transient partial settings failure must not overlap held path reads', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const original = d.request.getMockImplementation();
    let branchReads = 0;
    let active = 0;
    let peakActive = 0;
    const held: Array<(value: unknown) => void> = [];
    d.request.mockImplementation((method, params) => {
      if (method !== 'settings.get') return original?.(method, params) ?? Promise.resolve();
      if (params?.path === 'workspace.branchPrefix') {
        branchReads++;
        return branchReads === 1
          ? Promise.reject(new Error('temporary'))
          : Promise.resolve({ value: 'current/' });
      }
      active++;
      peakActive = Math.max(peakActive, active);
      return new Promise((resolve) =>
        held.push((value) => {
          active--;
          resolve(value);
        }),
      );
    });
    d.loss();
    await flush();
    expect(held).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      held,
      'a retry must not start another worktree/SSH read before the first settles',
    ).toHaveLength(2);
    for (const resolve of held.splice(0)) resolve({ value: '/fresh' });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(branchReads).toBe(2);
    expect(active).toBe(2);
    expect(peakActive).toBe(2);
    for (const resolve of held.splice(0)) resolve({ value: '/fresh' });
    await flush();
    expect(active).toBe(0);
    expect(settings.getBranchPrefix()).toBe('current/');
  });

  it('preserves authority retirement when a sibling settings read also fails transiently', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const original = d.request.getMockImplementation();
    d.request.mockImplementation((method, params) => {
      if (method !== 'settings.get') return original?.(method, params) ?? Promise.resolve();
      return Promise.reject(
        params?.path === 'workspace.sshKeyPath'
          ? Object.assign(new Error('forbidden'), { rpcCode: -32003 })
          : new Error('temporary'),
      );
    });
    d.loss();
    await flush();
    expect(settings.getBranchPrefix()).toBe('');
    expect(settings.getWorktreesLocation()).toBe('');
    expect(settings.getSshKeyPath()).toBe('');
    const reads = calls(d, 'settings.get').length;
    await vi.advanceTimersByTimeAsync(6000);
    await settings.initAppSettingsService();
    await flush();
    expect(calls(d, 'settings.get')).toHaveLength(reads);
  });

  it('recovers final lost settings with one fenced read per path and rejects delayed unversioned pushes', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    expect(settings.getBranchPrefix()).toBe('old/');
    d.values['workspace.branchPrefix'] = 'new/';
    d.loss();
    d.loss();
    d.loss('9', 'foreign');
    await flush();
    expect(settings.getBranchPrefix()).toBe('new/');
    expect(calls(d, 'settings.get')).toHaveLength(6);
    expect(calls(d, 'events.fence')).toHaveLength(2);
    d.push('settings:changed', {
      changes: [{ path: 'workspace.branchPrefix', value: 'late-old/' }],
    });
    expect(settings.getBranchPrefix()).not.toBe('late-old/');
    await vi.advanceTimersByTimeAsync(250);
    expect(settings.getBranchPrefix()).toBe('new/');
  });
  it('clears settings synchronously on identity retirement and discards a held hydration', async () => {
    const d = daemon();
    let resolve!: (value: unknown) => void;
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? new Promise((r) => {
            resolve = r;
          })
        : original(method, params),
    );
    await settings.initAppSettingsService();
    await flush();
    d.retire();
    resolve({ value: 'retired' });
    await flush();
    expect(settings.getSshKeyPath()).toBe('');
  });
  it('lazily invalidates all cached paths after own loss without scanning workspaces', async () => {
    const d = daemon();
    expect(await paths.getWorkspacePath('w')).toBe('/old');
    await flush();
    d.setPath('/new');
    d.loss();
    d.loss();
    await flush();
    expect(calls(d, 'workspace.get')).toHaveLength(1);
    expect(await paths.getWorkspacePath('w')).toBe('/new');
    expect(calls(d, 'workspace.get')).toHaveLength(2);
    expect(calls(d, 'workspace.list')).toHaveLength(0);
  });
  it('does not return a held path from retired authority', async () => {
    const d = daemon();
    let resolve!: (value: unknown) => void;
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'workspace.get'
        ? new Promise((r) => {
            resolve = r;
          })
        : original(method, params),
    );
    const pending = paths.getWorkspacePath('w');
    await flush();
    d.retire();
    resolve({ workspace: { path: '/secret' } });
    expect(await pending).toBeNull();
  });
  it('closes only retired workspace-owned forwards after a lost deletion', async () => {
    const d = daemon();
    const registry = new ForwardOwnershipRegistry();
    const closeForward = vi.fn();
    registry.record(3000, 'w');
    registry.record(4000);
    ensureWorkspaceForwardCleanup({ client: d.client, registry, closeForward });
    await flush();
    d.setWorkspaces([]);
    d.loss();
    d.loss();
    await flush();
    expect(closeForward.mock.calls).toEqual([[3000]]);
    expect(calls(d, 'workspace.list')).toHaveLength(2);
    expect(calls(d, 'events.fence')).toHaveLength(2);
    expect(registry.releaseWorkspace('w')).toEqual([]);
  });
  it('does not overlap recovery reads with held initial settings hydration', async () => {
    const d = daemon();
    const replies: Array<(value: unknown) => void> = [];
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? new Promise((r) => {
            replies.push(r);
          })
        : original(method, params),
    );
    await settings.initAppSettingsService();
    await flush();
    expect(calls(d, 'settings.get')).toHaveLength(3);
    d.loss();
    await flush();
    expect(calls(d, 'settings.get')).toHaveLength(3);
    d.request.mockImplementation(original);
    for (const resolve of replies) resolve({ value: 'obsolete' });
    await flush();
    expect(settings.getBranchPrefix()).toBe('old/');
    expect(calls(d, 'settings.get')).toHaveLength(6);
  });
  it('coalesces a marker burst during a read into exactly one trailing settings snapshot', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const replies: Array<(value: unknown) => void> = [];
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? new Promise((r) => {
            replies.push(r);
          })
        : original(method, params),
    );
    d.loss();
    await flush();
    expect(replies).toHaveLength(3);
    for (let generation = 2; generation <= 12; generation++) d.loss(String(generation));
    await flush();
    expect(replies).toHaveLength(3);
    d.request.mockImplementation(original);
    d.values['workspace.branchPrefix'] = 'latest/';
    for (const resolve of replies) resolve({ value: 'stale' });
    await flush();
    expect(settings.getBranchPrefix()).toBe('old/');
    await vi.advanceTimersByTimeAsync(250);
    expect(settings.getBranchPrefix()).toBe('latest/');
    expect(calls(d, 'settings.get')).toHaveLength(9);
    expect(calls(d, 'events.fence')).toHaveLength(4);
  });
  it('does not overlap tunnel recovery with an ordinary held reconciliation', async () => {
    const d = daemon();
    const registry = new ForwardOwnershipRegistry();
    registry.record(3000, 'w');
    const closeForward = vi.fn();
    let resolve!: (value: unknown) => void;
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'workspace.list'
        ? new Promise((r) => {
            resolve = r;
          })
        : original(method, params),
    );
    ensureWorkspaceForwardCleanup({ client: d.client, registry, closeForward });
    await flush();
    d.loss();
    await flush();
    expect(calls(d, 'workspace.list')).toHaveLength(1);
    d.request.mockImplementation(original);
    d.setWorkspaces([]);
    resolve({ workspaces: [{ id: 'w' }] });
    await flush();
    expect(closeForward.mock.calls).toEqual([[3000]]);
    expect(calls(d, 'workspace.list')).toHaveLength(2);
  });
  it('rejects a stale archive push after recovery instead of closing an active forward', async () => {
    const d = daemon();
    const registry = new ForwardOwnershipRegistry();
    registry.record(3000, 'w');
    const closeForward = vi.fn();
    ensureWorkspaceForwardCleanup({ client: d.client, registry, closeForward });
    await flush();
    d.loss();
    await flush();
    d.push('workspace:updated', { workspaceId: 'w', changes: { archived: true } });
    await vi.advanceTimersByTimeAsync(250);
    expect(closeForward).not.toHaveBeenCalled();
    expect(registry.ownedWorkspaceIds()).toEqual(['w']);
  });
  it('retires settings on a permission error without retries or stale cache revival', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? Promise.reject(Object.assign(new Error('denied'), { rpcCode: -32003 }))
        : original(method, params),
    );
    d.loss();
    await flush();
    expect(settings.getBranchPrefix()).toBe('');
    expect(settings.getSshKeyPath()).toBe('');
    d.request.mockImplementation(original);
    await settings.initAppSettingsService();
    await flush();
    expect(settings.getBranchPrefix()).toBe('');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls(d, 'settings.get')).toHaveLength(6);
  });
  it('caps transient settings recovery at three complete attempts', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const original = d.request.getMockImplementation()!;
    d.request.mockImplementation((method, params) =>
      method === 'events.fence'
        ? Promise.reject(new Error('unavailable'))
        : original(method, params),
    );
    d.loss();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls(d, 'events.fence')).toHaveLength(3);
    expect(calls(d, 'settings.get')).toHaveLength(3);
  });
  it('waits for initial identity before subscribing or reading local settings', async () => {
    const d = daemon(true, false);
    await settings.initAppSettingsService();
    await flush();
    expect(calls(d, 'events.subscribe')).toHaveLength(0);
    expect(calls(d, 'settings.get')).toHaveLength(0);
    d.connect();
    await flush();
    expect(calls(d, 'events.subscribe')).toHaveLength(1);
    expect(calls(d, 'events.subscribe')[0][1]).toEqual({
      eventTypes: ['settings:changed'],
      lossRecovery: 1,
    });
    expect(settings.getBranchPrefix()).toBe('old/');
  });
  it('does not revive a held recovery snapshot after same-name connection replacement', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    const original = d.request.getMockImplementation()!;
    const replies: Array<(value: unknown) => void> = [];
    d.request.mockImplementation((method, params) =>
      method === 'settings.get'
        ? new Promise((r) => {
            replies.push(r);
          })
        : original(method, params),
    );
    d.loss();
    await flush();
    d.retire();
    expect(settings.getBranchPrefix()).toBe('');
    d.request.mockImplementation(original);
    d.values['workspace.branchPrefix'] = 'replacement/';
    d.connect(true);
    await flush();
    for (const resolve of replies) resolve({ value: 'old-authority' });
    await flush();
    expect(settings.getBranchPrefix()).toBe('replacement/');
  });
  it('rejects paths while the local identity is unavailable without queueing reads onto a successor', async () => {
    const d = daemon(true, false);
    expect(await paths.getWorkspacePath('w')).toBeNull();
    expect(calls(d, 'workspace.get')).toHaveLength(0);
    d.connect();
    expect(await paths.getWorkspacePath('w')).toBe('/old');
  });
  it('releases only its admitted subscription and source listeners when disposed', async () => {
    const d = daemon();
    await settings.initAppSettingsService();
    await flush();
    settings.__resetAppSettingsForTesting();
    await flush();
    expect(calls(d, 'events.unsubscribe')).toEqual([
      ['events.unsubscribe', { subscriptionId: 'own' }],
    ]);
    expect(d.feed.size).toBe(0);
    d.loss();
    await flush();
    expect(calls(d, 'settings.get')).toHaveLength(3);
  });
  it.each([true, false])(
    'finishes untouched settings after a push with recovery support %s',
    async (supported) => {
      const d = daemon(supported);
      const original = d.request.getMockImplementation()!;
      const replies: Array<(value: unknown) => void> = [];
      d.request.mockImplementation((method, params) =>
        method === 'settings.get'
          ? new Promise((r) => {
              replies.push(r);
            })
          : original(method, params),
      );
      await settings.initAppSettingsService();
      await flush();
      d.values['workspace.branchPrefix'] = 'pushed/';
      d.push('settings:changed', {
        changes: [{ path: 'workspace.branchPrefix', value: 'pushed/' }],
      });
      d.request.mockImplementation(original);
      // Only branchPrefix changed; the other two held responses remain authoritative.
      replies[0]({ value: 'outdated' });
      replies[1]({ value: '/old' });
      replies[2]({ value: '/old-key' });
      await flush();
      expect(settings.getBranchPrefix()).toBe('pushed/');
      expect(settings.getWorktreesLocation()).toBe('/old');
      expect(settings.getSshKeyPath()).toBe('/old-key');
      expect(calls(d, 'settings.get')).toHaveLength(3);
      expect(calls(d, 'events.fence')).toHaveLength(0);
    },
  );
  it('preserves legacy settings refresh without claiming loss recovery', async () => {
    const d = daemon(false);
    await settings.initAppSettingsService();
    await flush();
    expect(calls(d, 'events.subscribe')[0][1]).toEqual({ eventTypes: ['settings:changed'] });
    d.values['workspace.branchPrefix'] = 'new/';
    d.loss();
    await flush();
    expect(settings.getBranchPrefix()).toBe('old/');
    for (const reconnect of mock.reconnects) reconnect();
    await flush();
    expect(settings.getBranchPrefix()).toBe('new/');
    expect(calls(d, 'events.fence')).toHaveLength(0);
  });
});
