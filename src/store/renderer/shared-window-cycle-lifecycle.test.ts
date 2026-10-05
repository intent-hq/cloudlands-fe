import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { sharedWindowCycleSaga } from '$store/renderer/slices/hardware-console/sagas/shared-window-cycle-saga';
import { hardwareConsoleReducer } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { withHostPrincipal } from '../../test/fixtures/principal-state';
import { HardwareConsoleManager } from '$features/hardware-console/device/device-manager';
import { createWebHidPlatform } from '$features/hardware-console/device/platform';
import {
  FakeHidDevice,
  FakeWebHidApi,
  flushMicrotasks,
} from '$features/hardware-console/device/__tests__/fake-hid';

const ref = vi.hoisted(() => ({ manager: null as unknown }));
vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ref.manager,
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ cycled: true, windowCount: 3 }),
}));
let task: Task;
let manager: HardwareConsoleManager;
let hid: FakeWebHidApi;
let device: FakeHidDevice;
let state: ReturnType<typeof withHostPrincipal>;
const subscribers = new Set<() => void>();
const ownerCallbacks = new Map<string, (...args: unknown[]) => void>();
let listenerId = 0;
function notify() {
  for (const callback of [...subscribers]) callback();
}
function boot() {
  state = withHostPrincipal(
    {
      connections: { windowBackendId: 'shared-host' },
      hardwareConsole: { ...hardwareConsoleReducer.initialState },
    },
    'guest',
  );
  task = runSaga(
    {
      channel: stdChannel(),
      getState: () => state,
      dispatch: () => {},
      context: {
        reduxStore: {
          getState: () => state,
          subscribe: (fn: () => void) => {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
          },
        },
      },
    },
    sharedWindowCycleSaga,
  );
}
beforeEach(() => {
  subscribers.clear();
  ownerCallbacks.clear();
  hid = new FakeWebHidApi();
  device = new FakeHidDevice(0x303a, 0x8360);
  hid.devices = [device];
  manager = new HardwareConsoleManager(createWebHidPlatform(hid));
  ref.manager = manager;
  vi.mocked(localStorage.getItem).mockReturnValue(
    JSON.stringify({
      enabled: true,
      keysByModel: { 'creator-micro-2': [], 'codex-micro': ['ACT07'] },
    }),
  );
  vi.stubGlobal('electronAPI', {
    invoke: async () => ({ isOwner: true }),
    on: (_channel: string, fn: (...args: unknown[]) => void) => {
      const id = String(++listenerId);
      ownerCallbacks.set(id, fn);
      return id;
    },
    offById: (_channel: string, id: string) => ownerCallbacks.delete(id),
  });
});
afterEach(async () => {
  device.close = async () => {
    device.opened = false;
  };
  task?.cancel();
  await task?.toPromise();
  await manager.stop();
  vi.unstubAllGlobals();
});
it('cancelling a shared lifetime during getDevices cannot open later', async () => {
  let release!: (devices: FakeHidDevice[]) => void;
  const entered = vi.fn();
  hid.getDevices = () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  boot();
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  task.cancel();
  release([device]);
  await flushMicrotasks(30);
  expect(device.opened).toBe(false);
  expect(manager.client).toBeNull();
  expect(ownerCallbacks.size).toBe(0);
});
it('a re-admitted shared lifetime stays connected after the previous asynchronous close settles', async () => {
  boot();
  await vi.waitFor(() => expect(manager.status).toBe('connected'));
  let releaseClose!: () => void;
  const closeEntered = vi.fn();
  device.close = () => {
    closeEntered();
    return new Promise((resolve) => {
      releaseClose = () => {
        device.opened = false;
        resolve();
      };
    });
  };
  const admitted = state;
  state = { ...state, principal: { ...state.principal, status: 'loading' } };
  notify();
  await vi.waitFor(() => expect(closeEntered).toHaveBeenCalledOnce());
  expect(manager.client).toBeNull();
  state = admitted;
  notify();
  await flushMicrotasks(30);
  releaseClose();
  await flushMicrotasks(30);

  expect(device.opened).toBe(true);
  expect(manager.status).toBe('connected');
  expect(ownerCallbacks.size).toBe(1);
  device.emitRpc({ m: 'v.oai.hid', p: { k: 'ACT07', act: 1 } });
  expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.WINDOW.CYCLE_FOCUS);
});
