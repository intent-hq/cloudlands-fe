import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { subscribeScriptMonitors, type ScriptMonitorSnapshot } from './script-monitor-service';
import {
  monitorFixture as active,
  monitorSummaryFixture as summary,
} from './script-monitor.fixture';
import { CURRENT_PROTOCOL_VERSION } from '../../test/current-protocol-version';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
let emit: Parameters<typeof onBackendNotification>[0];
let snapshot: ScriptMonitorSnapshot;
let service: ReturnType<typeof subscribeScriptMonitors>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    emit = fn;
    return () => {};
  });
  vi.mocked(onBackendReconnected).mockReturnValue(() => {});
  vi.mocked(backendSubscribe).mockResolvedValue({ subscriptionId: 'sub' });
  vi.mocked(backendUnsubscribe).mockResolvedValue(undefined);
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello')
      return {
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: { scriptMonitors: 2, scriptActiveLists: 1 },
        },
      };
    if (method === 'scriptMonitor.list')
      return { view: 'summary', monitors: [summary], nextCursor: 'next' };
    throw new Error(`unexpected ${method}`);
  });
});
afterEach(() => service?.dispose());
it('loads one active page, no script definitions, and only loads more on demand', async () => {
  service = subscribeScriptMonitors(active.workspaceId, (value) => (snapshot = value));
  await vi.waitFor(() => expect(snapshot.status).toBe('ready'));
  expect(backendRequest).toHaveBeenCalledTimes(2);
  expect(backendRequest).toHaveBeenLastCalledWith('scriptMonitor.list', {
    workspaceId: active.workspaceId,
    view: 'summary',
    state: 'active',
    limit: 100,
  });
  await service.loadMore();
  expect(backendRequest).toHaveBeenLastCalledWith('scriptMonitor.list', {
    workspaceId: active.workspaceId,
    view: 'summary',
    state: 'active',
    limit: 100,
    cursor: 'next',
  });
});
it('removes terminal events and journals them across a stale page reply', async () => {
  service = subscribeScriptMonitors(active.workspaceId, (value) => (snapshot = value));
  await vi.waitFor(() => expect(snapshot.status).toBe('ready'));
  let resolve!: (value: unknown) => void;
  vi.mocked(backendRequest).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const pending = service.loadMore();
  emit({
    method: 'events.event',
    params: {
      event: {
        workspaceId: active.workspaceId,
        type: 'scriptMonitor:cancelled',
        data: {
          monitor: { ...active, state: 'cancelled', reason: 'unmonitored', settledAt: 'now' },
        },
      },
    },
  });
  expect(snapshot.monitors).toEqual([]);
  resolve({ view: 'summary', monitors: [summary] });
  await pending;
  expect(snapshot.monitors).toEqual([]);
});

it.each(['terminal', 'archived'] as const)(
  'does not publish stale expansion details after %s events',
  async (kind) => {
    service = subscribeScriptMonitors(active.workspaceId, (value) => (snapshot = value));
    await vi.waitFor(() => expect(snapshot.status).toBe('ready'));
    let resolve!: (value: unknown) => void;
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) => {
      if (method === 'scriptMonitor.get') return Promise.resolve(active);
      if (method === 'script.get') return new Promise((done) => (resolve = done));
      return original(method, params);
    });
    const pending = service.details(active.monitorId);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    const script = {
      id: active.scriptId,
      workspaceId: active.workspaceId,
      name: active.scriptName,
      command: 'full command',
      mode: 'command',
      source: 'user',
      createdAt: 'now',
      runtime: { status: 'exited', restartCount: 0 },
    };
    emit({
      method: 'events.event',
      params: {
        event:
          kind === 'terminal'
            ? {
                workspaceId: active.workspaceId,
                type: 'scriptMonitor:cancelled',
                data: {
                  monitor: {
                    ...active,
                    state: 'cancelled',
                    reason: 'unmonitored',
                    settledAt: 'now',
                  },
                },
              }
            : {
                workspaceId: active.workspaceId,
                type: 'script:changed',
                data: { scriptId: active.scriptId, script: { ...script, archivedAt: 'now' } },
              },
      },
    });
    resolve(script);
    await pending;
    expect(snapshot.scripts).toEqual([]);
    if (kind === 'terminal') expect(snapshot.monitors).toEqual([]);
    expect(backendRequest).not.toHaveBeenCalledWith('script.list', expect.anything());
  },
);
