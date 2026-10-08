import { store } from '$store/renderer/store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';

export const selectCustomViewsState = store.createSelector((state) => state.customViews);
export const selectCustomViewState = selectCustomViewsState;
export const selectCustomViews = store.createSelector((state) => getItems(state.customViews.views));
export const selectCustomViewsSelectedId = store.createSelector(
  (state) => state.customViews.selectedId,
);
export const selectCustomViewById = store.createSelector((state, id: string) =>
  getItem(state.customViews.views, id),
);
export const selectCustomViewRuntime = store.createSelector((state, id: string) =>
  getItem(state.customViews.runtimes, id),
);
export const selectCustomViewsHaveActiveServers = store.createSelector((state) =>
  getItems(state.customViews.runtimes).some(
    (runtime) => runtime.status === 'starting' || runtime.status === 'running',
  ),
);
