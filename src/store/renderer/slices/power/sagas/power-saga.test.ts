import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<boolean>>(),
  listeners: new Set<(onBattery: boolean) => void>(),
  unsubscribe: vi.fn(),
}));

vi.mock('$store/renderer/seeders/power-bridge-seeder', () => ({
  createBatterySource: () => ({
    read: mocks.read,
    subscribe: (listener: (onBattery: boolean) => void) => {
      mocks.listeners.add(listener);
      return () => {
        mocks.listeners.delete(listener);
        mocks.unsubscribe();
      };
    },
  }),
}));

import {
  initialState as userPreferencesInitialState,
  setReduceMotionOnBattery,
  userPreferencesReducer,
} from '../../user-preferences/user-preferences-slice';
import { initialState as powerInitialState, powerReducer, setOnBattery } from '../power-slice';
import { REDUCE_MOTION_ROOT_ATTRIBUTE, powerSaga } from './power-saga';

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

const hasRootAttribute = () => document.documentElement.hasAttribute(REDUCE_MOTION_ROOT_ATTRIBUTE);

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
    document.documentElement.removeAttribute(REDUCE_MOTION_ROOT_ATTRIBUTE);
  });

  afterEach(() => {
    document.documentElement.removeAttribute(REDUCE_MOTION_ROOT_ATTRIBUTE);
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
});
