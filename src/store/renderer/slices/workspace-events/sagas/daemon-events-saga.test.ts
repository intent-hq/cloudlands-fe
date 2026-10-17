import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  agentLockReducer,
  setAgentLockState,
} from '$store/renderer/slices/agent-lock/agent-lock-slice';
import type { RendererRecoveryScope } from '$features/events/renderer-event-recovery';
import type { RecoveryReduxStore } from '$features/events/renderer-recovery-owners';
vi.mock('$features/events/renderer-recovery-owners', () => ({
  installRendererRecoveryOwners: (...args: unknown[]) => mocks.installOwners(...args),
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', async (original) => ({
  ...(await original<typeof import('$store/renderer/slices/principal/principal-selectors')>()),
  selectPrincipalActionContext: { select: () => 'A' },
}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  api: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() },
  capture: vi.fn(),
  installOwners: vi.fn(() => () => {}),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  offNotification: vi.fn(),
  offReconnect: vi.fn(),
  readyHandler: undefined as (() => void) | undefined,
  offReady: vi.fn(),
  reconnectHandlers: new Set<() => void>(),
  notificationHandler: undefined as
    ((notification: { method: string; params?: unknown }) => void) | undefined,
  reconnectHandler: undefined as (() => void) | undefined,
  route: vi.fn(),
  refresh: vi.fn(),
  disposeRouting: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  captureBackendEventRecovery: mocks.capture,
  onEventRecoveryReady: (handler: () => void) => {
    mocks.readyHandler = handler;
    return mocks.offReady;
  },
  electronAPI: () => mocks.api,
  backendSubscribe: mocks.subscribe,
  backendUnsubscribe: mocks.unsubscribe,
  onBackendNotification: (handler: typeof mocks.notificationHandler) => {
    mocks.notificationHandler = handler;
    return mocks.offNotification;
  },
  onBackendReconnected: (handler: typeof mocks.reconnectHandler) => {
    mocks.reconnectHandlers.add(handler!);
    mocks.reconnectHandler = () => {
      for (const listener of mocks.reconnectHandlers) listener();
    };
    return () => {
      mocks.reconnectHandlers.delete(handler!);
      mocks.offReconnect();
    };
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
import { installInterruptedAgentsService } from '$features/agent/interrupted-agents-service';
import {
  daemonEventsSubscribed,
  workspaceEventsReducer,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
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

function startSaga(
  currentTabId: string | null = null,
  dispatch = vi.fn(),
  enableRecovery: boolean | null = false,
) {
  const input = stdChannel();
  let state = {
    agentLock: agentLockReducer(undefined, setAgentLockState('ws', { old: true }, {})),
    workspaceEvents: workspaceEventsReducer(undefined, { type: '@@INIT' }),
    tabState:
      currentTabId === null
        ? tabStateReducer(undefined, { type: '@@INIT' })
        : tabStateReducer(undefined, openWorkspaceTab(currentTabId)),
  };
  const listeners = new Set<() => void>();
  const dispatchAction = (action: Parameters<typeof tabStateReducer>[1]) => {
    state = {
      agentLock: agentLockReducer(state.agentLock, action),
      tabState: tabStateReducer(state.tabState, action),
      workspaceEvents: workspaceEventsReducer(state.workspaceEvents, action),
    };
    input.put(action);
    listeners.forEach((listener) => listener());
    return dispatch(action);
  };
  const reduxStore = {
    dispatch: dispatchAction,
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
    enableRecovery ?? undefined,
  );
  return { input, task, setActive, state: () => state };
}

describe('daemonEventsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandler = undefined;
    mocks.reconnectHandler = undefined;
    mocks.reconnectHandlers.clear();
    mocks.subscribe.mockResolvedValue({ subscriptionId: 'sub-1' });
    mocks.unsubscribe.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mocks.notificationHandler = undefined;
    mocks.reconnectHandler = undefined;
    mocks.reconnectHandlers.clear();
  });

  it.each([
    ['array action', { inviteId: 'invite', action: ['created'] }],
    ['object action', { inviteId: 'invite', action: { toString: null } }],
    ['missing action', { inviteId: 'invite' }],
    ['unknown action', { inviteId: 'invite', action: 'changed' }],
    ['empty id', { inviteId: '', action: 'created' }],
    ['blank id', { inviteId: '  ', action: 'created' }],
    ['non-string id', { inviteId: 1, action: 'created' }],
    ['null data', null],
    ['array data', []],
  ])(
    'ignores malformed invitation %s and processes a later valid notification',
    async (_name, data) => {
      const actual = await vi.importActual<
        typeof import('$features/events/daemon-events-bridge.client')
      >('$features/events/daemon-events-bridge.client');
      const { store } = await import('$store/renderer/store');
      const {
        hostMembershipListsChanged,
        hostMembershipReducer,
        hostMembershipOpened,
        initialState,
      } = await import('$store/renderer/slices/host-membership/host-membership-slice');
      let membership = hostMembershipReducer(
        initialState,
        hostMembershipOpened({ session: 'active', context: 'owner' }),
      );
      const dispatch = vi.fn((action: Parameters<typeof hostMembershipReducer>[1]) => {
        membership = hostMembershipReducer(membership, action);
        return action;
      });
      const dispatchGetter = vi.spyOn(store, 'dispatch', 'get').mockReturnValue(dispatch);
      mocks.route.mockImplementation(actual.routeDaemonEventsNotification);
      const { task } = startSaga();
      const completion = task.toPromise().catch(() => undefined);
      const notify = (payload: unknown, subscriptionId = 'sub-1') =>
        mocks.notificationHandler!({
          method: 'events.event',
          params: { subscriptionId, event: { type: 'host:invites-changed', data: payload } },
        });
      try {
        await settle();
        dispatch.mockClear();
        notify(data);
        await settle();
        expect(task.isRunning()).toBe(true);
        expect(dispatch).not.toHaveBeenCalledWith(hostMembershipListsChanged());
        expect(membership.reloadPending).toBe(false);
        notify({ inviteId: 'valid', action: 'created' }, 'foreign-host');
        await settle();
        expect(dispatch).not.toHaveBeenCalledWith(hostMembershipListsChanged());
        for (const action of ['created', 'revoked', 'redeemed'])
          notify({ inviteId: 'valid', action, url: 'must-not-dispatch' });
        await settle();
        expect(task.isRunning()).toBe(true);
        expect(dispatch.mock.calls).toEqual([
          [hostMembershipListsChanged()],
          [hostMembershipListsChanged()],
          [hostMembershipListsChanged()],
        ]);
        expect(membership.reloadPending).toBe(true);
        expect(JSON.stringify(dispatch.mock.calls)).not.toContain('must-not-dispatch');
      } finally {
        task.cancel();
        await completion;
        dispatchGetter.mockRestore();
        mocks.route.mockReset();
      }
    },
  );

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
      'hub:checkpoint',
      'note:*',
      'comment:*',
      'script:*',
      'terminal:exit',
      'settings:changed',
      'skills:changed',
      'workspace:tokenUsage-changed',
      'workspace:context-changed',
      'workspace:activity-changed',
      'workspace:displayStatus-changed',
      'workspace:attention-changed',
      'workspace:waiting-changed',
      'workspace:updated',
      'workspace:task-stats-changed',
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
      'sourceControl:auth-changed',
      'principal:identity-changed',
      'client:updated',
      'client:connected',
      'client:disconnected',
      'browser:tab-opened',
      'browser:tab-updated',
      'browser:tab-closed',
      'app:ui-navigate',
      'app:ui-highlight',
      'app:workspace-open',
      'presence:changed',
      'host:members-changed',
      'host:invites-changed',
      'host:execution-context-changed',
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

    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-old', undefined);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe).toHaveBeenLastCalledWith('sub-new', undefined);
  });

  it('discovers recovery that failed between the initial list and firehose subscription', async () => {
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    mocks.subscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    mocks.api.invoke.mockResolvedValue({ status: 'connected' });
    mocks.api.on.mockReturnValue('status-listener');
    const listInterrupted = vi.fn().mockResolvedValue([]);
    const show = vi.fn();
    const dispose = installInterruptedAgentsService({ agents: { listInterrupted } }, show);
    const { task } = startSaga();
    try {
      await settle();
      expect(listInterrupted).toHaveBeenCalledTimes(1);
      expect(show).not.toHaveBeenCalled();
      const candidate = {
        agentId: 'failed-startup',
        workspaceId: 'ws-1',
        workspaceName: 'Workspace',
        agentName: 'Agent',
        prevStatus: 'active',
        interruptedAt: '2026-09-29T00:00:00Z',
      };
      // Failure was published before events.subscribe reached the daemon, so
      // no notification is delivered to this client. Subscribe readiness must
      // trigger an authoritative catch-up read.
      listInterrupted.mockResolvedValue([candidate]);
      resolveSubscribe({ subscriptionId: 'sub-ready' });
      await settle();
      expect(show).toHaveBeenCalledExactlyOnceWith([candidate]);
    } finally {
      dispose();
      task.cancel();
      await task.toPromise();
    }
  });

  it('discovers recovery that failed while reconnect subscription restoration was delayed', async () => {
    mocks.api.invoke.mockResolvedValue({ status: 'connected' });
    mocks.api.on.mockReturnValue('status-listener');
    const listInterrupted = vi.fn().mockResolvedValue([]);
    const show = vi.fn();
    const dispose = installInterruptedAgentsService({ agents: { listInterrupted } }, show);
    const { task } = startSaga();
    try {
      await settle();
      let finishUnsubscribe!: () => void;
      mocks.unsubscribe.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishUnsubscribe = resolve;
          }),
      );
      mocks.reconnectHandler!();
      await settle();
      expect(mocks.subscribe).toHaveBeenCalledTimes(1);
      expect(show).not.toHaveBeenCalled();
      const candidate = {
        agentId: 'failed-startup',
        workspaceId: 'ws-1',
        workspaceName: 'Workspace',
        agentName: 'Agent',
        prevStatus: 'active',
        interruptedAt: '2026-09-29T00:00:00Z',
      };
      listInterrupted.mockResolvedValue([candidate]);
      finishUnsubscribe();
      await settle();
      expect(mocks.subscribe).toHaveBeenCalledTimes(2);
      expect(show).toHaveBeenCalledExactlyOnceWith([candidate]);
    } finally {
      dispose();
      task.cancel();
      await task.toPromise();
    }
  });

  it('announces firehose readiness only once a subscription id is held, on boot and reconnect', async () => {
    const dispatch = vi.fn();
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-old' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ subscriptionId: 'sub-new' });
    const { task } = startSaga(null, dispatch);
    await settle();
    const subscribed = () =>
      dispatch.mock.calls.filter(([action]) => action.type === daemonEventsSubscribed.type);
    expect(subscribed()).toHaveLength(1);
    const readyIndex = dispatch.mock.calls.findIndex(
      ([action]) => action.type === daemonEventsSubscribed.type,
    );
    expect(dispatch.mock.invocationCallOrder[readyIndex]).toBeGreaterThan(
      mocks.subscribe.mock.invocationCallOrder[0],
    );

    mocks.reconnectHandler!();
    await settle();
    expect(subscribed()).toHaveLength(1);

    mocks.reconnectHandler!();
    await settle();
    expect(subscribed()).toHaveLength(2);
    expect(mocks.subscribe).toHaveBeenCalledTimes(3);
    task.cancel();
    await task.toPromise();
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

    expect(mocks.unsubscribe.mock.calls).toEqual([
      ['sub-fire-old', undefined],
      ['sub-file-old', 'ws-1'],
    ]);
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
    expect(mocks.unsubscribe.mock.calls.slice(2)).toEqual([
      ['sub-fire-new', undefined],
      ['sub-file-new', 'ws-1'],
    ]);
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
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1', undefined);
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

    expect(mocks.unsubscribe.mock.calls).toEqual([
      ['sub-fire', undefined],
      ['sub-file', 'ws-1'],
    ]);
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
    expect(mocks.unsubscribe.mock.calls).toEqual([['sub-file', 'ws-1']]);
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
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-file-ws1', 'ws-1');
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
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-late', undefined);
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

it.each([true, null])(
  'recovers a lost final snapshot with configured opt-in %s',
  async (enabled) => {
    vi.clearAllMocks();
    let receive!: (n: RecoveryNotification) => void;
    const wire = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
      if (method === 'events.subscribe')
        return { subscriptionId: 'adopted-global', lossRecovery: 1 };
      if (method === 'events.fence') return params;
      if (method === 'file-tracking.getAgentLocks') return { lockedAgentIds: ['new'] };
      if (method === 'events.unsubscribe') return {};
      throw new Error(method);
    });
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onNotification: (fn) => {
        receive = fn;
        return () => {};
      },
      onRetired: () => () => {},
      dispose: () => {},
      request: async (method, params, observe) => {
        const value = await wire(method, params);
        observe?.(value);
        return value;
      },
    });
    mocks.capture.mockResolvedValue(session);
    mocks.installOwners.mockImplementation(
      (scope: RendererRecoveryScope, store: RecoveryReduxStore) => {
        const owner = scope.registerResource({
          key: 'locks:ws',
          workspaceId: 'ws',
          eventTypes: ['changes:agent-locks'],
          isCurrent: () => true,
          read: (reader) =>
            reader.request<{ lockedAgentIds: string[] }>('file-tracking.getAgentLocks', {
              workspaceId: 'ws',
            }),
          apply: (value) => {
            store.dispatch(
              setAgentLockState(
                'ws',
                Object.fromEntries(value.lockedAgentIds.map((id) => [id, true])),
                {},
              ),
            );
          },
          invalidate: () => {},
          retire: () => {
            store.dispatch(setAgentLockState('ws', {}, {}));
          },
        });
        return () => owner.dispose();
      },
    );
    const h = startSaga(null, vi.fn(), enabled);
    try {
      await settle();
      await settle();
      expect(mocks.subscribe).not.toHaveBeenCalled();
      expect(wire.mock.calls.filter(([m]) => m === 'events.subscribe')).toEqual([
        ['events.subscribe', { ...firehoseParams, lossRecovery: 1 }],
      ]);
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'adopted-global', generation: '1', scope: { workspaceId: null } },
      });
      await settle();
      await settle();
      expect(h.state().agentLock.byWorkspaceId.ws.lockedAgentIds).toEqual({ new: true });
      expect(wire.mock.calls.filter(([m]) => m === 'file-tracking.getAgentLocks')).toHaveLength(1);
      expect(wire.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
    } finally {
      h.task.cancel();
      await settle();
    }
    expect(wire.mock.calls.filter(([m]) => m === 'events.unsubscribe')).toHaveLength(1);
  },
);

