import { store as appStore } from '$store/renderer/store';
import { workspaceLoadRequested } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

export interface UseWorkspaceLoaderOptions {
  workspaceId: string;
}

export function useWorkspaceLoader(options: UseWorkspaceLoaderOptions) {
  $effect(() => {
    const workspaceId = options.workspaceId;
    if (!workspaceId || workspaceId === 'undefined' || workspaceId === 'new') return;
    appStore.dispatch(workspaceLoadRequested(workspaceId));
  });
}
