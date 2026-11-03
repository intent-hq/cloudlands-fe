/**
 * Start On reads `remoteInitialAgent` through the real Electron main path:
 * the daemon's `client.hello` lands in `JsonRpcClient`, `BACKEND.NODE_CAPABILITIES`
 * answers `{ server: { capabilities: client.getNodeCapabilities() } }`, and the
 * remote machines saga reads that reply. Seeding renderer state or mocking the
 * channel's reply skips main's capability list, which once dropped the key
 * (intent-hq/intent#8423).
 */
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import { installMockBackend, resetMockBackend } from '../../test/mocks/backend-transport.mock';
import { JsonRpcClient } from '$features/backend/main/json-rpc-client';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesSaga } from './remote-machines-saga';
import { remoteMachinesRefreshRequested } from './remote-machines-slice';
import { selectStartOnVisible } from './remote-machines-selectors';

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }
  destroy(): void {}
}

const MACHINE = {
  id: 'd-mac',
  name: 'Studio Mac',
  hosts: ['192.0.2.4'],
  port: 5179,
  fingerprint: 'AA:BB',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-10-30T00:00:00Z',
};

let client: JsonRpcClient | undefined;
let task: Task | undefined;

/** A main-process client acknowledged with the daemon's hello capabilities. */
async function mainClient(capabilities: Record<string, unknown>): Promise<JsonRpcClient> {
  const socket = new FakeSocket();
  client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    helloParams: () => ({ clientId: 'persisted' }),
    heartbeatIntervalMs: 0,
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(socket.writes).toHaveLength(1));
  socket.emit(
    'data',
    Buffer.from(
      JSON.stringify({ id: 1, result: { clientId: 'confirmed', server: { capabilities } } }) + '\n',
    ),
  );
  await vi.waitFor(() => expect(client?.getStatus()).toBe('connected'));
  return client;
}

/** The renderer sees exactly what the `BACKEND.NODE_CAPABILITIES` handler returns. */
function rendererOver(main: JsonRpcClient) {
  const mock = installMockBackend();
  mock.onRequest('client.hello', () => ({
    server: { capabilities: main.getNodeCapabilities() },
  }));
  mock.onRequest('remoteMachines.list', () => ({ machines: [MACHINE] }));
  mock.onRequest('executor.list', () => ({ backends: [] }));
  const channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    remoteMachinesSaga,
  );
  const action = remoteMachinesRefreshRequested();
  store.dispatch(action);
  channel.put(action);
}

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke: vi.fn(async () => 'local-fp'),
  };
});

afterEach(() => {
  task?.cancel();
  task = undefined;
  client?.dispose();
  client = undefined;
  resetMockBackend();
});

describe('Start On through the Electron main capability path', () => {
  it('shows with a connected machine when the daemon advertises remoteInitialAgent: 1', async () => {
    rendererOver(await mainClient({ remoteMachines: 1, remoteInitialAgent: 1 }));
    await vi.waitFor(() =>
      expect(Object.keys(store.state.remoteMachines.machines)).toEqual(['d-mac']),
    );
    await vi.waitFor(() => expect(selectStartOnVisible.select(store.state)).toBe(true));
  });

  it('stays hidden when the daemon does not advertise remoteInitialAgent', async () => {
    rendererOver(await mainClient({ remoteMachines: 1 }));
    await vi.waitFor(() =>
      expect(Object.keys(store.state.remoteMachines.machines)).toEqual(['d-mac']),
    );
    expect(store.state.remoteMachines.supported).toBe(true);
    expect(selectStartOnVisible.select(store.state)).toBe(false);
  });
});