it('waits for confirmed recovery readiness and deduplicates the physical reconnect', async () => {
  vi.clearAllMocks();
  mocks.installOwners.mockImplementation(() => () => {});
  let current = true;
  let retire!: () => void;
  const wire = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: `lease-${wire.mock.calls.length}`, lossRecovery: 1 }
      : {},
  );
  const create = (initial: boolean) =>
    createEventRecoverySession({
      supported: true,
      isCurrent: () => (initial ? current : true),
      onNotification: () => () => {},
      onRetired: (fn) => {
        if (initial) retire = fn;
        return () => {};
      },
      dispose: () => {},
      request: async (method, _params, observe) => {
        const result = await wire(method);
        observe?.(result);
        return result;
      },
    });
  mocks.capture
    .mockResolvedValueOnce(create(true))
    .mockImplementation(() => Promise.resolve(create(false)));
  const h = startSaga(null, vi.fn(), true);
  try {
    await settle();
    current = false;
    retire();
    await settle();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(wire.mock.calls.filter(([method]) => method === 'events.subscribe')).toHaveLength(1);
    mocks.readyHandler!();
    mocks.reconnectHandler!();
    await settle();
    await settle();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(wire.mock.calls.filter(([method]) => method === 'events.subscribe')).toHaveLength(2);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  } finally {
    h.task.cancel();
    await h.task.toPromise();
  }
  expect(mocks.offReady).toHaveBeenCalledTimes(1);
});

