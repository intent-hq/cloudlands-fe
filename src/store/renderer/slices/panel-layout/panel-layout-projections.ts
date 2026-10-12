import { emptyWorkspaceState } from './panel-layout-slice';
import type { PanelLayoutSliceState, PanelState } from './panel-layout-types';

export const getPanels = (
  state: { panelLayout: PanelLayoutSliceState },
  wsId: string,
): Record<string, PanelState> =>
  (state.panelLayout.byWorkspaceId[wsId] ?? emptyWorkspaceState).panels;
