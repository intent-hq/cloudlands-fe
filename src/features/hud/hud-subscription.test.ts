import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport: the WSS seam is replaced by the scripted MockBackendTransport
// so no request reaches a real daemon. The REAL configured store is exercised:
// PROTOCOL-shaped events.event notifications drive the hud slice end to end.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

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
  selectHudRate5s,
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

/** Zeroed §5.36 UsageTotals with overrides. */
function totals(overrides: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

/** PROTOCOL §5.36-shaped stats.getUsage result (arrays elided to shape). */
function usageResult() {
  return {
    totals: totals({ inputTokens: 130, outputTokens: 45 }),
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
      ...totals(i === 23 ? { inputTokens: 130, outputTokens: 45 } : {}),
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
      ...totals(i === HUD_RATE_HISTORY_LIMIT - 1 ? { inputTokens: 100, outputTokens: 70 } : {}),
    })),
  };
}

function scriptHappyBackend(backend: MockBackendHandle) {
  backend.onSubscribe(() => ({ subscriptionId: SUB_ID }));
  backend.onRequest('stats.getUsage', () => usageResult());
  backend.onRequest('stats.getRateHistory', () => rateHistoryResult());
  backend.onRequest('system.status', () => ({
    running: true,
    listenMode: 'uds',
    transports: ['uds'],
    clients: 1,
    agents: 2,
    maxAgents: 8,
    version: '1.2.3',
    uptimeSeconds: 4200,
    fingerprint: 'fp',
    protocolVersion: 3,
  }));
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
    // (agent:stream:end carries the §7.1 question trailingBlocks) plus the
    // live token-rate family for the TOK/S chart.
    expect(HUD_SUBSCRIBE_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        ...HUD_FEED_EVENT_TYPES,
        'agent:stream:end',
        'workspace:tokenUsage-changed',
      ]),
    );
    expect(selectHudActive.select(appStore.state)).toBe(true);
  });

  it('fetches the 24h stats.getUsage rollup and system.status on start', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    const statsCall = backend.requests.find((r) => r.method === 'stats.getUsage');
    expect(statsCall?.params).toEqual({
      period: '24h',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const usage = selectHudUsage.select(appStore.state);
    expect(usage?.totals).toEqual(totals({ inputTokens: 130, outputTokens: 45 }));
    expect(usage?.runs).toBe(3);
    expect(usage?.rateSamples).toHaveLength(24);
    expect(usage?.rateSamples[23]).toEqual({ hour: 23, tokens: 175 });

    const system = selectHudSystem.select(appStore.state);
    expect(system.online).toBe(true);
    expect(system.uptimeSeconds).toBe(4200);
    expect(system.version).toBe('1.2.3');
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
        tokens: 170,
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

  it('backfills the 5s TOK/S buckets from the rate history exactly once', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    const rate5s = selectHudRate5s.select(appStore.state);
    expect(rate5s.backfilled).toBe(true);
    // The scripted history's minutes are from 14:00 (2026-07-30) — far outside
    // the trailing 200s window of "now" — so no buckets survive the prune, but
    // the one-shot flag is set.
    expect(rate5s.buckets).toEqual([]);
  });

  it('folds workspace:tokenUsage-changed totals deltas into live 5s buckets', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    const usageEvent = (id: string, inputTokens: number) => ({
      type: 'workspace:tokenUsage-changed',
      workspaceId: WS_ID,
      id,
      subscriptionId: SUB_ID,
      data: { workspaceId: WS_ID, tokenUsage: { totals: totals({ inputTokens }) } },
    });
    // First push establishes the cumulative baseline — no delta yet.
    backend.pushEvent(usageEvent('evt-u1', 1000));
    await flush();
    expect(selectHudRate5s.select(appStore.state).buckets).toEqual([]);

    backend.pushEvent(usageEvent('evt-u2', 1150));
    await flush();
    const { buckets } = selectHudRate5s.select(appStore.state);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].tokens).toBe(150);
    // Never a feed row.
    expect(selectHudFeed.select(appStore.state)).toEqual([]);
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
      header: 'Auth method',
      question: 'Which auth flow?',
      ts: '2026-07-30T12:00:00.000Z',
    });
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
      });
      // Terminal stream events never render in the feed.
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
    backend.onRequest('system.status', () => {
      throw new Error('daemon offline');
    });
    stop = startHudSubscription();
    await flush();

    expect(selectHudUsage.select(appStore.state)).toBeNull();
    expect(selectHudUsageError.select(appStore.state)).toContain('daemon offline');
    expect(selectHudSystem.select(appStore.state).online).toBe(false);
  });

  it('re-issues the subscribe and refetches rollups on reconnect (RESUB-1)', async () => {
    scriptHappyBackend(backend);
    stop = startHudSubscription();
    await flush();

    backend.triggerReconnect();
    await flush();

    expect(backend.subscribes).toHaveLength(2);
    expect(backend.requests.filter((r) => r.method === 'stats.getUsage')).toHaveLength(2);
    expect(backend.requests.filter((r) => r.method === 'system.status')).toHaveLength(2);
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
