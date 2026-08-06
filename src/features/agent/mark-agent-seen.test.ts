import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

// FAKE seams only: `$lib/client` and `$store/renderer/store` are mocked so no
// request ever reaches the user's real daemon. The triggers dynamically import
// both at fire time; fake timers + advanceTimersByTimeAsync flush the debounce
// and the dynamic-import microtasks together.
const mockMarkSeen = vi.fn(
  async (_params: { workspaceId: string; agentId: string; messageId: string }) => ({
    success: true,
  }),
);
vi.mock('$lib/client', () => ({
  appClient: { agents: { markSeen: mockMarkSeen } },
}));

interface MockSession {
  workspaceId?: string;
  messages: AgentMessage[];
}
const mockState: {
  unreadTracking: { currentlyViewedAgentId: string | null };
  agentSessions: { byAgentId: Record<string, MockSession | undefined> };
} = {
  unreadTracking: { currentlyViewedAgentId: null },
  agentSessions: { byAgentId: {} },
};
vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
  },
}));

import {
  MARK_AGENT_SEEN_DEBOUNCE_MS,
  MARK_AGENT_SEEN_DEDUPE_LIMIT,
  cancelPendingMarkAgentSeen,
  createMarkAgentSeenTriggerMiddleware,
  markAgentSeenAtBoundary,
  markAgentSeenOnTurnFinish,
  markAgentSeenOnUserSend,
  newestPersistedMessageId,
} from './mark-agent-seen';
import { sendMessage, streamEnded } from '$store/renderer/slices/chat-state/chat-state-slice';

function msg(id: string, isStreaming = false): AgentMessage {
  return { id, role: 'assistant', contentBlocks: [], isStreaming } as unknown as AgentMessage;
}

// Distinct agent ids per test: the module keeps a per-agent dedupe map across
// the suite (module-level state, intentional in production).
let agentSeq = 0;
function nextAgentId(): string {
  return `agent-${++agentSeq}`;
}

/** Seed a viewed conversation with a persisted transcript in the mock store. */
function seedSession(
  agentId: string,
  overrides: Partial<MockSession> = {},
  { viewed = true }: { viewed?: boolean } = {},
): void {
  mockState.agentSessions.byAgentId[agentId] = {
    workspaceId: 'ws-1',
    messages: [msg('msg-1')],
    ...overrides,
  };
  if (viewed) mockState.unreadTracking.currentlyViewedAgentId = agentId;
}

async function fireDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS + 1);
}

/** Flush the dynamic-import microtasks behind an immediate (boundary) fire. */
async function flushImmediate(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  mockState.unreadTracking.currentlyViewedAgentId = null;
  mockState.agentSessions.byAgentId = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('newestPersistedMessageId', () => {
  it('returns the last message id, skipping streaming rows', () => {
    expect(newestPersistedMessageId([msg('m1'), msg('m2'), msg('m3', true)])).toBe('m2');
  });

  it('returns null for an empty or all-streaming transcript', () => {
    expect(newestPersistedMessageId([])).toBeNull();
    expect(newestPersistedMessageId([msg('m1', true)])).toBeNull();
  });
});

describe('markAgentSeenOnTurnFinish (debounced, viewed + focused gates)', () => {
  it('fires agent.markSeen once after the debounce with the newest persisted id', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, { messages: [msg('msg-1'), msg('msg-2'), msg('msg-3', true)] });

    markAgentSeenOnTurnFinish(agentId);
    expect(mockMarkSeen).not.toHaveBeenCalled(); // nothing before the debounce
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-2',
    });
  });

  it('coalesces a burst into one call carrying the fire-time newest id', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);

    markAgentSeenOnTurnFinish(agentId);
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS / 2);
    mockState.agentSessions.byAgentId[agentId]!.messages = [msg('msg-1'), msg('msg-2')];
    markAgentSeenOnTurnFinish(agentId); // restarts the trailing edge
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-2',
    });
  });

  it('drops the request when another agent is the currently viewed one', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, {}, { viewed: false });
    mockState.unreadTracking.currentlyViewedAgentId = 'agent-other';

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when the window is not focused at fire time', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when there is no persisted message id (streaming-only)', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, { messages: [msg('m1', true)] });

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when the session is unknown or has no workspaceId', async () => {
    const unknownAgent = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = unknownAgent;
    markAgentSeenOnTurnFinish(unknownAgent);
    await fireDebounce();

    const noWsAgent = nextAgentId();
    seedSession(noWsAgent, { workspaceId: undefined });
    markAgentSeenOnTurnFinish(noWsAgent);
    await fireDebounce();

    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('dedupes: the same marker id is not re-sent', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    markAgentSeenOnTurnFinish(agentId); // same msg-1
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('advances to a newer marker id after a dedupe hit', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    mockState.agentSessions.byAgentId[agentId]!.messages = [msg('msg-1'), msg('msg-2')];
    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
    expect(mockMarkSeen).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-2',
    });
  });

  it('cancelPendingMarkAgentSeen drops a pending debounce', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);

    markAgentSeenOnTurnFinish(agentId);
    cancelPendingMarkAgentSeen(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('rolls back the dedupe record on a failed mutation so the next trigger retries', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);
    mockMarkSeen.mockResolvedValueOnce({ success: false } as { success: boolean });

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();
    markAgentSeenOnTurnFinish(agentId); // same msg-1 retries
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
  });

  it('is error-tolerant: a rejected mutation is swallowed and the id retries', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);
    mockMarkSeen.mockRejectedValueOnce(new Error('daemon offline'));

    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce(); // must not surface an unhandled rejection
    markAgentSeenOnTurnFinish(agentId);
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
  });

  it('bounds the dedupe map: evicted agents re-send their marker (no unbounded growth)', async () => {
    // Fill the dedupe map past the limit with other agents; the first agent's
    // record is evicted (insertion-order LRU), so re-triggering the same
    // marker id for it fires again instead of being deduped forever.
    const firstAgentId = nextAgentId();
    seedSession(firstAgentId);
    markAgentSeenOnTurnFinish(firstAgentId);
    await fireDebounce();
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);

    for (let i = 0; i < MARK_AGENT_SEEN_DEDUPE_LIMIT; i++) {
      const otherId = nextAgentId();
      seedSession(otherId);
      markAgentSeenOnTurnFinish(otherId);
      await fireDebounce();
    }

    seedSession(firstAgentId); // same msg-1, re-viewed
    markAgentSeenOnTurnFinish(firstAgentId);
    await fireDebounce();
    expect(mockMarkSeen).toHaveBeenCalledTimes(MARK_AGENT_SEEN_DEDUPE_LIMIT + 2);
  });
});

