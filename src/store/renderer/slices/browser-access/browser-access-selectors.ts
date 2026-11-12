import { store } from '../../store';

export const selectBrowserAccess = store.createSelector((state) => state.browserAccess.current);

export const selectBrowserAccessBusy = store.createSelector(
  (state) => state.browserAccess.pending > 0,
);

export const selectBrowserAccessSignInCode = store.createSelector(
  (state) => state.browserAccess.signInCode,
);

export const selectBrowserAccessSignInCodeFailed = store.createSelector(
  (state) => state.browserAccess.signInCodeFailed,
);

export const selectBrowserAccessFailed = store.createSelector(
  (state) => state.browserAccess.failed,
);
