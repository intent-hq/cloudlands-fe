import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const ui = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: ui.confirm }));
import { installMockBackend, resetMockBackend } from '../../test/mocks/backend-transport.mock';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { remoteMachinesSaga } from './remote-machines-saga';
import {
  executorRevokeRequested,
  remoteMachineExposeRequested,
  remoteMachinesRefreshRequested,
  remoteMachineUnexposeRequested,
} from './remote-machines-slice';

const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;
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

let task: Task;
let channel: ReturnType<typeof stdChannel>;
const invoke = vi.fn();

function start() {
  channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    remoteMachinesSaga,
  );
}

/** Reduce the action and deliver it to the running saga. */
function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

async function settle() {
  await vi.waitFor(() => expect(Object.keys(store.state.remoteMachines.pending)).toEqual([]));
}

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  invoke.mockReset();
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  ui.confirm.mockResolvedValue(true);
});

afterEach(() => {
  task?.cancel();
  resetMockBackend();
  vi.clearAllMocks();
});

function backend(capabilities: Record<string, unknown> = { remoteMachines: 1 }) {
  const mock = installMockBackend();
  mock.onRequest('client.hello', () => ({ server: { capabilities } }));
  mock.onRequest('remoteMachines.list', () => ({ machines: [MACHINE, { id: 'broken' }] }));
  mock.onRequest('executor.list', () => ({
    backends: [
      {
        credentialId: 'cred-9',
        backendId: 'head-9',
        backendName: 'Laptop',
        createdAt: '2026-10-30T00:00:00Z',
        connected: true,
        runningAgents: 1,
      },
    ],
  }));
  mock.onRequest('executor.revoke', () => ({ ok: true }));
  return mock;
}

describe('remote machines saga — refresh', () => {
  it('loads machines, the local fingerprint and backends with access when supported', async () => {
    backend();
    invoke.mockResolvedValue('AA:BB');
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.supported).toBe(true));
    expect(Object.keys(store.state.remoteMachines.machines)).toEqual(['d-mac']);
    expect(store.state.remoteMachines.localFingerprint).toBe('AA:BB');
    expect(invoke).toHaveBeenCalledWith(CHANNELS.MACHINE_FINGERPRINT, 'local');
    expect(store.state.remoteMachines.executorBackends).toEqual([
      expect.objectContaining({ credentialId: 'cred-9', backendName: 'Laptop' }),
    ]);
  });

  it('ignores a non-string fingerprint from a bridge without the channel (web build)', async () => {
    backend();
    invoke.mockResolvedValue({ success: false, error: 'Browser mock: channel not implemented' });
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.supported).toBe(true));
    expect(store.state.remoteMachines.localFingerprint).toBeNull();
  });

  it('retries while the capability snapshot is not known yet (hello in flight)', async () => {
    const mock = backend();
    let calls = 0;
    mock.onRequest('client.hello', () =>
      ++calls < 3
        ? { server: { capabilities: null } }
        : { server: { capabilities: { remoteMachines: 1 } } },
    );
    invoke.mockResolvedValue(null);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      start();
      dispatch(remoteMachinesRefreshRequested());
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(store.state.remoteMachines.supported).toBe(true);
      });
      expect(calls).toBe(3);
      expect(Object.keys(store.state.remoteMachines.machines)).toEqual(['d-mac']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads again when the connection generation moves mid-refresh (first connect)', async () => {
    const mock = backend();
    let calls = 0;
    mock.onRequest('remoteMachines.list', () => {
      calls += 1;
      if (calls === 1) store.dispatch(connectionStatusChanged('connected'));
      return { machines: [MACHINE] };
    });
    invoke.mockResolvedValue(null);
    store.dispatch(connectionStatusChanged('connecting'));
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.executorBackends).not.toBeNull());
    expect(calls).toBe(2);
    expect(store.state.remoteMachines.supported).toBe(true);
    expect(Object.keys(store.state.remoteMachines.machines)).toEqual(['d-mac']);
  });

  it('stays hidden when the backend does not advertise remoteMachines', async () => {
    const mock = backend({});
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.executorBackends).not.toBeNull());
    expect(store.state.remoteMachines.supported).toBe(false);
    expect(store.state.remoteMachines.machines).toEqual({});
    expect(mock.requests.map((r) => r.method)).not.toContain('remoteMachines.list');
  });

  it('resets on backend switch', async () => {
    backend();
    invoke.mockResolvedValue(null);
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.supported).toBe(true));
    resetMockBackend();
    backend({});
    dispatch(backendReconnected());
    expect(store.state.remoteMachines.machines).toEqual({});
    await vi.waitFor(() => expect(store.state.remoteMachines.executorBackends).not.toBeNull());
    expect(store.state.remoteMachines.supported).toBe(false);
  });
});

