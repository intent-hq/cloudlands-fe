import { invoke } from '$lib/electron-bridge';
import type { FileIpc, IpcResponse } from '$shared/ipc';
import { workspaceRelativeFilePath } from '../utils/workspace-file-path';

/** Save persisted workspace bytes on the client, including through a remote daemon. */
export async function downloadWorkspaceFile(
  workspaceId: string,
  filePath: string,
  root: string | null | undefined,
): Promise<IpcResponse<FileIpc.DownloadAttachmentResponse> & { canceled?: boolean }> {
  const path = workspaceRelativeFilePath(filePath, root);
  if (!workspaceId || !path) throw new Error('Invalid workspace download path');
  return await invoke('file:download-attachment', {
    workspaceId,
    path,
    fileName: path.slice(path.lastIndexOf('/') + 1),
  });
}
