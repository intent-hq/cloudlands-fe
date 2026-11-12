/**
 * The ordered machine list on the wire (PROTOCOL `methods/nodes.md` →
 * "Ordered machine list"): `remoteMachines.order` is read only with exact
 * `machineOrder: 1`, and a reorder sends the whole list to
 * `remoteMachines.setOrder`, keeping the backend's answer, the current list
 * from an `order-stale` error, or the previous order after any other failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const ui = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: vi.fn(async () => true) }));
import {
  BackendError,
  installMockBackend,
  resetMockBackend,
} from '../../test/mocks/backend-transport.mock';
import type { MachineOrderRow } from '$shared/types/remote-machines';
import { store } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { remoteMachinesSaga } from './remote-machines-saga';
import { machineOrderSetRequested, remoteMachinesRefreshRequested } from './remote-machines-slice';

const ORDER: MachineOrderRow[] = [
  { kind: 'local', name: 'build-host' },
  { kind: 'machine', nodeId: 'd-mac', name: 'Studio Mac' },
  { kind: 'cloud', cloudMachineId: 'e2b-1', name: 'Sandbox' },
];
const MOVED = [
  { kind: 'machine', nodeId: 'd-mac' },
  { kind: 'local' },
  { kind: 'cloud', cloudMachineId: 'e2b-1' },
] as const;

let task: Task;
let channel: ReturnType<typeof stdChannel>;

function start() {
  channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    remoteMachinesSaga,
  );
}

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

function backend(capabilities: Record<string, unknown>) {
  const mock = installMockBackend();
  mock.onRequest('client.hello', () => ({ server: { capabilities } }));
  mock.onRequest('remoteMachines.list', () => ({ machines: [] }));
  mock.onRequest('remoteMachines.order', () => ({ order: ORDER }));
  mock.onRequest('executor.list', () => ({ backends: [] }));
  return mock;
}

async function loaded(capabilities: Record<string, unknown>) {
  const mock = backend(capabilities);
  start();
  dispatch(remoteMachinesRefreshRequested());
  await vi.waitFor(() => expect(store.state.remoteMachines.supported).toBe(true));
  return mock;
}

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke: vi.fn() };
});

afterEach(() => {
  task?.cancel();
  resetMockBackend();
  vi.clearAllMocks();
});

describe('remoteMachines.order', () => {
  it('reads the order with exact machineOrder: 1', async () => {
    const mock = await loaded({ remoteMachines: 1, machineOrder: 1 });
    expect(mock.requests.find((r) => r.method === 'remoteMachines.order')?.params).toBeUndefined();
    expect(store.state.remoteMachines.machineOrder).toBe(true);
    expect(store.state.remoteMachines.order).toEqual(ORDER);
  });

  it.each([{ machineOrder: 2 }, { machineOrder: '1' }, { machineOrder: true }, {}])(
    'never reads it otherwise (%o)',
    async (flag) => {
      const mock = await loaded({ remoteMachines: 1, ...flag });
      expect(mock.requests.map((r) => r.method)).not.toContain('remoteMachines.order');
      expect(store.state.remoteMachines.machineOrder).toBe(false);
      expect(store.state.remoteMachines.order).toBeNull();
    },
  );
});

describe('remoteMachines.setOrder', () => {
  it('sends the whole list, shows it at once and keeps the reply', async () => {
    const mock = await loaded({ remoteMachines: 1, machineOrder: 1 });
    let resolve!: (value: unknown) => void;
    mock.onRequest('remoteMachines.setOrder', () => new Promise((done) => (resolve = done)));
    dispatch(machineOrderSetRequested([...MOVED]));

    await vi.waitFor(() => expect(store.state.remoteMachines.orderSaving).toBe(true));
    expect(store.state.remoteMachines.order?.map((row) => row.name)).toEqual([
      'Studio Mac',
      'build-host',
      'Sandbox',
    ]);
    expect(mock.requests.find((r) => r.method === 'remoteMachines.setOrder')?.params).toEqual({
      order: MOVED,
    });
    // The backend's answer wins, here with a renamed entry.
    const reply = [ORDER[1], ORDER[0], { ...ORDER[2], name: 'Renamed' }];
    resolve({ order: reply });
    await vi.waitFor(() => expect(store.state.remoteMachines.orderSaving).toBe(false));
    expect(store.state.remoteMachines.order).toEqual(reply);
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('reloads the list from an order-stale answer', async () => {
    const mock = await loaded({ remoteMachines: 1, machineOrder: 1 });
    const current: MachineOrderRow[] = [
      ...ORDER,
      { kind: 'machine', nodeId: 'd-new', name: 'New box' },
    ];
    mock.onRequest('remoteMachines.setOrder', () => {
      throw new BackendError({
        code: 'INVALID_PARAMS',
        message: 'order is stale',
        rpcCode: -32602,
        data: { code: 'order-stale', order: current },
      });
    });
    dispatch(machineOrderSetRequested([...MOVED]));

    await vi.waitFor(() => expect(store.state.remoteMachines.order).toEqual(current));
    expect(store.state.remoteMachines.orderSaving).toBe(false);
    expect(ui.error).not.toHaveBeenCalled();
  });

  it('puts the previous order back and says so after any other failure', async () => {
    const mock = await loaded({ remoteMachines: 1, machineOrder: 1 });
    mock.onRequest('remoteMachines.setOrder', () => {
      throw new BackendError({ code: 'FORBIDDEN', message: 'owner only', rpcCode: -32003 });
    });
    dispatch(machineOrderSetRequested([...MOVED]));

    await vi.waitFor(() => expect(ui.error).toHaveBeenCalledTimes(1));
    expect(store.state.remoteMachines.order).toEqual(ORDER);
    expect(store.state.remoteMachines.orderSaving).toBe(false);
  });

  it('sends nothing to a backend without machineOrder: 1', async () => {
    const mock = await loaded({ remoteMachines: 1 });
    dispatch(machineOrderSetRequested([...MOVED]));
    await Promise.resolve();
    expect(mock.requests.map((r) => r.method)).not.toContain('remoteMachines.setOrder');
  });
});
