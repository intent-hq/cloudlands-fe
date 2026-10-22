import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { withHostPrincipal } from '../../test/fixtures/principal-state';
import { hostOwnerServicesSaga } from './slices/principal/sagas/host-owner-services-saga';
import { hardwareConsoleReducer } from './slices/hardware-console/hardware-console-slice';
import { appClient } from '$lib/client';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { HardwareConsoleStatus } from '$features/hardware-console/device/device-manager';

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ cycled: true, windowCount: 3 }),
}));
const device = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => device.current,
}));
const effects = vi.hoisted(() => ({ started: [] as string[], cancelled: [] as string[] }));
vi.mock('./slices/host-requirements/sagas/host-requirements-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    hostRequirementsSaga: function* () {
      effects.started.push('requirements');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('requirements');
      }
    },
  };
});
vi.mock('./slices/hardware-console/sagas/hardware-console-device-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    hardwareConsoleDeviceSaga: function* () {
      effects.started.push('hardware');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('hardware');
      }
    },
  };
});
vi.mock('./slices/hardware-console/sagas/encoder-preference-saga', () => ({
  encoderPreferenceSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/action-key-saga', () => ({
  actionKeySaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/key-pin-persistence-saga', () => ({
  keyPinPersistenceSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/prompt-picker-saga', () => ({
  promptPickerSaga: function* () {},
}));
vi.mock('./slices/hardware-console/sagas/voice-transcription-saga', () => ({
  voiceTranscriptionSaga: function* () {},
}));
vi.mock('./slices/voice-settings/sagas/voice-settings-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    voiceSettingsSaga: function* () {
      effects.started.push('voice');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('voice');
      }
    },
  };
});
vi.mock('./slices/user-preferences/sagas/notification-settings-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    notificationSettingsSaga: function* () {
      effects.started.push('notifications');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('notifications');
      }
    },
  };
});
vi.mock('./slices/github-auth/sagas/github-auth-saga', async () => {
  const { take } = await import('typed-redux-saga');
  return {
    githubAuthSaga: function* () {
      effects.started.push('account');
      try {
        yield* take('never');
      } finally {
        effects.cancelled.push('account');
      }
    },
  };
});

vi.mock('./slices/gitlab-auth/sagas/gitlab-auth-saga', () => ({ gitlabAuthSaga: function* () {} }));

