import '@tanstack/react-start/client-only';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreState } from '@themislib/themis/types';
import { catalogReducer } from './catalog/catalog-slice';
import { uiHighlightReducer } from '../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';
import { autoUpdateReducer } from '../../../../src/store/renderer/slices/auto-update/auto-update-slice';
import { uiLayoutReducer } from '../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import { userPreferencesReducer } from '../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { daemonHealthReducer } from '../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';

export const store = new ReactStore({
  catalog: catalogReducer,
  uiHighlight: uiHighlightReducer,
  autoUpdate: autoUpdateReducer,
  uiLayout: uiLayoutReducer,
  userPreferences: userPreferencesReducer,
  daemonHealth: daemonHealthReducer,
});
export type AppState = StoreState<typeof store>;
