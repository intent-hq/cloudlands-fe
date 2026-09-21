import { describe, expect, it } from 'vitest';

import { initialState as userPreferencesInitialState } from '../user-preferences/user-preferences-slice';
import { selectOnBattery, selectReduceMotionActive } from './power-selectors';
import { initialState, powerReducer, setOnBattery } from './power-slice';

describe('powerReducer', () => {
  it('returns the initial state (not on battery)', () => {
    expect(powerReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
    expect(initialState.onBattery).toBe(false);
  });

  it('sets onBattery and returns the same reference when unchanged', () => {
    const onBattery = powerReducer(initialState, setOnBattery(true));
    expect(onBattery.onBattery).toBe(true);
    expect(powerReducer(onBattery, setOnBattery(true))).toBe(onBattery);
    expect(powerReducer(onBattery, setOnBattery(false)).onBattery).toBe(false);
  });
});

describe('power selectors', () => {
  const stateWith = (onBattery: boolean, reduceMotionOnBattery: boolean) =>
    ({
      power: { onBattery },
      userPreferences: { ...userPreferencesInitialState, reduceMotionOnBattery },
    }) as any;

  it('selectOnBattery reads the power slice', () => {
    expect(selectOnBattery.select(stateWith(true, true))).toBe(true);
    expect(selectOnBattery.select(stateWith(false, true))).toBe(false);
  });

  it('selectReduceMotionActive is true only when on battery AND the preference is on', () => {
    expect(selectReduceMotionActive.select(stateWith(true, true))).toBe(true);
    expect(selectReduceMotionActive.select(stateWith(true, false))).toBe(false);
    expect(selectReduceMotionActive.select(stateWith(false, true))).toBe(false);
    expect(selectReduceMotionActive.select(stateWith(false, false))).toBe(false);
  });
});
