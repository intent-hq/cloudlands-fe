import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    agents: { getConversation: mocks.getConversation },
    chat: {},
  },
}));

import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import {
  HISTORY_SEGMENT_MAX,
  agentSessionReducer,
  bulkUpsertSessions,
  initialState as agentSessionInitialState,
  prependHistoryMessages,
} from '../../agent-session/agent-session-slice';
import {
  chatStateReducer,
  chatTranscriptSnapshotApplied,
  historyGapFillRequested,
  initialState as chatStateInitialState,
  olderHistoryPageRequested,
} from '../chat-state-slice';
import { chatScrollbackSaga } from './chat-scrollback-saga';

const WS = 'ws-scrollback';
const AGENT = 'agent-scrollback';
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function ts(index: number): string {
  return new Date(BASE_TIME + index * 1000).toISOString();
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    workspaceId: WS,
    backendSessionId: null,
    name: 'Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: ts(0),
    updatedAt: ts(0),
    ...overrides,
  } as AgentSession;
}

function message(id: string, index: number): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: ts(index),
    contentBlocks: [{ type: 'text', text: id }],
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
    chatScrollbackSaga,
  );
  return {
    channel,
    dispatch,
    task,
    history: () => agentSessions.historySegmentsByAgentId?.[AGENT],
    chat: () => chatState.byAgentId[AGENT],
  };
}

describe('chatScrollbackSaga (on-demand history paging)', () => {
  afterEach(() => vi.clearAllMocks());

  it('seeks at the tail oldest on the first older request, then continues from the persisted token', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-08', 8), message('m-09', 9), message('m-10', 10)], {
        nextToken: 'older-1',
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-08', 'm-09']);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.history()?.oldestReached).toBe(false);

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-06', 6), message('m-07', 7)], { nextToken: null }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-10'],
      [AGENT, 200, 'older-1'],
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-06', 'm-07', 'm-08', 'm-09']);
    expect(run.history()?.oldestReached).toBe(true);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();

    // Exhausted: further requests are no-ops.
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(2);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('anchors at the history oldest (not the tail) once history rows exist', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    run.dispatch(prependHistoryMessages(AGENT, [message('m-05', 5)]));

    // No token persisted (e.g. fresh app session): re-seek at history's oldest.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-04', 4), message('m-05', 5)]));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined, 'm-05');
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-04', 'm-05']);
    expect(run.history()?.oldestReached).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dedupes concurrent older requests per agent (takeLeading semantics)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    let resolvePage!: (value: unknown) => void;
    mocks.getConversation.mockReturnValueOnce(
      new Promise((done) => {
        resolvePage = done;
      }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(true);

    // Second request while the first is in flight: dropped, no second call.
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);

    resolvePage(page([message('m-09', 9)], { nextToken: null }));
    await settle();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-09']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('clears the fetching flag and drops the cursor when the older fetch fails', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockRejectedValueOnce(new Error('wire failed'));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();

    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.history()).toBeUndefined();

    // Next request recovers with a fresh seek.
    mocks.getConversation.mockResolvedValueOnce(page([message('m-09', 9)], { nextToken: null }));
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation.mock.calls).toEqual([
      [AGENT, 200, undefined, 'm-10'],
      [AGENT, 200, undefined, 'm-10'],
    ]);
    expect(run.history()?.messages.map((m) => m.id)).toEqual(['m-09']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('opens the hole past the segment cap, then a gap refill closes it on tail overlap', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    // Fill history to the cap, then prepend one more page: the reducer prunes
    // from the NEWEST side and flips gapToTail.
    const bulk: AgentMessage[] = [];
    for (let index = 0; index < HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    expect(run.history()?.gapToTail).toBe(false);
    run.dispatch(prependHistoryMessages(AGENT, [message('m-0999', 999)]));
    expect(run.history()?.gapToTail).toBe(true);
    expect(run.history()?.messages).toHaveLength(HISTORY_SEGMENT_MAX);

    const newest = run.history()!.messages[HISTORY_SEGMENT_MAX - 1].id as string;
    // Gap refill: seek at history's newest; the page overlaps the tail row,
    // so appendHistoryMessages closes the hole.
    mocks.getConversation.mockResolvedValueOnce(
      page([message(newest, 1000), message('m-mid', 1600), message('m-tail', 2000)], {
        prevToken: null,
      }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined, newest);
    expect(run.history()?.gapToTail).toBe(false);
    expect(run.chat()?.fetchingGapFill).toBe(false);
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps walking prevToken across gap-fill requests while the hole stays open', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    const bulk: AgentMessage[] = [];
    for (let index = 0; index <= HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    expect(run.history()?.gapToTail).toBe(true);

    // Page of rows the tail has since pruned: no overlap, gap stays open,
    // forward cursor persists for the next request.
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-pruned-1', 1900)], { prevToken: 'fwd-1' }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(run.history()?.gapToTail).toBe(true);
    expect(run.chat()?.scrollbackGapToken).toBe('fwd-1');

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-tail', 2000)], { prevToken: null }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();

    expect(mocks.getConversation.mock.calls[1]).toEqual([AGENT, 200, 'fwd-1']);
    expect(run.history()?.gapToTail).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('skips the gap fill entirely when no hole is open', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    run.dispatch(prependHistoryMessages(AGENT, [message('m-05', 5)]));
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(mocks.getConversation).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('an older prepend settle drops the gap cursor (cap prune invalidates the forward walk)', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-tail', 2000)] })]));
    const bulk: AgentMessage[] = [];
    for (let index = 0; index <= HISTORY_SEGMENT_MAX; index++) {
      bulk.push(message(`m-${String(index + 1000)}`, index + 1000));
    }
    run.dispatch(prependHistoryMessages(AGENT, bulk));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-pruned-1', 1900)], { prevToken: 'fwd-1' }),
    );
    run.channel.put(historyGapFillRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.scrollbackGapToken).toBe('fwd-1');

    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-0500', 500)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('resets segment + continuation state on a §7.1 resumed:false snapshot', async () => {
    const run = harness();
    run.dispatch(bulkUpsertSessions([session({ messages: [message('m-10', 10)] })]));
    mocks.getConversation.mockResolvedValueOnce(
      page([message('m-05', 5)], { nextToken: 'older-1' }),
    );
    run.channel.put(olderHistoryPageRequested(WS, AGENT));
    await settle();
    expect(run.history()?.messages).toHaveLength(1);
    expect(run.chat()?.scrollbackOlderToken).toBe('older-1');

    run.channel.put(
      chatTranscriptSnapshotApplied(AGENT, {
        truncated: true,
        totalMessages: 20,
        oldestMessageId: 'm-15',
        resumed: false,
      }),
    );
    await settle();

    expect(run.history()).toBeUndefined();
    expect(run.chat()?.scrollbackOlderToken).toBeNull();
    expect(run.chat()?.scrollbackGapToken).toBeNull();
    expect(run.chat()?.fetchingOlderHistory).toBe(false);
    expect(run.chat()?.fetchingGapFill).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });
});
