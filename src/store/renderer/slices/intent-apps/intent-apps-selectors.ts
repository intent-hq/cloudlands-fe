import { store } from '../../store';

export const selectIntentApps = store.createSelector((state) => state.intentApps);

/** The Labs switch (main owns it; off until main answers). */
export const selectIntentAppsLabEnabled = store.createSelector(
  (state) => state.intentApps.library.labEnabled,
);

/** The library section shows: the Labs switch is on. */
export const selectIntentAppsLibraryShown = store.createSelector(
  (state) => state.intentApps.library.labEnabled,
);

/** Install works from this window: its machine is this computer, where the library is. */
export const selectIntentAppsCanInstallHere = store.createSelector(
  (state) => state.connections.windowBackendId === 'local',
);

/** Loaded icon data URLs by `<appId>@<bundleHash>`. */
export const selectIntentAppIcons = store.createSelector((state) => state.intentApps.icons);
