import {
  getHorizontalPanelColumns,
  getPanelOrder,
} from '$store/renderer/slices/panel-layout/panel-layout-tabless';
export { resolvePaneVerticalMove } from '$store/renderer/slices/panel-layout/panel-layout-tabless';
import type {
  PanelLayoutNode,
  PanelState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { PanelCycleDirection } from './panel-cycle-navigation';

type PaneColumnMove =
  | { kind: 'neighbor'; tabId: string; targetPanelId: string }
  | { kind: 'edge'; tabId: string; position: 'before' | 'after' };

/** Share eligibility between the movement pad and its fresh-state action routing. */
export function resolvePaneColumnMove(
  panelOrder: readonly string[],
  panel: PanelState | null | undefined,
  direction: PanelCycleDirection,
  root?: PanelLayoutNode,
): PaneColumnMove | null {
  const tabId = panel?.activeTabId;
  if (!panel || !tabId || !panel.tabs.some((tab) => tab.id === tabId)) return null;
  const columns = root
    ? getHorizontalPanelColumns(root).map(getPanelOrder)
    : panelOrder.map((id) => [id]);
  const index = columns.findIndex((column) => column.includes(panel.id));
  if (index < 0) return null;

  const targetPanelId = columns[index + (direction === 'next' ? 1 : -1)]?.[0];
  if (targetPanelId) return { kind: 'neighbor', tabId, targetPanelId };

  // A single-tab row can leave its column when another row remains.
  if (columns.length >= 4 || (panel.tabs.length < 2 && columns[index].length < 2)) return null;
  return { kind: 'edge', tabId, position: direction === 'next' ? 'after' : 'before' };
}
