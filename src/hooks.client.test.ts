import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  expectsElectronPreloadBridge: vi.fn(() => false),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { warning: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/utils/platform-capabilities', () => ({
  expectsElectronPreloadBridge: mocks.expectsElectronPreloadBridge,
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  daemonHealthReducer,
  initialState,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { DaemonHealthState } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { daemonHealthSaga } from '$store/renderer/slices/daemon-health/sagas/daemon-health-saga';

const statusPayload = {
  running: true,
  listenMode: 'uds',
  transports: ['uds'],
  port: null,
  clients: 1,
  agents: 1,
  protocolVersion: '2.6',
  host: { os: 'linux', arch: 'x64', hasDisplay: false, locality: 'local' },
};

function installConnectedBridge(): void {
  (window as any).electronAPI = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.BACKEND.GET_STATUS) {
        return {
          status: 'connected',
          transport: { mode: 'external-ws', target: 'ws://127.0.0.1:5181/rpc' },
        };
      }
      return undefined;
    }),
    on: vi.fn(() => 'daemon-status-listener'),
    offById: vi.fn(),
  };
}

function startDaemonHealthWithReducer() {
  const input = stdChannel();
  let state = { daemonHealth: initialState };
  const dispatch = (action: unknown) => {
    state = { daemonHealth: daemonHealthReducer(state.daemonHealth, action as never) };
    input.put(action as never);
    return action;
  };
  const task = runSaga({ channel: input, dispatch, getState: () => state }, daemonHealthSaga);
  return { task, getState: (): DaemonHealthState => state.daemonHealth };
}

describe('client startup', () => {
  const originalElectronAPI = (window as any).electronAPI;
  let releaseBrowserMock: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', '');
    mocks.expectsElectronPreloadBridge.mockReturnValue(false);
    mocks.backendRequest.mockResolvedValue(statusPayload);
    window.history.replaceState({}, '', '/');
    delete (window as any).electronAPI;
  });

  afterEach(() => {
    releaseBrowserMock?.();
    releaseBrowserMock = undefined;
    vi.unstubAllEnvs();
    vi.doUnmock('$lib/browser-mock');
    (window as any).electronAPI = originalElectronAPI;
  });

  it('awaits the browser bridge before app sagas can observe startup', async () => {
    const browserMockReady = new Promise<void>((resolve) => {
      releaseBrowserMock = resolve;
    });
    vi.doMock('$lib/browser-mock', async () => {
      await browserMockReady;
      installConnectedBridge();
      return {};
    });

    const clientHooks = await import('./hooks.client');
    expect(clientHooks.init).toBeTypeOf('function');

    let initialized = false;
    const initPromise = clientHooks.init().then(() => {
      initialized = true;
    });
    await Promise.resolve();

    expect(initialized).toBe(false);
    expect((window as any).electronAPI).toBeUndefined();

    releaseBrowserMock();
    await initPromise;

    const { task, getState } = startDaemonHealthWithReducer();
    await vi.waitFor(() => expect(getState().health).toBe('healthy'));
    expect(getState().transport).toEqual({
      mode: 'external-ws',
      target: 'ws://127.0.0.1:5181/rpc',
    });

    task.cancel();
    await task.toPromise();
  });
});
