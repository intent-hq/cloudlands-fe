import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn().mockResolvedValue([]),
  manager: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    status: 'disconnected' as string,
    client: null as unknown,
  },
  installKeySwitch: vi.fn(),
  installEncoder: vi.fn(),
  installLed: vi.fn(),
  installClear: vi.fn(),
  installToasts: vi.fn(),
  ledUpdate: vi.fn(),
  ledAttach: vi.fn(),
  ledDetach: vi.fn(),
  disposers: Array.from({ length: 5 }, () => vi.fn()),
  /** Preload bridge handed to the owner-status wiring; null = bridge-less. */
  ownerBridge: { current: null as unknown },
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
    attach = mocks.ledAttach;
    detach = mocks.ledDetach;
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
vi.mock('$features/hardware-console/console-owner-status', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$features/hardware-console/console-owner-status')>();
  return { ...actual, getConsoleOwnerBridge: () => mocks.ownerBridge.current };
});

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

function makeFakeOwnerBridge(initialIsOwner: boolean) {
  const listeners = new Map<string, (payload: unknown) => void>();
  let nextId = 0;
  return {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'hardware-console:get-owner-status') return { isOwner: initialIsOwner };
      throw new Error(`unexpected invoke: ${channel}`);
    }),
    on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
      const id = `listener-${++nextId}`;
      listeners.set(id, handler);
      return id;
    }),
    offById: vi.fn((_channel: string, id: string) => {
      listeners.delete(id);
    }),
    pushOwnerChanged(isOwner: boolean) {
      for (const handler of listeners.values()) handler({ isOwner });
    },
    listenerCount: () => listeners.size,
  };
}

describe('hardwareConsoleDeviceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ownerBridge.current = null;
    mocks.manager.status = 'disconnected';
    mocks.manager.client = null;
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
    expect(mocks.installLed.mock.calls[0][1]).toEqual({
      engine: expect.any(Object),
      isOwner: expect.any(Function),
    });
    expect(mocks.ledUpdate).toHaveBeenCalled();
    expect(mocks.installClear).toHaveBeenCalledWith(mocks.manager, {
      disposeLedWiring: mocks.disposers[2],
    });
    expect(mocks.installToasts).toHaveBeenCalledWith(mocks.manager, {
      isOwner: expect.any(Function),
    });
    expect(getSubscriberCount()).toBe(2);

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

  it('keeps the default owner=true when no preload bridge exists (web build)', async () => {
    const { task, getState } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    expect(getState().hardwareConsole.isConsoleOwner).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('flips to non-owner before the initial owner query resolves (startup race, #1928)', async () => {
    const bridge = makeFakeOwnerBridge(true);
    let resolveQuery!: (value: { isOwner: boolean }) => void;
    bridge.invoke.mockImplementation(
      () =>
        new Promise<{ isOwner: boolean }>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    mocks.ownerBridge.current = bridge;
    const { task, getState } = createHarness();

    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(1));
    expect(getState().hardwareConsole.isConsoleOwner).toBe(false);
    // Boot is held at the hydration barrier: no handlers, no manager start.
    expect(mocks.installToasts).not.toHaveBeenCalled();
    expect(mocks.manager.start).not.toHaveBeenCalled();

    resolveQuery({ isOwner: true });
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));

    task.cancel();
    await task.toPromise();
  });

  it('applies an owner-changed push that lands while the initial query is pending', async () => {
    const bridge = makeFakeOwnerBridge(true);
    let resolveQuery!: (value: { isOwner: boolean }) => void;
    bridge.invoke.mockImplementation(
      () =>
        new Promise<{ isOwner: boolean }>((resolve) => {
          resolveQuery = resolve;
        }),
    );
    mocks.ownerBridge.current = bridge;
    const { task, getState } = createHarness();

    // Push arrives mid-query: ownership moved away after main computed the
    // (stale) query response. The buffered push must win over the result.
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(1));
    bridge.pushOwnerChanged(false);
    resolveQuery({ isOwner: true });

    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));

    task.cancel();
    await task.toPromise();
  });

  it('hydrates owner status from the invoke channel and applies owner-changed pushes', async () => {
    const bridge = makeFakeOwnerBridge(false);
    mocks.ownerBridge.current = bridge;
    const { task, getState } = createHarness();

    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));
    expect(bridge.invoke).toHaveBeenCalledWith('hardware-console:get-owner-status');
    expect(bridge.on).toHaveBeenCalledWith('hardware-console:owner-changed', expect.any(Function));

    bridge.pushOwnerChanged(true);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    bridge.pushOwnerChanged(false);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));

    task.cancel();
    await task.toPromise();
    expect(bridge.listenerCount()).toBe(0);
  });

  it('does not attach or detach the engine on the initial owner emission', async () => {
    const { task } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    expect(mocks.ledAttach).not.toHaveBeenCalled();
    expect(mocks.ledDetach).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('detaches the engine on ownership loss and re-attaches (snapshot replay) on gain', async () => {
    const bridge = makeFakeOwnerBridge(true);
    mocks.ownerBridge.current = bridge;
    const fakeClient = { call: vi.fn() };
    mocks.manager.status = 'connected';
    mocks.manager.client = fakeClient;
    const { task, getState } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));
    // Settle the startup pessimistic-flip → hydration churn before asserting.
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    mocks.ledAttach.mockClear();
    mocks.ledDetach.mockClear();

    bridge.pushOwnerChanged(false);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));
    expect(mocks.ledDetach).toHaveBeenCalledTimes(1);
    expect(mocks.ledAttach).not.toHaveBeenCalled();

    bridge.pushOwnerChanged(true);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    expect(mocks.ledAttach).toHaveBeenCalledTimes(1);
    expect(mocks.ledAttach).toHaveBeenCalledWith(fakeClient);

    task.cancel();
    await task.toPromise();
  });

  it('skips the re-attach on ownership gain while no device is connected', async () => {
    const bridge = makeFakeOwnerBridge(true);
    mocks.ownerBridge.current = bridge;
    const { task, getState } = createHarness();
    await vi.waitFor(() => expect(mocks.manager.start).toHaveBeenCalledTimes(1));

    bridge.pushOwnerChanged(false);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));
    bridge.pushOwnerChanged(true);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    expect(mocks.ledAttach).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });

  it('keeps the isOwner gate handed to LED wiring and toasts in sync with ownership', async () => {
    const bridge = makeFakeOwnerBridge(true);
    mocks.ownerBridge.current = bridge;
    const { task, getState } = createHarness();
    await vi.waitFor(() => expect(mocks.installToasts).toHaveBeenCalledTimes(1));

    const ledGate = (mocks.installLed.mock.calls[0][1] as { isOwner: () => boolean }).isOwner;
    const toastGate = (mocks.installToasts.mock.calls[0][1] as { isOwner: () => boolean }).isOwner;
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(true));
    expect(ledGate()).toBe(true);
    expect(toastGate()).toBe(true);

    bridge.pushOwnerChanged(false);
    await vi.waitFor(() => expect(getState().hardwareConsole.isConsoleOwner).toBe(false));
    expect(ledGate()).toBe(false);
    expect(toastGate()).toBe(false);

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
