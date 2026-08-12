/**
 * Pre-workspace attachment staging for the new-workspace modal and
 * onboarding: non-image files are captured as path-only context items
 * (`sourcePath`, no bytes) because `file.placeAttachment` (PROTOCOL §5.9)
 * needs a workspace that does not exist yet. At `workspace.create`
 * redemption every staged item is placed from its sourcePath; failures mark
 * the item `failed` (visible pill with retry) and block the first-message
 * send — never a silent drop.
 */
import type { FileBlock } from '$lib/client/app-client';
import {
  placeAttachment,
  type ContextItem,
  type PlaceAttachmentResult,
} from '$lib/components/chat/input/context-api';

/** A staged (not-yet-placed) non-image file item awaiting redemption. */
export function isStagedFileItem(item: ContextItem): boolean {
  return (
    item.type === 'file' &&
    !item.attachmentId &&
    (item.sourcePath !== undefined || item.placementStatus === 'failed')
  );
}

/** True when the item set contains staged files that need placement at create time. */
export function hasStagedFileItems(items: ContextItem[]): boolean {
  return items.some(isStagedFileItem);
}

/** Build an attachment-reference file block from a placed item (PROTOCOL §5.5). */
export function fileBlockFromItem(item: ContextItem): FileBlock | null {
  if (!item.attachmentId) return null;
  return {
    type: 'file',
    attachmentId: item.attachmentId,
    fileName: item.label,
    ...(item.attachmentMimeType !== undefined ? { mimeType: item.attachmentMimeType } : {}),
    ...(item.attachmentSize !== undefined ? { size: item.attachmentSize } : {}),
  };
}

export interface RedeemResult {
  /** The full item list with staged items updated in place (placed or failed). */
  items: ContextItem[];
  /** Attachment-reference blocks for every successfully placed item. */
  fileBlocks: FileBlock[];
  /** Number of items that failed placement (stale path, no path, daemon error). */
  failedCount: number;
}

/**
 * Place every staged file item into the newly created workspace via its
 * captured sourcePath. Sequential (attachment counts are small) and
 * fail-soft per item: a failure marks that item `failed` and counts it —
 * the caller blocks the first-message send while `failedCount > 0`, keeps
 * the pills visible for retry/remove, and re-calls on retry (placed items
 * are skipped via their `attachmentId`).
 */
export async function redeemStagedAttachments(
  workspaceId: string,
  items: ContextItem[],
  place: typeof placeAttachment = placeAttachment,
): Promise<RedeemResult> {
  const out: ContextItem[] = [];
  const fileBlocks: FileBlock[] = [];
  let failedCount = 0;

  for (const item of items) {
    if (!isStagedFileItem(item)) {
      out.push(item);
      const block = fileBlockFromItem(item);
      if (block) fileBlocks.push(block);
      continue;
    }
    if (!item.sourcePath) {
      // No captured host path (e.g. clipboard bytes with no backing file) —
      // placement is impossible; base64 is not a fallback.
      failedCount++;
      out.push({ ...item, placementStatus: 'failed' });
      continue;
    }
    try {
      const result: PlaceAttachmentResult = await place(workspaceId, item.label, {
        sourcePath: item.sourcePath,
        mimeType: item.attachmentMimeType,
      });
      const placed: ContextItem = {
        ...item,
        placementStatus: 'placed',
        label: result.fileName,
        path: result.path,
        attachmentId: result.attachmentId,
        attachmentMimeType: result.mimeType ?? item.attachmentMimeType,
        attachmentSize: result.size,
      };
      out.push(placed);
      const block = fileBlockFromItem(placed);
      if (block) fileBlocks.push(block);
    } catch {
      // Stale/missing source path or daemon error — failed pill, blocks send.
      failedCount++;
      out.push({ ...item, placementStatus: 'failed' });
    }
  }

  return { items: out, fileBlocks, failedCount };
}
