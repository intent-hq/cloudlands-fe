/**
 * Serialize/deserialize chat input image attachments for draft persistence
 * (PROTOCOL §5.16 `drafts.set`/`drafts.get` optional `attachments` array).
 *
 * The daemon stores attachments verbatim as an opaque JSON array, so the FE
 * owns the shape: a projection of image `ContextItem`s with the
 * non-serializable `File` handle dropped. Thumbnails rehydrate from
 * `imageData`/`imageMimeType` alone.
 */
import type { DraftAttachment } from '$lib/client/app-client';
import type { ContextItem } from './input/context-api';

/**
 * Project image context items into wire-safe draft attachments. Only items
 * carrying `imageData` + `imageMimeType` are persisted; the `File` handle and
 * other non-serializable fields are dropped.
 */
export function serializeDraftAttachments(items: ContextItem[]): DraftAttachment[] {
  return items
    .filter((item) => item.imageData && item.imageMimeType)
    .map((item) => ({
      id: item.id,
      type: item.type,
      label: item.label,
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.path !== undefined ? { path: item.path } : {}),
      imageData: item.imageData!,
      imageMimeType: item.imageMimeType!,
    }));
}

/**
 * Rehydrate context items from a draft's persisted attachments. No `File`
 * handle exists after a reload; `SimpleRichInput` renders thumbnails from
 * `imageData`/`imageMimeType` directly.
 */
export function deserializeDraftAttachments(attachments: DraftAttachment[]): ContextItem[] {
  return attachments.map((a) => ({
    id: a.id,
    type: (a.type as ContextItem['type']) || 'file',
    label: a.label,
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(a.path !== undefined ? { path: a.path } : {}),
    ...(a.imageData !== undefined ? { imageData: a.imageData } : {}),
    ...(a.imageMimeType !== undefined ? { imageMimeType: a.imageMimeType } : {}),
  }));
}
