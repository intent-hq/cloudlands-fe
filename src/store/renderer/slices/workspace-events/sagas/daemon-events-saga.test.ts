import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

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

import { daemonEventsSaga } from './daemon-events-saga';
import { DAEMON_EVENTS_SUBSCRIBE_TYPES } from '$features/events/daemon-events-bridge.client';
import { settingsChangesReceived } from '$store/renderer/slices/settings-events/settings-events-slice';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

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

    const task = runSaga({ dispatch: vi.fn() }, daemonEventsSaga);
    expect(mocks.notificationHandler).toBeTypeOf('function');
    expect(mocks.reconnectHandler).toBeTypeOf('function');
    expect(mocks.subscribe).toHaveBeenCalledWith({
      eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES],
    });

    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 1 } });
    mocks.notificationHandler!({ method: 'events.event', params: { sequence: 2 } });
    expect(mocks.route).not.toHaveBeenCalled();
    resolveSubscribe({ subscriptionId: 'sub-owned' });
    await settle();

    expect(mocks.route.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['events.event', { sequence: 1 }, 'sub-owned'],
      ['events.event', { sequence: 2 }, 'sub-owned'],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses the complete reviewed firehose filter, including exact-match task and git families', () => {
    expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toEqual([
      'agent:*',
      'file:*',
      'note:*',
      'comment:*',
      'script:*',
      'settings:changed',
      'workspace:tokenUsage-changed',
      'workspace:context-changed',
      'workspace:activity-changed',
      'workspace:displayStatus-changed',
      'workspace:attention-changed',
      'workspace:updated',
      'workspace:created',
      'workspace:deleted',
      'task:*',
      'git:*',
      'changes:git-status',
      'changes:tracked',
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
    const task = runSaga({ dispatch: vi.fn() }, daemonEventsSaga);
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

  it('removes both listeners, clears routing state, and unsubscribes on cancellation', async () => {
    const task = runSaga({ dispatch: vi.fn() }, daemonEventsSaga);
    await settle();
    task.cancel();
    await task.toPromise();

    expect(mocks.offNotification).toHaveBeenCalledTimes(1);
    expect(mocks.offReconnect).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-1');
    expect(mocks.disposeRouting).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes a subscription that resolves after the saga was cancelled', async () => {
    let resolveSubscribe!: (value: { subscriptionId: string }) => void;
    mocks.subscribe.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    const task = runSaga({ dispatch: vi.fn() }, daemonEventsSaga);
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
        _subscriptionId,
        overrides: { onSettingsChanges: (changes: unknown[]) => void },
      ) => {
        overrides.onSettingsChanges([{ path: 'providers.active', value: 'auggie' }]);
      },
    );
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, daemonEventsSaga);
    await settle();
    mocks.notificationHandler!({
      method: 'events.event',
      params: { event: { type: 'settings:changed' } },
    });
    await settle();

    expect(dispatch).toHaveBeenCalledWith(
      settingsChangesReceived([{ path: 'providers.active', value: 'auggie' }]),
    );
    task.cancel();
    await task.toPromise();
  });
});