it('keeps ingress closed while an initial capture is quarantined and retries on readiness', async () => {
  vi.clearAllMocks();
  mocks.installOwners.mockImplementation(() => () => {});
  mocks.capture.mockRejectedValueOnce(new Error('requests still draining'));
  const h = startSaga(null, vi.fn(), true);
  const completion = h.task.toPromise().catch(() => undefined);
  try {
    await settle();
    expect(h.task.isRunning()).toBe(true);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    mocks.notificationHandler!({
      method: 'events.event',
      params: { event: { type: 'settings:changed', data: {} } },
    });
    await settle();
    expect(mocks.route).not.toHaveBeenCalled();
    const wire = vi.fn(async (method: string) =>
      method === 'events.subscribe' ? { subscriptionId: 'ready', lossRecovery: 1 } : {},
    );
    mocks.capture.mockResolvedValue(
      createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onNotification: () => () => {},
        onRetired: () => () => {},
        dispose: () => {},
        request: async (m, _p, observe) => {
          const r = await wire(m);
          observe?.(r);
          return r;
        },
      }),
    );
    mocks.readyHandler!();
    await settle();
    await settle();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(wire.mock.calls.filter(([method]) => method === 'events.subscribe')).toHaveLength(1);
  } finally {
    h.task.cancel();
    await completion;
  }
});

