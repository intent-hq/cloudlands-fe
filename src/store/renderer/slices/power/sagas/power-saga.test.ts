import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<boolean>>(),
  listeners: new Set<(onBattery: boolean) => void>(),
  unsubscribe: vi.fn(),
  useRealSource: false,
}));

vi.mock('$store/renderer/seeders/power-bridge-seeder', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$store/renderer/seeders/power-bridge-seeder')>();
  return {
    createBatterySource: () =>
      mocks.useRealSource
        ? actual.createBatterySource()
        : {
            read: mocks.read,
            subscribe: (listener: (onBattery: boolean) => void) => {
              mocks.listeners.add(listener);
              return () => {
                mocks.listeners.delete(listener);
                mocks.unsubscribe();
              };
            },
          },
  };
});

import { REDUCE_MOTION_ATTRIBUTE } from '$lib/utils/reduced-motion';
import {
  initialState as userPreferencesInitialState,
  setReduceMotionOnBattery,
  userPreferencesReducer,
} from '../../user-preferences/user-preferences-slice';
import { initialState as powerInitialState, powerReducer, setOnBattery } from '../power-slice';
import { powerSaga } from './power-saga';

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

const hasRootAttribute = () => document.documentElement.hasAttribute(REDUCE_MOTION_ATTRIBUTE);

function createHarness() {
  let state = { power: powerInitialState, userPreferences: userPreferencesInitialState };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: any) => {
    state = {
      power: powerReducer(state.power, action),
      userPreferences: userPreferencesReducer(state.userPreferences, action),
    };
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
    powerSaga,
  );
  return { dispatch, task, getState: () => state };
}

const emitBattery = (onBattery: boolean) => {
  for (const listener of mocks.listeners) listener(onBattery);
};

describe('powerSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.read.mockResolvedValue(false);
    document.documentElement.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  });

  afterEach(() => {
    document.documentElement.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  });

  it('seeds onBattery from the initial read and keeps the root attribute absent off battery', async () => {
    const { dispatch, task, getState } = createHarness();
    await settle();
    expect(dispatch).toHaveBeenCalledWith(setOnBattery(false));
    expect(getState().power.onBattery).toBe(false);
    expect(hasRootAttribute()).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('sets data-reduce-motion when the battery source reports on-battery and clears it on AC', async () => {
    mocks.read.mockResolvedValue(true);
    const { task, getState } = createHarness();
    await settle();
    expect(getState().power.onBattery).toBe(true);
    expect(hasRootAttribute()).toBe(true);

    emitBattery(false);
    await settle();
    expect(getState().power.onBattery).toBe(false);
    expect(hasRootAttribute()).toBe(false);

    emitBattery(true);
    await settle();
    expect(hasRootAttribute()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('honors the preference: on battery with reduceMotionOnBattery off leaves the attribute absent', async () => {
    mocks.read.mockResolvedValue(true);
    const { dispatch, task } = createHarness();
    await settle();
    expect(hasRootAttribute()).toBe(true);

    dispatch(setReduceMotionOnBattery(false));
    await settle();
    expect(hasRootAttribute()).toBe(false);

    dispatch(setReduceMotionOnBattery(true));
    await settle();
    expect(hasRootAttribute()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('falls back to off-battery when the initial read fails', async () => {
    mocks.read.mockRejectedValue(new Error('no battery api'));
    const { dispatch, task, getState } = createHarness();
    await settle();
    expect(dispatch).not.toHaveBeenCalledWith(setOnBattery(true));
    expect(getState().power.onBattery).toBe(false);
    expect(hasRootAttribute()).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('unsubscribes from the battery source and clears the attribute on cancellation', async () => {
    mocks.read.mockResolvedValue(true);
    const { task } = createHarness();
    await settle();
    expect(mocks.listeners.size).toBe(1);
    expect(hasRootAttribute()).toBe(true);
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(hasRootAttribute()).toBe(false);
  });

  describe('with the real browser BatterySource', () => {
    const originalElectronAPI = (window as any).electronAPI;
    const originalGetBattery = (navigator as any).getBattery;
    const unhandled = vi.fn();

    beforeEach(() => {
      mocks.useRealSource = true;
      delete (window as any).electronAPI;
      unhandled.mockClear();
      process.on('unhandledRejection', unhandled);
    });

    afterEach(() => {
      process.off('unhandledRejection', unhandled);
      mocks.useRealSource = false;
      (window as any).electronAPI = originalElectronAPI;
      if (originalGetBattery) (navigator as any).getBattery = originalGetBattery;
      else delete (navigator as any).getBattery;
    });

    it('stays off-battery with no unhandled rejection when navigator.getBattery rejects', async () => {
      (navigator as any).getBattery = vi.fn(() => Promise.reject(new Error('denied')));
      const { task, getState } = createHarness();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getState().power.onBattery).toBe(false);
      expect(hasRootAttribute()).toBe(false);
      task.cancel();
      await task.toPromise();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('cancelling while getBattery is still pending settles cleanly without attaching listeners', async () => {
      const addEventListener = vi.fn();
      let resolveBattery!: (value: unknown) => void;
      (navigator as any).getBattery = vi.fn(
        () => new Promise((resolve) => (resolveBattery = resolve)),
      );
      const { task } = createHarness();
      await settle();

      task.cancel();
      await task.toPromise();
      resolveBattery({ charging: false, addEventListener, removeEventListener: vi.fn() });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(addEventListener).not.toHaveBeenCalled();
      expect(hasRootAttribute()).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });
});
