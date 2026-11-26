import type { IntentApp } from '$shared/intent-apps/intent-apps-types';
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

export const selectIntentAppIconUrl = store.createSelector<[app: IntentApp], string | null>(
  (state, app) => state.intentApps.icons[`${app.id}@${app.bundleHash}`] ?? null,
);
