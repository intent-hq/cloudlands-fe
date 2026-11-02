import { store } from '../../store';

export const selectBrowserAccess = store.createSelector((state) => state.browserAccess.current);

export const selectBrowserAccessBusy = store.createSelector(
  (state) => state.browserAccess.pending > 0,
);

export const selectBrowserAccessFailed = store.createSelector(
  (state) => state.browserAccess.failed,
);
