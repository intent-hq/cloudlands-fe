import { createAttachmentInfoRead } from './backend-attachment-info';
import { createBinaryFileRead } from './backend-binary-file-read';
import type { BackendTransport } from './backend-transport-types';
import { intentFileImageUrlToWorkspaceFileUrl } from '$lib/utils/workspace-file-image';

/** Browser PNG attachment reads: registry identity and daemon containment, never a guessed URL.
 * No domain cache: the mounted media owner releases its decoded bytes/object URL.
 */
export function createAttachmentImageRead(request: BackendTransport['request']) {
  const info = createAttachmentInfoRead(request);
  const read = createBinaryFileRead(request);
  return async (workspaceId: string, attachmentId: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const attachment = await info({ workspaceId, attachmentId });
    signal.throwIfAborted();
    const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
    if (
      attachment.attachmentId !== attachmentId ||
      !attachment.exists ||
      attachment.mimeType !== 'image/png' ||
      !attachment.path.startsWith('.intent/attachments/') ||
      attachment.path.includes('\0') ||
      !attachment.path.toLowerCase().endsWith('.png') ||
      !intentFileImageUrlToWorkspaceFileUrl(
        `intent://local/${workspaceId}/file/${encodedPath}`,
        workspaceId,
      )
    )
      throw new Error('Unsupported attachment image');
    const data = await read(workspaceId, attachment.path, signal);
    signal.throwIfAborted();
    if (data.length !== attachment.size) throw new Error('Attachment size changed');
    return { data, attachment };
  };
}
