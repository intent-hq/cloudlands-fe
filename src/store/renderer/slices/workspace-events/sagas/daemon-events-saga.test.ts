import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  offNotification: vi.fn(),
  offReconnect: vi.fn(),
  notificationHandler: undefined as
    ((notification: { method: string; params?: unknown }) => void) | undefined,
  reconnectHandler: undefined as (() => void) | undefined,
  route: vi.fn(),
  refresh: vi.fn(),
  disposeRouting: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendSubscribe: mocks.subscribe,
  backendUnsubscribe: mocks.unsubscribe,
  onBackendNotification: (handler: typeof mocks.notificationHandler) => {
    mocks.notificationHandler = handler;
    return mocks.offNotification;
  },
  onBackendReconnected: (handler: typeof mocks.reconnectHandler) => {
    mocks.reconnectHandler = handler;
    return mocks.offReconnect;
  },
}));

vi.mock('$features/events/daemon-events-bridge.client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/events/daemon-events-bridge.client')>()),
  routeDaemonEventsNotification: mocks.route,
  refreshDaemonEventsAfterReconnect: mocks.refresh,
  disposeDaemonEventsRoutingState: mocks.disposeRouting,
}));

import {
  daemonEventsSaga,
  FILE_EVENTS_REPLACE_GROUP,
  FILE_EVENTS_SUBSCRIBE_TYPES,
} from './daemon-events-saga';
import { DAEMON_EVENTS_SUBSCRIBE_TYPES } from '$features/events/daemon-events-bridge.client';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';
import {
  loadWorkspaceTabsState,
  openWorkspaceTab,
  tabStateReducer,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import { workspaceMounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

// The saga now chains two sequential subscribe/unsubscribe legs (firehose +
// scoped file lease), so settling needs macrotask flushes, not just a fixed
// number of microtask ticks.
const settle = async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const firehoseParams = { eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES] };
const scopedFileParams = (workspaceId: string) => ({
  eventTypes: [...FILE_EVENTS_SUBSCRIBE_TYPES],
  workspaceId,
  replaceGroup: FILE_EVENTS_REPLACE_GROUP,
});

function startSaga(currentTabId: string | null = null, dispatch = vi.fn()) {
  const input = stdChannel();
  let state = {
    tabState:
      currentTabId === null
        ? tabStateReducer(undefined, { type: '@@INIT' })
        : tabStateReducer(undefined, openWorkspaceTab(currentTabId)),
  };
  const listeners = new Set<() => void>();
  const dispatchAction = (action: Parameters<typeof tabStateReducer>[1]) => {
    state = { tabState: tabStateReducer(state.tabState, action) };
    input.put(action);
    listeners.forEach((listener) => listener());
    return dispatch(action);
  };
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setActive = (wsId: string | null) => {
    dispatchAction(
      wsId
        ? openWorkspaceTab(wsId)
        : loadWorkspaceTabsState({
            openTabs: [],
            currentTabId: null,
            pinnedTabs: [],
            unsavedTabs: [],
            optimisticTabs: [],
            tabOrder: [],
          }),
    );
  };
  const task = runSaga(
    {
      channel: input,
      dispatch: dispatchAction,
      getState: reduxStore.getState,
      context: { reduxStore },
    },
    daemonEventsSaga,
  );
  return { input, task, setActive };
}

describe('daemonEventsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandler = undefined;
    mocks.reconnectHandler = undefined;
    mocks.subscribe.mockResolvedValue({ subscriptionId: 'sub-1' });
    mocks.unsubscribe.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mocks.notificationHandler = undefined;
    mocks.reconnectHandler = undefined;
  });

  it('listens before subscribing and forwards buffered events in arrival order with its id', async () => {
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    mocks.subscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );

    const { task } = startSaga();
    expect(mocks.notificationHandler).toBeTypeOf('function');
    expect(mocks.reconnectHandler).toBeTypeOf('function');
    expect(mocks.subscribe).toHaveBeenCalledWith(firehoseParams);

    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 2 } });
    expect(mocks.route).not.toHaveBeenCalled();
    resolveSubscribe({ subscriptionId: 'sub-owned' });
    await settle();

    expect(mocks.route.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['events.event', { sequence: 1 }, ['sub-owned']],
      ['events.event', { sequence: 2 }, ['sub-owned']],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it.each([null, ''])(
    'does not open the scoped file lease for %s selected workspace',
    async (workspaceId) => {
      const { task } = startSaga(workspaceId);
      await settle();

      expect(mocks.subscribe.mock.calls).toEqual([[firehoseParams]]);
      task.cancel();
      await task.toPromise();
    },
  );

  it('subscribes the scoped file lease for the first explicitly selected workspace', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' });
    const { task } = startSaga('ws-1');
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([[firehoseParams], [scopedFileParams('ws-1')]]);

    // Scope gate input carries BOTH owned subscription ids, so a file event
    // fanned out on the scoped lease still reaches the routing layer
    // (monorepo#1853 — activity timeline `eventReceived`).
    mocks.notificationHandler!({
      method: 'events.event',
      params: { event: { type: 'file:changed' }, subscriptionId: 'sub-file' },
    });
    await settle();
    expect(mocks.route.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [
        'events.event',
        { event: { type: 'file:changed' }, subscriptionId: 'sub-file' },
        ['sub-fire', 'sub-file'],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('re-issues the scoped subscribe with the same replaceGroup on workspace switch', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-ws1' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-ws2' });
    const { setActive, task } = startSaga('ws-1');
    await settle();

    setActive('ws-2');
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([
      [firehoseParams],
      [scopedFileParams('ws-1')],
      [scopedFileParams('ws-2')],
    ]);

    // The lease swap retired sub-file-ws1: the routing gate now expects the
    // new scoped id (the daemon side was replaced atomically via replaceGroup,
    // so no unsubscribe call is issued for the old lease).
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire', 'sub-file-ws2'],
      expect.anything(),
    );
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('ignores workspace mount lifecycle that does not select the workspace', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' });
    const { input, task } = startSaga('ws-1');
    await settle();

    input.put(workspaceMounted('chief'));
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([[firehoseParams], [scopedFileParams('ws-1')]]);
    task.cancel();
    await task.toPromise();
  });

  it('uses the complete reviewed firehose filter, without file:* (carried by the scoped lease)', () => {
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).not.toContain('file:*');
    expect(FILE_EVENTS_SUBSCRIBE_TYPES).toEqual(['file:*']);
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toEqual([
      'agent:*',
      'map:*',
      'note:*',
      'comment:*',
      'script:*',
      'terminal:exit',
      'settings:changed',
      'workspace:tokenUsage-changed',
      'workspace:context-changed',
      'workspace:activity-changed',
      'workspace:displayStatus-changed',
      'workspace:attention-changed',
      'workspace:waiting-changed',
      'workspace:updated',
      'workspace:created',
      'workspace:deleted',
      'workspace:delete-scheduled',
      'workspace:delete-cancelled',
      'task:*',
      'git:*',
      'changes:git-status',
      'changes:tracked',
      'changes:agent-locks',
      'line-attribution:updated',
      'pr:*',
      'mcp.servers:status-changed',
      'github:auth-changed',
      'app:ui-navigate',
      'app:ui-highlight',
      'app:workspace-open',
    ]);
  });

  it('unsubscribes, resubscribes, then refreshes on reconnect', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-new' });
    const { task } = startSaga();
    await settle();

    mocks.reconnectHandler!();
    await settle();

    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-old');
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe).toHaveBeenLastCalledWith('sub-new');
  });

  it('replays BOTH the firehose and the scoped file lease on reconnect', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-new' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-new' });
    const { task } = startSaga('ws-1');
    await settle();

    mocks.reconnectHandler!();
    await settle();

    expect(mocks.unsubscribe.mock.calls).toEqual([['sub-fire-old'], ['sub-file-old']]);
    expect(mocks.subscribe.mock.calls).toEqual([
      [firehoseParams],
      [scopedFileParams('ws-1')],
      [firehoseParams],
      [scopedFileParams('ws-1')],
    ]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe.mock.invocationCallOrder[3]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe.mock.calls.slice(2)).toEqual([['sub-fire-new'], ['sub-file-new']]);
  });

  it('replays and refreshes the desired workspace after selection A switches to workspace B', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-a' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-b' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-new' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-b-replay' });
    const { setActive, task } = startSaga('ws-A');
    await settle();

    setActive('ws-B');
    await settle();
    mocks.reconnectHandler!();
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([
      [firehoseParams],
      [scopedFileParams('ws-A')],
      [scopedFileParams('ws-B')],
      [firehoseParams],
      [scopedFileParams('ws-B')],
    ]);
    expect(mocks.refresh).toHaveBeenCalledWith('ws-B');
    expect(mocks.subscribe.mock.invocationCallOrder[4]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire-new', 'sub-file-b-replay'],
      expect.anything(),
    );
    task.cancel();
    await task.toPromise();
  });

  it('retains a cleared desired workspace across reconnect', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-old' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire-new' });
    const { setActive, task } = startSaga('ws-1');
    await settle();

    setActive(null);
    await settle();
    mocks.reconnectHandler!();
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([
      [firehoseParams],
      [scopedFileParams('ws-1')],
      [firehoseParams],
    ]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    task.cancel();
    await task.toPromise();
  });

  it('removes both listeners, clears routing state, and unsubscribes on cancellation', async () => {
    const { task } = startSaga();
    await settle();
    task.cancel();
    await task.toPromise();

    expect(mocks.offNotification).toHaveBeenCalledTimes(1);
    expect(mocks.offReconnect).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1');
    expect(mocks.disposeRouting).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes both leases on cancellation when a workspace is active', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' });
    const { task } = startSaga('ws-1');
    await settle();
    task.cancel();
    await task.toPromise();

    expect(mocks.unsubscribe.mock.calls).toEqual([['sub-fire'], ['sub-file']]);
    expect(mocks.disposeRouting).toHaveBeenCalledTimes(1);
  });

  it('retires the scoped lease when the active workspace is cleared', async () => {
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' });
    const { setActive, task } = startSaga('ws-1');
    await settle();

    setActive(null);
    await settle();

    // The scoped lease is unsubscribed (no replacing subscribe on a clear)
    // and the routing gate no longer accepts its id.
    expect(mocks.unsubscribe.mock.calls).toEqual([['sub-file']]);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire'],
      expect.anything(),
    );
    task.cancel();
    await task.toPromise();
  });

  it('converges to the latest workspace when a switch lands during an in-flight scoped subscribe', async () => {
    let resolveScopedWs1!: (value: { subscriptionId: string }) => void;
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-fire' })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveScopedWs1 = resolve;
        }),
      )
      .mockResolvedValueOnce({ subscriptionId: 'sub-file-ws2' });
    const { setActive, task } = startSaga('ws-1');

    // ws-2 is selected while the ws-1 scoped subscribe is still in flight —
    // previously this dispatch was dropped (no pending take) and the lease
    // stayed stranded on ws-1.
    setActive('ws-2');
    resolveScopedWs1({ subscriptionId: 'sub-file-ws1' });
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([
      [firehoseParams],
      [scopedFileParams('ws-1')],
      [scopedFileParams('ws-2')],
    ]);
    // No unsubscribe on the switch path: the ws-2 subscribe atomically
    // replaced the daemon-side subscription via replaceGroup, and the
    // retired lease's id simply fell out of the routing gate.
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire', 'sub-file-ws2'],
      expect.anything(),
    );
    task.cancel();
    await task.toPromise();
  });

  it('folds buffered selection transitions before converging an in-flight lease', async () => {
    let resolveScopedWs1!: (value: { subscriptionId: string }) => void;
    mocks.subscribe.mockResolvedValueOnce({ subscriptionId: 'sub-fire' }).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScopedWs1 = resolve;
      }),
    );
    const { setActive, task } = startSaga('ws-1');

    setActive('ws-2');
    setActive(null);
    resolveScopedWs1({ subscriptionId: 'sub-file-ws1' });
    await settle();

    expect(mocks.subscribe.mock.calls).toEqual([[firehoseParams], [scopedFileParams('ws-1')]]);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-file-ws1');
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire'],
      expect.anything(),
    );
    task.cancel();
    await task.toPromise();
  });

  it('subscribes the scoped lease for a workspace selected during the initial firehose subscribe', async () => {
    let resolveFirehose!: (value: { subscriptionId: string }) => void;
    mocks.subscribe
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirehose = resolve;
        }),
      )
      .mockResolvedValueOnce({ subscriptionId: 'sub-file' });
    const { setActive, task } = startSaga(null);

    // The first selection lands while the firehose subscribe round-trip is
    // still pending — previously the watcher was not yet forked, so no scoped
    // subscription was ever issued.
    setActive('ws-1');
    await settle();
    expect(mocks.subscribe.mock.calls).toEqual([[firehoseParams], [scopedFileParams('ws-1')]]);

    resolveFirehose({ subscriptionId: 'sub-fire' });
    await settle();
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    await settle();
    expect(mocks.route).toHaveBeenLastCalledWith(
      'events.event',
      { sequence: 1 },
      ['sub-fire', 'sub-file'],
      expect.anything(),
    );
    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes a subscription that resolves after the saga was cancelled', async () => {
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    mocks.subscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    const { task } = startSaga();
    task.cancel();
    await task.toPromise();

    resolveSubscribe({ subscriptionId: 'sub-late' });
    await settle();
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-late');
  });

  it('routes settings bundles to the settings domain action without applying them itself', async () => {
    mocks.route.mockImplementation(
      (
        _method,
        _params,
        _subscriptionIds,
        overrides: { onSettingsChanges: (changes: unknown[]) => void },
      ) => {
        overrides.onSettingsChanges([{ path: 'model.defaultProvider', value: 'auggie' }]);
      },
    );
    const dispatch = vi.fn();
    const { task } = startSaga(null, dispatch);
    await settle();
    mocks.notificationHandler!({
      method: 'events.event',
      params: { event: { type: 'settings:changed' } },
    });
    await settle();

    expect(dispatch).toHaveBeenCalledWith(
      settingsChangesReceived([{ path: 'model.defaultProvider', value: 'auggie' }], undefined),
    );
    task.cancel();
    await task.toPromise();
  });
});
