import { store } from '../../store';

export const selectGitCredentialsShownForWorkspace = store.createSelector(
  (state, workspaceId: string) =>
    state.globalModals.gitCredentials.shownForWorkspaceIds[workspaceId] === true,
);
