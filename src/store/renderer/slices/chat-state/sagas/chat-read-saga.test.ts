import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getConversation: vi.fn(),
  getMessageBlock: vi.fn(),
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      get: mocks.get,
      getConversation: mocks.getConversation,
      getMessageBlock: mocks.getMessageBlock,
    },
    chat: {},
  },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
  replaceMessages,
} from '../../agent-session/agent-session-slice';
import {
  chatLiveStreamPhaseChanged,
  chatReset,
  chatStateReducer,
  chatTranscriptSnapshotApplied,
  chatTranscriptSnapshotRerequested,
  initializeChatRequested,
  initialState as chatStateInitialState,
  messageBlockHydrationRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationFailed,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { hydratedBlockKey } from '../chat-state-types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  closeTabsByAgentId,
  destroyTabsByOwnerAgent,
  pruneRecentlyClosed,
} from '../../panel-layout/panel-layout-slice';
import {
  clearAllStandingChatSubscriptions,
  markChatSubscriptionAcquiring,
  setReplayableChatSnapshot,
} from '$features/agent/utils/chat-subscription-registry';
import { chatReadSaga } from './chat-read-saga';

const WS = 'ws-chat';
const AGENT = 'agent-chat';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: null,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function message(id: string, text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2026-01-01T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
    ...overrides,
  };
}

function page(
  messages: AgentMessage[],
  overrides: Partial<{
    truncated: boolean;
    totalMessages: number;
    nextToken: string | null;
    prevToken: string | null;
  }> = {},
) {
  return {
    messages,
    truncated: false,
    totalMessages: messages.length,
    nextToken: null,
    prevToken: null,
    ...overrides,
  };
}

function harness() {
  const channel = stdChannel();
  let agentSessions = agentSessionInitialState;
  let chatState = chatStateInitialState;
  const dispatch = vi.fn((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSessions, chatState }) },
    chatReadSaga,
  );
  return { channel, dispatch, task, sessions: () => agentSessions, chat: () => chatState };
}

/** Simulate the chat-subscribe saga applying a seq-0 snapshot to the store. */
function applySnapshot(
  run: ReturnType<typeof harness>,
  messages: AgentMessage[],
  meta: { truncated?: boolean; totalMessages?: number } = {},
) {
  run.dispatch(bulkUpsertSessions([session({ messages })]));
  const oldest = messages.find((m) => typeof m.id === 'string' && m.id.length > 0);
  run.dispatch(
    chatTranscriptSnapshotApplied(AGENT, {
      truncated: meta.truncated ?? false,
      totalMessages: meta.totalMessages ?? messages.length,
      ...(oldest ? { oldestMessageId: oldest.id } : {}),
    }),
  );
}

