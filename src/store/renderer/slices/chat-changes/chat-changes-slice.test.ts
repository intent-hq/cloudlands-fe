import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ChatChangesInput, ChatChangesState, ChatFileRefresh } from './chat-changes-types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  agentFileChangeReceived,
  agentFileRefreshTriggered,
  chatChangesReducer,
  emptyChatChangesWorkspaceState,
  initialState,
  chatChangesInputChanged,
  chatChangesConsumerReleased,
  chatChangesEnriched,
  chatChangesFileRefreshStarted,
  chatChangesFileRefreshed,
  chatChangesMutationRefreshQueued,
} from './chat-changes-slice';

const WS_ID = 'ws-1';
const PATH = 'src/app.ts';
const input: ChatChangesInput = {
  changes: [
    {
      filePath: PATH,
      action: 'modify',
      toolName: 'git',
      toolCallId: 'edit',
      additions: 1,
      deletions: 0,
    },
  ],
  showStagingControls: true,
  isAggregate: false,
  groupByCommit: false,
  nodeOwnedPaths: false,
};
const consumer = (state: ChatChangesState) =>
  getItem(state.byWorkspaceId[WS_ID].consumers, 'panel')!;
const start = () =>
  chatChangesReducer(initialState, chatChangesInputChanged(WS_ID, 'panel', 'read-1', input));

