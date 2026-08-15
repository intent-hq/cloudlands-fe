import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentSession, QueuedMessage } from '$shared/types';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

// FAKE seam: appClient.agents.getQueue is stubbed so no daemon call happens.
// The service runs against the REAL configured store so the replaceAgentQueue
// fold (including tombstone suppression) is exercised end to end. READ-ONLY.
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      getQueue: vi.fn(() => Promise.resolve([] as QueuedMessage[])),
    },
  },
}));

import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';

// The configured store's context normally lives in Svelte component context;
// outside a component tree (vitest), route it through a plain property —
// same shim as chat-read-service.test.ts.
const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import {
  clearAgentQueue,
  removeQueuedMessageFromAgentQueue,
  replaceAgentQueue,
} from '$store/renderer/slices/agent-queue/agent-queue-slice';
import type { AgentQueueEntryState } from '$store/renderer/slices/agent-queue/agent-queue-types';
import {
  getAgentQueueEventSnapshotSeq,
  hydrateAgentQueue,
  noteAgentQueueEventSnapshotApplied,
  __resetAgentQueueReadServiceForTests,
} from './agent-queue-read-service';
import {
  clearPendingAgentDeletions,
  setPendingAgentDeletion,
} from './utils/pending-agent-deletions';

const getQueueMock = appClient.agents.getQueue as unknown as ReturnType<typeof vi.fn>;
const AGENT = 'agent-queue-read-1';

function entryOf(agentId: string): AgentQueueEntryState | undefined {
  const state = appStore.state as {
    agentQueue: { byAgentId: Record<string, AgentQueueEntryState> };
  };
  return state.agentQueue.byAgentId[agentId];
}

function messagesOf(agentId: string): QueuedMessage[] {
  const entry = entryOf(agentId);
  return entry ? getItems(entry.messages) : [];
}

function queued(id: string, position: number): QueuedMessage {
  return {
    id,
    content: `Message ${id}`,
    queuedAt: `2026-08-09T00:00:0${position}.000Z`,
    position,
  };
}

function markDeletionPending(agentId: string): void {
  setPendingAgentDeletion({
    wsId: 'ws-1',
    agentId,
    snapshot: { id: agentId } as AgentSession,
    timer: null,
  });
}

beforeAll(() => appStore.init());

afterEach(() => {
  appStore.dispatch(clearAgentQueue(AGENT));
  clearPendingAgentDeletions();
  __resetAgentQueueReadServiceForTests();
  getQueueMock.mockReset();
  getQueueMock.mockImplementation(() => Promise.resolve([] as QueuedMessage[]));
});