it('recaptures the real browser transport once after same-socket hello and held wire drain', async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.installOwners.mockImplementation(() => () => {});
  const { BrowserWebSocketTransport } =
    await import('$lib/client/live/browser-websocket-transport');
  const frames: Array<{ id: number; method: string }> = [];
  let identity = 'first';
  const socket = {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as (() => void) | null,
    onclose: null as (() => void) | null,
    close: () => {},
    send: (data: string) => {
      const frame = JSON.parse(data) as { id: number; method: string };
      frames.push(frame);
      if (frame.method === 'held.read') return;
      const result =
        frame.method === 'client.hello'
          ? { clientId: identity, server: { capabilities: { eventStreamRecovery: 1 } } }
          : frame.method === 'events.subscribe'
            ? { subscriptionId: `lease-${identity}`, lossRecovery: 1 }
            : {};
      queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ id: frame.id, result }) }));
    },
  };
  const transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc',
    webSocketFactory: () => socket,
  });
  let firstSession: Awaited<ReturnType<typeof transport.captureEventRecovery>> | undefined;
  mocks.capture.mockImplementation(async () => {
    const session = await transport.captureEventRecovery();
    firstSession ??= session;
    return session;
  });
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  const h = startSaga(null, vi.fn(), true);
  const off = transport.onEventRecoveryReady(() => mocks.readyHandler?.());
  try {
    await flush();
    expect(socket.onopen).not.toBeNull();
    socket.onopen?.();
    await flush();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(1);
    const held = firstSession!.request('held.read').catch((error: unknown) => error);
    await flush();
    const heldFrame = frames.find((frame) => frame.method === 'held.read')!;
    await vi.advanceTimersByTimeAsync(60_000);
    identity = 'second';
    await transport.request('client.hello');
    await flush();
    expect(firstSession!.isCurrent()).toBe(false);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(1);
    socket.onmessage?.({ data: JSON.stringify({ id: heldFrame.id, result: 'stale' }) });
    await held;
    await flush();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(frames.filter((frame) => frame.method === 'events.subscribe')).toHaveLength(2);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(h.task.isRunning()).toBe(true);
  } finally {
    h.task.cancel();
    await h.task.toPromise();
    off();
    transport.dispose();
    vi.useRealTimers();
  }
});

