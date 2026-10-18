import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import {
  createScriptMonitorConnection,
  subscribeScriptMonitors,
  type ScriptMonitorSnapshot,
} from './script-monitor-service';
import {
  monitorFixture as active,
  monitorSummaryFixture as summary,
  scriptFixture,
} from './script-monitor.fixture';
import type { ScriptMonitor } from './types';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
let emit: (notification: BackendNotification) => void;
let reconnect: () => void;
let off: ReturnType<typeof subscribeScriptMonitors> | undefined;
let rows: ScriptMonitorSnapshot;
const ws = active.workspaceId;
const done: ScriptMonitor = {
  ...active,
  state: 'completed',
  reason: 'finished',
  settledAt: '2026-10-02T10:01:00Z',
  result: { outcome: 'succeeded', exitCode: 0, stoppedAt: '2026-10-02T10:01:00Z' },
};
function event(monitor: ScriptMonitor, type = `scriptMonitor:${monitor.state}`) {
  emit({ method: 'events.event', params: { event: { workspaceId: ws, type, data: { monitor } } } });
}
function start() {
  off = subscribeScriptMonitors(ws, (snapshot) => {
    rows = snapshot;
  });
  return off;
}
async function ready() {
  await vi.waitFor(() => expect(rows.status).toBe('ready'));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(onBackendNotification).mockImplementation((handler) => {
    emit = handler;
    return vi.fn();
  });
  vi.mocked(onBackendReconnected).mockImplementation((handler) => {
    reconnect = handler;
    return vi.fn();
  });
  vi.mocked(backendSubscribe).mockResolvedValue({ subscriptionId: 'sub-1' });
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello')
      return {
        server: {
          protocolVersion: '14.0',
          capabilities: { scriptMonitors: 2, scriptActiveLists: 1, scriptLifecycle: 1 },
        },
      };
    if (method === 'scriptMonitor.list') return { view: 'summary', monitors: [summary] };
    if (method === 'script.list') return { scripts: [scriptFixture] };
    throw new Error(`Unexpected wire call ${method}`);
  });
});
afterEach(() => off?.dispose());
describe('script monitor wire and connection lifecycle', () => {
  it('shares a missing-method rejection across workspace leases until reconnect', async () => {
    const connection = createScriptMonitorConnection();
    off = subscribeScriptMonitors(
      ws,
      (snapshot) => {
        rows = snapshot;
      },
      connection,
    );
    await ready();
    vi.mocked(backendRequest).mockRejectedValueOnce({ rpcCode: -32601 });
    await expect(off.mutate(active.monitorId, true)).rejects.toEqual({ rpcCode: -32601 });
    let secondStatus: string | undefined;
    const second = subscribeScriptMonitors(
      'second-workspace',
      (snapshot) => {
        secondStatus = snapshot.status;
      },
      connection,
    );
    expect(secondStatus).toBe('unsupported');
    expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.list', {
      workspaceId: 'second-workspace',
    });
    second.dispose();
    reconnect();
    await ready();
    expect(rows.monitors).toEqual([summary]);
    connection.dispose();
  });

  it('loads monitors from a protocol 15 daemon that advertises capability v2', async () => {
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'client.hello')
        return {
          server: {
            protocolVersion: '15.0',
            capabilities: { scriptMonitors: 2, scriptActiveLists: 1, scriptLifecycle: 1 },
          },
        };
      if (method === 'scriptMonitor.list') return { view: 'summary', monitors: [summary] };
      throw new Error(`Unexpected wire call ${method}`);
    });
    start();
    await ready();
    expect(rows.status).toBe('ready');
    expect(rows.monitors).toEqual([summary]);
  });
  it('still rejects a protocol 15 daemon without monitor capability v2', async () => {
    vi.mocked(backendRequest).mockResolvedValue({
      server: { protocolVersion: '15.0', capabilities: { scriptMonitors: 1 } },
    });
    start();
    await vi.waitFor(() => expect(rows.status).toBe('unsupported'));
    expect(backendSubscribe).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 1, 3])(
    'never subscribes or reads monitors without capability v2 (%s)',
    async (version) => {
      vi.mocked(backendRequest).mockResolvedValue({
        server: { protocolVersion: '14.0', capabilities: { scriptMonitors: version } },
      });
      start();
      await vi.waitFor(() => expect(rows.status).toBe('unsupported'));
      expect(backendSubscribe).not.toHaveBeenCalled();
      expect(backendRequest).toHaveBeenCalledTimes(1);
      await off!.mutate(active.monitorId, true);
      expect(backendRequest).toHaveBeenCalledTimes(1);
    },
  );
  it('subscribes before reading, never enumerates script definitions, never fetches output', async () => {
    const ack = deferred<{ subscriptionId: string }>();
    vi.mocked(backendSubscribe).mockReturnValue(ack.promise);
    start();
    await vi.waitFor(() => expect(backendSubscribe).toHaveBeenCalled());
    expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.list', expect.anything());
    ack.resolve({ subscriptionId: 'sub-1' });
    await ready();
    expect(backendSubscribe).toHaveBeenCalledWith({
      workspaceId: ws,
      eventTypes: ['scriptMonitor:*', 'script:changed', 'script:removed'],
    });
    expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.list', {
      workspaceId: ws,
      view: 'summary',
      state: 'active',
      limit: 100,
    });
    expect(backendRequest).not.toHaveBeenCalledWith('script.list', expect.anything());
    expect(rows.monitors).toEqual([summary]);
    expect(backendRequest).not.toHaveBeenCalledWith('script.output', expect.anything());
  });
  it.each(['completed', 'expired', 'triggered', 'cancelled'] as const)(
    'does not let a pending list or duplicate registration revive %s',
    async (state) => {
      const read = deferred<{ view: 'summary'; monitors: ScriptMonitor[] }>();
      const original = vi.mocked(backendRequest).getMockImplementation()!;
      vi.mocked(backendRequest).mockImplementation((method, params) =>
        method === 'scriptMonitor.list' ? read.promise : original(method, params),
      );
      start();
      await vi.waitFor(() =>
        expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.list', {
          workspaceId: ws,
          view: 'summary',
          state: 'active',
          limit: 100,
        }),
      );
      const terminal =
        state === 'completed'
          ? done
          : state === 'triggered'
            ? {
                ...active,
                state,
                reason: 'output-match',
                settledAt: done.settledAt,
                trigger: { observedLineCount: 7, matchedLine: '<img src=x onerror=alert(1)>' },
              }
            : {
                ...active,
                state,
                reason: state === 'expired' ? 'ttl-expired' : 'owner-retired',
                settledAt: done.settledAt,
              };
      event(terminal as ScriptMonitor);
      event(active, 'scriptMonitor:registered');
      read.resolve({ view: 'summary', monitors: [summary] });
      await ready();
      expect(rows.monitors).toEqual([]);
      await off!.mutate(active.monitorId, true);
      expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.cancelRun', expect.anything());
    },
  );
  it('binds cancelRun to monitor identity and uses the returned identity receipt without synthesizing a wake', async () => {
    start();
    await ready();
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'scriptMonitor.cancelRun'
        ? Promise.resolve({ ok: true, monitorId: active.monitorId, runStopped: false })
        : original(method, params),
    );
    const result = await off!.mutate(active.monitorId, true);
    expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.cancelRun', {
      workspaceId: ws,
      monitorId: active.monitorId,
    });
    expect(result?.runStopped).toBe(false);
    expect(rows.monitors).toEqual([]);
    expect(backendRequest).not.toHaveBeenCalledWith('script.stop', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('agent.send', expect.anything());
  });
  it('keeps an RPC failure retryable and disables unexpected missing methods for this connection', async () => {
    start();
    await ready();
    vi.mocked(backendRequest).mockRejectedValueOnce(new Error('stop failed'));
    await expect(off!.mutate(active.monitorId, true)).rejects.toThrow('stop failed');
    expect(rows.monitors).toEqual([summary]);
    vi.mocked(backendRequest).mockRejectedValueOnce({ rpcCode: -32601 });
    await expect(off!.mutate(active.monitorId, true)).rejects.toEqual({ rpcCode: -32601 });
    expect(rows.status).toBe('unsupported');
    const calls = vi.mocked(backendRequest).mock.calls.length;
    await off!.mutate(active.monitorId, true);
    expect(backendRequest).toHaveBeenCalledTimes(calls);
  });
  it('reconnects with an authoritative empty list and releases stale subscriptions', async () => {
    const firstAck = deferred<{ subscriptionId: string }>();
    vi.mocked(backendSubscribe).mockReturnValueOnce(firstAck.promise);
    start();
    await vi.waitFor(() => expect(backendSubscribe).toHaveBeenCalledTimes(1));
    reconnect();
    await ready();
    firstAck.resolve({ subscriptionId: 'old-sub' });
    await vi.waitFor(() => expect(backendUnsubscribe).toHaveBeenCalledWith('old-sub', ws));
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'scriptMonitor.list'
        ? Promise.resolve({ view: 'summary', monitors: [] })
        : original(method, params),
    );
    reconnect();
    await ready();
    expect(rows.monitors).toEqual([]);
  });
  it('does not refetch lists on script events', async () => {
    start();
    await ready();
    const before = vi.mocked(backendRequest).mock.calls.length;
    for (let i = 0; i < 20; i++)
      emit({
        method: 'events.event',
        params: {
          event: {
            workspaceId: ws,
            type: 'script:changed',
            data: { scriptId: scriptFixture.id, script: scriptFixture },
          },
        },
      });
    expect(backendRequest).toHaveBeenCalledTimes(before);
  });
});

