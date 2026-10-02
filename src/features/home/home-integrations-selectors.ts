import { store } from '$store/renderer/store';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { homePullIdentity } from './home-integrations-model';
export const selectHomeIntegrationSearchState = store.createSelector(
  (state) => state.homeIntegrations,
);
export const selectHomeIntegrations = store.createSelector((state) => {
  const view = state.homeIntegrations;
  if (!view.linkedItems || !Object.keys(view.linkedItems).length) return view;
  return {
    ...view,
    items: [
      ...new Map(
        [...Object.values(view.linkedItems), ...view.items].map((item) => [item.id, item]),
      ).values(),
    ].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
  };
});
export const selectHomeLinkedWorkspaces = store.createSelector((state) =>
  getItems(state.workspace.workspaces).flatMap((workspace) =>
    [
      ...(workspace.pullRequests ?? []).map((pull) => pull.url),
      workspace.activePullRequest?.url,
      workspace.prUrl,
    ]
      .filter((url): url is string => Boolean(url))
      .map((url) => ({
        url: homePullIdentity(url)?.url ?? url.replace(/\/$/, '').toLowerCase(),
        workspaceId: workspace.id,
        name: workspace.title || workspace.id,
      })),
  ),
);
export const selectHomeIntegrationWorkspace = store.createSelector((state) => {
  const detailUrl = state.homeIntegrations.detail?.url;
  const url = detailUrl
    ? (homePullIdentity(detailUrl)?.url ?? detailUrl.replace(/\/$/, '').toLowerCase())
    : undefined;
  return selectHomeLinkedWorkspaces.select(state).find((link) => link.url === url) ?? null;
});
export const selectHomeLinkedPullUrls = store.createSelector((state) =>
  selectHomeLinkedWorkspaces.select(state).map((link) => link.url),
);
