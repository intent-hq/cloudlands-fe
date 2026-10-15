import { store } from '@/store';
import {
  getPanels,
  getPanelLayoutWorkspace,
  getPanelColumnCount,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-projections';
import type { PanelState } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';

export const selectPanels = store.createSelector<[wsId: string], Record<string, PanelState>>(
  getPanels,
);

export const selectPanelLayoutWorkspace = store.createSelector(getPanelLayoutWorkspace);
export const selectPanelColumnCount = store.createSelector(getPanelColumnCount);