describe('script monitor read failures (intent-hq/intent#7206)', () => {
  const calls = (method: string) =>
    vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method).length;

  it('retries a failed first page on the healthy subscription without re-registering', async () => {
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    let fail = true;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'scriptMonitor.list' && fail
        ? Promise.reject(new Error('Timed out'))
        : original(method, params),
    );
    const service = start();
    await vi.waitFor(() => expect(rows.status).toBe('failed'));
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    const hellos = calls('client.hello');
    fail = false;
    service.retry();
    await ready();
    expect(rows.monitors.map((row) => row.monitorId)).toEqual([active.monitorId]);
    expect(calls('client.hello')).toBe(hellos);
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    expect(backendUnsubscribe).not.toHaveBeenCalled();
  });

  it('re-registers when the hello itself failed', async () => {
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    let fail = true;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'client.hello' && fail
        ? Promise.reject(new Error('Socket closed'))
        : original(method, params),
    );
    const service = start();
    await vi.waitFor(() => expect(rows.status).toBe('failed'));
    expect(backendSubscribe).not.toHaveBeenCalled();
    fail = false;
    service.retry();
    await ready();
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    expect(rows.monitors).toHaveLength(1);
  });

  it('keeps loaded rows usable when only an extra page fails', async () => {
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) => {
      if (method !== 'scriptMonitor.list') return original(method, params);
      return (params as { cursor?: string }).cursor
        ? Promise.reject(new Error('Timed out'))
        : Promise.resolve({ view: 'summary', monitors: [summary], nextCursor: 'more' });
    });
    const service = start();
    await ready();
    await service.loadMore();
    expect(rows.status).toBe('ready');
    expect(rows.loadingMore).toBe(false);
    expect(rows.nextCursor).toBe('more');
    expect(rows.monitors).toHaveLength(1);
    service.retry();
    expect(calls('scriptMonitor.list')).toBe(2);
  });
});
