import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    () =>
    () =>
    (next: (action: unknown) => unknown) =>
    (action: unknown) =>
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
} from '$store/renderer/slices/hud/hud-selectors';
import {
  HUD_RATE_HISTORY_LIMIT,
  HUD_RATE_HISTORY_POLL_MS,
  HUD_REPLACE_GROUP,
  HUD_SUBSCRIBE_EVENT_TYPES,
  startHudSubscription,
} from './hud-subscription';
import { HUD_FEED_EVENT_TYPES } from './hud-feed-mapper';
import {
  connectionStatusChanged,
  heartbeatFailed,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
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
}

describe('HUD subscription (mock backend, real store)', () => {
  let backend: MockBackendHandle;
  let stop: (() => void) | undefined;

  beforeAll(() => appStore.init());
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
    expect(usage?.totals).toEqual(totals({ inputTokens: 130, outputTokens: 45, thoughtTokens: 20 }));
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

  it('hydrates agent.list for every visible workspace on open and folds lastAgentResponse in (§5.5)', async () => {
    const WS2_ID = '22222222-2222-4222-8222-222222222222';
    const AGENT_ID = 'agent-11111111-aaaa-4aaa-8aaa-111111111111';
    scriptHappyBackend(backend);
    // PROTOCOL §5.5 AgentLite projection: messages stripped, persisted
    // lastAgentResponse present — no live status event is pushed in this test.
    backend.onRequest('agent.list', (params) => {
      const { workspaceId } = params as { workspaceId: string };
      if (workspaceId !== WS_ID) return { agents: [] };
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
      };
    });
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS_ID)));
    appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS2_ID)));
    try {
      stop = startHudSubscription();
      await flush();
      await flush();

      // One agent.list per visible workspace, no repeats.
      const listCalls = () => backend.requests.filter((r) => r.method === 'agent.list');
      expect(listCalls().map((r) => (r.params as { workspaceId: string }).workspaceId)).toEqual(
        expect.arrayContaining([WS_ID, WS2_ID]),
      );
      expect(listCalls()).toHaveLength(2);

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

      // …and an unrelated store change never re-fetches (once per workspace).
      appStore.dispatch(setWorkspaceEntity(makeHudWorkspace(WS3_ID)));
      await flush();
      expect(listCalls()).toHaveLength(3);
    } finally {
      appStore.dispatch(removeWorkspaceEntity(WS_ID));
      appStore.dispatch(removeWorkspaceEntity(WS2_ID));
      appStore.dispatch(removeWorkspaceEntity('33333333-3333-4333-8333-333333333333'));
    }
  });
});
