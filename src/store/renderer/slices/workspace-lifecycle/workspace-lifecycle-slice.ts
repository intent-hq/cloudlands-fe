import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';

export const workspaceMounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceMounted');
export const workspaceUnmounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceUnmounted');
/**
 * The workspace was permanently deleted upstream (daemon `workspace:deleted`).
 * Unlike `workspaceUnmounted` (session-end cleanup), this purges every trace of
 * the workspace from Redux so a recreated same-slug workspace does not surface
 * ghost agents. `agentIds` is the resolved list of agent IDs known to belong to
 * the deleted workspace at dispatch time — passed in the payload so slices
 * keyed by agentId (chat-state) can purge without cross-slice reads.
 */
export const workspaceDeleted = createAction<[wsId: string, agentIds: string[]]>(
  'workspace-lifecycle/workspaceDeleted',
);