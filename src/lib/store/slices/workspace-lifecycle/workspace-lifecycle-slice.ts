import { createAction } from '$lib/store/utils/create-action';

export const workspaceMounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceMounted');
export const workspaceUnmounted = createAction<[wsId: string]>('workspace-lifecycle/workspaceUnmounted');