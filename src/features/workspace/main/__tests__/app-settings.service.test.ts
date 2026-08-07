import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestSpy, loggerSpies, clientListeners, reconnectHandlers } = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  loggerSpies: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  clientListeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  reconnectHandlers: [] as Array<() => void>,
}));

vi.mock('../../../backend/main/backend.ipc', () => {
  const client = {
    request: requestSpy,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (!clientListeners.has(event)) clientListeners.set(event, new Set());
      clientListeners.get(event)!.add(cb);
      return client;
    },
    off: (event: string, cb: (...args: unknown[]) => void) => {
      clientListeners.get(event)?.delete(cb);
      return client;
    },
  };
  // T9: notification/status listeners now register on the stable forwarders.
  // Wire them onto the same `clientListeners` map that `emit()` drives so the
  // tests keep delivering `notification`/`status` to the service handlers.
  const register = (event: string) => (handler: (...args: unknown[]) => void) => {
    if (!clientListeners.has(event)) clientListeners.set(event, new Set());
    clientListeners.get(event)!.add(handler);
    return () => clientListeners.get(event)?.delete(handler);
  };
  return {
    getBackendClient: () => client,
    onBackendReconnected: (handler: () => void) => {
      reconnectHandlers.push(handler);
      return () => {};
    },
    onBackendNotification: register('notification'),
    onBackendStatus: register('status'),
  };
});

vi.mock('../../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

/** Emit an event on the mocked JsonRpcClient. */
function emit(event: string, ...args: unknown[]): void {
  for (const cb of clientListeners.get(event) ?? []) cb(...args);
}

/** The `settings.get` wire calls issued so far (ignores events.subscribe). */
function settingsGetCalls(): Array<{ path: string }> {
  return requestSpy.mock.calls
    .filter((call) => call[0] === 'settings.get')
    .map((call) => call[1] as { path: string });
}

/** Drain pending microtasks / zero-delay timers from fire-and-forget chains. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Mock the daemon: `settings.get` answers from `values` (per-path errors via
 * `failPaths`), `events.subscribe` returns `subscriptionId` or throws when
 * `failSubscribe` is set.
 */
function mockDaemon(
  values: Record<string, unknown>,
  opts: { failPaths?: string[]; failSubscribe?: boolean; subscriptionId?: string } = {},
): void {
  requestSpy.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'events.subscribe') {
      if (opts.failSubscribe) throw new Error('connect ENOENT intentd.sock');
      return { subscriptionId: opts.subscriptionId ?? 'sub-1' };
    }
    if (method === 'events.unsubscribe') return {};
    if (method === 'settings.get') {
      const path = (params as { path: string }).path;
      if (opts.failPaths?.includes(path)) throw new Error('boom');
      if (path in values) return { path, value: values[path] };
      throw new Error(`unexpected path ${path}`);
    }
    throw new Error(`unexpected method ${method}`);
  });
}

