import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn().mockResolvedValue([]),
  manager: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  },
  installKeySwitch: vi.fn(),
  installEncoder: vi.fn(),
  installLed: vi.fn(),
  installClear: vi.fn(),
  installToasts: vi.fn(),
  ledUpdate: vi.fn(),
  disposers: Array.from({ length: 5 }, () => vi.fn()),
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.settingsGet, update: mocks.settingsUpdate } },
}));
vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => mocks.manager,
}));
vi.mock('$features/hardware-console/assignment/key-switch-service', () => ({
  installHardwareConsoleKeySwitching: mocks.installKeySwitch,
}));
vi.mock('$features/hardware-console/encoder/encoder-service', () => ({
  ENCODER_HUD_HIDE_MS: 1200,
  installHardwareConsoleEncoder: mocks.installEncoder,
}));
vi.mock('$features/hardware-console/led/led-status-service', () => ({
  installHardwareConsoleLedStatus: mocks.installLed,
}));
vi.mock('$features/hardware-console/led/engine', () => ({
  HardwareLedEngine: class {
    update = mocks.ledUpdate;
  },
}));
vi.mock('$features/hardware-console/led/snapshot', () => ({
  buildHardwareLedSnapshot: () => ({ keys: [], ambient: { kind: 'dark' } }),
}));
vi.mock('$features/hardware-console/led/clear-lighting', () => ({
  installHardwareConsoleClearLightingListener: mocks.installClear,
}));
vi.mock('$features/hardware-console/connection-toast-service', () => ({
  installHardwareConsoleConnectionToasts: mocks.installToasts,
}));

import {
  encoderHudHidden,
  encoderHudShown,
  hardwareConsoleReducer,
  initialState,
  setHardwareConsoleEnabled,
} from '../hardware-console-slice';
import {
  hardwareConsoleDeviceSaga,
  watchHardwareConsoleEncoderHud,
} from './hardware-console-device-saga';

const enabledSetting = (enabled: boolean) => ({
  path: 'hardwareConsole.state',
  value: { keyPins: ['ws-1'], promptUsage: [], enabled },
});

function createHarness(saga = hardwareConsoleDeviceSaga) {
  let state = { hardwareConsole: initialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: ReturnType<typeof setHardwareConsoleEnabled>) => {
    state = { hardwareConsole: hardwareConsoleReducer(state.hardwareConsole, action) };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    saga,
  );
  return {
    dispatch,
    task,
    getState: () => state,
    getSubscriberCount: () => listeners.size,
  };
}

describe('hardwareConsoleDeviceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsGet.mockResolvedValue(enabledSetting(true));
    mocks.installKeySwitch.mockReturnValue(mocks.disposers[0]);
    mocks.installEncoder.mockReturnValue(mocks.disposers[1]);
    mocks.installLed.mockReturnValue(mocks.disposers[2]);
    mocks.installClear.mockReturnValue(mocks.disposers[3]);
    mocks.installToasts.mockReturnValue(mocks.disposers[4]);
  });

  afterEach(() => vi.useRealTimers());

  it('installs device wiring before one boot start and disposes everything on cancellation', async () => {
    const { task, getSubscriberCount } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));

    expect(mocks.installKeySwitch).toHaveBeenCalledOnce();
    expect(mocks.installEncoder).toHaveBeenCalledOnce();
    expect(mocks.installLed).toHaveBeenCalledOnce();
    expect(mocks.installLed.mock.calls[0][1]).toEqual({ engine: expect.any(Object) });
    expect(mocks.ledUpdate).toHaveBeenCalled();
    expect(mocks.installClear).toHaveBeenCalledWith(mocks.manager, {
      disposeLedWiring: mocks.disposers[2],
    });
    expect(mocks.installToasts).toHaveBeenCalledOnce();
    expect(getSubscriberCount()).toBe(1);

    task.cancel();
    await task.toPromise();
    for (const dispose of mocks.disposers) expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.manager.stop).toHaveBeenCalledOnce();
    expect(getSubscriberCount()).toBe(0);
  });

  it('keeps a persisted disabled integration stopped, then starts and persists on enable', async () => {
    mocks.settingsGet.mockResolvedValue(enabledSetting(false));
    const { dispatch, task } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.stop).toHaveBeenCalledTimes(1));
    expect(mocks.manager.start).not.toHaveBeenCalled();

    dispatch(setHardwareConsoleEnabled(true));
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: { keyPins: ['ws-1'], promptUsage: [], enabled: true },
        },
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('defaults to enabled when hydration fails', async () => {
    mocks.settingsGet.mockRejectedValue(new Error('daemon unavailable'));
    const { task, getState } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    expect(getState().hardwareConsole.enabled).toBe(true);
    expect(getState().hardwareConsole.enabledHydrated).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('applies toggles during hydration and flushes the queued write after success', async () => {
    let resolveHydration!: (value: ReturnType<typeof enabledSetting>) => void;
    mocks.settingsGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveHydration = resolve;
          }),
      )
      .mockResolvedValue(enabledSetting(true));
    const { dispatch, task } = createHarness();

    dispatch(setHardwareConsoleEnabled(false));
    await vi.waitFor(() => expect(mocks.manager.stop).toHaveBeenCalledTimes(1));
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();

    resolveHydration(enabledSetting(true));
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(mocks.settingsUpdate).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: { keyPins: ['ws-1'], promptUsage: [], enabled: true },
        },
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('resets and cancels the encoder HUD inactivity timer from actions', async () => {
    vi.useFakeTimers();
    const { dispatch, task } = createHarness(watchHardwareConsoleEncoderHud);
    dispatch(encoderHudShown('ws-1'));
    await vi.advanceTimersByTimeAsync(1199);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === encoderHudHidden.type),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === encoderHudHidden.type),
    ).toHaveLength(1);

    dispatch.mockClear();
    dispatch(encoderHudShown('ws-2'));
    await vi.advanceTimersByTimeAsync(600);
    dispatch(encoderHudHidden());
    await vi.advanceTimersByTimeAsync(1200);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === encoderHudHidden.type),
    ).toHaveLength(1);
    task.cancel();
    await task.toPromise();
  });
});
