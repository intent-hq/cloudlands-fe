import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { AgentMessage, AgentSession } from '$shared/types';

const mock = vi.hoisted(() => ({
  getConversation: vi.fn(),
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { agents: { getConversation: mock.getConversation }, chat: {} },
}));
vi.mock('$store/renderer/store', async () => {
  const { store } = await import('$store/renderer/configured-store');
  return {
    store: {
      createSelector: store.createSelector.bind(store),
      get state() {
        return mock.state;
      },
      dispatch: mock.dispatch,
    },
  };
});
import {
  agentSessionReducer,
  initialState as sessionsInitial,
  bulkUpsertSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatStateReducer,
  initialState as chatInitial,
  chatTranscriptSnapshotApplied,
  chatInitialHistoryProgressed,
  olderHistoryPageRequested,
  historyGapFillRequested,
  historySeekRequested,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
import { seekConversationToMessage } from './open-message';

const AGENT = 'seek-agent';
const WS = 'seek-workspace';
const row = (i: number): AgentMessage => ({
  id: `m-${i}`,
  role: 'user',
  timestamp: new Date(1700000000000 + i * 1000).toISOString(),
  contentBlocks: [{ type: 'text', text: `Message ${i}` }],
});
const rows = (start: number) => Array.from({ length: 5 }, (_, i) => row(start + i));
const page = (start: number) => ({
  messages: rows(start),
  totalMessages: 1000,
  truncated: start > 0,
  nextToken: `before-${start}`,
  prevToken: `after-${start + 4}`,
});
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function harness() {
  const channel = stdChannel();
  let agentSessions = sessionsInitial;
  let chatState = chatInitial;
  mock.dispatch.mockImplementation((action) => {
    agentSessions = agentSessionReducer(agentSessions, action);
    chatState = chatStateReducer(chatState, action);
    mock.state = { agentSessions, chatState };
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch: mock.dispatch, getState: () => mock.state },
    chatScrollbackSaga,
  );
  mock.dispatch(
    bulkUpsertSessions([{ id: AGENT, workspaceId: WS, messages: rows(995) } as AgentSession]),
  );
  mock.dispatch(
    chatTranscriptSnapshotApplied(AGENT, {
      truncated: true,
      totalMessages: 1000,
      nextToken: 'before-995',
    }),
  );
  return {
    task,
    history: () => agentSessions.historySegmentsByAgentId?.[AGENT],
    chat: () => chatState.byAgentId[AGENT],
    tail: () => agentSessions.byAgentId[AGENT]?.messages,
  };
}

describe('direct message seek pagination ownership', () => {
  afterEach(() => vi.resetAllMocks());
  it('defers a direct seek until initial completion installs the cursor', async () => {
    vi.useFakeTimers();
    const run = harness();
    try {
      mock.dispatch(
        chatInitialHistoryProgressed(AGENT, { target: 20, received: 1, complete: false }),
      );
      mock.getConversation.mockResolvedValue(page(498));
      const seeking = seekConversationToMessage(AGENT, 'm-500', WS);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mock.getConversation).not.toHaveBeenCalled();
      mock.dispatch(
        chatTranscriptSnapshotApplied(AGENT, {
          truncated: true,
          totalMessages: 1000,
          nextToken: 'before-980',
          initialHistory: { target: 20, received: 20, complete: true },
        }),
      );
      await vi.advanceTimersByTimeAsync(150);
      await expect(seeking).resolves.toBe(true);
      expect(mock.getConversation).toHaveBeenCalledTimes(1);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
      vi.useRealTimers();
    }
  });

  it.each(['older', 'gap'] as const)(
    'continues %s paging from the sought window, preserving the live tail',
    async (direction) => {
      const run = harness();
      try {
        mock.getConversation
          .mockResolvedValueOnce(page(498))
          .mockResolvedValueOnce(page(direction === 'older' ? 493 : 503));
        await expect(seekConversationToMessage(AGENT, 'm-500', WS)).resolves.toBe(true);
        mock.dispatch(
          direction === 'older'
            ? olderHistoryPageRequested(WS, AGENT)
            : historyGapFillRequested(WS, AGENT),
        );
        await settle();
        expect(mock.getConversation.mock.calls).toEqual([
          [AGENT, 5, undefined, 'm-500', undefined, WS],
          [AGENT, 5, direction === 'older' ? 'before-498' : 'after-502', undefined, undefined, WS],
        ]);
        expect(run.tail()?.map((m) => m.id)).toEqual(rows(995).map((m) => m.id));
        expect(run.history()?.messages.map((m) => m.id)).toEqual(
          Array.from({ length: 10 }, (_, i) => `m-${(direction === 'older' ? 493 : 498) + i}`),
        );
      } finally {
        run.task.cancel();
        await run.task.toPromise();
      }
    },
  );

  it('discards an older page still in flight when the direct seek takes ownership', async () => {
    const run = harness();
    try {
      let resolveOlder!: (value: ReturnType<typeof page>) => void;
      mock.getConversation
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOlder = resolve;
          }),
        )
        .mockResolvedValueOnce(page(498));
      mock.dispatch(olderHistoryPageRequested(WS, AGENT));
      await expect(seekConversationToMessage(AGENT, 'm-500', WS)).resolves.toBe(true);
      resolveOlder(page(990));
      await settle();
      expect(run.history()?.messages.map((m) => m.id)).toEqual(rows(498).map((m) => m.id));
      expect(run.chat()?.scrollbackOlderToken).toBe('before-498');
      expect(run.chat()?.scrollbackGapToken).toBe('after-502');
      expect(run.chat()?.fetchingOlderHistory).toBe(false);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('a later direct seek wins and automatic paging cannot race its pending window', async () => {
    const run = harness();
    try {
      let resolveFirst!: (value: ReturnType<typeof page>) => void;
      mock.getConversation
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockResolvedValueOnce(page(698));
      const first = seekConversationToMessage(AGENT, 'm-500', WS);
      mock.dispatch(olderHistoryPageRequested(WS, AGENT));
      mock.dispatch(historyGapFillRequested(WS, AGENT));
      expect(mock.getConversation).toHaveBeenCalledTimes(1);
      await expect(seekConversationToMessage(AGENT, 'm-700', WS)).resolves.toBe(true);
      resolveFirst(page(498));
      await expect(first).resolves.toBe(false);
      expect(run.history()?.messages.map((m) => m.id)).toEqual(rows(698).map((m) => m.id));
      expect(run.chat()?.scrollbackOlderToken).toBe('before-698');
      expect(run.chat()?.scrollbackGapToken).toBe('after-702');
      expect(run.chat()?.fetchingHistorySeek).toBe(false);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it.each(['pending', 'settled'] as const)(
    'an obsolete ordinal rejection preserves the newer direct seek while %s',
    async (phase) => {
      const run = harness();
      try {
        let rejectOrdinal!: (error: unknown) => void;
        let resolveDirect!: (value: ReturnType<typeof page>) => void;
        mock.getConversation
          .mockReturnValueOnce(
            new Promise((_resolve, reject) => {
              rejectOrdinal = reject;
            }),
          )
          .mockReturnValueOnce(
            new Promise((resolve) => {
              resolveDirect = resolve;
            }),
          );
        mock.dispatch(historySeekRequested(WS, AGENT, 200));
        const direct = seekConversationToMessage(AGENT, 'm-500', WS);
        if (phase === 'settled') {
          resolveDirect(page(498));
          await expect(direct).resolves.toBe(true);
        }
        const before = { ...run.chat() };
        rejectOrdinal({ rpcCode: -32602 });
        await settle();
        expect(run.chat()).toEqual({ ...before, historySeekUnsupported: true });
        if (phase === 'pending') {
          mock.dispatch(olderHistoryPageRequested(WS, AGENT));
          mock.dispatch(historyGapFillRequested(WS, AGENT));
          expect(mock.getConversation).toHaveBeenCalledTimes(2);
          resolveDirect(page(498));
          await expect(direct).resolves.toBe(true);
        }
        expect(run.chat()?.scrollbackOlderToken).toBe('before-498');
        expect(run.chat()?.scrollbackGapToken).toBe('after-502');
      } finally {
        run.task.cancel();
        await run.task.toPromise();
      }
    },
  );

  it('uses the returned sequence as the sought window position estimate', async () => {
    const run = harness();
    try {
      mock.getConversation.mockResolvedValueOnce({
        ...page(498),
        messages: rows(498).map((message, index) => ({ ...message, seq: 498 + index })),
      });
      await expect(seekConversationToMessage(AGENT, 'm-500', WS)).resolves.toBe(true);
      expect(run.history()?.startOrdinalEstimate).toBe(498);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('failed seeks preserve the displayed window and its older cursor', async () => {
    const run = harness();
    try {
      mock.getConversation.mockRejectedValueOnce(new Error('Temporary seek failure'));
      await expect(seekConversationToMessage(AGENT, 'm-500', WS)).resolves.toBe(false);
      expect(run.tail()?.map((m) => m.id)).toEqual(rows(995).map((m) => m.id));
      expect(run.history()).toBeUndefined();
      expect(run.chat()?.scrollbackOlderToken).toBe('before-995');
      expect(run.chat()?.fetchingHistorySeek).toBe(false);
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });

  it('does not apply a direct seek that resolves after a replacement snapshot', async () => {
    const run = harness();
    try {
      let resolveSeek!: (value: ReturnType<typeof page>) => void;
      mock.getConversation.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSeek = resolve;
        }),
      );
      const sought = seekConversationToMessage(AGENT, 'm-500', WS);
      mock.dispatch(
        chatTranscriptSnapshotApplied(AGENT, {
          resumed: false,
          truncated: true,
          totalMessages: 1000,
          nextToken: 'fresh-before-995',
        }),
      );
      resolveSeek(page(498));
      await expect(sought).resolves.toBe(false);
      expect(run.tail()?.map((m) => m.id)).toEqual(rows(995).map((m) => m.id));
      expect(run.history()).toBeUndefined();
      expect(run.chat()?.scrollbackOlderToken).toBe('fresh-before-995');
    } finally {
      run.task.cancel();
      await run.task.toPromise();
    }
  });
});
