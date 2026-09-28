import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { PanelCycleDirection } from './panel-cycle-navigation';

type PaneColumnMove =
  | { kind: 'neighbor'; tabId: string; targetPanelId: string }
  | { kind: 'edge'; tabId: string; position: 'before' | 'after' };

/** Share eligibility between the movement pad and its fresh-state action routing. */
export function resolvePaneColumnMove(
  panelOrder: readonly string[],
  panel: PanelState | null | undefined,
  direction: PanelCycleDirection,
): PaneColumnMove | null {
  const tabId = panel?.activeTabId;
  if (!panel || !tabId || !panel.tabs.some((tab) => tab.id === tabId)) return null;
  const index = panelOrder.indexOf(panel.id);
  if (index < 0) return null;

  const targetPanelId = panelOrder[index + (direction === 'next' ? 1 : -1)];
  if (targetPanelId) return { kind: 'neighbor', tabId, targetPanelId };

  // A sole pane is already in its own edge column; there is nothing to split off.
  if (panelOrder.length >= 4 || panel.tabs.length < 2) return null;
  return { kind: 'edge', tabId, position: direction === 'next' ? 'after' : 'before' };
}
