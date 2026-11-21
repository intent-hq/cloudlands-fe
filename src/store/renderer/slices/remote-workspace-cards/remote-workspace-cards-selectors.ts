import { store } from '../../store';
import type { RemoteWorkspaceCardEntry } from './remote-workspace-cards-slice';

export const selectRemoteWorkspaceCardEntries = store.createSelector(
  (state): Record<string, RemoteWorkspaceCardEntry> => state.remoteWorkspaceCards?.byKey ?? {},
);
