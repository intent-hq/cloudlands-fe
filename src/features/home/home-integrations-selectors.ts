import { store } from '$store/renderer/store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
export const selectHomeIntegrations = store.createSelector((state) => state.homeIntegrations);
export const selectHomeLinkedWorkspaces = store.createSelector((state) =>
  getItems(state.workspace.workspaces).flatMap((workspace) =>
    [
      ...(workspace.pullRequests ?? []).map((pull) => pull.url),
      workspace.activePullRequest?.url,
      workspace.prUrl,
    ]
      .filter((url): url is string => Boolean(url))
      .map((url) => ({
        url: url.replace(/\/$/, '').toLowerCase(),
        workspaceId: workspace.id,
        name: workspace.title || workspace.id,
      })),
  ),
);
export const selectHomeIntegrationWorkspace = store.createSelector((state) => {
  const url = state.homeIntegrations.detail?.url.replace(/\/$/, '').toLowerCase();
  return selectHomeLinkedWorkspaces.select(state).find((link) => link.url === url) ?? null;
});
export const selectHomeLinkedPullUrls = store.createSelector((state) =>
  selectHomeLinkedWorkspaces.select(state).map((link) => link.url),
);
