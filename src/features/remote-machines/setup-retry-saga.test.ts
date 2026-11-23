/**
 * The setup retry saga against a mock backend: the `agent.retrySetup` wire
 * request, one request per agent at a time, and a refusal toast carrying the
 * daemon's message (PROTOCOL `methods/nodes.md` "Retrying a remote agent's setup").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const ui = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));

import {
  BackendError,
  buildErrorPayload,
  installMockBackend,
  type MockBackendHandle,
} from '../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { remoteSetupRetryRequested, setupRetryKey } from './remote-machines-slice';
import { setupRetrySaga } from './setup-retry-saga';

const PARAMS = { workspaceId: 'ws-1', agentId: 'agent-1' };

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let backend: MockBackendHandle;

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}
const pending = () => store.state.remoteMachines.pending[setupRetryKey(PARAMS.agentId)];
/** The agent's session row with the given setup, as `agent:updated` stores it. */
const upsertSetup = (setup: AgentSession['setup']) =>
  dispatch(
    bulkUpsertSessions(
      [
        {
          id: AgentId(PARAMS.agentId),
          backendSessionId: null,
          workspaceId: WorkspaceId(PARAMS.workspaceId),
          name: 'iOS build fixer',
          status: AgentStatus.Idle,
          messages: [],
          createdAt: '2026-11-23T09:00:00Z',
          updatedAt: '2026-11-23T09:00:00Z',
          nodeId: 'node-mac',
          effectiveIsolation: 'isolated',
          setup,
        } as AgentSession,
      ],
      { preserveExplicitRuntimeFlags: true },
    ),
  );
const FAILED = { state: 'failed' as const, exitCode: 2, startedAt: '2026-11-23T09:00:00Z' };
const RUNNING_REPLY = {
  agentId: PARAMS.agentId,
  setup: { state: 'running', startedAt: '2026-11-23T09:05:00Z' },
};
const retryRequests = () => backend.requests.filter((r) => r.method === 'agent.retrySetup');

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  ui.error.mockReset();
  backend = installMockBackend();
  channel = stdChannel();
  task = runSaga(
    {
      channel,
      getState: () => store.state,
      dispatch: (action) => store.dispatch(action as Parameters<typeof store.dispatch>[0]),
    },
    setupRetrySaga,
  );
});
afterEach(() => task?.cancel());

describe('setupRetrySaga', () => {
  it('sends agent.retrySetup once while a request for that agent is in flight', async () => {
    let release!: () => void;
    backend.onRequest(
      'agent.retrySetup',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              agentId: PARAMS.agentId,
              setup: { state: 'running', startedAt: '2026-11-23T09:05:00Z' },
            });
        }),
    );
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    await vi.waitFor(() => expect(retryRequests()).toHaveLength(1));
    expect(retryRequests()[0]?.params).toEqual(PARAMS);
    expect(pending()).toBe('retrying-setup');

    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    expect(retryRequests()).toHaveLength(1);

    release();
    await vi.waitFor(() => expect(pending()).toBeUndefined());
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('toasts a -32602 refusal with the machine and the daemon message', async () => {
    const message = 'The agent is not running on Mac mini.';
    backend.onRequest('agent.retrySetup', () => {
      throw new BackendError(
        buildErrorPayload('agent-not-running', message, {
          rpcCode: -32602,
          data: { code: 'agent-not-running' },
        }),
      );
    });
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledTimes(1));
    const [title, options] = ui.error.mock.calls[0]!;
    expect(title).toContain('Mac mini');
    expect(options).toEqual({ description: message });
    await vi.waitFor(() => expect(pending()).toBeUndefined());
  });

  it('keeps the retry pending after the reply until agent:updated moves setup out of failed', async () => {
    upsertSetup(FAILED);
    backend.onRequest('agent.retrySetup', () => RUNNING_REPLY);
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    await vi.waitFor(() => expect(retryRequests()).toHaveLength(1));
    // The reply alone does not release it, and a second press sends nothing.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending()).toBe('retrying-setup');
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    expect(retryRequests()).toHaveLength(1);
    // The session is not patched from the reply.
    expect(store.state.agentSessions.byAgentId[PARAMS.agentId]?.setup?.state).toBe('failed');

    upsertSetup({ state: 'running', startedAt: '2026-11-23T09:05:00Z' });
    await vi.waitFor(() => expect(pending()).toBeUndefined());
  });

  it('clears a pending retry on reconnect', async () => {
    upsertSetup(FAILED);
    backend.onRequest('agent.retrySetup', () => RUNNING_REPLY);
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    await vi.waitFor(() => expect(retryRequests()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending()).toBe('retrying-setup');
    dispatch(backendReconnected());
    await vi.waitFor(() => expect(pending()).toBeUndefined());
    // The saga is free again: a new press sends a new request.
    dispatch(remoteSetupRetryRequested({ ...PARAMS, machine: 'Mac mini' }));
    await vi.waitFor(() => expect(retryRequests()).toHaveLength(2));
  });
});