describe('chatReadSaga (single-transfer hydration)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearAllStandingChatSubscriptions();
  });

  it('settles from the standing subscription snapshot without any conversation fetch', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    applySnapshot(run, [message('m1', 'one'), message('m2', 'two')]);
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    run.task.cancel();
    await run.task.toPromise();
  });

  // Regression (monorepo#1977): a deletion scheduled by ANOTHER window/client
  // (or before an FE restart) is not in this window's local pending-delete
  // registry — the fetched row's daemon-owned `pendingDeleteAt` deadline
  // (PROTOCOL §5.5, v6.7+) is the only signal, and hydration must skip.
  it('skips hydration when the fetched session carries pendingDeleteAt', async () => {
    mocks.get.mockResolvedValue(session({ pendingDeleteAt: '2026-01-01T00:00:15.000Z' }));
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith(AGENT);
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.sessions().byAgentId[AGENT]).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('preserves the pre-existing transcript when the session shell upserts', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('prior', 'prior')] })]));
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['prior']);
    applySnapshot(run, [message('prior', 'prior'), message('new', 'new')]);
    await settle();
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    run.task.cancel();
    await run.task.toPromise();
  });

  // Older history beyond a truncated snapshot window is the infinite
  // scrollback saga's job (fetched on demand as the user scrolls) — hydration
  // must render the window as-is with NO follow-up history fetch.
  it('renders a truncated snapshot window without any follow-up history fetch', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    applySnapshot(run, [message('m-snap-1', 'one'), message('m-snap-2', 'two')], {
      truncated: true,
      totalMessages: 4,
    });
    await settle();
    await settle();

    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
      'm-snap-1',
      'm-snap-2',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('waits for a fresh snapshot on reopen instead of settling off prior-session meta', async () => {
    // Chat closed with non-truncated meta and retained rows [m1, m2]; the
    // conversation grew past the snapshot window while closed. On reopen the
    // hydration must NOT settle off the prior session's meta (teardown
    // cleared it) — it waits for the new subscription's snapshot. The §7.1
    // resume fallback (resumed: false) then serves the newest window
    // [m4, m5]; older history is the scrollback saga's job, so hydration
    // renders the window as-is without any follow-up fetch.
    mocks.get.mockResolvedValue(session());
    const run = harness();

    // Prior session: retained rows + settled snapshot meta.
    run.dispatch(
      bulkUpsertSessions([
        session({
          messages: [
            message('m1', 'one', { timestamp: '2026-01-01T00:00:01.000Z' }),
            message('m2', 'two', { timestamp: '2026-01-01T00:00:02.000Z' }),
          ],
        }),
      ]),
    );
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 2,
        oldestMessageId: 'm1',
        resumed: true,
      }),
    );
    // Chat closes: subscription teardown clears the snapshot meta.
    run.dispatch(chatLiveStreamPhaseChanged(AGENT, null));

    // Reopen: hydration must wait, not settle instantly off stale meta.
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
    expect(mocks.getConversation).not.toHaveBeenCalled();

    // §7.1 resume fallback: the daemon declines the anchor and serves the
    // newest truncated window; the subscribe saga discards the retained
    // store-only rows (resumed: false) and records the fresh meta.
    run.dispatch(
      replaceMessages(AGENT, [
        message('m4', 'four', { timestamp: '2026-01-01T00:00:04.000Z' }),
        message('m5', 'five', { timestamp: '2026-01-01T00:00:05.000Z' }),
      ]),
    );
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: true,
        totalMessages: 5,
        oldestMessageId: 'm4',
        resumed: false,
      }),
    );
    await settle();
    await settle();

    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['m4', 'm5']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles a non-truncated snapshot without any conversation fetch', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    applySnapshot(run, [message('only', 'only')], { truncated: false });
    await settle();
    await settle();

    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    run.task.cancel();
    await run.task.toPromise();
  });

  // Regression: opening a chat mid-turn must not settle hydration from a
  // direct `agent.getConversation` read — that page misses the in-flight
  // assistant message (only the seq-0 snapshot merges it, CS-0 D5), so the
  // reveal frame would flicker: user message first, streamed chunks later.
  it('regression: never settles from a direct read while the snapshot carrying the in-flight turn is pending', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      // What a direct read would serve mid-turn: persisted rows only.
      mocks.getConversation.mockResolvedValue(
        page([message('m-user', 'question', { role: 'user' })]),
      );
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // Well past the former 50ms hedge window.
      await vi.advanceTimersByTimeAsync(500);

      // No direct read on the critical path, no premature reveal.
      expect(mocks.getConversation).not.toHaveBeenCalled();
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');

      // The snapshot (with the in-flight assistant message) is the sole
      // hydration source — only its application settles the reveal gate.
      applySnapshot(run, [
        message('m-user', 'question', { role: 'user' }),
        message('m-live', 'partial stream...', { isStreaming: true }),
      ]);
      await settle();
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
        'm-user',
        'm-live',
      ]);
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // The wait window must survive one full LiveChatClient self-heal cycle
  // (5s seq-0 timeout + 1s retry delay + fresh registration's snapshot), so
  // a snapshot delivered by the healed registration settles normally.
  it('accepts a late snapshot while the bounded wait is still open', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      await vi.advanceTimersByTimeAsync(6_500);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
      applySnapshot(run, [message('late', 'late snapshot')]);
      await settle();
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes retryable error only after every bounded wait window times out', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      // A subscription is acquiring (seq-0 push in flight, monorepo#2692) — the
      // plain bounded wait runs; no immediate dead-wait escalation.
      markChatSubscriptionAcquiring(AGENT);
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // Still loading past the live client's own 5s snapshot timeout — the
      // saga's wait is wider so a client self-heal can land in-window.
      await vi.advanceTimersByTimeAsync(5_050);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
      // First window times out (8s): no failure yet — a re-request is
      // dispatched and a second window opens (monorepo#2692).
      await vi.advanceTimersByTimeAsync(3_050);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(1);
      // Second window times out: still loading, second re-request.
      await vi.advanceTimersByTimeAsync(8_050);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(2);
      // Third (final) window times out: hydration fails — no further
      // re-request rides the failure.
      await vi.advanceTimersByTimeAsync(8_050);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('error');
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(2);
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression (intent-hq/monorepo#2692): the daemon/network dropped the
  // initial seq-0 push, so the first wait window closed empty. The saga must
  // re-request a snapshot and settle when the retry window's snapshot
  // arrives — never fail the load after a single missed window.
  it('settles from a snapshot arriving in a retry window after the first wait timed out', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      // A subscription is acquiring (the dropped initial push, monorepo#2692) —
      // the plain bounded wait runs; no immediate dead-wait escalation.
      markChatSubscriptionAcquiring(AGENT);
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // First window (8s) times out; the re-request went out.
      await vi.advanceTimersByTimeAsync(8_100);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(1);

      // The re-requested snapshot lands mid second window.
      await vi.advanceTimersByTimeAsync(2_000);
      applySnapshot(run, [message('m-retry', 'healed')]);
      await vi.advanceTimersByTimeAsync(0);

      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['m-retry']);
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // Defense-in-depth for the reopen snapshot stall (monorepo#2864): the
  // standing subscription already holds a replayable snapshot (its seq-0
  // emit was consumed before this hydration attached — e.g. a teardown
  // reset dropped the meta) so no new emit is coming. The saga must
  // escalate immediately instead of stranding the first ~8s wait window.
  it('escalates immediately when the standing subscription already holds a replayable snapshot', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      setReplayableChatSnapshot(AGENT, true);
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // No wait window elapses: the re-request goes out right away.
      await vi.advanceTimersByTimeAsync(50);
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(1);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');

      // The subscribe saga answers by replaying the held snapshot.
      applySnapshot(run, [message('m-replayed', 'replayed')]);
      await vi.advanceTimersByTimeAsync(0);

      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // Cold open with an in-flight acquisition (monorepo#3295): no replayable
  // snapshot yet, but the subscribe saga IS opening a registration (its seq-0
  // emit is still coming) — the plain bounded wait must run without an
  // immediate escalation, because an early force-cycle would only churn a
  // healthy opening subscription.
  it('does not escalate early on a cold open while an acquisition is in flight', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      markChatSubscriptionAcquiring(AGENT);
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(0);
      applySnapshot(run, [message('m-cold', 'cold open')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // Dead wait (monorepo#3295): the window opens with NEITHER a standing
  // registration NOR an acquisition in flight — a dedup-consumed open or an
  // already-swept slot, so no seq-0 emit is coming at all. The saga must
  // escalate immediately (force-cycle a fresh registration) instead of
  // stranding the first ~8s wait window.
  it('escalates immediately when no subscription exists and none is acquiring', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // No wait window elapses: the re-request goes out right away.
      await vi.advanceTimersByTimeAsync(50);
      expect(
        run.dispatch.mock.calls.filter(
          ([action]) => action.type === chatTranscriptSnapshotRerequested.type,
        ),
      ).toHaveLength(1);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');

      // The force-cycled registration answers with a fresh snapshot.
      applySnapshot(run, [message('m-healed', 'healed')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(mocks.getConversation).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression (PR #1327 finding 1): `initializeChatRequested` starts the
  // read and subscribe sagas concurrently, so the seq-0 snapshot can arrive
  // while `agents.get` is still pending. The subscribe saga DEFERS such a
  // pre-session snapshot until the shell upserts (never meta without
  // messages), and hydration must settle from that single deferred
  // application — no second snapshot, no false 5s error.
  it('settles from a snapshot deferred until after the session shell upsert (pre-session race)', async () => {
    let resolveGet!: (value: AgentSession) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolveGet = done;
      }),
    );
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    // Snapshot arrived pre-session: nothing was recorded, still loading.
    expect(run.chat().byAgentId[AGENT]?.transcriptSnapshot).toBeUndefined();
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');

    resolveGet(session());
    await settle();
    // Shell upserted → the deferred snapshot applies (messages + meta
    // together, exactly once).
    applySnapshot(run, [message('m1', 'one')]);
    await settle();

    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['m1']);
    run.task.cancel();
    await run.task.toPromise();
  });

  // Regression (PR #1327 finding 2): LiveChatClient self-heals a broken
  // registration (unsubscribe + re-register) and can deliver its snapshot
  // AFTER this saga's bounded wait already failed hydration. The applied
  // snapshot must pull hydration out of the error state instead of leaving
  // the panel on the retry surface until a manual retry.
  it('recovers hydration out of the error state when a snapshot applies after the wait window', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      // All bounded wait windows (3 × 8s) time out.
      await vi.advanceTimersByTimeAsync(24_150);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('error');

      // The healed registration's seq-0 snapshot applies late.
      applySnapshot(run, [message('m-late', 'late')]);
      await settle();
      await settle();

      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(mocks.getConversation).not.toHaveBeenCalled();
      expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['m-late']);
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles immediately on refresh when snapshot metadata already exists', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m1', 'one')] })]));
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: false,
        totalMessages: 1,
        oldestMessageId: 'm1',
      }),
    );
    run.channel.put(refreshChatTranscriptRequested(WS, AGENT));
    await settle();

    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
    expect(mocks.getConversation).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks a failed session read without replacing the prior transcript', async () => {
    mocks.get.mockRejectedValue(new Error('read failed'));
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('prior', 'prior')] })]));
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['prior']);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationFailed.type),
    ).toBe(true);
    // A generic failure is NOT the deleted-agent path: no tab close.
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === closeTabsByAgentId.type),
    ).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  // Regression: restoring a layout with a tab for a deleted agent makes
  // `agents.get` reject with the agent-not-found shape (monorepo#1753).
  // Hydration must treat it as "agent deleted" — run the shared stale-tab
  // cleanup and short-circuit — never reach the error/retry surface for a
  // tab that is being closed.
  it.each([
    [
      'structured data.code',
      Object.assign(new Error('Agent not found'), {
        name: 'BackendError',
        code: 'not-found',
        rpcCode: -32602,
        data: { code: 'not-found' },
      }),
    ],
    [
      'rpcCode + message fallback',
      Object.assign(new Error(`Agent ${AGENT} not found`), { rpcCode: -32602 }),
    ],
  ])(
    'closes stale tabs instead of failing hydration on agent-not-found (%s)',
    async (_label, notFound) => {
      mocks.get.mockRejectedValue(notFound);
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      await settle();

      const close = run.dispatch.mock.calls.find(
        ([action]) => action.type === closeTabsByAgentId.type,
      )?.[0];
      expect(close?.payload).toMatchObject({ wsId: WS, agentId: AGENT });
      const destroy = run.dispatch.mock.calls.find(
        ([action]) => action.type === destroyTabsByOwnerAgent.type,
      )?.[0];
      expect(destroy?.payload).toMatchObject({ wsId: WS, agentId: AGENT });
      // Missed-deletion recovery: no event-driven prune follows, so the
      // cleanup prunes recentlyClosed itself — "Reopen closed tab" must not
      // resurrect the deleted agent.
      const prune = run.dispatch.mock.calls.find(
        ([action]) => action.type === pruneRecentlyClosed.type,
      )?.[0];
      expect(prune?.payload).toEqual([WS, { agentId: AGENT }]);
      expect(mocks.invoke).toHaveBeenCalledWith('browser:clear-agent-tabs', { agentId: AGENT });
      // Worker contract: `started: false` suppresses BOTH settle/fail
      // branches — neither the retry surface nor a false settle.
      expect(
        run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationFailed.type),
      ).toBe(false);
      expect(
        run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationSettled.type),
      ).toBe(false);
      // The started 'loading' marker must not leak: the path resets the
      // deleted agent's chat-state entry.
      expect(run.dispatch.mock.calls.some(([action]) => action.type === chatReset.type)).toBe(true);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBeUndefined();
      run.task.cancel();
      await run.task.toPromise();
    },
  );

  it('cancels an unmounted workspace read without a late upsert or settled ghost action', async () => {
    let resolve!: (value: AgentSession) => void;
    mocks.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve(session());
    await settle();

    expect(run.sessions().byAgentId[AGENT]).toBeUndefined();
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationSettled.type),
    ).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks hydration loading while waiting for the snapshot', async () => {
    mocks.get.mockResolvedValue(session());
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    const startedCalls = run.dispatch.mock.calls.filter(
      ([action]) => action.type === transcriptHydrationStarted.type,
    );
    expect(startedCalls).toHaveLength(1);
    expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('loading');
    run.task.cancel();
    await run.task.toPromise();
  });
});

