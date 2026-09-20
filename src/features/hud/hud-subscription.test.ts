import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport: the WSS seam is replaced by the scripted MockBackendTransport
// so no request reaches a real daemon. The REAL configured store is exercised:
// PROTOCOL-shaped events.event notifications drive the hud slice end to end.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

// Neutralize the daemon-health middleware: its own 10s system.status poll
// would otherwise hit the SAME mocked transport at nondeterministic times,
// breaking the "the HUD subscription issues NO system.status request"
// assertions below. Its slice stays real — tests dispatch the poll/connection
// actions directly to drive the selectHudSystem view.
vi.mock('$store/renderer/middlewares/daemon-health-service', () => ({
  createDaemonHealthMiddleware:
    () => () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  disposeDaemonHealthService: () => {},
}));

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../test/mocks/backend-transport.mock';
import { store as appStore } from '$store/renderer/store';
import {
  selectHudActive,
  selectHudFeed,
  selectHudAttentionByWorkspaceId,
  selectHudRateHistory,
  selectHudSystem,
  selectHudUsage,
  selectHudUsageError,
  selectHudWorkspaceCards,
} from '$store/renderer/slices/hud/hud-selectors';
import {
  HUD_FAILED_SUMMARY_ROW_READ_CAP,
  HUD_RATE_HISTORY_LIMIT,
  HUD_RATE_HISTORY_POLL_MS,
  HUD_REPLACE_GROUP,
  HUD_SUBSCRIBE_EVENT_TYPES,
  hudSaga,
} from '$store/renderer/slices/hud/sagas/hud-saga';
import { HUD_FEED_EVENT_TYPES } from './hud-feed-mapper';
import {
  connectionStatusChanged,
  heartbeatFailed,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import {
  bulkUpsertSessions,
  removeWorkspaceSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { hydrateAgentsRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { hudActivated, hudDeactivated } from '$store/renderer/slices/hud/hud-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import type { AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

const WS_ID = '11111111-1111-4111-8111-111111111111';
const SUB_ID = 'ws-sub-7';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal active workspace entity for the agent-hydration pass. */
function makeHudWorkspace(id: string): Workspace {
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id.slice(0, 8)}`,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Workspace;
}

/** Zeroed §5.36 UsageTotals with overrides (`thoughtTokens` omitted at zero). */
function totals(overrides: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

/**
 * Zeroed §5.39 RateSample counters — unlike §5.36 totals these are DENSE, so
 * `thoughtTokens` is always present (`0` included).
 */
function sampleTotals(overrides: Partial<Record<string, number>> = {}) {
  return { ...totals(), thoughtTokens: 0, ...overrides };
}

/** PROTOCOL §5.36-shaped stats.getUsage result (arrays elided to shape). */
function usageResult() {
  return {
    totals: totals({ inputTokens: 130, outputTokens: 45, thoughtTokens: 20 }),
    runs: 3,
    sessions: 1,
    longestRunMs: 9000,
    linesAdded: 10,
    linesDeleted: 3,
    byModel: [{ model: 'Opus 4.8', runs: 2, ...totals({ inputTokens: 100, outputTokens: 40 }) }],
    byProvider: [
      { provider: 'claude-code', runs: 2, ...totals({ inputTokens: 100, outputTokens: 40 }) },
    ],
    byHourOfDay: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      ...totals(i === 23 ? { inputTokens: 130, outputTokens: 45, thoughtTokens: 20 } : {}),
    })),
    byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...totals() })),
    availablePeriods: { months: ['2026-07'], years: ['2026'] },
  };
}

/** PROTOCOL §5.39-shaped stats.getRateHistory result (gap-free minute series). */
function rateHistoryResult() {
  return {
    samples: Array.from({ length: HUD_RATE_HISTORY_LIMIT }, (_, i) => ({
      bucketUtc: `2026-07-30T14:${String(i).padStart(2, '0')}:00Z`,
      ...sampleTotals(
        i === HUD_RATE_HISTORY_LIMIT - 1
          ? { inputTokens: 100, outputTokens: 70, thoughtTokens: 15 }
          : {},
      ),
    })),
  };
}

function scriptHappyBackend(backend: MockBackendHandle) {
  backend.onSubscribe(() => ({ subscriptionId: SUB_ID }));
  backend.onRequest('stats.getUsage', () => usageResult());
  backend.onRequest('stats.getRateHistory', () => rateHistoryResult());
  // PROTOCOL §5.5 daemon-global busy set — nothing mid-turn by default.
  backend.onRequest('agent.listActive', () => ({ streams: [] }));
}

function startHudSubscription(): () => void {
  appStore.dispatch(hudActivated());
  return () => appStore.dispatch(hudDeactivated());
}

describe('HUD subscription (mock backend, real store)', () => {
  let backend: MockBackendHandle;
  let stop: (() => void) | undefined;
  let stopSaga: (() => void) | undefined;

  beforeAll(() => {
    appStore.init();
    stopSaga = appStore.runSaga(hudSaga);
  });
  afterAll(() => stopSaga?.());
  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    resetMockBackend();
  });

  it('issues the global events.subscribe with replaceGroup and no workspaceId (PROTOCOL §6.1)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    expect(backend.subscribes).toEqual([
      { eventTypes: [...HUD_SUBSCRIBE_EVENT_TYPES], replaceGroup: HUD_REPLACE_GROUP },
    ]);
    // The subscribe set is the feed families plus the takeover-only families
    // (agent:stream:end carries the §7.1 question trailingBlocks).
    expect(HUD_SUBSCRIBE_EVENT_TYPES).toEqual(
      expect.arrayContaining([...HUD_FEED_EVENT_TYPES, 'agent:stream:end']),
    );
    expect(selectHudActive.select(appStore.state)).toBe(true);
  });

  it('fetches the 24h stats.getUsage rollup on start — and NEVER its own system.status', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    const statsCall = backend.requests.find((r) => r.method === 'stats.getUsage');
    expect(statsCall?.params).toEqual({
      period: '24h',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const usage = selectHudUsage.select(appStore.state);
    expect(usage?.totals).toEqual(
      totals({ inputTokens: 130, outputTokens: 45, thoughtTokens: 20 }),
    );
    expect(usage?.runs).toBe(3);
    expect(usage?.rateSamples).toHaveLength(24);
    // 130 + 45 + 20 thoughts — every counter counts toward the hourly bucket.
    expect(usage?.rateSamples[23]).toEqual({ hour: 23, tokens: 195 });

    // The daemon ONLINE signal comes from the daemon-health slice (the
    // middleware's 10s poll) — the HUD adds no system.status fetch of its own.
    expect(backend.requests.filter((r) => r.method === 'system.status')).toEqual([]);
  });

  it('derives online/version/uptime from the daemon-health slice (live, no HUD fetch)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    // Before any health signal: down → OFFLINE, no version/uptime.
    expect(selectHudSystem.select(appStore.state)).toEqual({
      online: false,
      uptimeSeconds: null,
      version: null,
      fetchedAtMs: null,
      remoteHostname: null,
    });

    // The middleware's poll result folds into daemon-health → the HUD view.
    appStore.dispatch(connectionStatusChanged('connected'));
    appStore.dispatch(
      systemStatusSuccess(
        {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          clients: 1,
          agents: 2,
          version: '1.2.3',
          uptimeSeconds: 4200,
          protocolVersion: '3',
          host: { os: 'macos', arch: 'arm64', hasDisplay: true, locality: 'local' },
        },
        '2026-08-03T00:00:10.000Z',
        selectDaemonConnectionGeneration.select(appStore.state),
      ),
    );
    const system = selectHudSystem.select(appStore.state);
    expect(system.online).toBe(true);
    expect(system.uptimeSeconds).toBe(4200);
    expect(system.version).toBe('1.2.3');
    expect(system.fetchedAtMs).toBe(Date.parse('2026-08-03T00:00:10.000Z'));

    // degraded (poll failure while connected) still renders ONLINE; only a
    // 'down' transition flips the indicator OFFLINE — stats survive for the
    // frozen uptime + version render.
    appStore.dispatch(heartbeatFailed());
    expect(selectHudSystem.select(appStore.state).online).toBe(true);
    appStore.dispatch(connectionStatusChanged('disconnected'));
    const downSystem = selectHudSystem.select(appStore.state);
    expect(downSystem.online).toBe(false);
    expect(downSystem.version).toBe('1.2.3');
    expect(downSystem.uptimeSeconds).toBe(4200);
  });

  it('fetches stats.getRateHistory on start and polls it every 15s (PROTOCOL §5.39)', async () => {
    vi.useFakeTimers();
    try {
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await vi.advanceTimersByTimeAsync(0);

      const calls = () => backend.requests.filter((r) => r.method === 'stats.getRateHistory');
      expect(calls()).toHaveLength(1);
      expect(calls()[0].params).toEqual({ limit: HUD_RATE_HISTORY_LIMIT });

      const history = selectHudRateHistory.select(appStore.state);
      expect(history?.samples).toHaveLength(HUD_RATE_HISTORY_LIMIT);
      expect(history?.samples[HUD_RATE_HISTORY_LIMIT - 1]).toEqual({
        bucketUtc: '2026-07-30T14:39:00Z',
        ...sampleTotals({ inputTokens: 100, outputTokens: 70, thoughtTokens: 15 }),
      });

      await vi.advanceTimersByTimeAsync(HUD_RATE_HISTORY_POLL_MS);
      expect(calls()).toHaveLength(2);

      stop?.();
      stop = undefined;
      await vi.advanceTimersByTimeAsync(HUD_RATE_HISTORY_POLL_MS * 2);
      expect(calls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('captures §7.1 question blocks from agent:stream:end into the slice', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: 'agent:stream:end',
      workspaceId: WS_ID,
      id: 'evt-qc1',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:00:00.000Z',
      data: {
        agentId: 'agent-1',
        messageId: 'msg-1',
        trailingBlocks: [
          {
            type: 'resource',
            resource: {
              uri: 'intent-question://tar-1',
              name: 'Auth method',
              mimeType: 'application/vnd.intent.question+json',
              text: JSON.stringify({
                attachmentId: 'tar-1',
                header: 'Auth method',
                question: 'Which auth flow?',
                multiSelect: false,
              }),
            },
          },
        ],
      },
    });
    await flush();

    expect(appStore.state.hud.questionsByAgentId['agent-1']).toEqual({
      workspaceId: WS_ID,
      agentId: 'agent-1',
      messageId: 'msg-1',
      header: 'Auth method',
      question: 'Which auth flow?',
      ts: '2026-07-30T12:00:00.000Z',
    });

    // Persistent pendingness: a plain user message — and the turn it starts
    // — no longer supersede the question, so a running transition leaves the
    // capture in place.
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-qc2',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:01:00.000Z',
      data: { agentId: 'agent-1', status: 'active', isActive: true },
    });
    await flush();
    expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which auth flow?');

    // The daemon's rollup is the release signal: a pending question holds
    // `needs_attention` up, so leaving it means answered or dismissed.
    backend.pushEvent({
      type: 'workspace:displayStatus-changed',
      workspaceId: WS_ID,
      id: 'evt-qc2b',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:01:30.000Z',
      data: { displayStatus: 'in_progress' },
    });
    await flush();
    expect(appStore.state.hud.questionsByAgentId['agent-1']).toBeUndefined();

    // A fresh capture pends again.
    backend.pushEvent({
      type: 'agent:stream:end',
      workspaceId: WS_ID,
      id: 'evt-qc3',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:02:00.000Z',
      data: {
        agentId: 'agent-1',
        messageId: 'msg-2',
        trailingBlocks: [
          {
            type: 'resource',
            resource: {
              uri: 'intent-question://tar-2',
              name: 'Deploy target',
              mimeType: 'application/vnd.intent.question+json',
              text: JSON.stringify({
                attachmentId: 'tar-2',
                header: 'Deploy target',
                question: 'Which target?',
                multiSelect: false,
              }),
            },
          },
        ],
      },
    });
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-qc4',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:02:01.000Z',
      data: { agentId: 'agent-1', status: 'idle', isActive: false },
    });
    await flush();
    expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which target?');
  });

  it('keeps a captured question when the workspace transitions to a status OUTRANKING needs_attention', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: 'agent:stream:end',
      workspaceId: WS_ID,
      id: 'evt-hq1',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:00:00.000Z',
      data: {
        agentId: 'agent-1',
        messageId: 'msg-1',
        trailingBlocks: [
          {
            type: 'resource',
            resource: {
              uri: 'intent-question://tar-1',
              name: 'Auth method',
              mimeType: 'application/vnd.intent.question+json',
              text: JSON.stringify({
                attachmentId: 'tar-1',
                header: 'Auth method',
                question: 'Which auth flow?',
                multiSelect: false,
              }),
            },
          },
        ],
      },
    });
    await flush();
    expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which auth flow?');

    // `failed`/`blocked` outrank `needs_attention` in the rollup, so they MASK
    // a still-pending question rather than resolving it — releasing here would
    // drop a question the user still owes an answer to.
    for (const displayStatus of ['failed', 'blocked'] as const) {
      backend.pushEvent({
        type: 'workspace:displayStatus-changed',
        workspaceId: WS_ID,
        id: `evt-hq-${displayStatus}`,
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:01:00.000Z',
        data: { displayStatus },
      });
      await flush();
      expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which auth flow?');
    }

    // A status ranking below it still releases.
    backend.pushEvent({
      type: 'workspace:displayStatus-changed',
      workspaceId: WS_ID,
      id: 'evt-hq-idle',
      subscriptionId: SUB_ID,
      timestamp: '2026-07-30T12:02:00.000Z',
      data: { displayStatus: 'idle' },
    });
    await flush();
    expect(appStore.state.hud.questionsByAgentId['agent-1']).toBeUndefined();
  });

  it('maps a PROTOCOL-shaped agent:failed event into an err feed row, newest first', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: 'agent:started',
      workspaceId: WS_ID,
      id: 'evt-1',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-1', agentName: 'Implementor' },
    });
    backend.pushEvent({
      type: 'agent:failed',
      workspaceId: WS_ID,
      id: 'evt-2',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-1', error: 'spawn failed', turnId: 'turn-1' },
    });
    await flush();

    const feed = selectHudFeed.select(appStore.state);
    expect(feed.map((e) => e.id)).toEqual(['evt-2', 'evt-1']);
    expect(feed[0]).toMatchObject({
      colorClass: 'err',
      source: WS_ID,
      kind: 'agent:failed',
      text: 'spawn failed',
      agentId: 'agent-1',
    });
    expect(feed[1]).toMatchObject({ colorClass: 'info', agentName: 'Implementor' });
  });

  it('suppresses agent:created and emits ONE AGENT DELEGATED row on the first running transition', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    // Raw creation: no feed row (the agent has not done anything yet).
    backend.pushEvent({
      type: 'agent:created',
      workspaceId: WS_ID,
      id: 'evt-c1',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-new', name: 'Verifier' },
    });
    await flush();
    expect(selectHudFeed.select(appStore.state)).toEqual([]);

    // First running transition → the one synthetic AGENT DELEGATED row.
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-s1',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-new', status: 'active', isActive: true },
    });
    await flush();
    let feed = selectHudFeed.select(appStore.state);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      id: 'evt-s1',
      kind: 'agent:delegated',
      colorClass: 'info',
      agentId: 'agent-new',
      agentStatus: 'active',
    });

    // Later running transitions keep the normal AGENT RUNNING row — never a
    // second delegation announcement.
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-s2',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-new', status: 'active', isActive: true },
    });
    // Non-running transitions on an unseen agent never consume its first
    // start (waiting is not running work).
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-s3',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-other', status: 'waiting', isActive: false },
    });
    backend.pushEvent({
      type: 'agent:status-changed',
      workspaceId: WS_ID,
      id: 'evt-s4',
      subscriptionId: SUB_ID,
      data: { agentId: 'agent-other', status: 'active', isActive: true },
    });
    await flush();
    feed = selectHudFeed.select(appStore.state);
    expect(feed.map((e) => ({ id: e.id, kind: e.kind }))).toEqual([
      { id: 'evt-s4', kind: 'agent:delegated' },
      { id: 'evt-s3', kind: 'agent:status-changed' },
      { id: 'evt-s2', kind: 'agent:status-changed' },
      { id: 'evt-s1', kind: 'agent:delegated' },
    ]);
  });

  it('fans notable events out to the takeover trigger bus (feed events do not)', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: unknown[] = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    try {
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'task:status-changed',
        workspaceId: WS_ID,
        id: 'evt-t1',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: { noteId: 'n-1', noteTitle: 'Ship takeover', newStatus: 'complete' },
      });
      // Feed-only family: must NOT reach the takeover bus.
      backend.pushEvent({
        type: 'git:commit',
        workspaceId: WS_ID,
        id: 'evt-g1',
        subscriptionId: SUB_ID,
        data: { message: 'feat: x' },
      });
      await flush();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        workspaceId: WS_ID,
        kind: 'task_complete',
        detail: 'Ship takeover',
        changedTaskId: 'n-1',
      });
    } finally {
      unsubscribe();
    }
  });

  it('fans a question-bearing agent:stream:end out as a question_asked trigger (§7.1)', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: unknown[] = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    try {
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'agent:stream:end',
        workspaceId: WS_ID,
        id: 'evt-q1',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: {
          agentId: 'agent-579724c1-fe68-450e-8188-43b7afb964c6',
          messageId: 'msg-1',
          trailingBlocks: [
            {
              type: 'resource',
              resource: {
                uri: 'intent-question://tar-3f9c2a81d0b4',
                name: 'Auth method',
                mimeType: 'application/vnd.intent.question+json',
                text: JSON.stringify({
                  attachmentId: 'tar-3f9c2a81d0b4',
                  header: 'Auth method',
                  question: 'Which authentication method should the endpoint use?',
                  options: [{ label: 'OAuth' }, { label: 'API key' }],
                  multiSelect: false,
                }),
              },
            },
          ],
        },
      });
      // A question-free terminal event must NOT trigger.
      backend.pushEvent({
        type: 'agent:stream:end',
        workspaceId: WS_ID,
        id: 'evt-q2',
        subscriptionId: SUB_ID,
        data: { agentId: 'agent-579724c1-fe68-450e-8188-43b7afb964c6', messageId: 'msg-2' },
      });
      await flush();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        workspaceId: WS_ID,
        kind: 'question_asked',
        detail: 'Which authentication method should the endpoint use?',
        signal: 'question',
      });
      // Terminal stream events never render in the feed.
      expect(selectHudFeed.select(appStore.state)).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('fans agent:attention-requested out as a blocker/discussion takeover, feed-free (§6.5)', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: unknown[] = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    try {
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'agent:attention-requested',
        workspaceId: WS_ID,
        id: 'evt-att1',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: {
          agentId: 'agent-579724c1-fe68-450e-8188-43b7afb964c6',
          agentName: 'Verifier',
          kind: 'blocker',
          reason: 'Sandbox network is down',
        },
      });
      // A delegated agent's request (parentAgentId) never takes over.
      backend.pushEvent({
        type: 'agent:attention-requested',
        workspaceId: WS_ID,
        id: 'evt-att2',
        subscriptionId: SUB_ID,
        data: {
          agentId: 'agent-579724c1-fe68-450e-8188-43b7afb964c6',
          agentName: 'Implementor',
          kind: 'discussion',
          reason: 'Which rollout order?',
          parentAgentId: 'agent-579724c1-fe68-450e-8188-43b7afb96400',
        },
      });
      await flush();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        workspaceId: WS_ID,
        kind: 'question_asked',
        detail: 'Sandbox network is down',
        agentName: 'Verifier',
        signal: 'blocker',
      });
      // Attention requests never render in the feed.
      expect(selectHudFeed.select(appStore.state)).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('resolves a UUID-only agent event to its store display name (never a raw id)', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: Array<{ detail?: string }> = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    const agentId = 'agent-579724c1-fe68-450e-8188-43b7afb964c6';
    try {
      appStore.dispatch(
        bulkUpsertSessions([
          {
            id: agentId,
            workspaceId: WS_ID,
            name: 'Implementor',
            messages: [],
          } as unknown as AgentSession,
        ]),
      );
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'agent:started',
        workspaceId: WS_ID,
        id: 'evt-n1',
        subscriptionId: SUB_ID,
        data: { agentId },
      });
      backend.pushEvent({
        type: 'agent:started',
        workspaceId: WS_ID,
        id: 'evt-n2',
        subscriptionId: SUB_ID,
        data: { agentId: 'agent-00000000-0000-4000-8000-000000000000' },
      });
      await flush();

      expect(received.map((t) => t.detail)).toEqual(['Implementor', '']);
    } finally {
      unsubscribe();
    }
  });

  it.each(['none', 'unknown', 'known'])('gates HUD hydration (prior: %s)', async (priorRead) => {
    const hasLeadingRead = priorRead !== 'none';
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: Array<{ kind: string; detail?: string }> = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    const WS_RACE_ID = '44444444-4444-4444-8444-444444444444';
    const OTHER_WS_ID = '55555555-5555-4555-8555-555555555555';
    const MUTED_ID = 'agent-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const LOUD_ID = 'agent-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    // agent.list resolves only when the test says so — the subscribe wins the
    // race, exactly the window the bot finding describes.
    let releaseList: (() => void) | undefined;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    let releaseLeading!: () => void;
    const leadingGate = new Promise<void>((resolve) => {
      releaseLeading = resolve;
    });
    let workspaceReads = 0;
    scriptHappyBackend(backend);
    backend.onRequest('agent.list', async (params) => {
      const { workspaceId } = params as { workspaceId: string };
      if (workspaceId !== WS_RACE_ID) return { agents: [] };
      workspaceReads += 1;
      if (hasLeadingRead && workspaceReads === 1) {
        await leadingGate;
        return { agents: [], retiredCount: 0 };
      }
      await listGate;
      return {
        agents: [
          {
            id: MUTED_ID,
            workspaceId: WS_RACE_ID,
            name: 'Muted worker',
            status: 'running',
            messageCount: 1,
            notificationsMuted: true,
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: false },
          },
          {
            id: LOUD_ID,
            workspaceId: WS_RACE_ID,
            name: 'Loud worker',
            status: 'running',
            messageCount: 1,
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: false },
          },
        ],
      };
    });
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_RACE_ID)));
    const stopLifecycleReadSaga = appStore.runSaga(lifecycleReadSaga);
    try {
      if (hasLeadingRead) {
        appStore.dispatch(hydrateAgentsRequested(WS_RACE_ID));
        await flush();
      }
      if (priorRead === 'known') {
        appStore.dispatch(
          bulkUpsertSessions([
            {
              id: MUTED_ID,
              workspaceId: WS_RACE_ID,
              name: 'Stale worker',
              notificationsMuted: false,
              messages: [],
            } as unknown as AgentSession,
          ]),
        );
      }
      stop = startHudSubscription();
      await flush();
      expect(backend.requests.filter((request) => request.method === 'agent.list')).toEqual([
        { method: 'agent.list', params: { workspaceId: WS_RACE_ID, scope: 'topLevel' } },
      ]);
      if (priorRead !== 'known') {
        expect(appStore.state.agentSessions?.byAgentId[MUTED_ID]).toBeUndefined();
      }
      // Later triggers may replace HUD's action in the coalescer, but must not
      // lose the requirement to finish that trailing read before settling.
      if (hasLeadingRead) {
        appStore.dispatch(hydrateAgentsRequested(WS_RACE_ID));
        appStore.dispatch(hydrateAgentsRequested(WS_RACE_ID));
      }

      // Both agents' first `agent:started` arrive BEFORE the list response.
      for (const [agentId, id] of [
        [MUTED_ID, 'evt-race-1'],
        [LOUD_ID, 'evt-race-2'],
      ]) {
        backend.pushEvent({
          type: 'agent:started',
          workspaceId: WS_RACE_ID,
          id,
          subscriptionId: SUB_ID,
          timestamp: '2026-07-30T12:00:00.000Z',
          data: { agentId },
        });
      }
      backend.pushEvent({
        type: 'agent:failed',
        workspaceId: WS_RACE_ID,
        id: 'evt-race-loud-failed',
        subscriptionId: SUB_ID,
        data: { agentId: LOUD_ID, error: 'second event' },
      });
      await flush();
      // Nothing may take over while the mute state is still unknown.
      expect(received).toEqual([]);

      // A different workspace can finish hydrating without releasing this gate.
      appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(OTHER_WS_ID)));
      await flush();
      expect(backend.requests.filter((request) => request.method === 'agent.list')).toEqual([
        { method: 'agent.list', params: { workspaceId: WS_RACE_ID, scope: 'topLevel' } },
        { method: 'agent.list', params: { workspaceId: OTHER_WS_ID, scope: 'topLevel' } },
      ]);
      expect(received).toEqual([]);

      if (hasLeadingRead) {
        // HUD's request is trailing; settling the older read must not open its gate.
        releaseLeading();
        await flush();
        expect(backend.requests.filter((request) => request.method === 'agent.list')).toEqual([
          { method: 'agent.list', params: { workspaceId: WS_RACE_ID, scope: 'topLevel' } },
          { method: 'agent.list', params: { workspaceId: OTHER_WS_ID, scope: 'topLevel' } },
          { method: 'agent.list', params: { workspaceId: WS_RACE_ID, scope: 'topLevel' } },
        ]);
        expect(received).toEqual([]);
      }

      releaseList?.();
      await flush();
      await flush();

      // The hydrated list decides: the unmuted agent's takeover fires, the
      // muted agent's is dropped for good.
      expect(received.map(({ kind, detail }) => ({ kind, detail }))).toEqual([
        { kind: 'agent_started', detail: 'Loud worker' },
        { kind: 'agent_failed', detail: 'Loud worker: second event' },
      ]);

      // With the list landed, a later event is gated synchronously.
      backend.pushEvent({
        type: 'agent:failed',
        workspaceId: WS_RACE_ID,
        id: 'evt-race-3',
        subscriptionId: SUB_ID,
        data: { agentId: MUTED_ID, error: 'boom' },
      });
      await flush();
      expect(received).toHaveLength(2);
    } finally {
      stop?.();
      stopLifecycleReadSaga();
      releaseLeading();
      releaseList?.();
      unsubscribe();
      appStore.dispatch(removeWorkspaceSessions(WS_RACE_ID));
      appStore.dispatch(removeWorkspaceEntity(WS_RACE_ID));
      appStore.dispatch(removeWorkspaceEntity(OTHER_WS_ID));
    }
  });

  it('point-reads a muted agent OMITTED from the bounded hydration via one coalesced agent.get before gating its takeover (intent#5531)', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: Array<{ kind: string; detail?: string }> = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    const WS_OMIT_ID = '77777777-7777-4777-8777-777777777777';
    const MUTED_CHILD_ID = 'agent-cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const LOUD_CHILD_ID = 'agent-dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const GONE_ID = 'agent-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    scriptHappyBackend(backend);
    // The topLevel bin is empty and nothing is busy: both idle delegated
    // children are absent from the initial reads — exactly the sessions the
    // bounded hydration no longer carries.
    backend.onRequest('agent.list', () => ({ agents: [], retiredCount: 0 }));
    let releaseGet: (() => void) | undefined;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    backend.onRequest('agent.get', async (params) => {
      const { agentId } = params as { agentId: string };
      await getGate;
      if (agentId === MUTED_CHILD_ID || agentId === LOUD_CHILD_ID) {
        return {
          agent: {
            id: agentId,
            workspaceId: WS_OMIT_ID,
            name: agentId === MUTED_CHILD_ID ? 'Muted child' : 'Loud child',
            status: 'idle',
            messageCount: 2,
            parentAgentId: 'agent-11111111-aaaa-4aaa-8aaa-111111111111',
            ...(agentId === MUTED_CHILD_ID ? { notificationsMuted: true } : {}),
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:30:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: true, delegationDepth: 1 },
          },
        };
      }
      throw Object.assign(new Error(`agent not found: ${agentId}`), {
        rpcCode: -32602,
        data: { code: 'not-found' },
      });
    });
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_OMIT_ID)));
    try {
      stop = startHudSubscription();
      await flush();
      await flush();
      expect(appStore.state.agentSessions?.byAgentId[MUTED_CHILD_ID]).toBeUndefined();
      const getCalls = () =>
        backend.requests
          .filter((r) => r.method === 'agent.get')
          .map((r) => (r.params as { agentId: string }).agentId);
      expect(getCalls()).toEqual([]);

      // Hydration has landed; the omitted agents now wake up. The muted
      // child's burst (started + failed) must coalesce into ONE point read.
      for (const [agentId, id, type, extra] of [
        [MUTED_CHILD_ID, 'evt-omit-1', 'agent:started', {}],
        [MUTED_CHILD_ID, 'evt-omit-2', 'agent:failed', { error: 'boom' }],
        [LOUD_CHILD_ID, 'evt-omit-3', 'agent:started', {}],
        [GONE_ID, 'evt-omit-4', 'agent:started', {}],
      ] as const) {
        backend.pushEvent({
          type,
          workspaceId: WS_OMIT_ID,
          id,
          subscriptionId: SUB_ID,
          timestamp: '2026-07-30T12:00:00.000Z',
          data: { agentId, ...extra },
        });
      }
      await flush();
      // Nothing may take over while the mute state is still unknown, and
      // the reads are bounded by the distinct unknown agents, not the events.
      expect(received).toEqual([]);
      expect(getCalls().sort()).toEqual([GONE_ID, LOUD_CHILD_ID, MUTED_CHILD_ID].sort());

      releaseGet?.();
      await flush();
      await flush();

      // The point read decides: the muted child's takeovers are dropped, the
      // unmuted child's fires, and a vanished session gates as unmuted.
      expect(received.map((t) => ({ kind: t.kind, detail: t.detail }))).toEqual([
        { kind: 'agent_started', detail: 'Loud child' },
        { kind: 'agent_started', detail: '' },
      ]);
      expect(appStore.state.agentSessions?.byAgentId[MUTED_CHILD_ID]?.notificationsMuted).toBe(
        true,
      );

      // With the session landed, a later event is gated synchronously — no
      // second read.
      backend.pushEvent({
        type: 'agent:started',
        workspaceId: WS_OMIT_ID,
        id: 'evt-omit-5',
        subscriptionId: SUB_ID,
        data: { agentId: MUTED_CHILD_ID },
      });
      await flush();
      expect(received).toHaveLength(2);
      expect(getCalls()).toHaveLength(3);
    } finally {
      unsubscribe();
      appStore.dispatch(removeWorkspaceEntity(WS_OMIT_ID));
    }
  });
  it.each(['empty', 'failed', 'cancelled', 'deactivated'] as const)(
    'settles a pending takeover after %s hydration without stranding or reviving the HUD',
    async (outcome) => {
      const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
      const received: Array<{ kind: string }> = [];
      const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
      const workspaceId = '66666666-6666-4666-8666-666666666666';
      let releaseList!: () => void;
      const listGate = new Promise<void>((resolve) => {
        releaseList = resolve;
      });
      scriptHappyBackend(backend);
      backend.onRequest('agent.list', async () => {
        await listGate;
        if (outcome === 'failed') throw new Error('list unavailable');
        return { agents: [], retiredCount: 0 };
      });
      appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(workspaceId)));
      const stopLifecycleReadSaga = appStore.runSaga(lifecycleReadSaga);
      try {
        stop = startHudSubscription();
        await flush();
        expect(backend.requests.filter((request) => request.method === 'agent.list')).toEqual([
          { method: 'agent.list', params: { workspaceId, scope: 'topLevel' } },
        ]);
        backend.pushEvent({
          type: 'agent:started',
          workspaceId,
          id: 'evt-pending-start',
          subscriptionId: SUB_ID,
          data: { agentId: 'agent-cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        });
        backend.pushEvent({
          type: 'task:status-changed',
          workspaceId,
          id: 'evt-pending-task',
          subscriptionId: SUB_ID,
          data: { noteId: 'task-1', newStatus: 'complete' },
        });
        await flush();
        expect(received).toEqual([]);

        if (outcome === 'deactivated') stop();
        if (outcome === 'cancelled') stopLifecycleReadSaga();
        releaseList();
        await flush();
        expect(received.map(({ kind }) => kind)).toEqual(
          outcome === 'deactivated' ? [] : ['agent_started', 'task_complete'],
        );
      } finally {
        stop?.();
        stopLifecycleReadSaga();
        releaseList();
        unsubscribe();
        appStore.dispatch(removeWorkspaceEntity(workspaceId));
      }
    },
  );

  it('fires the STATUS UPDATE takeover only on statusMessage text changes, never on displayStatus', async () => {
    const { onTakeoverTrigger } = await import('./takeover/hud-takeover-bus');
    const received: Array<{ kind?: string; detail?: string }> = [];
    const unsubscribe = onTakeoverTrigger((trigger) => received.push(trigger));
    try {
      scriptHappyBackend(backend);
      stop = startHudSubscription();
      await flush();

      // displayStatus transition (e.g. → in_progress): cards/counters update
      // live but NO takeover is enqueued.
      backend.pushEvent({
        type: 'workspace:displayStatus-changed',
        workspaceId: WS_ID,
        id: 'evt-ds-1',
        subscriptionId: SUB_ID,
        data: { workspaceId: WS_ID, displayStatus: 'in_progress' },
      });
      // statusMessage text change (workspace:updated changes delta, §6.5):
      // fires the status_update takeover with the new text.
      backend.pushEvent({
        type: 'workspace:updated',
        workspaceId: WS_ID,
        id: 'evt-su-1',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: { workspaceId: WS_ID, changes: { statusMessage: 'PR #123 open, waiting on CI.' } },
      });
      // Same-text re-emit → deduped, no second takeover.
      backend.pushEvent({
        type: 'workspace:updated',
        workspaceId: WS_ID,
        id: 'evt-su-2',
        subscriptionId: SUB_ID,
        data: { workspaceId: WS_ID, changes: { statusMessage: 'PR #123 open, waiting on CI.' } },
      });
      // Cleared/empty message → no takeover.
      backend.pushEvent({
        type: 'workspace:updated',
        workspaceId: WS_ID,
        id: 'evt-su-3',
        subscriptionId: SUB_ID,
        data: { workspaceId: WS_ID, changes: { statusMessage: '' } },
      });
      // New text → fires again.
      backend.pushEvent({
        type: 'workspace:updated',
        workspaceId: WS_ID,
        id: 'evt-su-4',
        subscriptionId: SUB_ID,
        data: { workspaceId: WS_ID, changes: { statusMessage: 'Ready to review and merge.' } },
      });
      await flush();

      expect(received).toEqual([
        expect.objectContaining({
          workspaceId: WS_ID,
          kind: 'status_update',
          detail: 'PR #123 open, waiting on CI.',
        }),
        expect.objectContaining({
          workspaceId: WS_ID,
          kind: 'status_update',
          detail: 'Ready to review and merge.',
        }),
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('drops notifications tagged with a foreign subscriptionId (§6.3 fan-out dedupe)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: 'agent:started',
      workspaceId: WS_ID,
      id: 'evt-foreign',
      subscriptionId: 'ws-sub-other',
      data: { agentId: 'agent-1', agentName: 'Other' },
    });
    await flush();

    expect(selectHudFeed.select(appStore.state)).toEqual([]);
  });

  it("folds workspace:attention-changed into the live attention map ('none' clears)", async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.pushEvent({
      type: 'workspace:attention-changed',
      workspaceId: WS_ID,
      id: 'evt-att-1',
      timestamp: '2026-07-30T12:00:00Z',
      subscriptionId: SUB_ID,
      data: { workspaceId: WS_ID, attention: 'review_required' },
    });
    await flush();
    expect(selectHudAttentionByWorkspaceId.select(appStore.state)).toEqual({
      [WS_ID]: { attention: 'review_required', raisedAtTs: '2026-07-30T12:00:00Z' },
    });

    backend.pushEvent({
      type: 'workspace:attention-changed',
      workspaceId: WS_ID,
      id: 'evt-att-2',
      subscriptionId: SUB_ID,
      data: { workspaceId: WS_ID, attention: 'none' },
    });
    await flush();
    expect(selectHudAttentionByWorkspaceId.select(appStore.state)).toEqual({});
  });

  it('surfaces a stats.getUsage failure as usageError (no fabricated zeros)', async () => {
    backend.onSubscribe(() => ({ subscriptionId: SUB_ID }));
    backend.onRequest('stats.getUsage', () => {
      throw new Error('daemon offline');
    });
    stop = startHudSubscription();
    await flush();

    expect(selectHudUsage.select(appStore.state)).toBeNull();
    expect(selectHudUsageError.select(appStore.state)).toContain('daemon offline');
  });

  it('re-issues the subscribe and refetches rollups on reconnect (RESUB-1)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.triggerReconnect();
    await flush();

    expect(backend.subscribes).toHaveLength(2);
    expect(backend.requests.filter((r) => r.method === 'stats.getUsage')).toHaveLength(2);
    // No HUD-owned system.status refetch — the daemon-health middleware's
    // poll is the single source for the ONLINE/version/uptime signal.
    expect(backend.requests.filter((r) => r.method === 'system.status')).toEqual([]);
  });

  it('releases a captured question whose displayStatus transition was MISSED during an outage', async () => {
    // The live `workspace:displayStatus-changed` event is the only release
    // trigger, so a question answered while the connection was down would stay
    // captured forever. RESUB-1 refetches the workspace list; the reconnect
    // sweep replays the same allowlist decision against its `displayStatus`.
    scriptHappyBackend(backend);
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_ID)));
    try {
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'agent:stream:end',
        workspaceId: WS_ID,
        id: 'evt-rs1',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: {
          agentId: 'agent-1',
          messageId: 'msg-1',
          trailingBlocks: [
            {
              type: 'resource',
              resource: {
                uri: 'intent-question://tar-1',
                name: 'Auth method',
                mimeType: 'application/vnd.intent.question+json',
                text: JSON.stringify({
                  attachmentId: 'tar-1',
                  header: 'Auth method',
                  question: 'Which auth flow?',
                  multiSelect: false,
                }),
              },
            },
          ],
        },
      });
      await flush();
      expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which auth flow?');

      // Outage: no displayStatus event arrives. On reconnect the refetched
      // workspace lands with a releasing status.
      backend.triggerReconnect();
      appStore.dispatch(
        setWorkspaceEntity({ ...makeHudWorkspace(WS_ID), displayStatus: 'idle' } as Workspace),
      );
      await flush();
      await flush();
      expect(appStore.state.hud.questionsByAgentId['agent-1']).toBeUndefined();
    } finally {
      appStore.dispatch(removeWorkspaceEntity(WS_ID));
    }
  });

  it('the reconnect sweep never clears a workspace still holding attention', async () => {
    scriptHappyBackend(backend);
    appStore.dispatch(
      setWorkspaceEntity({
        ...makeHudWorkspace(WS_ID),
        displayStatus: 'needs_attention',
      } as Workspace),
    );
    try {
      stop = startHudSubscription();
      await flush();

      backend.pushEvent({
        type: 'agent:stream:end',
        workspaceId: WS_ID,
        id: 'evt-rs2',
        subscriptionId: SUB_ID,
        timestamp: '2026-07-30T12:00:00.000Z',
        data: {
          agentId: 'agent-1',
          messageId: 'msg-1',
          trailingBlocks: [
            {
              type: 'resource',
              resource: {
                uri: 'intent-question://tar-1',
                name: 'Auth method',
                mimeType: 'application/vnd.intent.question+json',
                text: JSON.stringify({
                  attachmentId: 'tar-1',
                  header: 'Auth method',
                  question: 'Which auth flow?',
                  multiSelect: false,
                }),
              },
            },
          ],
        },
      });
      await flush();

      backend.triggerReconnect();
      appStore.dispatch(
        setWorkspaceEntity({
          ...makeHudWorkspace(WS_ID),
          displayStatus: 'needs_attention',
          updatedAt: '2026-07-30T12:05:00Z',
        } as Workspace),
      );
      await flush();
      await flush();
      expect(appStore.state.hud.questionsByAgentId['agent-1']?.question).toBe('Which auth flow?');
    } finally {
      appStore.dispatch(removeWorkspaceEntity(WS_ID));
    }
  });

  it('stop() unsubscribes, removes listeners, and clears the slice (no leaks)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();
    expect(backend.notificationHandlerCount).toBe(1);
    expect(backend.reconnectHandlerCount).toBe(1);

    stop();
    stop = undefined;
    await flush();

    expect(backend.unsubscribes).toEqual([SUB_ID]);
    expect(backend.notificationHandlerCount).toBe(0);
    expect(backend.reconnectHandlerCount).toBe(0);
    expect(selectHudActive.select(appStore.state)).toBe(false);
    expect(selectHudFeed.select(appStore.state)).toEqual([]);
  });

  it('hydrates the topLevel agent.list bin for every visible workspace on open and folds lastAgentResponse in (§5.5, intent#5531)', async () => {
    const WS2_ID = '22222222-2222-4222-8222-222222222222';
    const AGENT_ID = 'agent-11111111-aaaa-4aaa-8aaa-111111111111';
    scriptHappyBackend(backend);
    // PROTOCOL §5.5 AgentLite projection: messages stripped, persisted
    // lastAgentResponse present — no live status event is pushed in this test.
    backend.onRequest('agent.list', (params) => {
      const { workspaceId } = params as { workspaceId: string };
      if (workspaceId !== WS_ID) return { agents: [], retiredCount: 0 };
      return {
        agents: [
          {
            id: AGENT_ID,
            workspaceId: WS_ID,
            name: 'Implementor',
            status: 'idle',
            messageCount: 12,
            lastAgentResponse: 'All three tsc projects pass',
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: false },
          },
        ],
        retiredCount: 0,
        scopeCounts: { topLevel: 1, delegated: 0, background: 0 },
      };
    });
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_ID)));
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS2_ID)));
    const stopLifecycleReadSaga = appStore.runSaga(lifecycleReadSaga);
    try {
      stop = startHudSubscription();
      await flush();
      await flush();

      // One SCOPED agent.list per visible workspace, no repeats — never the
      // unscoped all-rows read (intent-hq/intent#5531: that frame passed 1 MiB
      // at 459 sessions, multiplied here by the workspace count).
      const listCalls = () => backend.requests.filter((r) => r.method === 'agent.list');
      expect(listCalls().map((r) => r.params)).toEqual(
        expect.arrayContaining([
          { workspaceId: WS_ID, scope: 'topLevel' },
          { workspaceId: WS2_ID, scope: 'topLevel' },
        ]),
      );
      expect(listCalls()).toHaveLength(2);
      // The busy set is read ONCE for the whole pass, not once per workspace.
      const listActiveCalls = () => backend.requests.filter((r) => r.method === 'agent.listActive');
      expect(listActiveCalls()).toHaveLength(1);
      // No busy agent → no point reads.
      expect(backend.requests.filter((r) => r.method === 'agent.get')).toEqual([]);

      // The AgentLite hydration reached the session slice: the HUD card line
      // source (`lastAgentResponse`) is present without any live event.
      expect(appStore.state.agentSessions?.byAgentId[AGENT_ID]?.lastAgentResponse).toBe(
        'All three tsc projects pass',
      );

      // A workspace that appears AFTER open hydrates too (store-listener pass)…
      const WS3_ID = '33333333-3333-4333-8333-333333333333';
      appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS3_ID)));
      await flush();
      expect(listCalls()).toHaveLength(3);
      expect(listActiveCalls()).toHaveLength(2);

      // …and an unrelated store change never re-fetches (once per workspace).
      appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS3_ID)));
      await flush();
      expect(listCalls()).toHaveLength(3);
      expect(listActiveCalls()).toHaveLength(2);
    } finally {
      stopLifecycleReadSaga();
      appStore.dispatch(removeWorkspaceEntity(WS_ID));
      appStore.dispatch(removeWorkspaceEntity(WS2_ID));
      appStore.dispatch(removeWorkspaceEntity('33333333-3333-4333-8333-333333333333'));
    }
  });

  it('point-reads a busy background agent absent from the topLevel bin via agent.get and lands it in the store (intent#5531)', async () => {
    const WS_BG_ID = '55555555-5555-4555-8555-555555555555';
    const WS_OTHER_ID = '66666666-6666-4666-8666-666666666666';
    const TOP_ID = 'agent-11111111-aaaa-4aaa-8aaa-111111111111';
    const BUSY_BG_ID = 'agent-22222222-bbbb-4bbb-8bbb-222222222222';
    const GONE_ID = 'agent-33333333-cccc-4ccc-8ccc-333333333333';
    const FOREIGN_BUSY_ID = 'agent-44444444-dddd-4ddd-8ddd-444444444444';
    scriptHappyBackend(backend);
    backend.onRequest('agent.list', (params) => {
      const { workspaceId } = params as { workspaceId: string };
      if (workspaceId !== WS_BG_ID) return { agents: [], retiredCount: 0 };
      return {
        agents: [
          {
            id: TOP_ID,
            workspaceId: WS_BG_ID,
            name: 'Coordinator',
            status: 'active',
            messageCount: 3,
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: false },
          },
        ],
        retiredCount: 0,
        scopeCounts: { topLevel: 1, delegated: 1, background: 1 },
      };
    });
    // The daemon-global busy set: the top-level row (already listed — no
    // point read), a busy background child (not in the bin — point read), a
    // busy row whose session vanished between the reads, and a busy agent of
    // a workspace that is NOT HUD-visible (never read).
    backend.onRequest('agent.listActive', () => ({
      streams: [
        {
          agentId: TOP_ID,
          sessionId: 's-1',
          workspaceId: WS_BG_ID,
          startTime: '2026-07-30T11:58:00Z',
        },
        {
          agentId: BUSY_BG_ID,
          sessionId: 's-2',
          workspaceId: WS_BG_ID,
          startTime: '2026-07-30T11:59:00Z',
        },
        {
          agentId: GONE_ID,
          sessionId: 's-3',
          workspaceId: WS_BG_ID,
          startTime: '2026-07-30T11:59:30Z',
        },
        {
          agentId: FOREIGN_BUSY_ID,
          sessionId: 's-4',
          workspaceId: WS_OTHER_ID,
          startTime: '2026-07-30T11:59:40Z',
        },
      ],
    }));
    backend.onRequest('agent.get', (params) => {
      const { agentId } = params as { agentId: string };
      if (agentId === BUSY_BG_ID) {
        return {
          agent: {
            id: BUSY_BG_ID,
            workspaceId: WS_BG_ID,
            name: 'Implementor',
            status: 'active',
            messageCount: 7,
            parentAgentId: TOP_ID,
            lastAgentResponse: 'Running the focused vitest suite',
            lastActivity: '2026-07-30T11:59:00Z',
            createdAt: '2026-07-30T10:30:00Z',
            updatedAt: '2026-07-30T11:59:00Z',
            metadata: { isBackground: true, delegationDepth: 1 },
          },
        };
      }
      // PROTOCOL §5.5 / 09-error-codes: a deleted session is -32602 not-found.
      throw Object.assign(new Error(`agent not found: ${agentId}`), {
        rpcCode: -32602,
        data: { code: 'not-found' },
      });
    });
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_BG_ID)));
    try {
      stop = startHudSubscription();
      await flush();
      await flush();
      await flush();

      expect(
        backend.requests.filter((r) => r.method === 'agent.list').map((r) => r.params),
      ).toEqual([{ workspaceId: WS_BG_ID, scope: 'topLevel' }]);
      expect(backend.requests.filter((r) => r.method === 'agent.listActive')).toHaveLength(1);
      // Exactly the busy rows the topLevel bin did not carry, for THIS
      // workspace only — bounded by the busy count, never the session count.
      const getIds = backend.requests
        .filter((r) => r.method === 'agent.get')
        .map((r) => (r.params as { agentId: string }).agentId)
        .sort();
      expect(getIds).toEqual([BUSY_BG_ID, GONE_ID].sort());

      // Both the top-level row and the busy background child are in the
      // store; the vanished row was skipped without failing the hydration.
      const sessions = appStore.state.agentSessions?.byAgentId ?? {};
      expect(sessions[TOP_ID]?.name).toBe('Coordinator');
      expect(sessions[BUSY_BG_ID]?.lastAgentResponse).toBe('Running the focused vitest suite');
      expect(sessions[BUSY_BG_ID]?.metadata?.isBackground).toBe(true);
      expect(sessions[GONE_ID]).toBeUndefined();
      expect(sessions[FOREIGN_BUSY_ID]).toBeUndefined();
      expect(appStore.state.workspaceAgents?.byWorkspaceId?.[WS_BG_ID]?.agentIds).toEqual(
        expect.arrayContaining([TOP_ID, BUSY_BG_ID]),
      );
    } finally {
      appStore.dispatch(removeWorkspaceEntity(WS_BG_ID));
    }
  });

  it('point-reads the summary FAILED child rows (newest first, capped) so a muted failed child never masks the failed snippet (intent#5531)', async () => {
    const WS_FAIL_ID = '88888888-8888-4888-8888-888888888888';
    const TOP_ID = 'agent-11111111-aaaa-4aaa-8aaa-111111111111';
    const IDLE_CHILD_ID = 'agent-99999999-9999-4999-8999-999999999999';
    const failedChildId = (n: number) =>
      `agent-f${n}f${n}f${n}f${n}-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
    const FAILED_COUNT = HUD_FAILED_SUMMARY_ROW_READ_CAP + 2;
    const MUTED_FAILED_ID = failedChildId(FAILED_COUNT - 1);
    const LOUD_FAILED_ID = failedChildId(FAILED_COUNT - 2);
    const failedSummaryRows = Array.from({ length: FAILED_COUNT }, (_, n) => ({
      id: failedChildId(n),
      name: `Worker ${n}`,
      status: 'error',
      parentAgentId: TOP_ID,
      lastActivity: `2026-07-30T11:${String(n).padStart(2, '0')}:00Z`,
      isStreaming: false,
      isResponding: false,
    }));
    scriptHappyBackend(backend);
    backend.onRequest('agent.list', () => ({
      agents: [
        {
          id: TOP_ID,
          workspaceId: WS_FAIL_ID,
          name: 'Coordinator',
          status: 'idle',
          messageCount: 3,
          lastActivity: '2026-07-30T11:59:00Z',
          createdAt: '2026-07-30T10:00:00Z',
          updatedAt: '2026-07-30T11:59:00Z',
          metadata: { isBackground: false },
        },
      ],
      retiredCount: 0,
      scopeCounts: { topLevel: 1, delegated: FAILED_COUNT + 1, background: 0 },
    }));
    backend.onRequest('agent.get', (params) => {
      const { agentId } = params as { agentId: string };
      const n = failedSummaryRows.findIndex((row) => row.id === agentId);
      if (n < 0) {
        throw Object.assign(new Error(`agent not found: ${agentId}`), {
          rpcCode: -32602,
          data: { code: 'not-found' },
        });
      }
      return {
        agent: {
          id: agentId,
          workspaceId: WS_FAIL_ID,
          name: `Worker ${n}`,
          status: 'error',
          messageCount: 4,
          parentAgentId: TOP_ID,
          stopReason: agentId === MUTED_FAILED_ID ? 'muted crash' : `worker ${n} crashed`,
          ...(agentId === MUTED_FAILED_ID ? { notificationsMuted: true } : {}),
          lastActivity: failedSummaryRows[n].lastActivity,
          createdAt: '2026-07-30T10:30:00Z',
          updatedAt: failedSummaryRows[n].lastActivity,
          metadata: { isBackground: false, delegationDepth: 1 },
        },
      };
    });
    appStore.dispatch(
      setWorkspaceEntity({
        ...makeHudWorkspace(WS_FAIL_ID),
        displayStatus: 'failed',
        agentSummary: {
          count: FAILED_COUNT + 2,
          agents: [
            {
              id: TOP_ID,
              name: 'Coordinator',
              status: 'idle',
              lastActivity: '2026-07-30T11:59:00Z',
              isStreaming: false,
              isResponding: false,
            },
            {
              id: IDLE_CHILD_ID,
              name: 'Idle child',
              status: 'idle',
              parentAgentId: TOP_ID,
              lastActivity: '2026-07-30T11:58:00Z',
              isStreaming: false,
              isResponding: false,
            },
            ...failedSummaryRows,
          ],
          agentIds: [TOP_ID, IDLE_CHILD_ID, ...failedSummaryRows.map((row) => row.id)],
        },
      } as Workspace),
    );
    try {
      stop = startHudSubscription();
      await flush();
      await flush();
      await flush();

      // Only the summary's failed rows are point-read — the idle child never
      // is — and only the newest HUD_FAILED_SUMMARY_ROW_READ_CAP of them.
      const getIds = backend.requests
        .filter((r) => r.method === 'agent.get')
        .map((r) => (r.params as { agentId: string }).agentId)
        .sort();
      expect(getIds).toEqual(
        failedSummaryRows
          .slice(2)
          .map((row) => row.id)
          .sort(),
      );
      expect(getIds).toHaveLength(HUD_FAILED_SUMMARY_ROW_READ_CAP);

      const sessions = appStore.state.agentSessions?.byAgentId ?? {};
      expect(sessions[MUTED_FAILED_ID]?.notificationsMuted).toBe(true);
      expect(sessions[MUTED_FAILED_ID]?.stopReason).toBe('muted crash');
      expect(sessions[LOUD_FAILED_ID]?.stopReason).toBe(`worker ${FAILED_COUNT - 2} crashed`);
      expect(sessions[IDLE_CHILD_ID]).toBeUndefined();

      // The card's failed snippet skips the muted child (newest failed row,
      // first in tree order) and surfaces the unmuted child's stopReason.
      const card = selectHudWorkspaceCards
        .select(appStore.state)
        .find((entry) => entry.workspaceId === WS_FAIL_ID);
      expect(card?.attentionSnippet).toEqual({
        kind: 'failed',
        text: `worker ${FAILED_COUNT - 2} crashed`,
      });
      expect(card?.agents.map((agent) => agent.id)).toEqual(
        expect.arrayContaining([MUTED_FAILED_ID, LOUD_FAILED_ID]),
      );
    } finally {
      appStore.dispatch(removeWorkspaceEntity(WS_FAIL_ID));
    }
  });
});