describe('app-settings.service (daemon-backed hydration cache)', () => {
  beforeEach(async () => {
    vi.resetModules();
    requestSpy.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
    clientListeners.clear();
    reconnectHandlers.length = 0;
  });

  it('sync getters return "" before hydration completes', async () => {
    const { getBranchPrefix, getWorktreesLocation, getSshKeyPath } =
      await import('../app-settings.service');
    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('');
    expect(getSshKeyPath()).toBe('');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('initAppSettingsService fetches the three daemon paths and subscribes to settings:changed', async () => {
    mockDaemon({
      'workspace.branchPrefix': 'feature/',
      'workspace.worktreesLocation': '/tmp/wt',
      'workspace.sshKeyPath': '/home/me/.ssh/id_ed25519',
    });

    const { initAppSettingsService, getBranchPrefix, getWorktreesLocation, getSshKeyPath } =
      await import('../app-settings.service');

    await initAppSettingsService();

    // Assert the exact wire calls per PROTOCOL.md §5.12 settings.get.
    expect(settingsGetCalls()).toHaveLength(3);
    expect(requestSpy).toHaveBeenCalledWith('settings.get', { path: 'workspace.branchPrefix' });
    expect(requestSpy).toHaveBeenCalledWith('settings.get', {
      path: 'workspace.worktreesLocation',
    });
    expect(requestSpy).toHaveBeenCalledWith('settings.get', { path: 'workspace.sshKeyPath' });
    // One long-lived settings:changed subscription (§6.1 / §6.5).
    expect(requestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['settings:changed'],
    });

    expect(getBranchPrefix()).toBe('feature/');
    expect(getWorktreesLocation()).toBe('/tmp/wt');
    expect(getSshKeyPath()).toBe('/home/me/.ssh/id_ed25519');
  });

  it('missing / non-string daemon values fall back to ""', async () => {
    requestSpy.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      const path = (params as { path: string }).path;
      if (path === 'workspace.branchPrefix') return { path, value: null };
      if (path === 'workspace.worktreesLocation') return { path };
      return { path, value: 42 };
    });

    const { initAppSettingsService, getBranchPrefix, getWorktreesLocation, getSshKeyPath } =
      await import('../app-settings.service');

    await initAppSettingsService();

    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('');
    expect(getSshKeyPath()).toBe('');
  });

  it('daemon errors per-path degrade to "" without failing hydration, and retry on the next init', async () => {
    mockDaemon(
      { 'workspace.worktreesLocation': 'ok', 'workspace.sshKeyPath': 'ok' },
      { failPaths: ['workspace.branchPrefix'] },
    );

    const { initAppSettingsService, getBranchPrefix, getWorktreesLocation } =
      await import('../app-settings.service');

    await expect(initAppSettingsService()).resolves.toBeUndefined();
    expect(getBranchPrefix()).toBe('');
    expect(getWorktreesLocation()).toBe('ok');
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      'Failed to hydrate workspace.branchPrefix from daemon',
      expect.objectContaining({ error: 'boom' }),
    );

    // The failure is NOT cached: a later init retries ONLY the missing path.
    mockDaemon({ 'workspace.branchPrefix': 'feature/' });
    requestSpy.mockClear();
    await initAppSettingsService();
    expect(settingsGetCalls()).toEqual([{ path: 'workspace.branchPrefix' }]);
    expect(getBranchPrefix()).toBe('feature/');

    // Fully hydrated now — further init calls are no-ops.
    requestSpy.mockClear();
    await initAppSettingsService();
    expect(settingsGetCalls()).toHaveLength(0);
  });

  it('concurrent initAppSettingsService calls share a single hydration', async () => {
    mockDaemon({
      'workspace.branchPrefix': '',
      'workspace.worktreesLocation': '',
      'workspace.sshKeyPath': '',
    });

    const { initAppSettingsService } = await import('../app-settings.service');
    await Promise.all([initAppSettingsService(), initAppSettingsService()]);

    // 3 daemon paths × 1 hydration cycle = 3 calls, not 6.
    expect(settingsGetCalls()).toHaveLength(3);
  });

  it('retries hydration and subscribe on the next connected transition after total failure', async () => {
    // Boot-order race: initAppSettingsService runs before the sidecar starts,
    // so every request fails with ENOENT. Nothing may be cached as ''.
    requestSpy.mockImplementation(async () => {
      throw new Error('connect ENOENT intentd.sock');
    });

    const { initAppSettingsService, getBranchPrefix, getWorktreesLocation, getSshKeyPath } =
      await import('../app-settings.service');

    await expect(initAppSettingsService()).resolves.toBeUndefined();
    expect(getBranchPrefix()).toBe('');
    expect(clientListeners.get('status')?.size ?? 0).toBeGreaterThan(0);

    // Daemon comes up; the armed status listener re-runs hydration + subscribe.
    mockDaemon({
      'workspace.branchPrefix': 'feature/',
      'workspace.worktreesLocation': '/tmp/wt',
      'workspace.sshKeyPath': '/id',
    });
    requestSpy.mockClear();
    emit('status', 'connected');
    await flush();

    expect(getBranchPrefix()).toBe('feature/');
    expect(getWorktreesLocation()).toBe('/tmp/wt');
    expect(getSshKeyPath()).toBe('/id');
    expect(requestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['settings:changed'],
    });
  });

  it('applies settings:changed deltas from its own subscription to the cache', async () => {
    mockDaemon(
      {
        'workspace.branchPrefix': 'feature/',
        'workspace.worktreesLocation': '/tmp/wt',
        'workspace.sshKeyPath': '/id',
      },
      { subscriptionId: 'sub-1' },
    );

    const { initAppSettingsService, getBranchPrefix, getSshKeyPath } =
      await import('../app-settings.service');
    await initAppSettingsService();
    await flush();

    // §6.5 delta on OUR subscription updates the cache in-session.
    emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: 'sub-1',
        event: {
          type: 'settings:changed',
          data: {
            changes: [
              { path: 'workspace.branchPrefix', value: 'hotfix/' },
              { path: 'workspace.sshKeyPath', value: null },
              { path: 'git.autoCommit', value: false },
            ],
          },
        },
      },
    });
    expect(getBranchPrefix()).toBe('hotfix/');
    // Non-string (reset) normalizes to '' like fetchStringSetting.
    expect(getSshKeyPath()).toBe('');

    // Deltas on renderer-proxied subscriptions are ignored.
    emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: 'other-sub',
        event: {
          type: 'settings:changed',
          data: { changes: [{ path: 'workspace.branchPrefix', value: 'stolen/' }] },
        },
      },
    });
    expect(getBranchPrefix()).toBe('hotfix/');
  });

  it('re-subscribes and re-fetches all paths on backend reconnect', async () => {
    mockDaemon({
      'workspace.branchPrefix': 'feature/',
      'workspace.worktreesLocation': '/tmp/wt',
      'workspace.sshKeyPath': '/id',
    });

    const { initAppSettingsService, getBranchPrefix } = await import('../app-settings.service');
    await initAppSettingsService();
    await flush();
    expect(reconnectHandlers).toHaveLength(1);

    // Values changed while disconnected; reconnect must re-fetch them all.
    mockDaemon(
      {
        'workspace.branchPrefix': 'release/',
        'workspace.worktreesLocation': '/tmp/wt2',
        'workspace.sshKeyPath': '/id2',
      },
      { subscriptionId: 'sub-2' },
    );
    requestSpy.mockClear();
    for (const handler of reconnectHandlers) handler();
    await flush();

    expect(settingsGetCalls()).toHaveLength(3);
    expect(requestSpy).toHaveBeenCalledWith('events.subscribe', {
      eventTypes: ['settings:changed'],
    });
    expect(getBranchPrefix()).toBe('release/');
  });

  it('on reconnect, the re-subscribe completes before the re-fetch begins', async () => {
    mockDaemon({
      'workspace.branchPrefix': 'feature/',
      'workspace.worktreesLocation': '/tmp/wt',
      'workspace.sshKeyPath': '/id',
    });
    const { initAppSettingsService } = await import('../app-settings.service');
    await initAppSettingsService();
    await flush();

    // Reconnect: hold the re-subscribe open and assert no settings.get fires
    // until it resolves (subscribe-then-fetch closes the missed-delta window).
    let resolveSubscribe: ((v: unknown) => void) | undefined;
    requestSpy.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'events.subscribe') {
        return new Promise((resolve) => {
          resolveSubscribe = resolve;
        });
      }
      if (method === 'settings.get') {
        return { path: (params as { path: string }).path, value: 'new' };
      }
      return {};
    });
    requestSpy.mockClear();
    for (const handler of reconnectHandlers) handler();
    await flush();
    expect(settingsGetCalls()).toHaveLength(0);

    resolveSubscribe!({ subscriptionId: 'sub-2' });
    await flush();
    expect(settingsGetCalls()).toHaveLength(3);
  });

  it('unsubscribes a stale in-flight subscribe superseded by a reconnect and never adopts its id', async () => {
    // First events.subscribe hangs; a reconnect fires while it is in flight.
    let resolveFirstSubscribe: ((v: unknown) => void) | undefined;
    let subscribeCalls = 0;
    requestSpy.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'events.subscribe') {
        subscribeCalls++;
        if (subscribeCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstSubscribe = resolve;
          });
        }
        return { subscriptionId: 'sub-2' };
      }
      if (method === 'events.unsubscribe') return {};
      if (method === 'settings.get') {
        return { path: (params as { path: string }).path, value: 'v' };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { initAppSettingsService, getBranchPrefix } = await import('../app-settings.service');
    const initPromise = initAppSettingsService();
    await flush();
    expect(reconnectHandlers).toHaveLength(1);

    // Reconnect while the first subscribe is still in flight.
    for (const handler of reconnectHandlers) handler();
    await flush();

    // The stale subscribe resolves AFTER the reconnect bumped the epoch: its
    // id must be released best-effort and must not become the live id.
    resolveFirstSubscribe!({ subscriptionId: 'sub-stale' });
    await initPromise;
    await flush();
    expect(requestSpy).toHaveBeenCalledWith('events.unsubscribe', {
      subscriptionId: 'sub-stale',
    });

    // Deltas on the stale id are ignored; the reconnect's id is live.
    emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: 'sub-stale',
        event: {
          type: 'settings:changed',
          data: { changes: [{ path: 'workspace.branchPrefix', value: 'stolen/' }] },
        },
      },
    });
    expect(getBranchPrefix()).toBe('v');
    emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: 'sub-2',
        event: {
          type: 'settings:changed',
          data: { changes: [{ path: 'workspace.branchPrefix', value: 'hotfix/' }] },
        },
      },
    });
    expect(getBranchPrefix()).toBe('hotfix/');
  });

  it('a settings:changed delta wins over an in-flight settings.get for the same path', async () => {
    let resolveBranchPrefixGet: ((v: unknown) => void) | undefined;
    requestSpy.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      if (method === 'settings.get') {
        const path = (params as { path: string }).path;
        if (path === 'workspace.branchPrefix') {
          return new Promise((resolve) => {
            resolveBranchPrefixGet = resolve;
          });
        }
        return { path, value: '' };
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { initAppSettingsService, getBranchPrefix } = await import('../app-settings.service');
    const initPromise = initAppSettingsService();
    await flush();

    // A newer delta lands while the settings.get for the same path is in flight.
    emit('notification', {
      method: 'events.event',
      params: {
        subscriptionId: 'sub-1',
        event: {
          type: 'settings:changed',
          data: { changes: [{ path: 'workspace.branchPrefix', value: 'hotfix/' }] },
        },
      },
    });
    expect(getBranchPrefix()).toBe('hotfix/');

    // The older fetch result must be discarded as stale, not clobber the delta.
    resolveBranchPrefixGet!({ path: 'workspace.branchPrefix', value: 'stale/' });
    await initPromise;
    expect(getBranchPrefix()).toBe('hotfix/');
  });

  it('retries a failed subscribe after a delay while connected, bounded, without a status transition', async () => {
    vi.useFakeTimers();
    try {
      mockDaemon(
        {
          'workspace.branchPrefix': 'feature/',
          'workspace.worktreesLocation': '/tmp/wt',
          'workspace.sshKeyPath': '/id',
        },
        { failSubscribe: true },
      );

      const { initAppSettingsService, getBranchPrefix } = await import('../app-settings.service');
      const initPromise = initAppSettingsService();
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Hydration succeeded (subscribe failure does not block getters)…
      expect(getBranchPrefix()).toBe('feature/');
      const subscribeCalls = () =>
        requestSpy.mock.calls.filter(([m]) => m === 'events.subscribe').length;
      expect(subscribeCalls()).toBe(1);

      // …and with no status transition, a delayed retry fires and succeeds.
      mockDaemon(
        {
          'workspace.branchPrefix': 'feature/',
          'workspace.worktreesLocation': '/tmp/wt',
          'workspace.sshKeyPath': '/id',
        },
        { subscriptionId: 'sub-retry' },
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(subscribeCalls()).toBe(2);

      emit('notification', {
        method: 'events.event',
        params: {
          subscriptionId: 'sub-retry',
          event: {
            type: 'settings:changed',
            data: { changes: [{ path: 'workspace.branchPrefix', value: 'hotfix/' }] },
          },
        },
      });
      expect(getBranchPrefix()).toBe('hotfix/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the delayed subscribe retry after the bounded attempt budget', async () => {
    vi.useFakeTimers();
    try {
      mockDaemon(
        {
          'workspace.branchPrefix': '',
          'workspace.worktreesLocation': '',
          'workspace.sshKeyPath': '',
        },
        { failSubscribe: true },
      );

      const { initAppSettingsService } = await import('../app-settings.service');
      const initPromise = initAppSettingsService();
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const subscribeCalls = () =>
        requestSpy.mock.calls.filter(([m]) => m === 'events.subscribe').length;
      // Initial attempt + 3 bounded retries, then it stops (the armed status
      // listener remains the backstop for a reconnect cycle).
      await vi.advanceTimersByTimeAsync(60_000);
      expect(subscribeCalls()).toBe(4);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(subscribeCalls()).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('__resetAppSettingsForTesting detaches the notification listener it un-flags', async () => {
    mockDaemon({
      'workspace.branchPrefix': 'feature/',
      'workspace.worktreesLocation': '/tmp/wt',
      'workspace.sshKeyPath': '/id',
    });
    const { initAppSettingsService, __resetAppSettingsForTesting } =
      await import('../app-settings.service');
    await initAppSettingsService();
    expect(clientListeners.get('notification')?.size).toBe(1);

    __resetAppSettingsForTesting();
    expect(clientListeners.get('notification')?.size ?? 0).toBe(0);
  });
});
