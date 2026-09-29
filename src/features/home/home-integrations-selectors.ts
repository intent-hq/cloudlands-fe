import { store } from '$store/renderer/store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
export const selectHomeIntegrations = store.createSelector((state) => state.homeIntegrations);
export const selectHomeIntegrationWorkspace = store.createSelector((state) => {
  const item = state.homeIntegrations.detail;
  if (!item?.number || !item.url) return null;
  for (const workspace of getItems(state.workspace.workspaces)) {
    if (
      workspace.repositoryOwner?.toLowerCase() !== item.owner?.toLowerCase() ||
      workspace.repositoryName?.toLowerCase() !== item.repo?.toLowerCase()
    )
      continue;
    const pull = workspace.pullRequests?.find(
      (pr) => pr.url.replace(/\/$/, '') === item.url.replace(/\/$/, ''),
    );
    if (pull) return { workspaceId: workspace.id, pull };
  }
  return null;
});
