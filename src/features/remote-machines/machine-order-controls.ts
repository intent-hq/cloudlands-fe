import type { ActionDefinition } from '$lib/components/patterns/collection';

/**
 * What the ordered machine list adds to one row (`machineOrder: 1`): the
 * "Preferred" mark on the first row, and the owner's Move up / Move down
 * items appended to the row's own menu.
 */
export interface MachineOrderControls {
  preferred: boolean;
  actions: ActionDefinition[];
  /** Handles a Move up / Move down item; false for the row's own actions. */
  onAction: (id: string) => boolean;
}

/** Merge the row's own menu items with the list's Move up / Move down items. */
export function withOrderActions(
  own: ActionDefinition[],
  order: MachineOrderControls | undefined,
): ActionDefinition[] {
  return order ? [...own, ...order.actions] : own;
}
