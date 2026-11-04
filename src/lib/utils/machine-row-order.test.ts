import { expect, it } from 'vitest';
import { orderMachineRows } from './machine-row-order';

const rows = [
  { id: 'local', isLocal: true },
  { id: 'mini', isLocal: false },
  { id: 'intent1', isLocal: false },
  { id: 'studio', isLocal: false },
];
const ids = (list: readonly { id: string }[]) => list.map((row) => row.id);

it('lists the connected backend right after the local row, keeping the others in order', () => {
  expect(ids(orderMachineRows(rows, 'intent1'))).toEqual(['local', 'intent1', 'mini', 'studio']);
});

it('keeps the order when the window uses the local machine', () => {
  expect(ids(orderMachineRows(rows, 'local'))).toEqual(['local', 'mini', 'intent1', 'studio']);
});

it('keeps the order when the connected backend is not in the list', () => {
  expect(ids(orderMachineRows(rows, 'guest-session'))).toEqual([
    'local',
    'mini',
    'intent1',
    'studio',
  ]);
});

it('puts the connected backend first when there is no local row (browser host)', () => {
  expect(ids(orderMachineRows(rows.slice(1), 'studio'))).toEqual(['studio', 'mini', 'intent1']);
});
