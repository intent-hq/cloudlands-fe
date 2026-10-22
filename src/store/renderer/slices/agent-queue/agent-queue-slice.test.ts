import type { QueuedMessage } from '$shared/types';
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  agentQueueReducer,
  clearAgentQueue,
  hydrateAgentQueueRequested,
  initialState,
  queuedMessageMutationConsumed,
  queuedMessageMutationFinished,
  queuedMessageMutationRequested,
  queuedMessageMutationsReleased,
  removeQueuedMessageFromAgentQueue,
  replaceAgentQueue,
  restoreRecentlyRemovedMessageId,
  setAgentQueueError,
  setAgentQueueHydrating,
  upsertQueuedMessageInAgentQueue,
} from './agent-queue-slice';
import { selectAgentQueueMessages, selectQueuedMessageMutations } from './agent-queue-selectors';
import type { AgentQueueState, QueuedMessageMutationRequest } from './agent-queue-types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

const AGENT_ID = 'agent-1';

function message(id: string, position: number): QueuedMessage {
  return {
    id,
    content: `Message ${id}`,
    queuedAt: `2026-05-06T00:00:0${position}.000Z`,
    position,
  };
}

function storeWith(agentQueue: AgentQueueState): StoreState {
  return { agentQueue } as StoreState;
}

