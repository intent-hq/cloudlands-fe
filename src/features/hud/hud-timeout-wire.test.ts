import { hudSaga } from '$store/renderer/slices/hud/sagas/hud-saga';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/middlewares/daemon-health-service', () => ({
  createDaemonHealthMiddleware: () => () => (next: (action: unknown) => unknown) => next,
  disposeDaemonHealthService: () => {},
}));
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from '$lib/client/live/browser-websocket-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import * as factory from '$lib/client/live/backend-transport-factory';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { installAgentMetadataRecovery } from '$features/agent/agent-metadata-recovery';
import { hudActivated, hudDeactivated } from '$store/renderer/slices/hud/hud-slice';
const startHudSubscription = () => {
  store.dispatch(hudActivated());
  return () => store.dispatch(hudDeactivated());
};
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { WorkspaceStatus } from '$shared/types';
import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';

type Frame = { id: number; method: string; params?: any };
class Socket implements BrowserWebSocketLike {
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onSend?: (f: Frame) => void;
  frames: Frame[] = [];
  busyOutstanding = new Set<number>();
  busyPeak = 0;
  send(raw: string) {
    const f = JSON.parse(raw);
    this.frames.push(f);
    if (f.method === 'agent.listActive') {
      this.busyOutstanding.add(f.id);
      this.busyPeak = Math.max(this.busyPeak, this.busyOutstanding.size);
    }
    this.onSend?.(f);
  }
  receive(f: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  }) {
    if (f.id !== undefined) this.busyOutstanding.delete(f.id);
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  close() {}
}
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const WS = 'hud-wire-workspace';
const AGENT = 'hud-wire-agent';
const workspace = {
  id: WS,
  title: 'Wire HUD',
  branch: 'main',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const agent = (name: string) => ({
  id: AGENT,
  workspaceId: WS,
  name,
  status: 'idle',
  provider: 'claude-code',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  messages: [],
  metadata: { isBackground: false },
});
const usage = {
  totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  runs: 0,
  sessions: 0,
  longestRunMs: 0,
  linesAdded: 0,
  linesDeleted: 0,
  byModel: [],
  byProvider: [],
  byHourOfDay: [],
  byMonth: [],
  availablePeriods: { months: [], years: [] },
};
let stopRootSaga: (() => void) | undefined;
let transport: BrowserWebSocketTransport;
let stop: (() => void) | undefined;
let off: (() => void) | undefined;
beforeEach(() => {
  store.dispose();
  store.init();
  admitLegacyPrincipal();
  stopRootSaga = store.runSaga(hudSaga);
});
afterEach(() => {
  stopRootSaga?.();
  stop?.();
  stop = undefined;
  off?.();
  off = undefined;
  rendererEventRecovery.dispose();
  transport?.dispose();
  store.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function harness(legacy: boolean, holdList = false) {
  vi.useFakeTimers();
  const socket = new Socket();
  transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc',
    webSocketFactory: () => socket,
    requestTimeoutMs: 50,
  });
  vi.spyOn(factory, 'resolveBackendTransport').mockReturnValue(transport);
  const request = vi.spyOn(transport, 'request');
  const capture = transport.captureEventRecovery();
  socket.onopen?.();
  await flush();
  const hello = socket.frames.at(-1)!;
  expect(hello.method).toBe('client.hello');
  socket.receive({
    id: hello.id,
    result: {
      clientId: 'hud-browser',
      protocolVersion: '2.2',
      server: {
        locality: 'local',
        hasDisplay: false,
        osArch: 'linux/x86_64',
        version: '0.1.0',
        protocolVersion: '2.2',
        capabilities: { liveState: true, eventStreamRecovery: 1 },
      },
    },
  });
  let sub = 0;
  const reads = (method: string) => socket.frames.filter((f) => f.method === method);
  socket.onSend = (f) => {
    if (f.method === 'agent.listActive' && reads(f.method).length === 1) return;
    if (holdList && f.method === 'agent.list' && reads(f.method).length === 1) return;
    let result: unknown;
    switch (f.method) {
      case 'events.subscribe':
        result = { subscriptionId: `hud-wire-${++sub}`, lossRecovery: 1 };
        break;
      case 'events.fence':
        result = f.params;
        break;
      case 'events.unsubscribe':
        result = {};
        break;
      case 'stats.getUsage':
        result = usage;
        break;
      case 'stats.getRateHistory':
        result = { samples: [] };
        break;
      case 'agent.list':
        result = {
          agents: [agent(reads(f.method).length === 1 ? 'Old read' : 'Recovered')],
          retiredCount: 0,
        };
        break;
      case 'agent.listActive':
        result = { streams: [] };
        break;
      case 'agent.get':
        result = { agent: agent('Recovered') };
        break;
      case 'workspace.get':
        result = { workspace };
        break;
      default:
        throw new Error('Unexpected wire method ' + f.method);
    }
    queueMicrotask(() => socket.receive({ id: f.id, result }));
  };
  const session = await capture;
  if (!legacy) rendererEventRecovery.attach(session);
  off = rendererEventRecovery.onSession((scope) =>
    installAgentMetadataRecovery(scope, {
      getState: () => store.state,
      dispatch: (a) => store.dispatch(a),
      subscribe: (fn) => store.getReadableState().subscribe(() => fn()),
    }),
  );
  store.dispatch(setWorkspaceEntity(workspace as never));
  store.dispatch(setAgents(WS, [agent('Known private') as never]));
  store.dispatch(bulkUpsertSessions([agent('Known private') as never], { listProjection: true }));
  stop = startHudSubscription();
  await flush();
  await flush();
  expect(reads('agent.listActive')).toHaveLength(1);
  expect(reads('agent.list')).toHaveLength(1);
  const lose = () =>
    socket.receive({
      method: 'events.lost',
      params: { subscriptionId: `hud-wire-${sub}`, generation: '1', scope: { workspaceId: null } },
    });
  const push = () =>
    socket.receive({
      method: 'events.event',
      params: {
        subscriptionId: `hud-wire-${sub}`,
        event: {
          id: 'hud-live-agent',
          type: 'agent:status-changed',
          workspaceId: WS,
          timestamp: '2026-10-13T10:35:00Z',
          data: { agentId: AGENT, status: 'idle' },
        },
      },
    });
  return { socket, reads, request, session, lose, push };
}
describe('HUD timeout recovery through the browser transport', () => {
  it.each(['reply', 'forbidden'])(
    'retains an ordinary wire timeout while HUD adopts captured recovery (late %s)',
    async (kind) => {
      const h = await harness(true);
      const held = h.reads('agent.listActive')[0]!;
      await vi.advanceTimersByTimeAsync(51);
      const index = h.request.mock.calls.findIndex(([method]) => method === 'agent.listActive');
      const error = await h.request.mock.results[index]!.value.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackendError);
      expect(error.code).toBe('TIMEOUT');
      expect(getPhysicalRequestCompletion(error)).toBeInstanceOf(Promise);
      rendererEventRecovery.attach(h.session);
      await flush();
      expect(h.reads('agent.listActive')).toHaveLength(1);
      expect(store.state.agentSessions.byAgentId[AGENT]?.name).toBe('Known private');
      h.socket.receive(
        kind === 'forbidden'
          ? {
              id: held.id,
              error: { code: -32003, message: 'Old caller denied', data: { code: 'forbidden' } },
            }
          : { id: held.id, result: { streams: [] } },
      );
      await flush();
      await flush();
      expect(h.reads('agent.listActive')).toHaveLength(2);
      expect(store.state.agentSessions.byAgentId[AGENT]?.name).toBe('Recovered');
      h.lose();
      await flush();
      await flush();
      expect(h.reads('agent.listActive')).toHaveLength(3);
      expect(store.state.agentSessions.byAgentId[AGENT]?.name).toBe('Recovered');
      expect(h.socket.busyPeak).toBe(1);
    },
  );
  it.each(['transient', 'forbidden', 'push-forbidden'])(
    'observes late %s after the actual captured HUD read deadline',
    async (kind) => {
      const h = await harness(false);
      const held = h.reads('agent.listActive')[0]!;
      await vi.advanceTimersByTimeAsync(30_001);
      if (kind === 'push-forbidden') {
        h.push();
        await flush();
      }
      h.lose();
      await flush();
      expect(h.reads('agent.listActive')).toHaveLength(1);
      expect(h.reads('agent.list')).toHaveLength(1);
      expect(store.state.agentSessions.byAgentId[AGENT]?.name).toBe('Known private');
      h.socket.receive({
        id: held.id,
        error: {
          code: kind !== 'transient' ? -32003 : -32603,
          message: kind,
          data: { code: kind },
        },
      });
      await flush();
      await flush();
      if (kind !== 'transient') {
        expect
          .soft(
            store.state.agentSessions.byAgentId[AGENT],
            'current private row clears before queued recovery',
          )
          .toBeUndefined();
        expect
          .soft(
            rendererEventRecovery.captureAuthority('agents:' + JSON.stringify([WS])).isCurrent(),
            'denied agents authority retires',
          )
          .toBe(false);
        expect.soft(h.reads('agent.list'), 'denial cannot launch a successor read').toHaveLength(1);
      } else {
        expect(store.state.agentSessions.byAgentId[AGENT]?.name).toBe('Recovered');
        expect(h.reads('agent.listActive')).toHaveLength(2);
      }
      expect(h.socket.busyPeak).toBe(1);
    },
  );
  it('clears late HUD denial before a timed-out list sibling physically drains', async () => {
    const h = await harness(false, true);
    const busy = h.reads('agent.listActive')[0]!;
    const list = h.reads('agent.list')[0]!;
    await vi.advanceTimersByTimeAsync(30_001);
    h.lose();
    await flush();
    h.socket.receive({
      id: busy.id,
      error: { code: -32003, message: 'Forbidden', data: { code: 'forbidden' } },
    });
    await flush();
    await flush();
    expect
      .soft(
        store.state.agentSessions.byAgentId[AGENT],
        'private rows clear while sibling is still physically held',
      )
      .toBeUndefined();
    expect
      .soft(rendererEventRecovery.captureAuthority('agents:' + JSON.stringify([WS])).isCurrent())
      .toBe(false);
    expect(h.reads('agent.list')).toHaveLength(1);
    h.socket.receive({ id: list.id, result: { agents: [agent('Late private')], retiredCount: 0 } });
    await flush();
    await flush();
    expect(store.state.agentSessions.byAgentId[AGENT]).toBeUndefined();
    expect(h.reads('agent.list')).toHaveLength(1);
    expect(h.socket.busyPeak).toBe(1);
  });
});
