import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectPluginsSettings = store.createSelector((state) => state.pluginsSettings);

export const selectPlugins = store.createSelector((state) =>
  getItems(state.pluginsSettings.plugins),
);