describe('agentQueueReducer', () => {
  it('returns initial state', () => {
    expect(agentQueueReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('marks an agent queue as hydrating on hydrate request', () => {
    const state = agentQueueReducer(initialState, hydrateAgentQueueRequested(AGENT_ID));
    expect(state.byAgentId[AGENT_ID].isHydrating).toBe(true);
    expect(state.byAgentId[AGENT_ID].error).toBeNull();
  });

  it('replaces an agent queue with a Collection and preserves message order', () => {
    const messages = [message('second', 1), message('first', 0)];
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, messages));

    expect(getItems(state.byAgentId[AGENT_ID].messages)).toEqual(messages);
    expect(state.byAgentId[AGENT_ID].messages.ids).toEqual(['second', 'first']);
    expect(getItem(state.byAgentId[AGENT_ID].messages, 'first')).toEqual(messages[1]);
    expect(state.byAgentId[AGENT_ID].isHydrating).toBe(false);
    expect(state.byAgentId[AGENT_ID].error).toBeNull();
  });

  it('inserts an optimistic mutation result immediately', () => {
    const queued = message('optimistic', 0);
    const state = agentQueueReducer(
      initialState,
      upsertQueuedMessageInAgentQueue(AGENT_ID, queued),
    );
    expect(getItems(state.byAgentId[AGENT_ID].messages)).toEqual([queued]);
  });

  it('replaces authoritative queued content in stable order and honors tombstones', () => {
    const state = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('m1', 0), message('m2', 1)]),
    );
    const replacement = { ...message('m1', 9), content: 'daemon canonical' };
    const replaced = agentQueueReducer(
      state,
      upsertQueuedMessageInAgentQueue(AGENT_ID, replacement),
    );
    expect(getItems(replaced.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual([
      'm1',
      'm2',
    ]);
    expect(getItem(replaced.byAgentId[AGENT_ID].messages, 'm1')?.content).toBe('daemon canonical');
    const removed = agentQueueReducer(replaced, removeQueuedMessageFromAgentQueue(AGENT_ID, 'm1'));
    expect(agentQueueReducer(removed, upsertQueuedMessageInAgentQueue(AGENT_ID, replacement))).toBe(
      removed,
    );
  });

  it('clears an agent queue and returns same ref for unknown agents', () => {
    const state = agentQueueReducer(initialState, replaceAgentQueue(AGENT_ID, [message('m1', 0)]));
    const cleared = agentQueueReducer(state, clearAgentQueue(AGENT_ID));
    const unchanged = agentQueueReducer(cleared, clearAgentQueue('unknown'));

    expect(cleared.byAgentId[AGENT_ID]).toBeUndefined();
    expect(unchanged).toBe(cleared);
  });

  it('removes one queued message and repositions remaining messages', () => {
    const state = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('m1', 0), message('m2', 1), message('m3', 2)]),
    );
    const next = agentQueueReducer(state, removeQueuedMessageFromAgentQueue(AGENT_ID, 'm2'));
    const unchanged = agentQueueReducer(next, removeQueuedMessageFromAgentQueue(AGENT_ID, 'm2'));

    expect(
      getItems(next.byAgentId[AGENT_ID].messages).map((item) => [item.id, item.position]),
    ).toEqual([
      ['m1', 0],
      ['m3', 1],
    ]);
    expect(getItem(next.byAgentId[AGENT_ID].messages, 'm2')).toBeUndefined();
    expect(unchanged).toBe(next);
  });

  it('records removal tombstones without a local queued message and suppresses stale snapshots', () => {
    const removedBeforeHydration = agentQueueReducer(
      initialState,
      removeQueuedMessageFromAgentQueue(AGENT_ID, 'sent-before-hydration'),
    );
    const staleAfterMissingEntry = agentQueueReducer(
      removedBeforeHydration,
      replaceAgentQueue(AGENT_ID, [
        message('sent-before-hydration', 0),
        message('still-queued', 1),
      ]),
    );
    const hydrated = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('still-local', 0)]),
    );
    const removedMissingMessage = agentQueueReducer(
      hydrated,
      removeQueuedMessageFromAgentQueue(AGENT_ID, 'sent-missing-locally'),
    );
    const staleAfterMissingMessage = agentQueueReducer(
      removedMissingMessage,
      replaceAgentQueue(AGENT_ID, [message('sent-missing-locally', 0), message('still-local', 1)]),
    );

    expect(removedBeforeHydration.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([
      'sent-before-hydration',
    ]);
    expect(
      getItems(staleAfterMissingEntry.byAgentId[AGENT_ID].messages).map((item) => [
        item.id,
        item.position,
      ]),
    ).toEqual([['still-queued', 0]]);
    expect(removedMissingMessage.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([
      'sent-missing-locally',
    ]);
    expect(
      getItems(staleAfterMissingMessage.byAgentId[AGENT_ID].messages).map((item) => [
        item.id,
        item.position,
      ]),
    ).toEqual([['still-local', 0]]);
  });

  it('does not reintroduce a removed queued message from a stale queue snapshot', () => {
    const state = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('sent-now', 0), message('still-queued', 1)]),
    );
    const removed = agentQueueReducer(
      state,
      removeQueuedMessageFromAgentQueue(AGENT_ID, 'sent-now'),
    );
    const staleReplacement = agentQueueReducer(
      removed,
      replaceAgentQueue(AGENT_ID, [
        message('sent-now', 0),
        message('still-queued', 1),
        message('newer', 2),
      ]),
    );

    expect(
      getItems(staleReplacement.byAgentId[AGENT_ID].messages).map((item) => [
        item.id,
        item.position,
      ]),
    ).toEqual([
      ['still-queued', 0],
      ['newer', 1],
    ]);
    expect(getItem(staleReplacement.byAgentId[AGENT_ID].messages, 'sent-now')).toBeUndefined();
    expect(JSON.parse(JSON.stringify(staleReplacement))).toEqual(staleReplacement);
  });

  it('restores a recently-removed ID so a later snapshot can bring the message back', () => {
    const state = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('m1', 0), message('m2', 1)]),
    );
    const removed = agentQueueReducer(state, removeQueuedMessageFromAgentQueue(AGENT_ID, 'm1'));
    const restored = agentQueueReducer(removed, restoreRecentlyRemovedMessageId(AGENT_ID, 'm1'));
    const rehydrated = agentQueueReducer(
      restored,
      replaceAgentQueue(AGENT_ID, [message('m1', 0), message('m2', 1)]),
    );

    expect(removed.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual(['m1']);
    expect(restored.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([]);
    expect(getItems(rehydrated.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('returns same state when restoring unknown agents or IDs that are not marked removed', () => {
    const state = agentQueueReducer(
      initialState,
      removeQueuedMessageFromAgentQueue(AGENT_ID, 'm1'),
    );

    expect(agentQueueReducer(state, restoreRecentlyRemovedMessageId('unknown', 'm1'))).toBe(state);
    expect(agentQueueReducer(state, restoreRecentlyRemovedMessageId(AGENT_ID, 'other'))).toBe(
      state,
    );
  });

  describe('queued message mutations', () => {
    const request = (
      requestId: string,
      overrides: Partial<QueuedMessageMutationRequest> = {},
    ): QueuedMessageMutationRequest => ({
      requestId,
      consumerId: 'panel-a',
      workspaceId: 'ws-1',
      agentId: AGENT_ID,
      messageId: 'm1',
      operation: { kind: 'sendNow' },
      ...overrides,
    });

    it('records a pending request without touching the queue, and ignores replay', () => {
      const queued = agentQueueReducer(
        initialState,
        replaceAgentQueue(AGENT_ID, [message('m1', 0)]),
      );
      const pending = agentQueueReducer(
        queued,
        queuedMessageMutationRequested(
          request('r1', { operation: { kind: 'edit', content: 'x', editing: true } }),
        ),
      );
      expect(pending.byAgentId).toBe(queued.byAgentId);
      expect(getItem(pending.mutations, 'r1')).toEqual({
        requestId: 'r1',
        consumerId: 'panel-a',
        workspaceId: 'ws-1',
        agentId: AGENT_ID,
        messageId: 'm1',
        kind: 'edit',
        editing: true,
        status: 'pending',
      });
      expect(agentQueueReducer(pending, queuedMessageMutationRequested(request('r1')))).toBe(
        pending,
      );
    });

    it.each([
      [{ status: 'succeeded', sendOutcome: 'delivered' }],
      [{ status: 'failed', error: 'already drained' }],
      [{ status: 'cancelled' }],
    ] as const)('settles a pending request once as %o', (result) => {
      const pending = agentQueueReducer(
        initialState,
        queuedMessageMutationRequested(request('r1')),
      );
      const settled = agentQueueReducer(pending, queuedMessageMutationFinished('r1', result));
      expect(getItem(settled.mutations, 'r1')).toMatchObject({ ...result });
      expect(
        agentQueueReducer(settled, queuedMessageMutationFinished('r1', { status: 'succeeded' })),
      ).toBe(settled);
      expect(
        agentQueueReducer(initialState, queuedMessageMutationFinished('unknown', result)),
      ).toBe(initialState);
    });

    it('consumes only a settled outcome owned by the same consumer', () => {
      let state = agentQueueReducer(initialState, queuedMessageMutationRequested(request('r1')));
      expect(agentQueueReducer(state, queuedMessageMutationConsumed('panel-a', 'r1'))).toBe(state);
      state = agentQueueReducer(state, queuedMessageMutationFinished('r1', { status: 'failed' }));
      expect(agentQueueReducer(state, queuedMessageMutationConsumed('panel-b', 'r1'))).toBe(state);
      state = agentQueueReducer(state, queuedMessageMutationConsumed('panel-a', 'r1'));
      expect(getItem(state.mutations, 'r1')).toBeUndefined();
    });

    it('releases one consumer and clears an unmounted workspace without touching others', () => {
      let state = initialState;
      state = agentQueueReducer(state, queuedMessageMutationRequested(request('a1')));
      state = agentQueueReducer(
        state,
        queuedMessageMutationRequested(request('b1', { consumerId: 'panel-b' })),
      );
      state = agentQueueReducer(
        state,
        queuedMessageMutationRequested(
          request('c1', { consumerId: 'panel-c', workspaceId: 'ws-2' }),
        ),
      );
      const released = agentQueueReducer(state, queuedMessageMutationsReleased('panel-a'));
      expect(released.mutations.ids).toEqual(['b1', 'c1']);
      expect(agentQueueReducer(released, queuedMessageMutationsReleased('panel-a'))).toBe(released);
      const unmounted = agentQueueReducer(released, workspaceUnmounted('ws-1'));
      expect(unmounted.mutations.ids).toEqual(['c1']);
    });

    it('selects every consumer request for one agent and workspace with a stable reference', () => {
      let queueState = agentQueueReducer(
        initialState,
        queuedMessageMutationRequested(request('a1')),
      );
      queueState = agentQueueReducer(
        queueState,
        queuedMessageMutationRequested(request('b1', { consumerId: 'panel-b' })),
      );
      queueState = agentQueueReducer(
        queueState,
        queuedMessageMutationRequested(request('x1', { workspaceId: 'ws-2' })),
      );
      const state = storeWith(queueState);
      const selected = selectQueuedMessageMutations.select(state, AGENT_ID, 'ws-1');
      expect(selected.map((entry) => entry.requestId)).toEqual(['a1', 'b1']);
      expect(selectQueuedMessageMutations.select(state, AGENT_ID, 'ws-1')).toBe(selected);
      expect(
        selectQueuedMessageMutations.select(storeWith(initialState), AGENT_ID, 'ws-1'),
      ).toEqual([]);
    });
  });

  it('keeps stale suppression bounded so old removed IDs can appear in future snapshots', () => {
    let state = initialState;
    for (let index = 0; index < 101; index++) {
      state = agentQueueReducer(
        state,
        replaceAgentQueue(AGENT_ID, [message(`removed-${index}`, 0)]),
      );
      state = agentQueueReducer(
        state,
        removeQueuedMessageFromAgentQueue(AGENT_ID, `removed-${index}`),
      );
    }

    const next = agentQueueReducer(
      state,
      replaceAgentQueue(AGENT_ID, [
        message('removed-0', 0),
        message('removed-100', 1),
        message('unrelated', 2),
      ]),
    );

    expect(getItems(next.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual([
      'removed-0',
      'unrelated',
    ]);
  });

  it('sets and clears hydration without creating an idle unknown queue', () => {
    const unchanged = agentQueueReducer(initialState, setAgentQueueHydrating('unknown', false));
    const hydrating = agentQueueReducer(initialState, setAgentQueueHydrating(AGENT_ID, true));
    const idle = agentQueueReducer(hydrating, setAgentQueueHydrating(AGENT_ID, false));

    expect(unchanged).toBe(initialState);
    expect(hydrating.byAgentId[AGENT_ID].isHydrating).toBe(true);
    expect(idle.byAgentId[AGENT_ID].isHydrating).toBe(false);
  });

  it('sets error and stops hydrating', () => {
    const hydrating = agentQueueReducer(initialState, hydrateAgentQueueRequested(AGENT_ID));
    const errored = agentQueueReducer(hydrating, setAgentQueueError(AGENT_ID, 'failed'));

    expect(errored.byAgentId[AGENT_ID].isHydrating).toBe(false);
    expect(errored.byAgentId[AGENT_ID].error).toBe('failed');
  });

  it('does not mutate previous state when replacing the queue', () => {
    const previous = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('m1', 0)]),
    );
    const next = agentQueueReducer(previous, replaceAgentQueue(AGENT_ID, [message('m2', 1)]));

    expect(next).not.toBe(previous);
    expect(getItems(previous.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual(['m1']);
    expect(getItems(next.byAgentId[AGENT_ID].messages).map((item) => item.id)).toEqual(['m2']);
  });
});

describe('agent queue selectors', () => {
  it('returns default values for unknown agents', () => {
    const state = storeWith(initialState);

    expect(selectAgentQueueMessages.select(state, 'unknown')).toEqual([]);
  });

  it('selects ordered messages', () => {
    const queueState = agentQueueReducer(
      initialState,
      replaceAgentQueue(AGENT_ID, [message('queued-2', 2), message('queued-1', 1)]),
    );
    const state = storeWith(queueState);

    expect(selectAgentQueueMessages.select(state, AGENT_ID).map((item) => item.id)).toEqual([
      'queued-2',
      'queued-1',
    ]);
  });
});

it('drops the prior workspace queue and tombstones on rebind', () => {
  let state = agentQueueReducer(
    initialState,
    replaceAgentQueue(AGENT_ID, [message('shared-row', 0)], 'workspace-a'),
  );
  state = agentQueueReducer(state, removeQueuedMessageFromAgentQueue(AGENT_ID, 'shared-row'));
  state = agentQueueReducer(state, hydrateAgentQueueRequested(AGENT_ID, 'workspace-b'));
  expect(state.byAgentId[AGENT_ID].recentlyRemovedMessageIds).toEqual([]);
  state = agentQueueReducer(
    state,
    replaceAgentQueue(AGENT_ID, [message('shared-row', 0)], 'workspace-b'),
  );
  expect(getItems(state.byAgentId[AGENT_ID].messages).map((m) => m.id)).toEqual(['shared-row']);
  expect(state.byAgentId[AGENT_ID].workspaceId).toBe('workspace-b');
});
