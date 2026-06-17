import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';

export const workspaceMounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceMounted');
export const workspaceUnmounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceUnmounted');