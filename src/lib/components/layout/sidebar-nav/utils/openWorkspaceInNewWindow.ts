import { goto } from '$app/navigation';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

/**
 * Opens a workspace in a new Electron window, falling back to in-app navigation on failure.
 */
export async function openWorkspaceInNewWindow(workspaceId: string): Promise<void> {
  const route = `/workspace/${workspaceId}`;
  try {
    const result = (await invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route })) as {
      success?: boolean;
      error?: string;
    };
    if (result && result.success === false) {
      console.warn('Failed to open new window, navigating instead:', result.error);
      goto(route);
    }
  } catch (error) {
    console.warn('Failed to open new window, navigating instead:', error);
    goto(route);
  }
}