describe('markAgentSeenOnUserSend (debounced, no viewed/focus gates)', () => {
  it('fires even when the window is blurred and another agent is viewed', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, {}, { viewed: false });
    mockState.unreadTracking.currentlyViewedAgentId = 'agent-other';
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    markAgentSeenOnUserSend(agentId);
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-1',
    });
  });

  it('a user send during a pending turn-finish window replaces its gates', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, {}, { viewed: false }); // never the viewed agent

    markAgentSeenOnTurnFinish(agentId); // would be dropped by the viewed gate
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS / 2);
    markAgentSeenOnUserSend(agentId); // proof of looking — replaces the pending trigger
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('never targets streaming rows (optimistic/streaming-only transcript is dropped)', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, { messages: [msg('m1', true)] });

    markAgentSeenOnUserSend(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});

describe('markAgentSeenAtBoundary (immediate, stop-looking boundary)', () => {
  it('fires immediately for each affected agent without waiting for the debounce', async () => {
    const agentA = nextAgentId();
    const agentB = nextAgentId();
    seedSession(agentA, {}, { viewed: false });
    seedSession(agentB, { messages: [msg('msg-9')] }, { viewed: false });

    markAgentSeenAtBoundary([agentA, agentB]);
    await flushImmediate();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId: agentA,
      messageId: 'msg-1',
    });
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId: agentB,
      messageId: 'msg-9',
    });
  });

  it('supersedes a pending debounced trigger (no double send)', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);

    markAgentSeenOnTurnFinish(agentId);
    markAgentSeenAtBoundary([agentId]);
    await flushImmediate();
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);

    await fireDebounce(); // the cancelled debounce never fires
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('ignores blank ids and unknown sessions', async () => {
    markAgentSeenAtBoundary(['', nextAgentId()]);
    await flushImmediate();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});

describe('createMarkAgentSeenTriggerMiddleware', () => {
  const api = { dispatch: vi.fn(), getState: vi.fn(() => mockState) };
  const next = vi.fn((action: unknown) => action);

  it('schedules a turn-finish trigger on streamEnded', async () => {
    const agentId = nextAgentId();
    seedSession(agentId);
    const middleware = createMarkAgentSeenTriggerMiddleware()(api)(next);

    const action = streamEnded(agentId);
    expect(middleware(action)).toBe(action); // passes the action through
    expect(next).toHaveBeenCalledWith(action);
    expect(mockMarkSeen).not.toHaveBeenCalled(); // debounced, not immediate
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-1',
    });
  });

  it('schedules an ungated user-send trigger on sendMessage', async () => {
    const agentId = nextAgentId();
    seedSession(agentId, {}, { viewed: false });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const middleware = createMarkAgentSeenTriggerMiddleware()(api)(next);

    middleware(sendMessage(agentId, { wsId: 'ws-1', text: 'hello' }));
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated actions and malformed payloads', async () => {
    const middleware = createMarkAgentSeenTriggerMiddleware()(api)(next);

    middleware({ type: 'other/action' });
    middleware({ type: streamEnded.type, payload: [] });
    middleware({ type: sendMessage.type, payload: {} });
    await fireDebounce();

    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('never fires from scrolling — scroll actions are not markSeen triggers', async () => {
    // The marker advances ONLY at the three discrete triggers (turn finish,
    // user send, stop-looking boundary) — never continuously from scroll
    // position. Scroll-position persistence actions flow through the store
    // when the user scrolls a conversation; none of them may schedule a call.
    const agentId = nextAgentId();
    seedSession(agentId);
    const middleware = createMarkAgentSeenTriggerMiddleware()(api)(next);

    middleware({ type: 'tabState/saveScrollPosition', payload: [`tab-${agentId}`, 1200] });
    middleware({ type: 'tabState/saveScrollPosition', payload: [`tab-${agentId}`, 4800] });
    middleware({ type: 'tabState/removeScrollPosition', payload: [`tab-${agentId}`] });
    await fireDebounce();

    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});
