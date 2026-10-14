import type { BackendTransport } from './backend-transport-types';

/** Result of `file.getAttachmentInfo` (PROTOCOL §5.9). */
export interface AttachmentInfo {
  attachmentId: string;
  fileName: string;
  mimeType?: string;
  size: number;
  uploadedAt: string;
  /** Workspace-relative path under `.intent/attachments/`. */
  path: string;
  /** Whether the file is still on disk at read time (the registry row survives an out-of-band delete). */
  exists: boolean;
}

/**
 * `file.getAttachmentInfo` selector: the registry UUID, or (keyed placement) the
 * `{ workspaceId, idempotencyKey }` pair of a keyed placement.
 */
export type AttachmentInfoSelector =
  | string
  | { workspaceId: string; idempotencyKey: string; attachmentId?: never }
  | { workspaceId: string; attachmentId: string; idempotencyKey?: never };

/**
 * Look up an attachment-registry row via the daemon
 * (`file.getAttachmentInfo`, PROTOCOL §5.9) by UUID, or by the
 * `{ workspaceId, idempotencyKey }` a placement was keyed with — the
 * lost-reply recovery arm. Unknown ids/keys reject with -32602; errors
 * propagate to the caller.
 */
export function createAttachmentInfoRead(request: BackendTransport['request']) {
  return async function getAttachmentInfo(
    selector: AttachmentInfoSelector,
  ): Promise<AttachmentInfo> {
    const params =
      typeof selector === 'string'
        ? { attachmentId: selector }
        : selector.attachmentId !== undefined
          ? { workspaceId: selector.workspaceId, attachmentId: selector.attachmentId }
          : { workspaceId: selector.workspaceId, idempotencyKey: selector.idempotencyKey };
    return await request<AttachmentInfo>('file.getAttachmentInfo', params);
  };
}
