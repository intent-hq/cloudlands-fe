/**
 * Pre-workspace attachment staging for the new-workspace modal and
 * onboarding: non-image files are captured as path-only context items
 * (`sourcePath`, no bytes) because `file.placeAttachment` (PROTOCOL §5.9)
 * needs a workspace that does not exist yet. At `workspace.create`
 * redemption every staged item is placed from its sourcePath (transport-
 * aware: the data arm carries the bytes when the backend is remote);
 * failures mark the item `failed` (visible pill with retry) and block the
 * first-message send — never a silent drop.
 */
import type { FileBlock, ImageBlock } from '$lib/client/app-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ContextItem, PlaceAttachmentResult } from '$lib/components/chat/input/context-api';
import {
  extractPlacementErrorDetail,
  mintPlacementIdempotencyKey,
  placeAttachmentViaTransport,
} from '$lib/components/chat/input/attachment-placement';
import {
  imageRetryBlocks,
  toImageReferenceBlocks,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';

/** A staged (not-yet-placed) non-image file item awaiting redemption. */
function isStagedFileItem(item: ContextItem): boolean {
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
function fileBlockFromItem(item: ContextItem): FileBlock | null {
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
 * are skipped via their `attachmentId`). Each item's placement
 * `idempotencyKey` (v9.13) is minted on first placement and kept on the
 * item — failed included — so the retry replays a placement whose reply was
 * lost instead of placing a duplicate.
 */
export async function redeemStagedAttachments(
  workspaceId: string,
  items: ContextItem[],
  place: typeof placeAttachmentViaTransport = placeAttachmentViaTransport,
  mintKey: typeof mintPlacementIdempotencyKey = mintPlacementIdempotencyKey,
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
      // placement is impossible without a source to read from.
      failedCount++;
      out.push({ ...item, placementStatus: 'failed' });
      continue;
    }
    const idempotencyKey = item.placementIdempotencyKey ?? mintKey();
    const keyedItem: ContextItem =
      idempotencyKey !== undefined ? { ...item, placementIdempotencyKey: idempotencyKey } : item;
    try {
      const result: PlaceAttachmentResult = await place(workspaceId, item.label, {
        sourcePath: item.sourcePath,
        mimeType: item.attachmentMimeType,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      });
      const placed: ContextItem = {
        ...keyedItem,
        placementStatus: 'placed',
        placementError: undefined,
        label: result.fileName,
        path: result.path,
        attachmentId: result.attachmentId,
        attachmentMimeType: result.mimeType ?? item.attachmentMimeType,
        attachmentSize: result.size,
      };
      out.push(placed);
      const block = fileBlockFromItem(placed);
      if (block) fileBlocks.push(block);
    } catch (error) {
      // Stale/missing source path or daemon error — failed pill (with the
      // daemon's failure detail when available), blocks send.
      failedCount++;
      out.push({
        ...keyedItem,
        placementStatus: 'failed',
        placementError: extractPlacementErrorDetail(error),
      });
    }
  }

  return { items: out, fileBlocks, failedCount };
}

/** The first message held back from `workspace.create` while files staged. */
export interface HeldFirstMessage {
  workspaceId: string;
  agentId?: string;
  content: string;
  imageBlocks: ImageBlock[];
  contextReferences: unknown[];
}

export interface SendHeldFirstMessageResult {
  /** False when the daemon rejected the send or the request failed. */
  sent: boolean;
  /**
   * Human-readable failure reason for the banner (daemon `error` string /
   * structured `data.detail` / non-generic message), when available.
   */
  errorDetail?: string;
  /**
   * Set when the send failed after image placement began: the blocks the
   * resumed send must pass back in place of the originals — references for
   * the images that did place (all of them when placement succeeded and the
   * send itself failed), inline blocks tagged with their placement identity
   * for the rest — so the retry replays committed placements instead of
   * duplicating them.
   */
  imageBlocks?: WireImageBlock[];
}

/**
 * Image blocks for the held first message, built from the composer's image
 * items: a reference for an item whose placement a previous failed send
 * already completed, else the inline block carrying whatever placement
 * identity that send retained on it (see `retainImagePlacementIdentity`).
 */
export function heldImageBlocks(items: ContextItem[]): WireImageBlock[] {
  return items
    .filter((item) => item.imageData && item.imageMimeType)
    .map((item) =>
      item.placementAttachmentId !== undefined
        ? {
            type: 'image' as const,
            attachmentId: item.placementAttachmentId,
            mimeType: item.imageMimeType as string,
          }
        : {
            type: 'image' as const,
            data: item.imageData as string,
            mimeType: item.imageMimeType as string,
            ...(item.placementIdempotencyKey !== undefined
              ? { placementIdempotencyKey: item.placementIdempotencyKey }
              : {}),
            ...(item.placementFileName !== undefined
              ? { placementFileName: item.placementFileName }
              : {}),
          },
    );
}

