import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

interface DockWorkspaceOpenResult {
  success?: boolean;
  windowId?: number;
  reused?: boolean;
  error?: string;
}

/** Focus an open normal workspace tab, or create a normal window without navigating the dock. */
export async function openDockWorkspace(workspaceId: string): Promise<void> {
  const result = await invoke<DockWorkspaceOpenResult>(IPC_CHANNELS.WINDOW.OPEN_NEW, {
    route: `/workspace/${workspaceId}`,
    reuseExistingWorkspace: true,
  });
  if (result?.success === false) throw new Error(result.error ?? 'Failed to open workspace');
}
