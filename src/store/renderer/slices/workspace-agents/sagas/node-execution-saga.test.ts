import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const notifications = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: notifications }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: notifications.confirm }));
import {
  installMockBackend,
  resetMockBackend,
} from '../../../../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { bulkUpsertSessions, removeSession } from '../../agent-session/agent-session-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { setLabsRemoteAgentsEnabled } from '../../user-preferences/user-preferences-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import { nodeExecutionSaga } from './node-execution-saga';
import { agentHubActionRequested, nodeCapabilitiesRequested } from '../workspace-agents-slice';
import { selectNodeCapabilities } from '../workspace-agents-selectors';

let task: Task;
const agentId = 'agent-hub-saga';
function start() {
  const channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    nodeExecutionSaga,
  );
  return channel;
}
beforeEach(() => {
  store.init();
  store.dispatch(setLabsRemoteAgentsEnabled(false));
  store.dispatch(
    bulkUpsertSessions([
      {
        id: AgentId(agentId),
        workspaceId: WorkspaceId('ws-hub'),
        backendSessionId: null,
        name: 'Builder',
        status: AgentStatus.Halted,
        messages: [],
        createdAt: '2026-09-30T00:00:00Z',
        updatedAt: '2026-09-30T00:00:00Z',
        placement: { target: 'remote', checkout: 'isolated' },
        effectiveIsolation: 'isolated',
        checkpoint: {
          id: 'checkpoint-clean',
          assignmentEpoch: '1',
          captureRevision: '2',
          capturedAt: '2026-09-30T00:00:00Z',
          committedAt: '2026-09-30T00:00:01Z',
        },
      } satisfies AgentSession,
    ]),
  );
});
afterEach(() => {
  task?.cancel();
  store.dispatch(removeSession(agentId));
  resetMockBackend();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe('node execution actions', () => {
  it.each(['merged', 'conflict', 'blocked'] as const)(
    'merges an existing remote checkpoint with Labs off: %s',
    async (status) => {
      const backend = installMockBackend();
      backend.onRequest('client.hello', () => ({ server: { capabilities: { agentNodes: 1 } } }));
      backend.onRequest('hub.merge', () => ({
        ok: true,
        status,
        ...(status === 'conflict'
          ? { conflictingPaths: ['src/file.ts'] }
          : status === 'blocked'
            ? { reason: 'target-offline' }
            : {}),
      }));
      const channel = start();
      channel.put(agentHubActionRequested('ws-hub', agentId, 'merge'));
      await vi.waitFor(() =>
        expect(backend.requests.some((r) => r.method === 'hub.merge')).toBe(true),
      );
      expect(backend.requests.find((r) => r.method === 'hub.merge')?.params).toEqual({
        workspaceId: 'ws-hub',
        agentId,
        checkpointId: 'checkpoint-clean',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      await vi.waitFor(() =>
        expect(
          status === 'merged' ? notifications.success : notifications.error,
        ).toHaveBeenCalled(),
      );
      expect(store.state.workspaceAgents.nodeOperationBusy).toBe(false);
    },
  );
  it('keeps the checkout when discard confirmation is cancelled', async () => {
    const backend = installMockBackend();
    notifications.confirm.mockResolvedValueOnce(false);
    start().put(agentHubActionRequested('ws-hub', agentId, 'discard'));
    await vi.waitFor(() => expect(notifications.confirm).toHaveBeenCalled());
    expect(backend.requests).toEqual([]);
  });
  it('records only exact supported capability flags', async () => {
    const backend = installMockBackend();
    backend.onRequest('client.hello', () => ({
      server: { capabilities: { agentNodes: 1, localNodeIsolation: true } },
    }));
    start().put(nodeCapabilitiesRequested());
    await vi.waitFor(() =>
      expect(selectNodeCapabilities.select(store.state)).toEqual({
        agentNodes: true,
        localNodeIsolation: false,
      }),
    );
  });
  it('refreshes the new connection while an old hello remains pending', async () => {
    const backend = installMockBackend();
    let resolveOld!: (value: unknown) => void;
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve;
    });
    let helloCount = 0;
    backend.onRequest('client.hello', () =>
      ++helloCount === 1
        ? oldResponse
        : {
            server: { capabilities: { agentNodes: 1, localNodeIsolation: 1 } },
          },
    );
    const channel = start();
    channel.put(nodeCapabilitiesRequested());
    await vi.waitFor(() => expect(helloCount).toBe(1));
    store.dispatch(connectionStatusChanged('connecting'));
    const generation = store.state.daemonHealth.connectionGeneration;
    channel.put(nodeCapabilitiesRequested());
    try {
      await vi.waitFor(() =>
        expect(selectNodeCapabilities.select(store.state)).toEqual({
          agentNodes: true,
          localNodeIsolation: true,
        }),
      );
      expect(helloCount).toBe(2);
      resolveOld({ server: { capabilities: {} } });
      await oldResponse;
      await Promise.resolve();
      expect(store.state.workspaceAgents.nodeSupport).toEqual({
        generation,
        capabilities: { agentNodes: true, localNodeIsolation: true },
      });
    } finally {
      resolveOld({ server: { capabilities: {} } });
    }
  });
});