describe('hydrateAgentQueue', () => {
  it('clears a stale mirrored row when the daemon queue is already drained (monorepo#1749)', async () => {
    // Simulate the missed agent:queue:updated: the mirror still holds a row
    // the daemon has drained.
    appStore.dispatch(replaceAgentQueue(AGENT, [queued('stale-1', 0)]));
    expect(messagesOf(AGENT)).toHaveLength(1);

    getQueueMock.mockResolvedValueOnce([]);
    await hydrateAgentQueue(AGENT);

    expect(getQueueMock).toHaveBeenCalledWith(AGENT);
    expect(messagesOf(AGENT)).toEqual([]);
    expect(entryOf(AGENT)?.isHydrating).toBe(false);
    expect(entryOf(AGENT)?.error).toBeNull();
  });

  it('replaces the mirror with the fetched daemon snapshot', async () => {
    getQueueMock.mockResolvedValueOnce([queued('m1', 0), queued('m2', 1)]);
    await hydrateAgentQueue(AGENT);

    expect(messagesOf(AGENT).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('applies the recently-removed tombstone suppression to hydrated snapshots', async () => {
    appStore.dispatch(replaceAgentQueue(AGENT, [queued('kept', 0), queued('removed', 1)]));
    appStore.dispatch(removeQueuedMessageFromAgentQueue(AGENT, 'removed'));

    // Daemon has not self-drained the removed entry yet.
    getQueueMock.mockResolvedValueOnce([queued('kept', 0), queued('removed', 1)]);
    await hydrateAgentQueue(AGENT);

    expect(messagesOf(AGENT).map((m) => m.id)).toEqual(['kept']);
  });

  it('single-flights concurrent triggers with one trailing follow-up fetch', async () => {
    let resolveFirst!: (queue: QueuedMessage[]) => void;
    getQueueMock.mockImplementationOnce(
      () => new Promise<QueuedMessage[]>((resolve) => (resolveFirst = resolve)),
    );
    getQueueMock.mockResolvedValueOnce([]);

    const first = hydrateAgentQueue(AGENT);
    // Burst of triggers while the leading fetch is in flight — must collapse
    // into exactly ONE trailing follow-up, and every coalesced caller shares
    // the same in-flight chain promise.
    const second = hydrateAgentQueue(AGENT);
    const third = hydrateAgentQueue(AGENT);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(getQueueMock).toHaveBeenCalledTimes(1);

    resolveFirst([queued('m1', 0)]);
    // The shared promise settles only after the trailing follow-up too.
    await first;

    expect(getQueueMock).toHaveBeenCalledTimes(2);
    expect(messagesOf(AGENT)).toEqual([]);
  });

  it('skips the trailing follow-up when a deletion became pending during the leading fetch', async () => {
    let resolveFirst!: (queue: QueuedMessage[]) => void;
    getQueueMock.mockImplementationOnce(
      () => new Promise<QueuedMessage[]>((resolve) => (resolveFirst = resolve)),
    );

    const first = hydrateAgentQueue(AGENT);
    void hydrateAgentQueue(AGENT);
    markDeletionPending(AGENT);

    resolveFirst([queued('m1', 0)]);
    await first;

    // Leading fetch's fold was discarded and the follow-up never issued.
    expect(getQueueMock).toHaveBeenCalledTimes(1);
    expect(messagesOf(AGENT)).toEqual([]);
    expect(entryOf(AGENT)?.isHydrating).toBe(false);
  });

  it('keeps the prior mirror and records the error when the fetch fails', async () => {
    appStore.dispatch(replaceAgentQueue(AGENT, [queued('m1', 0)]));
    getQueueMock.mockRejectedValueOnce(new Error('boom'));

    await hydrateAgentQueue(AGENT);

    expect(messagesOf(AGENT).map((m) => m.id)).toEqual(['m1']);
    expect(entryOf(AGENT)?.error).toBe('boom');
    expect(entryOf(AGENT)?.isHydrating).toBe(false);
  });

  it('skips entirely when a deletion is pending for the agent', async () => {
    markDeletionPending(AGENT);
    await hydrateAgentQueue(AGENT);
    expect(getQueueMock).not.toHaveBeenCalled();
  });

  it('discards the fetched snapshot when the deletion became pending mid-flight', async () => {
    appStore.dispatch(replaceAgentQueue(AGENT, [queued('m1', 0)]));
    getQueueMock.mockImplementationOnce(async () => {
      markDeletionPending(AGENT);
      return [queued('m1', 0), queued('m2', 1)];
    });

    await hydrateAgentQueue(AGENT);

    expect(messagesOf(AGENT).map((m) => m.id)).toEqual(['m1']);
    expect(entryOf(AGENT)?.isHydrating).toBe(false);
  });

  it('discards the fetched snapshot when a live event snapshot arrived mid-flight', async () => {
    appStore.dispatch(replaceAgentQueue(AGENT, [queued('stale', 0)]));
    // The RPC response still contains the row, but while it was in flight a
    // live agent:queue:updated drained the queue. The event snapshot must win
    // — folding the older RPC response would re-add the drained row.
    getQueueMock.mockImplementationOnce(async () => {
      appStore.dispatch(replaceAgentQueue(AGENT, []));
      noteAgentQueueEventSnapshotApplied(AGENT);
      return [queued('stale', 0)];
    });

    await hydrateAgentQueue(AGENT);

    expect(messagesOf(AGENT)).toEqual([]);
    // The discarded response must NOT advance the seq — only the applied
    // live event fold did.
    expect(getAgentQueueEventSnapshotSeq(AGENT)).toBe(1);
  });

  it('advances the snapshot seq when the hydrate fold is applied (monorepo#2486)', async () => {
    // A hydrate-reconciled fold is an authoritative snapshot: it must bump
    // the same seq the send paths' queued-response seed guard captures, so
    // a stale queued:true echo resolving after the fold cannot re-seed a
    // drained row.
    getQueueMock.mockResolvedValueOnce([]);
    expect(getAgentQueueEventSnapshotSeq(AGENT)).toBe(0);

    await hydrateAgentQueue(AGENT);

    expect(getAgentQueueEventSnapshotSeq(AGENT)).toBe(1);
  });

  it('does not advance the snapshot seq when the fold is skipped for a pending deletion', async () => {
    getQueueMock.mockImplementationOnce(async () => {
      markDeletionPending(AGENT);
      return [queued('m1', 0)];
    });

    await hydrateAgentQueue(AGENT);

    expect(getAgentQueueEventSnapshotSeq(AGENT)).toBe(0);
  });

  it('folds the trailing follow-up despite the leading fold advancing the seq (monorepo#2486)', async () => {
    // The leading fold's seq bump must not make the trailing coalesced
    // follow-up discard its own response: the follow-up captures its
    // seqAtFetchStart AFTER the bump.
    let resolveFirst!: (queue: QueuedMessage[]) => void;
    getQueueMock.mockImplementationOnce(
      () => new Promise<QueuedMessage[]>((resolve) => (resolveFirst = resolve)),
    );
    getQueueMock.mockResolvedValueOnce([queued('follow-up', 0)]);

    const first = hydrateAgentQueue(AGENT);
    void hydrateAgentQueue(AGENT);
    resolveFirst([]);
    await first;

    expect(messagesOf(AGENT).map((m) => m.id)).toEqual(['follow-up']);
    // Both folds applied — one bump each.
    expect(getAgentQueueEventSnapshotSeq(AGENT)).toBe(2);
  });
});
