import { store } from '../../store';
import { desktopKey } from './desktop-control-types';
export const selectDesktopControl = store.createSelector((state) => state.desktopControl);
export const selectDesktopOsPermissions = store.createSelector(
  (state) => state.desktopControl.osPermissions,
);
export const selectDesktopOsPermissionsChecking = store.createSelector(
  (state) => state.desktopControl.osPermissionsChecking === true,
);
export const selectDesktopEntry = store.createSelector(
  (state, workspaceId: string, agentId: string) =>
    state.desktopControl.byKey[desktopKey(workspaceId, agentId)],
);
export const selectDesktopEventsReady = store.createSelector(
  (state) =>
    !state.workspaceEvents.subscriptionPending && state.workspaceEvents.subscriptionGeneration > 0,
);
