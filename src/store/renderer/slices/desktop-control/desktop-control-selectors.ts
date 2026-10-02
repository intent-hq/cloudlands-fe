import { store } from '../../store';
import { desktopKey } from './desktop-control-types';
export const selectDesktopControl = store.createSelector((state) => state.desktopControl);
export const selectDesktopEntry = store.createSelector(
  (state, workspaceId: string, agentId: string) =>
    state.desktopControl.byKey[desktopKey(workspaceId, agentId)],
);
export const selectDesktopEventsReady = store.createSelector(
  (state) =>
    !state.workspaceEvents.subscriptionPending && state.workspaceEvents.subscriptionGeneration > 0,
);

export const selectWorkspaceActiveComputerName = store.createSelector(
  (state, workspaceId: string): string | undefined => {
    const active = Object.values(state.desktopControl?.byKey ?? {}).find(
      (entry) => entry.workspaceId === workspaceId && entry.state.status === 'active',
    );
    return active?.state.status === 'active' ? active.state.computerName : undefined;
  },
);