const storageKey = 'intent.hardwareConsole.windowCycle';
let stored: string | null;
let owner = true;
let ownerPush: ((payload: unknown) => void) | undefined;
let task: Task;
let state: ReturnType<typeof withHostPrincipal>;
const listeners = new Set<() => void>();
const rawListeners = new Set<(message: unknown) => void>();
const statusListeners = new Set<(status: HardwareConsoleStatus) => void>();
const manager = {
  status: 'disconnected' as HardwareConsoleStatus,
  connectedDevice: { model: 'codex-micro' },
  start: vi.fn(async () => {
    manager.status = 'connected';
    for (const listener of statusListeners) listener('connected');
  }),
  stop: vi.fn(async () => {
    manager.status = 'disconnected';
    for (const listener of statusListeners) listener('disconnected');
  }),
  onRawMessage: (fn: (message: unknown) => void) => {
    rawListeners.add(fn);
    return () => rawListeners.delete(fn);
  },
  onStatusChange: (fn: (status: HardwareConsoleStatus) => void) => {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
};
const ipc = {
  invoke: vi.fn(async () => ({ isOwner: owner })),
  on: vi.fn((_channel: string, fn: (payload: unknown) => void) => {
    ownerPush = fn;
    return 'owner-listener';
  }),
  offById: vi.fn(() => {
    ownerPush = undefined;
  }),
};
function admit(role: 'owner' | 'member' | 'guest') {
  state = withHostPrincipal(
    {
      connections: { windowBackendId: 'remote-owned-or-shared-host' },
      hardwareConsole: { ...hardwareConsoleReducer.initialState },
    },
    role,
  );
  for (const listener of listeners) listener();
}
function boot(role: 'owner' | 'member' | 'guest') {
  admit(role);
  const channel = stdChannel();
  const reduxStore = {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  task = runSaga(
    {
      channel,
      getState: reduxStore.getState,
      dispatch: (action) => {
        state = {
          ...state,
          hardwareConsole: hardwareConsoleReducer(state.hardwareConsole, action),
        };
        for (const listener of listeners) listener();
        channel.put(action);
      },
      context: { reduxStore },
    },
    hostOwnerServicesSaga,
  );
}
function press(key = 'ACT07', act = 1) {
  for (const listener of rawListeners) listener({ m: 'v.oai.hid', p: { k: key, act } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(appClient.settings, 'get').mockResolvedValue(null);
  vi.spyOn(appClient.settings, 'update').mockResolvedValue([]);
  effects.started.length = 0;
  effects.cancelled.length = 0;
  listeners.clear();
  rawListeners.clear();
  statusListeners.clear();
  owner = true;
  ownerPush = undefined;
  manager.status = 'disconnected';
  device.current = manager;
  stored = JSON.stringify({
    enabled: true,
    keysByModel: { 'creator-micro-2': ['ACT11'], 'codex-micro': ['ACT07'] },
  });
  vi.mocked(localStorage.getItem).mockImplementation((key) => (key === storageKey ? stored : null));
  vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
    if (key === storageKey) stored = value;
  });
  vi.stubGlobal('electronAPI', ipc);
});
afterEach(async () => {
  task?.cancel();
  await task?.toPromise();
  vi.unstubAllGlobals();
});

describe('shared-window hardware cycling through host service admission', () => {
  it.each(['guest', 'member'] as const)(
    'keeps the configured cycle key working in an admitted %s window',
    async (role) => {
      boot(role);
      await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
      press();
      expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.WINDOW.CYCLE_FOCUS);
      press('ACT07', 0);
      press('ACT08');
      expect(invoke).toHaveBeenCalledTimes(1);
      press();
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(effects.started).toEqual([]);
      expect(appClient.settings.get).not.toHaveBeenCalled();
      expect(appClient.settings.update).not.toHaveBeenCalled();
      expect(localStorage.setItem).not.toHaveBeenCalled();
    },
  );
  it('gates input on live console ownership and removes listeners on owner admission', async () => {
    owner = false;
    boot('guest');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    press();
    expect(invoke).not.toHaveBeenCalled();
    ownerPush?.({ isOwner: true });
    press();
    expect(invoke).toHaveBeenCalledTimes(1);
    ownerPush?.({ isOwner: false });
    press();
    expect(invoke).toHaveBeenCalledTimes(1);
    admit('owner');
    await vi.waitFor(() => expect(manager.stop).toHaveBeenCalledTimes(1));
    expect(rawListeners.size).toBe(0);
    expect(ipc.offById).toHaveBeenCalledWith(
      IPC_CHANNELS.HARDWARE_CONSOLE.OWNER_CHANGED,
      'owner-listener',
    );
    expect(effects.started).toContain('hardware');
    admit('member');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(2));
    expect(rawListeners.size).toBe(1);
  });

  it.each([
    null,
    '{broken',
    JSON.stringify({
      enabled: false,
      keysByModel: { 'creator-micro-2': ['ACT11'], 'codex-micro': ['ACT07'] },
    }),
  ])(
    'does not open the device with missing, corrupt, or disabled local preferences: %s',
    async (preference) => {
      stored = preference;
      boot('member');
      await Promise.resolve();
      await Promise.resolve();
      press();
      expect(manager.start).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(effects.started).toEqual([]);
      expect(appClient.settings.get).not.toHaveBeenCalled();
      expect(appClient.settings.update).not.toHaveBeenCalled();
    },
  );

  it('carries the active remote owner mapping into a shared window without writing its host settings', async () => {
    stored = null;
    boot('owner');
    state = {
      ...state,
      hardwareConsole: {
        ...state.hardwareConsole,
        enabled: true,
        enabledHydrated: true,
        enabledHydrationSucceeded: true,
        actionMappingHydrated: true,
        actionMappingHydrationSucceeded: true,
        isConsoleOwner: true,
        actionMappingByModel: {
          'creator-micro-2': ['none', 'none', 'none', 'none', 'none', 'cycle-open-windows', 'none'],
          'codex-micro': ['none', 'cycle-open-windows', 'none', 'none', 'none', 'none', 'none'],
        },
      },
    };
    for (const listener of listeners) listener();
    await vi.waitFor(() => expect(stored).not.toBeNull());
    expect(JSON.parse(stored!)).toEqual({
      enabled: true,
      keysByModel: { 'creator-micro-2': ['ACT11'], 'codex-micro': ['ACT07'] },
    });
    vi.mocked(localStorage.setItem).mockClear();
    admit('guest');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    press();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.WINDOW.CYCLE_FOCUS);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('accepts live preference changes and stops cycling when the integration is disabled', async () => {
    boot('guest');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    stored = JSON.stringify({
      enabled: true,
      keysByModel: { 'creator-micro-2': ['ACT11'], 'codex-micro': ['ACT09'] },
    });
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    press();
    expect(invoke).not.toHaveBeenCalled();
    press('ACT09');
    expect(invoke).toHaveBeenCalledTimes(1);
    stored = JSON.stringify({
      enabled: false,
      keysByModel: { 'creator-micro-2': ['ACT11'], 'codex-micro': ['ACT09'] },
    });
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    await vi.waitFor(() => expect(manager.stop).toHaveBeenCalledTimes(1));
    press('ACT09');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps only one shared window handling a press as console ownership transfers', async () => {
    boot('guest');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    const firstTask = task;
    const firstPush = ownerPush;
    owner = false;
    boot('member');
    try {
      await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(2));
      expect(rawListeners.size).toBe(2);
      press();
      expect(invoke).toHaveBeenCalledTimes(1);
      firstPush?.({ isOwner: false });
      ownerPush?.({ isOwner: true });
      press();
      expect(invoke).toHaveBeenCalledTimes(2);
      ownerPush?.({ isOwner: false });
      firstPush?.({ isOwner: true });
      press();
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      firstTask.cancel();
      await firstTask.toPromise();
    }
  });

  it('does not let a stale initial query replace a newer ownership push', async () => {
    let resolveOwner!: (value: { isOwner: boolean }) => void;
    ipc.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOwner = resolve;
        }),
    );
    boot('guest');
    ownerPush?.({ isOwner: false });
    resolveOwner({ isOwner: true });
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    press();
    expect(invoke).not.toHaveBeenCalled();
    ownerPush?.({ isOwner: true });
    press();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not publish unhydrated or background owner defaults over the configured key', async () => {
    const original = stored;
    boot('owner');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    state = {
      ...state,
      hardwareConsole: {
        ...state.hardwareConsole,
        enabledHydrated: true,
        enabledHydrationSucceeded: true,
        actionMappingHydrated: true,
        actionMappingHydrationSucceeded: true,
        isConsoleOwner: false,
      },
    };
    for (const listener of listeners) listener();
    expect(stored).toBe(original);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    state = {
      ...state,
      hardwareConsole: { ...state.hardwareConsole, isConsoleOwner: true, enabled: false },
    };
    for (const listener of listeners) listener();
    await vi.waitFor(() => expect(JSON.parse(stored!).enabled).toBe(false));
  });
  it('refreshes an already open shared window when it gains console ownership', async () => {
    owner = false;
    boot('guest');
    await vi.waitFor(() => expect(manager.start).toHaveBeenCalledTimes(1));
    stored = JSON.stringify({
      enabled: true,
      keysByModel: { 'creator-micro-2': [], 'codex-micro': ['ACT09'] },
    });
    ownerPush?.({ isOwner: true });
    press();
    expect(invoke).not.toHaveBeenCalled();
    press('ACT09');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('fails closed when local storage is unavailable', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    boot('guest');
    await vi.waitFor(() => expect(manager.stop).toHaveBeenCalledTimes(1));
    expect(manager.start).not.toHaveBeenCalled();
    press();
    expect(invoke).not.toHaveBeenCalled();
    expect(task.isRunning()).toBe(true);
  });

  it.each(['enabled', 'mapping'] as const)(
    'never publishes defaults after a failed %s hydration',
    async (failed) => {
      const original = stored;
      boot('owner');
      state = {
        ...state,
        hardwareConsole: {
          ...state.hardwareConsole,
          enabledHydrated: true,
          actionMappingHydrated: true,
          enabledHydrationSucceeded: failed !== 'enabled',
          actionMappingHydrationSucceeded: failed !== 'mapping',
          isConsoleOwner: true,
        },
      };
      for (const listener of listeners) listener();
      expect(stored).toBe(original);
      expect(localStorage.setItem).not.toHaveBeenCalled();
    },
  );
});
