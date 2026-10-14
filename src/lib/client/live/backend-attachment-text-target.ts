import { m } from '$shared/paraglide/messages.js';
import { createAttachmentInfoRead } from './backend-attachment-info';
import type { BackendTransport } from './backend-transport-types';
import { parseIntentLink } from '$shared/utils/intent-link-parser';

/** Registered JSON only. Return the canonical contained path, never guess it from a label. */
export function createAttachmentTextTargetRead(request: BackendTransport['request']) {
  const info = createAttachmentInfoRead(request);
  return async (workspaceId: string, attachmentId: string) => {
    const attachment = await info({ workspaceId, attachmentId });
    if (typeof attachment.path !== 'string')
      throw new Error(m.ui_linkHandler_invalidFilePath_error());
    const target = parseIntentLink(
      `intent://local/file/${attachment.path.split('/').map(encodeURIComponent).join('/')}`,
    );
    if (
      attachment.attachmentId !== attachmentId ||
      !attachment.exists ||
      attachment.mimeType !== 'application/json' ||
      !Number.isSafeInteger(attachment.size) ||
      attachment.size < 0 ||
      !attachment.path.startsWith('.intent/attachments/') ||
      attachment.path.includes('\0') ||
      !/\.json$/i.test(attachment.path) ||
      !target.valid ||
      target.type !== 'file' ||
      target.line ||
      target.resourceId !== attachment.path
    )
      throw new Error(m.file_ipc_readFailed_error());
    return attachment.path;
  };
}