describe('chatReadSaga lazy block hydration (§5.5 slim → v7.2 agent.getMessageBlock)', () => {
  afterEach(() => vi.clearAllMocks());

  const MSG = 'msg-1';
  const BLOCK = 'msg-1:2';
  const KEY = hydratedBlockKey(MSG, BLOCK);

  it('fetches the full block once and caches it under {messageId}|{blockId}', async () => {
    mocks.getMessageBlock.mockResolvedValue({
      type: 'tool_result',
      id: BLOCK,
      tool_use_id: 'call-1',
      output: 'the full body',
    });
    const run = harness();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();

    expect(mocks.getMessageBlock).toHaveBeenCalledTimes(1);
    expect(mocks.getMessageBlock).toHaveBeenCalledWith(AGENT, MSG, BLOCK);
    expect(run.chat().byAgentId[AGENT]?.hydratedBlocks?.[KEY]).toMatchObject({
      status: 'loaded',
      block: { output: 'the full body' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('single-flight: concurrent expand triggers produce exactly one wire fetch', async () => {
    let resolveFetch!: (block: unknown) => void;
    mocks.getMessageBlock.mockReturnValue(
      new Promise((done) => {
        resolveFetch = done;
      }),
    );
    const run = harness();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();
    resolveFetch({ type: 'tool_result', id: BLOCK, output: 'body' });
    await settle();

    expect(mocks.getMessageBlock).toHaveBeenCalledTimes(1);
    expect(run.chat().byAgentId[AGENT]?.hydratedBlocks?.[KEY]).toMatchObject({
      status: 'loaded',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a re-request after load fires no second fetch (read-through cache)', async () => {
    mocks.getMessageBlock.mockResolvedValue({ type: 'tool_result', id: BLOCK, output: 'body' });
    const run = harness();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();

    expect(mocks.getMessageBlock).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('a failed fetch records the error and a later request retries', async () => {
    mocks.getMessageBlock
      .mockRejectedValueOnce(new Error('unknown block id: msg-1:2'))
      .mockResolvedValueOnce({ type: 'tool_result', id: BLOCK, output: 'body' });
    const run = harness();
    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();

    expect(run.chat().byAgentId[AGENT]?.hydratedBlocks?.[KEY]).toMatchObject({
      status: 'error',
      error: 'unknown block id: msg-1:2',
    });

    run.dispatch(messageBlockHydrationRequested(AGENT, MSG, BLOCK));
    await settle();
    expect(mocks.getMessageBlock).toHaveBeenCalledTimes(2);
    expect(run.chat().byAgentId[AGENT]?.hydratedBlocks?.[KEY]).toMatchObject({
      status: 'loaded',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('distinct blocks hydrate independently', async () => {
    mocks.getMessageBlock
      .mockResolvedValueOnce({ type: 'tool_use', id: 'msg-1:0', name: 't', input: { a: 1 } })
      .mockResolvedValueOnce({ type: 'image', id: 'msg-2:1', data: 'AAAA', mimeType: 'image/png' });
    const run = harness();
    run.dispatch(messageBlockHydrationRequested(AGENT, 'msg-1', 'msg-1:0'));
    run.dispatch(messageBlockHydrationRequested(AGENT, 'msg-2', 'msg-2:1'));
    await settle();

    expect(mocks.getMessageBlock).toHaveBeenCalledTimes(2);
    const cached = run.chat().byAgentId[AGENT]?.hydratedBlocks;
    expect(cached?.[hydratedBlockKey('msg-1', 'msg-1:0')]).toMatchObject({ status: 'loaded' });
    expect(cached?.[hydratedBlockKey('msg-2', 'msg-2:1')]).toMatchObject({ status: 'loaded' });
    run.task.cancel();
    await run.task.toPromise();
  });
});
