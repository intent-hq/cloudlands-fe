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
import { monitorFixture as active, scriptFixture } from './script-monitor.fixture';
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
      return { server: { capabilities: { scriptMonitors: 1, scriptLifecycle: 1 } } };
    if (method === 'scriptMonitor.list') return { monitors: [active] };
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
    expect(rows.monitors).toEqual([active]);
    connection.dispose();
  });

  it.each([undefined, 0, 2])(
    'never subscribes or reads monitors without capability v1 (%s)',
    async (version) => {
      vi.mocked(backendRequest).mockResolvedValue({
        server: { capabilities: { scriptMonitors: version } },
      });
      start();
      await vi.waitFor(() => expect(rows.status).toBe('unsupported'));
      expect(backendSubscribe).not.toHaveBeenCalled();
      expect(backendRequest).toHaveBeenCalledTimes(1);
      await off!.mutate(active.monitorId, true);
      expect(backendRequest).toHaveBeenCalledTimes(1);
    },
  );
  it('subscribes before reading, reads archived definitions, never fetches output', async () => {
    const ack = deferred<{ subscriptionId: string }>();
    vi.mocked(backendSubscribe).mockReturnValue(ack.promise);
    start();
    await vi.waitFor(() => expect(backendSubscribe).toHaveBeenCalled());
    expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.list', expect.anything());
    ack.resolve({ subscriptionId: 'sub-1' });
    await ready();
    expect(backendSubscribe).toHaveBeenCalledWith({
      workspaceId: ws,
      eventTypes: ['scriptMonitor:*', 'script:state', 'script:changed'],
    });
    expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.list', { workspaceId: ws });
    expect(backendRequest).toHaveBeenCalledWith('script.list', { workspaceId: ws, archive: 'all' });
    expect(rows.monitors).toEqual([active]);
    expect(backendRequest).not.toHaveBeenCalledWith('script.output', expect.anything());
  });
  it.each(['completed', 'expired', 'triggered', 'cancelled'] as const)(
    'does not let a pending list or duplicate registration revive %s',
    async (state) => {
      const read = deferred<{ monitors: ScriptMonitor[] }>();
      const original = vi.mocked(backendRequest).getMockImplementation()!;
      vi.mocked(backendRequest).mockImplementation((method, params) =>
        method === 'scriptMonitor.list' ? read.promise : original(method, params),
      );
      start();
      await vi.waitFor(() =>
        expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.list', { workspaceId: ws }),
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
      read.resolve({ monitors: [active] });
      await ready();
      expect(rows.monitors).toEqual([terminal]);
      await off!.mutate(active.monitorId, true);
      expect(backendRequest).not.toHaveBeenCalledWith('scriptMonitor.cancelRun', expect.anything());
    },
  );
  it('binds cancelRun to monitor identity and uses the returned terminal snapshot without synthesizing a wake', async () => {
    start();
    await ready();
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'scriptMonitor.cancelRun'
        ? Promise.resolve({ ok: true, monitor: done, runStopped: false })
        : original(method, params),
    );
    const result = await off!.mutate(active.monitorId, true);
    expect(backendRequest).toHaveBeenCalledWith('scriptMonitor.cancelRun', {
      workspaceId: ws,
      monitorId: active.monitorId,
    });
    expect(result?.runStopped).toBe(false);
    expect(rows.monitors).toEqual([done]);
    expect(backendRequest).not.toHaveBeenCalledWith('script.stop', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('agent.send', expect.anything());
  });
  it('keeps an RPC failure retryable and disables unexpected missing methods for this connection', async () => {
    start();
    await ready();
    vi.mocked(backendRequest).mockRejectedValueOnce(new Error('stop failed'));
    await expect(off!.mutate(active.monitorId, true)).rejects.toThrow('stop failed');
    expect(rows.monitors).toEqual([active]);
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
        ? Promise.resolve({ monitors: [] })
        : original(method, params),
    );
    reconnect();
    await ready();
    expect(rows.monitors).toEqual([]);
  });
  it('coalesces a burst of script changes into one trailing read', async () => {
    start();
    await ready();
    const read = deferred<{ monitors: ScriptMonitor[] }>();
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'scriptMonitor.list') return read.promise;
      if (method === 'client.hello') return { server: { capabilities: { scriptLifecycle: 1 } } };
      return { scripts: [scriptFixture] };
    });
    for (let i = 0; i < 20; i++)
      emit({
        method: 'events.event',
        params: { event: { workspaceId: ws, type: 'script:changed' } },
      });
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'scriptMonitor.list'),
    ).toHaveLength(2);
    read.resolve({ monitors: [active] });
    await vi.waitFor(() =>
      expect(
        vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'scriptMonitor.list'),
      ).toHaveLength(3),
    );
  });
});
