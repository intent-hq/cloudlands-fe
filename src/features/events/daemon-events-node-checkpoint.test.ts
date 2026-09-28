/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { waitFor } from '@testing-library/svelte';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  __resetDaemonEventsBridgeForTests,
} from './daemon-events-bridge.client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '@/test/mocks/backend-transport.mock';

vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('@/test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

const agentId = AgentId('checkpoint-transport-agent');
const workspaceId = WorkspaceId('checkpoint-transport-workspace');
let backend: MockBackendHandle;
let task: Task | undefined;
beforeEach(() => {
  backend = installMockBackend();
  backend.onSubscribe(() => ({ subscriptionId: 'checkpoint-sub' }));
  appStore.init();
  __resetDaemonEventsBridgeForTests();
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId,
        backendSessionId: null,
        name: 'Remote',
        status: AgentStatus.Halted,
        messages: [],
        createdAt: '2026-09-28T08:00:00Z',
        updatedAt: '2026-09-28T08:00:00Z',
        placement: { target: 'remote', checkout: 'isolated' },
        nodeState: 'offline',
      },
    ]),
  );
});
afterEach(async () => {
  task?.cancel();
  await task?.toPromise();
  task = undefined;
  appStore.dispatch(removeSession(agentId));
  resetMockBackend();
  __resetDaemonEventsBridgeForTests();
});

it('subscribes and folds checkpoint notifications through the real saga and router with numeric freshness', async () => {
  const input = stdChannel();
  task = runSaga(
    {
      channel: input,
      dispatch: (action) => appStore.dispatch(action),
      getState: () => appStore.state,
    },
    daemonEventsSaga,
  );
  await waitFor(() =>
    expect(backend.subscribes).toContainEqual({ eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES] }),
  );
  expect(DAEMON_EVENTS_SUBSCRIBE_TYPES).toContain('hub:checkpoint');
  const checkpoint = (assignmentEpoch: string, captureRevision: string, id: string) => ({
    id,
    assignmentEpoch,
    captureRevision,
    capturedAt: '2026-09-28T08:45:00Z',
    committedAt: '2026-09-28T08:45:01Z',
  });
  const deliver = (value: ReturnType<typeof checkpoint>, scope = workspaceId) => {
    // Model the server filter: an unsubscribed event is never delivered.
    if (
      !backend.subscribes.some((params) =>
        (params as { eventTypes: string[] }).eventTypes.includes('hub:checkpoint'),
      )
    )
      return;
    backend.pushEvent({
      type: 'hub:checkpoint',
      workspaceId: scope,
      subscriptionId: 'checkpoint-sub',
      data: { workspaceId: scope, agentId, checkpoint: value },
    });
  };
  const current = () => selectAgentSession.select(appStore.state, agentId)?.checkpoint;
  const latest = checkpoint('2', '10', 'cp-10');
  deliver(latest);
  await waitFor(() => expect(current()).toEqual(latest));
  deliver(checkpoint('2', '9', 'stale-revision'));
  deliver(checkpoint('1', '99', 'stale-epoch'));
  deliver(checkpoint('2', '10', 'same-pair-different-manifest'));
  deliver(checkpoint('9', '1', 'other-workspace'), WorkspaceId('other-workspace'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(current()).toEqual(latest);
  const newer = checkpoint('3', '1', 'cp-new-epoch');
  deliver(newer);
  await waitFor(() => expect(current()).toEqual(newer));
});
