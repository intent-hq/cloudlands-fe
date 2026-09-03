/**
 * Serialize/deserialize chat input attachments for draft persistence
 * (PROTOCOL §5.16 `drafts.set`/`drafts.get` optional `attachments` array).
 *
 * The daemon stores attachments verbatim as an opaque JSON array, so the FE
 * owns the shape: a projection of image, content-backed selection,
 * placed-attachment, and staged
 * (path-only, pre-placement) `ContextItem`s with the non-serializable `File`
 * handle dropped. Image thumbnails rehydrate from `imageData`/`imageMimeType`;
 * placed attachments persist only the registry `attachmentId` + metadata;
 * staged items persist only their `sourcePath` + metadata (no bytes ever —
 * placement copies from the path at redemption, and a path gone stale by
 * then fails the placement into a visible failed pill).
 */
import type { DraftAttachment } from '$lib/client/app-client';
import type { ContextItem } from './input/context-api';

/**
 * Project attachment context items into wire-safe draft attachments. Items
 * carrying `imageData` + `imageMimeType` (images), an `attachmentId` (placed
 * attachments), or a `sourcePath` (staged path-only items awaiting placement)
 * are persisted; the `File` handle and other non-serializable fields are
 * dropped. A chat-input item whose placement was still in flight or failed
 * persists `placementStatus: 'failed'` (an in-flight placement cannot survive
 * a reload) so the restore renders a blocking, retryable failed pill instead
 * of silently dropping the attachment from the send. Pre-workspace staged
 * items (modal/onboarding) carry no `placementStatus` and round-trip
 * status-free — they are placed at workspace.create redemption. Dropped
 * folders (type 'folder', path-only, never placed) persist their absolute
 * host `path` + label so an onboarding reload doesn't lose the pill.
 */
export function serializeDraftAttachments(items: ContextItem[]): DraftAttachment[] {
  return items
    .filter(
      (item) =>
        (item.imageData && item.imageMimeType) ||
        item.attachmentId ||
        item.sourcePath ||
        (item.type === 'folder' && item.path) ||
        (item.type === 'selection' && item.content),
    )
    .map((item) => ({
      id: item.id,
      type: item.type,
      label: item.label,
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.content !== undefined ? { content: item.content } : {}),
      ...(item.path !== undefined ? { path: item.path } : {}),
      ...(item.imageData !== undefined ? { imageData: item.imageData } : {}),
      ...(item.imageMimeType !== undefined ? { imageMimeType: item.imageMimeType } : {}),
      ...(item.attachmentId !== undefined ? { attachmentId: item.attachmentId } : {}),
      ...(item.attachmentMimeType !== undefined
        ? { attachmentMimeType: item.attachmentMimeType }
        : {}),
      ...(item.attachmentSize !== undefined ? { attachmentSize: item.attachmentSize } : {}),
      ...(item.sourcePath !== undefined && !item.attachmentId
        ? { sourcePath: item.sourcePath }
        : {}),
      ...((item.placementStatus === 'placing' || item.placementStatus === 'failed') &&
      !item.attachmentId
        ? { placementStatus: 'failed' as const }
        : {}),
    }));
}

/**
 * Rehydrate context items from a draft's persisted attachments. No `File`
 * handle exists after a reload; `SimpleRichInput` renders image thumbnails
 * from `imageData`/`imageMimeType`, placed-attachment pills from the registry
 * metadata, and staged path-only items rehydrate with their `sourcePath` for
 * placement at redemption (a stale path fails there, into a failed pill).
 * A persisted `placementStatus: 'failed'` restores as a failed pill: it
 * blocks send and its retry re-attempts placement from the `sourcePath` —
 * never a silent drop. Folder items (type 'folder') rehydrate path-only —
 * they are never placed; the path rides as a context reference at send.
 */
export function deserializeDraftAttachments(attachments: DraftAttachment[]): ContextItem[] {
  return attachments.map((a) => ({
    id: a.id,
    type: (a.type as ContextItem['type']) || 'file',
    label: a.label,
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(a.content !== undefined ? { content: a.content } : {}),
    ...(a.path !== undefined ? { path: a.path } : {}),
    ...(a.imageData !== undefined ? { imageData: a.imageData } : {}),
    ...(a.imageMimeType !== undefined ? { imageMimeType: a.imageMimeType } : {}),
    ...(a.attachmentId !== undefined ? { attachmentId: a.attachmentId } : {}),
    ...(a.attachmentMimeType !== undefined ? { attachmentMimeType: a.attachmentMimeType } : {}),
    ...(a.attachmentSize !== undefined ? { attachmentSize: a.attachmentSize } : {}),
    ...(a.sourcePath !== undefined ? { sourcePath: a.sourcePath } : {}),
    ...(a.placementStatus === 'failed' && a.attachmentId === undefined
      ? { placementStatus: 'failed' as const }
      : {}),
  }));
}