/**
 * Carry a failed held-first-message send's `imageBlocks` (its retry blocks)
 * back onto the composer's image items — positionally, over the items
 * `heldImageBlocks` built them from — so the next `heldImageBlocks` pass
 * resends the same placement identity: a reference block's `attachmentId`
 * for an image that placed, the key + file name for one that did not.
 * Returns the items unchanged when there is nothing to retain.
 */
export function retainImagePlacementIdentity(
  items: ContextItem[],
  retryBlocks: WireImageBlock[] | undefined,
): ContextItem[] {
  if (!retryBlocks) return items;
  let index = 0;
  return items.map((item) => {
    if (!(item.imageData && item.imageMimeType)) return item;
    const block = retryBlocks[index++];
    if (!block) return item;
    if ('attachmentId' in block) {
      return { ...item, placementAttachmentId: block.attachmentId };
    }
    return {
      ...item,
      ...(block.placementIdempotencyKey !== undefined
        ? { placementIdempotencyKey: block.placementIdempotencyKey }
        : {}),
      ...(block.placementFileName !== undefined
        ? { placementFileName: block.placementFileName }
        : {}),
    };
  });
}

/**
 * Deliver the held-back first message (`agent.sendMessage`, PROTOCOL §5.5)
 * after staged-attachment redemption succeeded.
 *
 * The held message lives in Svelte `$state` between create and send, so
 * `pending` and everything nested in it (imageBlocks, contextReferences)
 * arrive as deep-reactive Proxies. Electron's structured clone
 * (`ipcRenderer.invoke`) rejects Proxies outright ("An object could not be
 * cloned"), which made every send with staged attachments fail before it
 * ever reached the daemon (monorepo#2576) — so the wire params are rebuilt
 * as plain JSON here, never passed through from reactive state.
 *
 * Failures resolve as `{ sent: false, errorDetail? }` (never throw): the
 * daemon's structured `{ success: false, error }` result and thrown
 * transport/daemon errors both surface their reason for the banner,
 * mirroring the placement-failure detail pattern (#1287).
 */
export async function sendHeldFirstMessage(
  pending: HeldFirstMessage,
  fileBlocks: FileBlock[],
  request: typeof backendRequest = backendRequest,
  toReferences: typeof toImageReferenceBlocks = toImageReferenceBlocks,
): Promise<SendHeldFirstMessageResult> {
  const hasContent = pending.content.length > 0;
  const hasBlocks =
    pending.imageBlocks.length > 0 || fileBlocks.length > 0 || pending.contextReferences.length > 0;
  if (!pending.agentId || (!hasContent && !hasBlocks)) return { sent: true };

  // Pre-upload inline images into the (now-existing) workspace's attachment
  // registry and swap the wire blocks to references (monorepo#3338) — one
  // placement request per image, chunked when large, so the first-message
  // frame stays constant-size. A placement failure resolves
  // `{ sent: false, errorDetail }` like any other send failure: the held
  // message stays pending and the create button resumes the flow.
  let imageBlocks: ImageBlock[] = pending.imageBlocks;
  if (imageBlocks.length > 0) {
    const attempted = imageBlocks as WireImageBlock[];
    try {
      imageBlocks = await toReferences(pending.workspaceId, attempted);
    } catch (error) {
      return {
        sent: false,
        errorDetail: extractPlacementErrorDetail(error),
        imageBlocks: imageRetryBlocks(error, attempted),
      };
    }
  }

  try {
    // JSON round-trip strips reactive Proxies (and anything else structured
    // clone would reject) — the payload is plain JSON data by construction.
    // Inside the try so a non-serializable value (circular ref, BigInt) in a
    // future contextReference shape resolves `{ sent: false }` per contract
    // instead of rejecting.
    const params = JSON.parse(
      JSON.stringify({
        agentId: pending.agentId,
        workspaceId: pending.workspaceId,
        content: pending.content,
        imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
        fileBlocks: fileBlocks.length > 0 ? fileBlocks : undefined,
        contextReferences:
          pending.contextReferences.length > 0 ? pending.contextReferences : undefined,
      }),
    );

    // `backendRequest` resolves normal daemon send failures as
    // `{ success: false, error }` rather than rejecting — check it, or a
    // failed send would silently drop the held message and its retry path.
    const result = await request<{ success?: boolean; error?: string }>(
      'agent.sendMessage',
      params,
    );
    if (result?.success === false) {
      const error = typeof result.error === 'string' ? result.error.trim() : '';
      return {
        sent: false,
        errorDetail: error.length > 0 ? error : undefined,
        ...placedImageBlocks(imageBlocks),
      };
    }
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      errorDetail: extractPlacementErrorDetail(error),
      ...placedImageBlocks(imageBlocks),
    };
  }
}

/**
 * The placed image references a send that failed AFTER placement hands back
 * as its retry blocks, so the resumed send passes them through instead of
 * placing every image a second time. Nothing when the message had no images.
 */
function placedImageBlocks(
  imageBlocks: ImageBlock[],
): Pick<SendHeldFirstMessageResult, 'imageBlocks'> {
  return imageBlocks.length > 0 ? { imageBlocks: imageBlocks as WireImageBlock[] } : {};
}
