import { store } from '../index';
import { getGitWorkspaceState } from '../../../../../src/store/renderer/slices/git/git-slice';
import { sidebarSearchMatches } from '$lib/components/workspace/sidebar/sidebar-search';

export const selectGitWorkspaceState = store.createSelector((state, workspaceId: string) =>
  getGitWorkspaceState(state.git, workspaceId),
);

export const selectFilteredGitFiles = store.createSelector(
  (state, workspaceId: string, query: string) => {
    const files = selectGitWorkspaceState.select(state, workspaceId).status?.files ?? [];
    return query.trim() ? files.filter((file) => sidebarSearchMatches(query, [file.path])) : files;
  },
);
