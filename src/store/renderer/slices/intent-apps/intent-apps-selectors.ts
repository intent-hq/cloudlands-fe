import { store } from '../../store';

export const selectIntentApps = store.createSelector((state) => state.intentApps);

/** The Labs switch (main owns it; off until main answers). */
export const selectIntentAppsLabEnabled = store.createSelector(
  (state) => state.intentApps.library.labEnabled,
);

/**
 * The library section shows: the Labs switch is on and the daemon of this
 * window's machine advertises `intentApps: 1` (other or missing values hide it).
 */
export const selectIntentAppsLibraryShown = store.createSelector(
  (state) => state.intentApps.library.labEnabled && state.intentApps.library.supported,
);

/** Loaded icon data URLs by `<appId>@<bundleHash>`. */
export const selectIntentAppIcons = store.createSelector((state) => state.intentApps.icons);

/** The checked package that the install review shows (null when none). */
export const selectIntentAppPackageInstall = store.createSelector(
  (state) => state.intentApps.packageInstall,
);
