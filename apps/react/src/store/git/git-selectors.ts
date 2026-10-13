import { store } from '../index';
import { getGitWorkspaceState } from '../../../../../src/store/renderer/slices/git/git-slice';

export const selectGitWorkspaceState = store.createSelector((state, workspaceId: string) =>
  getGitWorkspaceState(state.git, workspaceId),
);
