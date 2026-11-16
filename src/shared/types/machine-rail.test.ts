import { describe, expect, it } from 'vitest';

import {
  addRailMachine,
  nextRailMachine,
  reorderRailMachines,
  removeRailMachine,
} from './machine-rail';

// The documented cap: nine machines per window.
const MACHINE_RAIL_MAX_MACHINES = 9;

describe('addRailMachine', () => {
  it('appends a new machine and leaves a listed one where it is', () => {
    expect(addRailMachine(['local'], 'b')).toEqual(['local', 'b']);
    expect(addRailMachine(['local', 'b', 'c'], 'b')).toEqual(['local', 'b', 'c']);
  });

  it('refuses a machine once the rail is full', () => {
    const full = Array.from({ length: MACHINE_RAIL_MAX_MACHINES }, (_, index) => `m${index}`);
    expect(addRailMachine(full, 'extra')).toEqual(full);
  });
});

describe('removeRailMachine', () => {
  const rail = { machineIds: ['local', 'b', 'c'], selectedId: 'b' };

  it('selects the next machine when the shown machine is removed', () => {
    expect(removeRailMachine(rail, 'b')).toEqual({ machineIds: ['local', 'c'], selectedId: 'c' });
  });

  it('selects the previous machine when the shown last machine is removed', () => {
    expect(removeRailMachine({ ...rail, selectedId: 'c' }, 'c')).toEqual({
      machineIds: ['local', 'b'],
      selectedId: 'b',
    });
  });

  it('keeps the selection when another machine is removed, the first one included', () => {
    expect(removeRailMachine(rail, 'local')).toEqual({ machineIds: ['b', 'c'], selectedId: 'b' });
  });

  it('leaves nothing selected once the last machine is removed', () => {
    expect(removeRailMachine({ machineIds: ['b'], selectedId: 'b' }, 'b')).toEqual({
      machineIds: [],
      selectedId: '',
    });
  });

  it('ignores a machine that is not in the rail', () => {
    expect(removeRailMachine(rail, 'x')).toEqual(rail);
  });
});

describe('nextRailMachine', () => {
  const guests = new Set(['g1']);
  const isGuest = (id: string) => guests.has(id);

  it('moves to the next machine and loops back to the first', () => {
    expect(nextRailMachine(['local', 'b', 'c'], 'local', isGuest)).toBe('b');
    expect(nextRailMachine(['local', 'b', 'c'], 'c', isGuest)).toBe('local');
  });

  it('skips guest hosts, also when one is shown', () => {
    expect(nextRailMachine(['local', 'g1', 'b'], 'local', isGuest)).toBe('b');
    expect(nextRailMachine(['local', 'b', 'g1'], 'g1', isGuest)).toBe('local');
  });

  it('has nowhere to go without another own machine', () => {
    expect(nextRailMachine(['local', 'g1'], 'local', isGuest)).toBeNull();
    expect(nextRailMachine(['local'], 'local', isGuest)).toBeNull();
  });
});

describe('reorderRailMachines', () => {
  const rail = ['local', 'b', 'c', 'g1'];

  it('takes a new order of the same machines', () => {
    expect(reorderRailMachines(rail, ['local', 'c', 'b', 'g1'])).toEqual(['local', 'c', 'b', 'g1']);
  });

  it('moves any machine to the first place', () => {
    expect(reorderRailMachines(rail, ['b', 'local', 'c', 'g1'])).toEqual(['b', 'local', 'c', 'g1']);
  });

  it('refuses an order that adds, drops or repeats a machine', () => {
    expect(reorderRailMachines(rail, ['local', 'b', 'c'])).toEqual(rail);
    expect(reorderRailMachines(rail, ['local', 'b', 'c', 'x'])).toEqual(rail);
    expect(reorderRailMachines(rail, ['local', 'b', 'b', 'g1'])).toEqual(rail);
  });
});
