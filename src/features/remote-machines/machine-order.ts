/**
 * The ordered machine list (PROTOCOL `methods/nodes.md` → "Ordered machine
 * list", `machineOrder: 1`): reorder moves that produce the whole
 * `remoteMachines.setOrder` list, and Start On rows sorted by the stored order.
 */
import {
  machineOrderId,
  machineOrderKey,
  type MachineOrderKey,
  type MachineOrderRow,
} from '$shared/types/remote-machines';
import { START_ON_BACKEND, startOnCloudMachineId } from './start-on';

/**
 * The whole list with row `id` moved before or after row `targetId`, as
 * `setOrder` keys; null when nothing moves.
 */
export function moveMachineOrder(
  order: readonly MachineOrderRow[],
  id: string,
  targetId: string,
  position: 'before' | 'after',
): MachineOrderKey[] | null {
  const ids = order.map(machineOrderId);
  const from = ids.indexOf(id);
  const target = ids.indexOf(targetId);
  if (from < 0 || target < 0 || from === target) return null;
  let to = target + (position === 'after' ? 1 : 0);
  if (from < to) to -= 1;
  if (to === from) return null;
  const rows = [...order];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  return rows.map(machineOrderKey);
}

/** Move row `id` one place up (-1) or down (1); null at either end. */
export function stepMachineOrder(
  order: readonly MachineOrderRow[],
  id: string,
  direction: -1 | 1,
): MachineOrderKey[] | null {
  const index = order.findIndex((row) => machineOrderId(row) === id);
  const target = order[index + direction];
  if (index < 0 || !target) return null;
  return moveMachineOrder(order, id, machineOrderId(target), direction === -1 ? 'before' : 'after');
}

/** The order id of a Start On option: the backend is "This computer". */
function startOnOrderId(optionId: string, kind: 'machine' | 'cloud' | undefined): string {
  if (optionId === START_ON_BACKEND) return 'local';
  const cloudMachineId = kind === 'cloud' ? startOnCloudMachineId(optionId) : null;
  return machineOrderId(
    cloudMachineId ? { kind: 'cloud', cloudMachineId } : { kind: 'machine', nodeId: optionId },
  );
}

/**
 * Start On rows in the stored order. Rows the list does not name yet keep
 * their relative place after the named ones.
 */
export function sortByMachineOrder<T extends { id: string; kind?: 'machine' | 'cloud' }>(
  options: readonly T[],
  order: readonly MachineOrderRow[],
): T[] {
  const rank = new Map(order.map((row, index) => [machineOrderId(row), index]));
  const rankOf = (option: T) => rank.get(startOnOrderId(option.id, option.kind)) ?? order.length;
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => rankOf(a.option) - rankOf(b.option) || a.index - b.index)
    .map(({ option }) => option);
}
