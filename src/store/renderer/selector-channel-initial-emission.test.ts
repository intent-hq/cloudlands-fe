import { runSaga, stdChannel } from 'redux-saga';
import { put } from 'typed-redux-saga';
import { takeEveryFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectCurrentWorkspaceTabId } from './slices/tab-state/tab-state-selectors';
import { openWorkspaceTab, tabStateReducer } from './slices/tab-state/tab-state-slice';

type TabChange = SelectorChannelPayload<string | null>;

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// Regression coverage for the patched @augmentcode/themis selector channel
// (patches/@augmentcode__themis@0.2.7.patch, intent-hq/intent#5008 and
// intent-hq/intent#5040): the synchronous initial emission must be retained
// until the first take so a selector-driven worker sees the value the store
// already held, and a worker that dispatches synchronously must not re-enter
// the channel against a stale comparison baseline.
describe('themis selector channel initial emission (patched)', () => {
  const tasks: ReturnType<typeof runSaga>[] = [];

  afterEach(async () => {
    for (const task of tasks.splice(0)) {
      task.cancel();
      await task.toPromise();
    }
  });

  function createHarness(
    openWorkspaceIds: string[],
    react?: (change: TabChange) => Generator<unknown, void, unknown>,
  ) {
    const initialTabState = openWorkspaceIds.reduce(
      (state, workspaceId) => tabStateReducer(state, openWorkspaceTab(workspaceId)),
      tabStateReducer(undefined, { type: '@@INIT' }),
    );
    let state = { tabState: initialTabState };
    const channel = stdChannel();
    const listeners = new Set<() => void>();
    const dispatch = (action: Parameters<typeof tabStateReducer>[1]) => {
      state = { tabState: tabStateReducer(state.tabState, action) };
      channel.put(action);
      for (const listener of listeners) listener();
      return action;
    };
    const reduxStore = {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const worker = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
      function* () {
        yield* takeEveryFromSelector(selectCurrentWorkspaceTabId, function* (change: TabChange) {
          worker(change);
          if (react) yield* react(change);
        });
      },
    );
    tasks.push(task);
    return { dispatch, worker };
  }

  it('runs the worker once with the initial value when the selector never changes', async () => {
    const { worker } = createHarness(['ws-A']);
    await settle();

    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker.mock.calls[0][0].payload).toBe('ws-A');
    expect(worker.mock.calls[0][0].prevPayload).toBeNull();
  });

  it('does not replay the initial value once a later change is delivered', async () => {
    const { dispatch, worker } = createHarness(['ws-A']);
    await settle();

    dispatch(openWorkspaceTab('ws-B'));
    await settle();

    expect(worker.mock.calls.map(([change]) => [change.prevPayload, change.payload])).toEqual([
      [null, 'ws-A'],
      ['ws-A', 'ws-B'],
    ]);
  });

  // intent-hq/intent#5040: the worker's synchronous dispatch re-enters the
  // channel's store subscriber before the emission returns; the baseline must
  // already be the emitted payload or the same transition is delivered twice.
  it('delivers one transition once when the worker dispatches a reducer no-op', async () => {
    const { dispatch, worker } = createHarness(['ws-A'], function* () {
      yield* put({ type: 'test/noop' });
    });
    await settle();

    dispatch(openWorkspaceTab('ws-B'));
    await settle();

    expect(worker.mock.calls.map(([change]) => [change.prevPayload, change.payload])).toEqual([
      [null, 'ws-A'],
      ['ws-A', 'ws-B'],
    ]);
  });

  it('delivers a nested transition dispatched by the worker once, in order', async () => {
    const { dispatch, worker } = createHarness(['ws-A'], function* (change) {
      if (change.payload === 'ws-B') yield* put(openWorkspaceTab('ws-C'));
    });
    await settle();

    dispatch(openWorkspaceTab('ws-B'));
    await settle();

    expect(worker.mock.calls.map(([change]) => [change.prevPayload, change.payload])).toEqual([
      [null, 'ws-A'],
      ['ws-A', 'ws-B'],
      ['ws-B', 'ws-C'],
    ]);
  });
});
