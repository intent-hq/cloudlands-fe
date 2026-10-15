import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { WorkspaceState } from './workspace-slice';
import type { WorkspaceTitleRequest } from './workspace-types';

type TitleState = { workspace: WorkspaceState };

export const getWorkspaceTitleOperations = (state: TitleState, workspaceId: string) =>
  getItems(state.workspace.titleOperations).filter(
    (operation) => operation.workspaceId === workspaceId,
  );

export const getWorkspaceTitleOperation = (state: TitleState, requestId: string) =>
  getItem(state.workspace.titleOperations, requestId);

export const getWorkspaceTitleRevision = (state: TitleState, workspaceId: string) =>
  state.workspace.titleRevisions[workspaceId] ?? 0;

export const getPendingWorkspaceTitleToken = (state: TitleState, workspaceId: string) =>
  state.workspace.pendingTitleMutations[workspaceId]?.token;

export const getWorkspaceTitleViewCurrent = (state: TitleState, request: WorkspaceTitleRequest) => {
  const view = request.viewId ? getItem(state.workspace.titleViews, request.viewId) : undefined;
  return (
    !!view &&
    !view.released &&
    view.workspaceId === request.workspaceId &&
    view.authority === request.authority
  );
};