it('absent replacement cannot reopen raw legacy after supported retirement', async () => {
  vi.clearAllMocks();
  mocks.installOwners.mockImplementation(() => () => {});
  let current = true;
  let retire!: () => void;
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => current,
    onRetired: (fn) => {
      retire = fn;
      return () => {};
    },
    onNotification: () => () => {},
    dispose: () => {},
    request: async (method, _params, observe) => {
      const result =
        method === 'events.subscribe'
          ? { subscriptionId: 'initial-supported', lossRecovery: 1 }
          : {};
      observe?.(result);
      return result;
    },
  });
  mocks.capture.mockResolvedValueOnce(session).mockResolvedValue(undefined);
  const h = startSaga(null, vi.fn(), true);
  const completion = h.task.toPromise().catch(() => undefined);
  try {
    await settle();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    current = false;
    retire();
    await settle();
    mocks.readyHandler!();
    await settle();
    await settle();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    mocks.route.mockClear();
    mocks.notificationHandler!({
      method: 'events.event',
      params: {
        type: 'settings:changed',
        data: { changes: [{ key: 'notifications.volume', value: 0.9 }] },
      },
    });
    await settle();
    expect.soft(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
  } finally {
    h.task.cancel();
    await completion;
  }
});

it.each([true, false])(
  'opens legacy routing only for a current confirmed unsupported capture: %s',
  async (current) => {
    vi.clearAllMocks();
    mocks.installOwners.mockImplementation(() => () => {});
    mocks.subscribe.mockResolvedValue({ subscriptionId: 'legacy-confirmed' });
    mocks.capture.mockResolvedValue(
      createEventRecoverySession({
        supported: false,
        isCurrent: () => current,
        onRetired: () => () => {},
        onNotification: () => () => {},
        dispose: () => {},
        request: async () => ({}),
      }),
    );
    const h = startSaga(null, vi.fn(), true);
    try {
      await settle();
      expect(mocks.subscribe).toHaveBeenCalledTimes(current ? 1 : 0);
      mocks.route.mockClear();
      mocks.notificationHandler!({
        method: 'events.event',
        params: { type: 'settings:changed', data: {} },
      });
      await settle();
      expect(mocks.route).toHaveBeenCalledTimes(current ? 1 : 0);
    } finally {
      h.task.cancel();
      await h.task.toPromise();
    }
  },
);
