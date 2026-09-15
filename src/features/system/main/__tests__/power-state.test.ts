import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => []),
  appOn: vi.fn(),
  ipcHandle: vi.fn(),
  isOnBatteryPower: vi.fn(() => false),
  powerOn: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  app: { on: electronMocks.appOn },
  ipcMain: { handle: electronMocks.ipcHandle },
  powerMonitor: { isOnBatteryPower: electronMocks.isOnBatteryPower, on: electronMocks.powerOn },
}));

import {
  BATTERY_CHANGED_CHANNEL,
  GET_BATTERY_STATE_CHANNEL,
  PowerStateBroadcaster,
  setupPowerStateIPC,
  type PowerMonitorLike,
  type PowerStateWindow,
} from '../power-state';

interface MockWindow extends PowerStateWindow {
  send: ReturnType<typeof vi.fn>;
  _destroy: () => void;
  _finishLoad: () => void;
}

function makeWindow(): MockWindow {
  let destroyed = false;
  const loadHandlers: Array<() => void> = [];
  const send = vi.fn();
  return {
    send,
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send,
      on: (_event, listener) => {
        loadHandlers.push(listener);
      },
    },
    _destroy: () => {
      destroyed = true;
    },
    _finishLoad: () => loadHandlers.forEach((cb) => cb()),
  };
}

function makeMonitor(onBattery: boolean) {
  const handlers = new Map<string, () => void>();
  const monitor: PowerMonitorLike = {
    isOnBatteryPower: () => onBattery,
    on: (event, listener) => {
      handlers.set(event, listener);
    },
  };
  return {
    monitor,
    goBattery: () => handlers.get('on-battery')!(),
    goAc: () => handlers.get('on-ac')!(),
  };
}

function batteryPayloads(win: MockWindow) {
  return win.send.mock.calls
    .filter(([channel]) => channel === BATTERY_CHANGED_CHANNEL)
    .map(([, payload]) => payload);
}

describe('PowerStateBroadcaster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the initial battery state from the power monitor', () => {
    const { monitor } = makeMonitor(true);
    expect(new PowerStateBroadcaster(monitor, () => []).getState()).toEqual({ onBattery: true });
    expect(new PowerStateBroadcaster(makeMonitor(false).monitor, () => []).getState()).toEqual({
      onBattery: false,
    });
  });

  it('broadcasts both transitions to every live window', () => {
    const { monitor, goBattery, goAc } = makeMonitor(false);
    const a = makeWindow();
    const b = makeWindow();
    const broadcaster = new PowerStateBroadcaster(monitor, () => [a, b]);

    goBattery();
    expect(broadcaster.getState()).toEqual({ onBattery: true });
    expect(batteryPayloads(a)).toEqual([{ onBattery: true }]);
    expect(batteryPayloads(b)).toEqual([{ onBattery: true }]);

    goAc();
    expect(broadcaster.getState()).toEqual({ onBattery: false });
    expect(batteryPayloads(a)).toEqual([{ onBattery: true }, { onBattery: false }]);
    expect(batteryPayloads(b)).toEqual([{ onBattery: true }, { onBattery: false }]);
  });

  it('does not re-broadcast an unchanged state', () => {
    const { monitor, goAc } = makeMonitor(false);
    const a = makeWindow();
    new PowerStateBroadcaster(monitor, () => [a]);
    goAc();
    expect(batteryPayloads(a)).toEqual([]);
  });

  it('skips destroyed windows', () => {
    const { monitor, goBattery } = makeMonitor(false);
    const live = makeWindow();
    const dead = makeWindow();
    dead._destroy();
    new PowerStateBroadcaster(monitor, () => [live, dead]);

    goBattery();
    expect(batteryPayloads(live)).toEqual([{ onBattery: true }]);
    expect(dead.send).not.toHaveBeenCalled();
  });

  it('sends the current state to a new window once it finishes loading', () => {
    const { monitor, goBattery } = makeMonitor(false);
    const win = makeWindow();
    const broadcaster = new PowerStateBroadcaster(monitor, () => []);

    goBattery();
    broadcaster.registerWindow(win);
    expect(win.send).not.toHaveBeenCalled();
    win._finishLoad();
    expect(batteryPayloads(win)).toEqual([{ onBattery: true }]);
  });

  it('does not send to a window destroyed before it finished loading', () => {
    const { monitor } = makeMonitor(true);
    const win = makeWindow();
    new PowerStateBroadcaster(monitor, () => []).registerWindow(win);
    win._destroy();
    win._finishLoad();
    expect(win.send).not.toHaveBeenCalled();
  });
});

describe('setupPowerStateIPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
    electronMocks.isOnBatteryPower.mockReturnValue(false);
  });

  function setup() {
    const broadcaster = setupPowerStateIPC();
    const appHandlers = new Map<string, (event: unknown, win: MockWindow) => void>(
      electronMocks.appOn.mock.calls.map(([event, cb]) => [event, cb]),
    );
    const powerHandlers = new Map<string, () => void>(
      electronMocks.powerOn.mock.calls.map(([event, cb]) => [event, cb]),
    );
    const invokeCall = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === GET_BATTERY_STATE_CHANNEL,
    );
    return {
      broadcaster,
      created: appHandlers.get('browser-window-created')!,
      powerHandlers,
      getBatteryState: invokeCall?.[1] as (
        event: unknown,
        data?: unknown,
      ) => Promise<{ onBattery: boolean }>,
    };
  }

  it('wires window-created, both power events, and the invoke handler', () => {
    const { created, powerHandlers, getBatteryState } = setup();
    expect(created).toBeDefined();
    expect(powerHandlers.get('on-battery')).toBeDefined();
    expect(powerHandlers.get('on-ac')).toBeDefined();
    expect(getBatteryState).toBeDefined();
  });

  it('answers the current state over the invoke channel and pushes to live windows', async () => {
    electronMocks.isOnBatteryPower.mockReturnValue(true);
    const win = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([win]);
    const { created, powerHandlers, getBatteryState } = setup();

    await expect(getBatteryState({}, {})).resolves.toEqual({ onBattery: true });

    powerHandlers.get('on-ac')!();
    await expect(getBatteryState({}, undefined)).resolves.toEqual({ onBattery: false });
    expect(batteryPayloads(win)).toEqual([{ onBattery: false }]);

    const fresh = makeWindow();
    created(undefined, fresh);
    fresh._finishLoad();
    expect(batteryPayloads(fresh)).toEqual([{ onBattery: false }]);
  });
});
