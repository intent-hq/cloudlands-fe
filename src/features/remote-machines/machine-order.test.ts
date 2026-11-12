import { describe, expect, it } from 'vitest';
import type { MachineOrderRow } from '$shared/types/remote-machines';
import { parseMachineOrder } from '$shared/types/remote-machines';
import { moveMachineOrder, sortByMachineOrder, stepMachineOrder } from './machine-order';
import { START_ON_BACKEND, startOnCloudId } from './start-on';

const ORDER: MachineOrderRow[] = [
  { kind: 'local', name: 'build-host' },
  { kind: 'machine', nodeId: 'd-a', name: 'A' },
  { kind: 'machine', nodeId: 'd-b', name: 'B' },
  { kind: 'cloud', cloudMachineId: 'e2b-1', name: 'Sandbox' },
];

describe('moveMachineOrder (drag and drop)', () => {
  it('drops a row before a target, as the whole setOrder list', () => {
    expect(moveMachineOrder(ORDER, 'cloud:e2b-1', 'local', 'before')).toEqual([
      { kind: 'cloud', cloudMachineId: 'e2b-1' },
      { kind: 'local' },
      { kind: 'machine', nodeId: 'd-a' },
      { kind: 'machine', nodeId: 'd-b' },
    ]);
  });

  it('drops a row after a target further down', () => {
    expect(moveMachineOrder(ORDER, 'local', 'machine:d-b', 'after')).toEqual([
      { kind: 'machine', nodeId: 'd-a' },
      { kind: 'machine', nodeId: 'd-b' },
      { kind: 'local' },
      { kind: 'cloud', cloudMachineId: 'e2b-1' },
    ]);
  });

  it('is null when the drop leaves the row where it is or names an unknown row', () => {
    expect(moveMachineOrder(ORDER, 'machine:d-a', 'machine:d-a', 'before')).toBeNull();
    expect(moveMachineOrder(ORDER, 'machine:d-a', 'machine:d-b', 'before')).toBeNull();
    expect(moveMachineOrder(ORDER, 'machine:d-a', 'local', 'after')).toBeNull();
    expect(moveMachineOrder(ORDER, 'machine:gone', 'local', 'before')).toBeNull();
  });
});

describe('stepMachineOrder (Move up / Move down)', () => {
  it('swaps a row with its neighbour', () => {
    expect(stepMachineOrder(ORDER, 'machine:d-b', -1)).toEqual([
      { kind: 'local' },
      { kind: 'machine', nodeId: 'd-b' },
      { kind: 'machine', nodeId: 'd-a' },
      { kind: 'cloud', cloudMachineId: 'e2b-1' },
    ]);
    expect(stepMachineOrder(ORDER, 'local', 1)?.[0]).toEqual({ kind: 'machine', nodeId: 'd-a' });
  });

  it('is null past either end', () => {
    expect(stepMachineOrder(ORDER, 'local', -1)).toBeNull();
    expect(stepMachineOrder(ORDER, 'cloud:e2b-1', 1)).toBeNull();
  });
});

describe('sortByMachineOrder (Start On)', () => {
  it('lists the backend, machines and cloud entries in the stored order', () => {
    const order: MachineOrderRow[] = [ORDER[3], ORDER[2], ORDER[0], ORDER[1]];
    const options = [
      { id: START_ON_BACKEND, label: 'This machine' },
      { id: 'd-a', label: 'A', kind: 'machine' as const },
      { id: 'd-b', label: 'B', kind: 'machine' as const },
      { id: startOnCloudId('e2b-1'), label: 'E2B · Sandbox', kind: 'cloud' as const },
    ];
    expect(sortByMachineOrder(options, order).map((option) => option.label)).toEqual([
      'E2B · Sandbox',
      'B',
      'This machine',
      'A',
    ]);
  });

  it('keeps rows the list does not name after the named ones, in their own order', () => {
    const options = [
      { id: 'd-new', label: 'New' },
      { id: START_ON_BACKEND, label: 'This machine' },
      { id: 'd-other', label: 'Other' },
      { id: 'd-b', label: 'B' },
    ];
    expect(sortByMachineOrder(options, ORDER).map((option) => option.label)).toEqual([
      'This machine',
      'B',
      'New',
      'Other',
    ]);
  });
});

describe('parseMachineOrder', () => {
  it('rejects a list with a row it cannot name, since setOrder must name every row', () => {
    expect(
      parseMachineOrder([
        { kind: 'local', name: 'h' },
        { kind: 'satellite', name: 'X' },
      ]),
    ).toBeNull();
    expect(parseMachineOrder([{ kind: 'machine', name: 'no id' }])).toBeNull();
    expect(parseMachineOrder([null])).toBeNull();
  });

  it('keeps documented rows and drops unknown fields', () => {
    expect(
      parseMachineOrder([
        { kind: 'local', name: 'host' },
        { kind: 'machine', nodeId: 'd-a', name: 'A', extra: true },
        { kind: 'cloud', cloudMachineId: 'e2b-1', name: 'S' },
      ]),
    ).toEqual([
      { kind: 'local', name: 'host' },
      { kind: 'machine', nodeId: 'd-a', name: 'A' },
      { kind: 'cloud', cloudMachineId: 'e2b-1', name: 'S' },
    ]);
    expect(parseMachineOrder(undefined)).toBeNull();
  });
});
