import { createAttachmentInfoRead } from './backend-attachment-info';
import { createBinaryFileRead } from './backend-binary-file-read';
import type { BackendTransport } from './backend-transport-types';
import { getWorkspaceVideoSource } from '$shared/types/content-block';
import { intentFileImageUrlToWorkspaceFileUrl } from '$lib/utils/workspace-file-image';

/** Browser PNG/MP4 attachment reads: registry identity and daemon containment, never a guessed URL.
 * No domain cache: the mounted media owner releases its decoded bytes/object URL.
 */
export function createAttachmentMediaRead(
  request: BackendTransport['request'],
  mimeType: 'image/png' | 'image/jpeg' | 'video/mp4',
) {
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
      attachment.mimeType !== mimeType ||
      !attachment.path.startsWith('.intent/attachments/') ||
      attachment.path.includes('\0') ||
      !(mimeType !== 'video/mp4'
        ? (mimeType === 'image/png'
            ? attachment.path.toLowerCase().endsWith('.png')
            : /\.jpe?g$/i.test(attachment.path)) &&
          intentFileImageUrlToWorkspaceFileUrl(
            `intent://local/${workspaceId}/file/${encodedPath}`,
            workspaceId,
          )
        : getWorkspaceVideoSource(`intent://local/${workspaceId}/file/${encodedPath}`, workspaceId)
            ?.mimeType === mimeType)
    )
      throw new Error('Unsupported attachment media');
    const data = await read(workspaceId, attachment.path, signal);
    signal.throwIfAborted();
    if (data.length !== attachment.size) throw new Error('Attachment size changed');
    return { data, attachment };
  };
}