describe('remote machines saga — expose', () => {
  it('warns first, relays through main and records the saved machine', async () => {
    backend();
    invoke.mockResolvedValue({ success: true, machine: MACHINE });
    start();
    dispatch(remoteMachineExposeRequested('mac'));
    await vi.waitFor(() => expect(store.state.remoteMachines.machines['d-mac']).toBeDefined());
    expect(ui.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('user account') }),
    );
    expect(invoke).toHaveBeenCalledWith(CHANNELS.EXPOSE, { machineConnectionId: 'mac' });
    await settle();
    expect(ui.success).toHaveBeenCalled();
  });

  it('turns an unrecognized bridge reply into a generic failure', async () => {
    invoke.mockResolvedValueOnce({
      success: false,
      error: 'Browser mock: channel not implemented',
    });
    start();
    dispatch(remoteMachineExposeRequested('mac'));
    await vi.waitFor(() =>
      expect(store.state.remoteMachines.failures.mac).toMatchObject({
        success: false,
        code: 'failed',
        message: 'Browser mock: channel not implemented',
      }),
    );
  });

  it('does nothing when the warning is declined', async () => {
    ui.confirm.mockResolvedValue(false);
    start();
    dispatch(remoteMachineExposeRequested('mac'));
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('records the failure for the row and retries with the chosen listener without re-warning', async () => {
    invoke.mockResolvedValueOnce({ success: false, code: 'listener-off' });
    start();
    dispatch(remoteMachineExposeRequested('local'));
    await vi.waitFor(() =>
      expect(store.state.remoteMachines.failures.local).toEqual({
        success: false,
        code: 'listener-off',
      }),
    );
    invoke.mockResolvedValueOnce({ success: true, machine: MACHINE });
    ui.confirm.mockClear();
    dispatch(remoteMachineExposeRequested('local', 'tailcat'));
    await vi.waitFor(() => expect(store.state.remoteMachines.failures.local).toBeUndefined());
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.EXPOSE, {
      machineConnectionId: 'local',
      enableListener: 'tailcat',
    });
  });

  it('turns a bridge error into a generic failure', async () => {
    invoke.mockRejectedValue(new Error('bridge down'));
    start();
    dispatch(remoteMachineExposeRequested('mac'));
    await vi.waitFor(() =>
      expect(store.state.remoteMachines.failures.mac).toMatchObject({
        code: 'failed',
        message: 'bridge down',
      }),
    );
  });
});

describe('remote machines saga — un-expose and revoke', () => {
  async function loaded() {
    backend();
    invoke.mockResolvedValueOnce(null);
    start();
    dispatch(remoteMachinesRefreshRequested());
    await vi.waitFor(() => expect(store.state.remoteMachines.executorBackends).not.toBeNull());
    expect(store.state.remoteMachines.machines['d-mac']).toBeDefined();
  }

  it('removes the machine and warns when the credential could not be revoked', async () => {
    await loaded();
    invoke.mockResolvedValueOnce({ success: true, revoked: false });
    dispatch(remoteMachineUnexposeRequested('d-mac', 'mac'));
    await vi.waitFor(() => expect(store.state.remoteMachines.machines['d-mac']).toBeUndefined());
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.UNEXPOSE, {
      machineId: 'd-mac',
      machineConnectionId: 'mac',
    });
    expect(ui.warning).toHaveBeenCalled();
  });

  it('keeps the machine and records machine-in-use; stop-agents skips the confirm', async () => {
    await loaded();
    invoke.mockResolvedValueOnce({ success: false, code: 'machine-in-use', runningAgents: 2 });
    dispatch(remoteMachineUnexposeRequested('d-mac', null));
    await vi.waitFor(() =>
      expect(store.state.remoteMachines.failures['d-mac']).toMatchObject({ runningAgents: 2 }),
    );
    expect(store.state.remoteMachines.machines['d-mac']).toBeDefined();
    ui.confirm.mockClear();
    invoke.mockResolvedValueOnce({ success: true, revoked: true });
    dispatch(remoteMachineUnexposeRequested('d-mac', null, true));
    await vi.waitFor(() => expect(store.state.remoteMachines.machines['d-mac']).toBeUndefined());
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith(CHANNELS.UNEXPOSE, {
      machineId: 'd-mac',
      stopAgents: true,
    });
  });

  it('keeps the machine when stops go unconfirmed; retrying stops again without a confirm', async () => {
    await loaded();
    invoke.mockResolvedValueOnce({
      success: false,
      code: 'machine-unreachable',
      attempts: [],
      unconfirmedStops: ['agent-1', 'agent-2'],
    });
    dispatch(remoteMachineUnexposeRequested('d-mac', 'mac', true));
    await vi.waitFor(() =>
      expect(store.state.remoteMachines.failures['d-mac']).toMatchObject({
        code: 'machine-unreachable',
        unconfirmedStops: ['agent-1', 'agent-2'],
      }),
    );
    expect(store.state.remoteMachines.machines['d-mac']).toBeDefined();
    expect(ui.success).not.toHaveBeenCalled();
    expect(ui.warning).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ success: true, revoked: true });
    dispatch(remoteMachineUnexposeRequested('d-mac', 'mac', true));
    await vi.waitFor(() => expect(store.state.remoteMachines.machines['d-mac']).toBeUndefined());
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(store.state.remoteMachines.failures['d-mac']).toBeUndefined();
  });

  it('revokes a backend from this machine after confirmation', async () => {
    await loaded();
    dispatch(executorRevokeRequested('cred-9'));
    await vi.waitFor(() => expect(store.state.remoteMachines.executorBackends).toEqual([]));
    expect(ui.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ destructive: true }));
  });
});