describe('chatChangesReducer', () => {
  it('returns the initial state', () => {
    expect(chatChangesReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('does not change state for agent file change receive trigger actions', () => {
    expect(chatChangesReducer(initialState, agentFileChangeReceived(WS_ID, PATH))).toBe(
      initialState,
    );
  });

  it('creates and increments per-file refresh versions', () => {
    const firstState = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH));
    expect(firstState.byWorkspaceId[WS_ID].refreshes.map[PATH]).toEqual({ path: PATH, version: 1 });

    const secondState = chatChangesReducer(firstState, agentFileRefreshTriggered(WS_ID, PATH));
    expect(secondState.byWorkspaceId[WS_ID].refreshes.map[PATH]).toEqual({
      path: PATH,
      version: 2,
    });
  });

  it('clears workspace state on workspace unmount', () => {
    const state = chatChangesReducer(initialState, agentFileRefreshTriggered(WS_ID, PATH));

    expect(
      chatChangesReducer(state, workspaceUnmounted(WS_ID)).byWorkspaceId[WS_ID],
    ).toBeUndefined();
    expect(chatChangesReducer(initialState, workspaceUnmounted(WS_ID))).toBe(initialState);
    expect(emptyChatChangesWorkspaceState.refreshes.ids).toEqual([]);
  });

  it('deduplicates stable inputs, accepts failed-read retries, and rejects stale completions', () => {
    const state = start();
    const key = consumer(state).resourceKey;
    expect(consumer(state).status).toBe('pending');
    expect(
      chatChangesReducer(state, chatChangesInputChanged(WS_ID, 'panel', 'duplicate', input)),
    ).toBe(state);
    expect(chatChangesReducer(state, chatChangesEnriched(WS_ID, 'panel', 'old', key, [], 0))).toBe(
      state,
    );
    const failed = chatChangesReducer(
      state,
      chatChangesEnriched(WS_ID, 'panel', 'read-1', key, input.changes, 0, 'failed'),
    );
    expect(consumer(failed)).toMatchObject({ status: 'failed', error: 'failed' });
    const retry = chatChangesReducer(
      failed,
      chatChangesInputChanged(WS_ID, 'panel', 'read-2', input),
    );
    expect(consumer(retry)).toMatchObject({ status: 'pending', requestId: 'read-2' });
    const ready = chatChangesReducer(
      retry,
      chatChangesEnriched(WS_ID, 'panel', 'read-2', key, input.changes, 1),
    );
    expect(consumer(ready).status).toBe('ready');
    const cleared = chatChangesReducer(
      ready,
      chatChangesInputChanged(WS_ID, 'panel', 'empty', { ...input, changes: [] }),
    );
    expect(getItems(consumer(cleared).changes)).toEqual([]);
  });

  it('uses raw node/per-turn inputs and fences resource swaps and released consumers', () => {
    const state = start();
    const remote = chatChangesReducer(
      state,
      chatChangesInputChanged(WS_ID, 'panel', 'remote', { ...input, nodeOwnedPaths: true }),
    );
    expect(consumer(remote).status).toBe('ready');
    expect(
      chatChangesReducer(
        remote,
        chatChangesEnriched(WS_ID, 'panel', 'read-1', consumer(state).resourceKey, [], 0),
      ),
    ).toBe(remote);
    const snippet = {
      ...input,
      showStagingControls: false,
      changes: [{ ...input.changes[0], newContent: 'one' }],
    };
    const first = chatChangesReducer(
      remote,
      chatChangesInputChanged(WS_ID, 'panel', 'snippet', snippet),
    );
    const updated = chatChangesReducer(
      first,
      chatChangesInputChanged(WS_ID, 'panel', 'snippet-2', {
        ...snippet,
        changes: [{ ...snippet.changes[0], newContent: 'two' }],
      }),
    );
    expect(getItems(consumer(updated).changes)[0].change.newContent).toBe('two');
    const released = chatChangesReducer(updated, chatChangesConsumerReleased(WS_ID, 'panel'));
    expect(getItem(released.byWorkspaceId[WS_ID].consumers, 'panel')).toBeUndefined();
    expect(chatChangesReducer(released, chatChangesConsumerReleased(WS_ID, 'panel'))).toBe(
      released,
    );
    expect(
      chatChangesReducer(
        released,
        chatChangesEnriched(WS_ID, 'panel', 'snippet-2', consumer(updated).resourceKey, [], 0),
      ),
    ).toBe(released);
  });

  it('protects fresh file refreshes and preserves mutation correlations across overlapping requests', () => {
    let state = start();
    const key = consumer(state).resourceKey;
    const refresh: ChatFileRefresh = {
      path: PATH,
      requestId: 'refresh',
      status: 'pending',
      refreshedAt: 100,
    };
    state = chatChangesReducer(state, chatChangesFileRefreshStarted(WS_ID, 'panel', key, refresh));
    state = chatChangesReducer(
      state,
      chatChangesMutationRefreshQueued(WS_ID, 'panel', key, PATH, 'mutation', 101),
    );
    expect(
      chatChangesReducer(
        state,
        chatChangesFileRefreshed(
          WS_ID,
          'panel',
          key,
          { ...refresh, requestId: 'old', status: 'ready' },
          [],
        ),
      ),
    ).toBe(state);
    state = chatChangesReducer(
      state,
      chatChangesFileRefreshed(WS_ID, 'panel', key, { ...refresh, status: 'ready' }, [
        { ...input.changes[0], newContent: 'fresh' },
      ]),
    );
    expect(getItem(consumer(state).fileRefreshes, PATH)?.queuedMutationRequestId).toBe('mutation');
    state = chatChangesReducer(
      state,
      chatChangesEnriched(WS_ID, 'panel', 'read-1', key, input.changes, 102),
    );
    expect(getItems(consumer(state).changes)[0].change.newContent).toBe('fresh');
    const next = { ...refresh, requestId: 'next', mutationRequestId: 'mutation' };
    state = chatChangesReducer(state, chatChangesFileRefreshStarted(WS_ID, 'panel', key, next));
    state = chatChangesReducer(
      state,
      chatChangesFileRefreshed(WS_ID, 'panel', key, { ...next, status: 'failed' }),
    );
    expect(consumer(state).completedMutationRequestId).toBeUndefined();
    expect(getItems(consumer(state).changes)[0].change.newContent).toBe('fresh');
    state = chatChangesReducer(
      state,
      chatChangesFileRefreshed(WS_ID, 'panel', key, { ...next, status: 'ready' }, []),
    );
    expect(consumer(state).completedMutationRequestId).toBe('mutation');
    expect(getItem(consumer(state).fileRefreshes, PATH)?.queuedMutationRequestId).toBeUndefined();
    expect(getItems(consumer(state).changes)).toEqual([]);
  });
});
