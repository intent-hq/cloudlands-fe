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
});
