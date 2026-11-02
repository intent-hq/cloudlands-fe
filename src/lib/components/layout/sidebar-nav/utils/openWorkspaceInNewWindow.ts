import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { openAndShowWorkspace } from '$lib/utils/show-workspace';

/**
 * Opens a workspace in a new Electron window, falling back to in-app navigation on failure.
 */
function showInThisWindow(workspaceId: string): Promise<void> {
  return openAndShowWorkspace(workspaceId).then(
    () => undefined,
    (error: unknown) => console.warn('Fallback navigation to workspace failed:', error),
  );
}

export async function openWorkspaceInNewWindow(workspaceId: string): Promise<void> {
  const route = `/workspace/${workspaceId}`;
  try {
    const result = (await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route })) as {
      success?: boolean;
      error?: string;
    };
    if (result && result.success === false) {
      console.warn('Failed to open new window, navigating instead:', result.error);
      await showInThisWindow(workspaceId);
    }
  } catch (error) {
    console.warn('Failed to open new window, navigating instead:', error);
    await showInThisWindow(workspaceId);
  }
}
