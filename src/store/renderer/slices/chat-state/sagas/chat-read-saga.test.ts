import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getConversation: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: { get: mocks.get, getConversation: mocks.getConversation },
    chat: {},
  },
}));

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
} from '../../agent-session/agent-session-slice';
import {
  chatStateReducer,
  chatTranscriptSnapshotApplied,
  initializeChatRequested,
  initialState as chatStateInitialState,
  refreshChatTranscriptRequested,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
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
  afterEach(() => vi.clearAllMocks());

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

  it('fetches older history in the background via aroundMessageId when the snapshot is truncated', async () => {
    mocks.get.mockResolvedValue(session());
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-old-1', 'old1'), message('m-old-2', 'old2'), message('m-snap-1', 'one')], {
        prevToken: 'fwd',
      }),
    );
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
    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined, 'm-snap-1');
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
      'm-old-1',
      'm-old-2',
      'm-snap-1',
      'm-snap-2',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('anchors the older walk at the snapshot window oldest, healing the retained-history gap (resumed: false)', async () => {
    // §7.1 resume fallback aftermath: the store holds retained rows BELOW an
    // interior gap toward the snapshot window ([m-r1] ... GAP(m-gap) ...
    // [m-snap]). The walk must anchor at the WINDOW's oldest (meta), not the
    // store's oldest retained row — anchoring at m-r1 would walk strictly
    // older and never fetch m-gap.
    mocks.get.mockResolvedValue(session());
    mocks.getConversation
      .mockResolvedValueOnce(
        page([message('m-gap', 'gap', { timestamp: '2026-01-01T00:00:02.000Z' }), message('m-snap', 's', { timestamp: '2026-01-01T00:00:03.000Z' })], {
          nextToken: 'older',
        }),
      )
      .mockResolvedValueOnce(page([message('m-r1', 'retained')]));
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.dispatch(
      bulkUpsertSessions([
        session({
          messages: [
            message('m-r1', 'retained'),
            message('m-snap', 's', { timestamp: '2026-01-01T00:00:03.000Z' }),
          ],
        }),
      ]),
    );
    run.dispatch(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: true,
        totalMessages: 3,
        oldestMessageId: 'm-snap',
        resumed: false,
      }),
    );
    await settle();
    await settle();

    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-snap'],
      [AGENT, 200, 'older'],
    ]);
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
      'm-r1',
      'm-gap',
      'm-snap',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('walks nextToken backward across multiple older pages', async () => {
    mocks.get.mockResolvedValue(session());
    mocks.getConversation
      .mockResolvedValueOnce(page([message('m-old-3', 'o3'), message('m-snap', 's')], { nextToken: 'older' }))
      .mockResolvedValueOnce(page([message('m-old-1', 'o1'), message('m-old-2', 'o2')]));
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    applySnapshot(run, [message('m-snap', 's')], { truncated: true, totalMessages: 4 });
    await settle();
    await settle();

    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-snap'],
      [AGENT, 200, 'older'],
    ]);
    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
      'm-old-1',
      'm-old-2',
      'm-old-3',
      'm-snap',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('skips the older fetch entirely when the snapshot is not truncated', async () => {
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

  it('falls back to a direct newest-page read when the snapshot never arrives', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      mocks.getConversation.mockResolvedValue(page([message('fallback', 'fb')]));
      const run = harness();
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      await vi.advanceTimersByTimeAsync(11_000);

      expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200);
      expect(run.chat().byAgentId[AGENT]?.transcriptHydration).toBe('settled');
      expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['fallback']);
      run.task.cancel();
      await run.task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('anchors the fallback-path older walk at the fetched page oldest, not retained rows', async () => {
    // Same gap class on the degraded path: retained rows below a gap toward
    // the fallback newest page. The walk anchors at the PAGE's oldest.
    vi.useFakeTimers();
    try {
      mocks.get.mockResolvedValue(session());
      mocks.getConversation
        .mockResolvedValueOnce(
          page([message('m-page', 'newest', { timestamp: '2026-01-01T00:00:03.000Z' })], {
            nextToken: 'older',
          }),
        )
        .mockResolvedValueOnce(
          page([message('m-gap', 'gap', { timestamp: '2026-01-01T00:00:02.000Z' }), message('m-page', 'newest', { timestamp: '2026-01-01T00:00:03.000Z' })], {
            nextToken: 'older-2',
          }),
        )
        .mockResolvedValueOnce(page([message('m-r1', 'retained')]));
      const run = harness();
      run.dispatch(bulkUpsertSessions([session({ messages: [message('m-r1', 'retained')] })]));
      run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
      await vi.advanceTimersByTimeAsync(11_000);

      expect(mocks.getConversation.mock.calls).toEqual([
        [AGENT, 200],
        [AGENT, 200, undefined, 'm-page'],
        [AGENT, 200, 'older-2'],
      ]);
      expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual([
        'm-r1',
        'm-gap',
        'm-page',
      ]);
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

  it('settles a failed session read without replacing the prior transcript', async () => {
    mocks.get.mockRejectedValue(new Error('read failed'));
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('prior', 'prior')] })]));
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(run.sessions().byAgentId[AGENT]?.messages.map((m) => m.id)).toEqual(['prior']);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === transcriptHydrationSettled.type),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

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
