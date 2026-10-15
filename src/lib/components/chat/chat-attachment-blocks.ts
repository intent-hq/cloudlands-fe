import type { ContextItem } from './input/context-item';

/** Canonical image/reference/file projection shared by source and connected composers. */
export function extractAttachmentBlocks(items: ContextItem[]) {
  const imageBlocks = items
    .filter(
      (item) =>
        !('repositoryFile' in item) && (item.imageData || item.attachmentId) && item.imageMimeType,
    )
    .map((item) =>
      item.attachmentId
        ? {
            type: 'image' as const,
            attachmentId: item.attachmentId,
            // The neutral 'image' marker (reference restored without a
            // persisted mime) stays off the wire — mimeType is optional
            // on the reference arm.
            ...(item.imageMimeType!.includes('/') ? { mimeType: item.imageMimeType! } : {}),
          }
        : {
            type: 'image' as const,
            data: item.imageData!,
            mimeType: item.imageMimeType!,
          },
    );
  const fileBlocks = items
    .filter((item) => !('repositoryFile' in item) && item.attachmentId && !item.imageMimeType)
    .map((item) => ({
      type: 'file' as const,
      attachmentId: item.attachmentId!,
      fileName: item.label,
      ...(item.attachmentMimeType ? { mimeType: item.attachmentMimeType } : {}),
      ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
    }));
  return { imageBlocks, fileBlocks };
}

/** Compare submitted content identity, independent of optional display metadata. */
export function matchesAttachmentBlocks(
  items: ContextItem[],
  attempt:
    | {
        imageBlocks?: Array<{ attachmentId?: string; data?: string; mimeType?: string }>;
        fileBlocks?: Array<{ attachmentId?: string }>;
      }
    | undefined,
): boolean {
  const current = extractAttachmentBlocks(items);
  const images = attempt?.imageBlocks ?? [],
    files = attempt?.fileBlocks ?? [];
  return (
    current.imageBlocks.length === images.length &&
    current.fileBlocks.length === files.length &&
    current.imageBlocks.every((block, index) =>
      'attachmentId' in block
        ? block.attachmentId === images[index].attachmentId
        : !images[index].attachmentId &&
          block.data === images[index].data &&
          block.mimeType === images[index].mimeType,
    ) &&
    current.fileBlocks.every((block, index) => block.attachmentId === files[index].attachmentId)
  );
}
