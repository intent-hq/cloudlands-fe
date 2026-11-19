import { describe, expect, it } from 'vitest';
import type { MachineRailState } from '$shared/types/machine-rail';
import type { StoreState } from '../../types';
import { selectMachineRailShown } from './machine-rail-selectors';

function state(rail: Partial<MachineRailState>): StoreState {
  return {
    machineRail: {
      enabled: true,
      machineIds: ['local'],
      selectedId: 'local',
      shownId: 'local',
      pendingId: '',
      degradedIds: [],
      ...rail,
    },
  } as unknown as StoreState;
}

describe('selectMachineRailShown', () => {
  it('hides the rail while the window holds a single machine', () => {
    expect(selectMachineRailShown.select(state({ machineIds: ['local'] }))).toBe(false);
  });

  it('shows the rail once the window holds a second machine, a guest host included', () => {
    expect(selectMachineRailShown.select(state({ machineIds: ['local', 'b'] }))).toBe(true);
    expect(selectMachineRailShown.select(state({ machineIds: ['local', 'g1'] }))).toBe(true);
  });

  it('never shows the rail while it is turned off', () => {
    expect(
      selectMachineRailShown.select(state({ enabled: false, machineIds: ['local', 'b'] })),
    ).toBe(false);
  });
});
