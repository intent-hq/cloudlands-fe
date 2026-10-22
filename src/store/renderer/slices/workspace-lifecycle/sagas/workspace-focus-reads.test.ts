import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../../test/mocks/backend-transport.mock';
import '../../../seeders/workspaces-seeder';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { consoleOwnerChanged } from '../../hardware-console/hardware-console-slice';
import { principalSaga } from '../../principal/sagas/principal-saga';
import { daemonEventsSaga } from '../../workspace-events/sagas/daemon-events-saga';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { lifecycleReadSaga } from './lifecycle-read-saga';
import { workspaceReconnectSaga } from './workspace-reconnect-saga';

const WS = 'focus-workspace';
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('workspace reads across window and transport lifecycle', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  const cancel: Array<() => void> = [];
  let subscription: number;
  let attention: 'none' | 'unread';
  let eventId: number;
  const lists = () => backend.requests.filter((request) => request.method === 'workspace.list');
  const workspace = () => selectWorkspaceById.select(store.state, WS);
  function push(type: string, data: Record<string, unknown>) {
    backend.pushEvent({
      type,
      data: { workspaceId: WS, ...data },
      workspaceId: WS,
      subscriptionId: `focus-sub-${subscription}`,
      id: `focus-event-${++eventId}`,
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockBackend();
    backend = installMockBackend();
    subscription = 0;
    eventId = 0;
    attention = 'none';
    backend.onSubscribe(() => ({ subscriptionId: `focus-sub-${++subscription}` }));
    backend.onRequest('client.hello', () => ({ server: { capabilities: {} } }));
    backend.onRequest('principal.me', () => ({
      id: 'owner',
      login: null,
      displayName: null,
      avatarUrl: null,
      isAdministrator: true,
    }));
    backend.onRequest('workspace.list', () => ({
      workspaces: [{ id: WS, title: 'Focus test', branch: 'main', status: 'active', attention }],
    }));
    dispose = store.init();
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    cancel.push(
      store.runSaga(lifecycleReadSaga),
      store.runSaga(principalSaga),
      store.runSaga(daemonEventsSaga),
      store.runSaga(workspaceReconnectSaga),
    );
  });
  afterEach(() => {
    cancel
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    dispose();
    resetMockBackend();
    vi.useRealTimers();
  });

  it('keeps live attention projections current while blurred without focus or ownership reads', async () => {
    await settle();
    expect(lists()).toEqual([{ method: 'workspace.list', params: { includeArchived: true } }]);
    expect(workspace()?.attention).toBe('none');
    const initialRequests = backend.requests.length;
    window.dispatchEvent(new Event('blur'));
    store.dispatch(consoleOwnerChanged(false));
    push('workspace:attention-changed', { attention: 'unread' });
    push('workspace:waiting-changed', { waiting: true });
    push('workspace:displayStatus-changed', { displayStatus: 'pr_merged' });
    await settle();
    expect(workspace()).toMatchObject({
      attention: 'unread',
      waiting: true,
      displayStatus: 'pr_merged',
    });
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event('focus'));
      store.dispatch(consoleOwnerChanged(true));
      window.dispatchEvent(new Event('blur'));
      store.dispatch(consoleOwnerChanged(false));
      await settle();
    }
    push('workspace:attention-changed', { attention: 'none' });
    push('workspace:waiting-changed', { waiting: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workspace()).toMatchObject({ attention: 'none', waiting: false });
    expect(backend.requests.slice(initialRequests)).toEqual([]);
    expect(backend.subscribes).toHaveLength(1);
  });

  it('recovers missed attention after actual reconnect and keeps the replacement subscription live', async () => {
    await settle();
    const initialLists = lists().length;
    store.dispatch(connectionStatusChanged('disconnected'));
    attention = 'unread';
    store.dispatch(connectionStatusChanged('connected'));
    backend.triggerReconnect();
    await settle();
    expect(backend.subscribes).toHaveLength(2);
    expect(workspace()?.attention).toBe('unread');
    const recovery = lists().slice(initialLists);
    expect(recovery.length).toBeGreaterThan(0);
    expect(recovery.length).toBeLessThanOrEqual(2);
    for (const request of recovery) {
      expect(request).toEqual({ method: 'workspace.list', params: { includeArchived: true } });
    }
    push('workspace:attention-changed', { attention: 'none' });
    await settle();
    expect(workspace()?.attention).toBe('none');
    const settledLists = lists().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lists()).toHaveLength(settledLists);
  });
});
