import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

// FAKE seams only: `$lib/client` and `$store/renderer/store` are mocked so no
// request ever reaches the user's real daemon. The trigger dynamically imports
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

const mockState: { unreadTracking: { currentlyViewedAgentId: string | null } } = {
  unreadTracking: { currentlyViewedAgentId: null },
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
  newestPersistedMessageId,
  requestMarkAgentSeen,
  type MarkAgentSeenSnapshot,
} from './mark-agent-seen';

function msg(id: string, isStreaming = false): AgentMessage {
  return { id, role: 'assistant', contentBlocks: [], isStreaming } as unknown as AgentMessage;
}

// Distinct agent ids per test: the module keeps a per-agent dedupe map across
// the suite (module-level state, intentional in production).
let agentSeq = 0;
function nextAgentId(): string {
  return `agent-${++agentSeq}`;
}

function snapshotOf(overrides: Partial<MarkAgentSeenSnapshot> & { agentId: string }) {
  return (): MarkAgentSeenSnapshot => ({
    workspaceId: 'ws-1',
    messageId: 'msg-1',
    atBottom: true,
    ...overrides,
  });
}

async function fireDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  mockState.unreadTracking.currentlyViewedAgentId = null;
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

describe('requestMarkAgentSeen (debounced at-bottom trigger)', () => {
  it('fires agent.markSeen once after the debounce with the snapshot params', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    expect(mockMarkSeen).not.toHaveBeenCalled(); // nothing before the debounce
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-1',
    });
  });

  it('coalesces a burst into one call carrying the fire-time snapshot id', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;
    let newest = 'msg-1';
    const getSnapshot = (): MarkAgentSeenSnapshot => ({
      workspaceId: 'ws-1',
      agentId,
      messageId: newest,
      atBottom: true,
    });

    requestMarkAgentSeen(agentId, getSnapshot);
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS / 2);
    newest = 'msg-2';
    requestMarkAgentSeen(agentId, getSnapshot); // restarts the trailing edge
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-2',
    });
  });

  it('drops the request when the snapshot is no longer at-bottom at fire time', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId, atBottom: false }));
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when the window is not focused at fire time', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when another agent is the currently viewed one', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = 'agent-other';

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when there is no persisted message id (streaming-only)', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId, messageId: null }));
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('drops the request when the snapshot getter returns null (unmounted)', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, () => null);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('dedupes: the same marker id is not re-sent while sitting at the bottom', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce();
    requestMarkAgentSeen(agentId, snapshotOf({ agentId })); // same msg-1
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('advances to a newer marker id after a dedupe hit', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId, messageId: 'msg-1' }));
    await fireDebounce();
    requestMarkAgentSeen(agentId, snapshotOf({ agentId, messageId: 'msg-2' }));
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
    expect(mockMarkSeen).toHaveBeenLastCalledWith({
      workspaceId: 'ws-1',
      agentId,
      messageId: 'msg-2',
    });
  });

  it('cancelPendingMarkAgentSeen drops a pending debounce (teardown path)', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    cancelPendingMarkAgentSeen(agentId);
    await fireDebounce();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('rolls back the dedupe record on a failed mutation so the next trigger retries', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;
    mockMarkSeen.mockResolvedValueOnce({ success: false } as { success: boolean });

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce();
    requestMarkAgentSeen(agentId, snapshotOf({ agentId })); // same msg-1 retries
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
  });

  it('is error-tolerant: a rejected mutation is swallowed and the id retries', async () => {
    const agentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = agentId;
    mockMarkSeen.mockRejectedValueOnce(new Error('daemon offline'));

    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce(); // must not surface an unhandled rejection
    requestMarkAgentSeen(agentId, snapshotOf({ agentId }));
    await fireDebounce();

    expect(mockMarkSeen).toHaveBeenCalledTimes(2);
  });

  it('bounds the dedupe map: evicted agents re-send their marker (no unbounded growth)', async () => {
    // Fill the dedupe map past the limit with other agents; the first agent's
    // record is evicted (insertion-order LRU), so re-triggering the same
    // marker id for it fires again instead of being deduped forever.
    const firstAgentId = nextAgentId();
    mockState.unreadTracking.currentlyViewedAgentId = firstAgentId;
    requestMarkAgentSeen(firstAgentId, snapshotOf({ agentId: firstAgentId }));
    await fireDebounce();
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);

    for (let i = 0; i < MARK_AGENT_SEEN_DEDUPE_LIMIT; i++) {
      const otherId = nextAgentId();
      mockState.unreadTracking.currentlyViewedAgentId = otherId;
      requestMarkAgentSeen(otherId, snapshotOf({ agentId: otherId }));
      await fireDebounce();
    }

    mockState.unreadTracking.currentlyViewedAgentId = firstAgentId;
    requestMarkAgentSeen(firstAgentId, snapshotOf({ agentId: firstAgentId })); // same msg-1
    await fireDebounce();
    expect(mockMarkSeen).toHaveBeenCalledTimes(MARK_AGENT_SEEN_DEDUPE_LIMIT + 2);
  });
});
