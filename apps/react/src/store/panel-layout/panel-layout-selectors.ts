import { store } from '@/store';
import { getPanels } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-projections';
import type { PanelState } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';

export const selectPanels = store.createSelector<[wsId: string], Record<string, PanelState>>(
  getPanels,
);
