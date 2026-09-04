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
  placeAttachmentViaTransport,
} from '$lib/components/chat/input/attachment-placement';
import {
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
 * are skipped via their `attachmentId`).
 */
export async function redeemStagedAttachments(
  workspaceId: string,
  items: ContextItem[],
  place: typeof placeAttachmentViaTransport = placeAttachmentViaTransport,
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
    try {
      const result: PlaceAttachmentResult = await place(workspaceId, item.label, {
        sourcePath: item.sourcePath,
        mimeType: item.attachmentMimeType,
      });
      const placed: ContextItem = {
        ...item,
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
        ...item,
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
  /** Stable client message id used to reconcile an uncertain send after restart. */
  messageId?: string;
  content: string;
  imageBlocks: ImageBlock[];
  contextReferences: unknown[];
}

export interface SendHeldFirstMessageResult {
  /** False when the daemon rejected the send or the request failed. */
  sent: boolean;
  /** The stable id supplied on the wire, when one was supplied. */
  messageId?: string;
  /** True when a transport failure means the daemon may have accepted the send. */
  deliveryUnknown?: boolean;
  /**
   * Human-readable failure reason for the banner (daemon `error` string /
   * structured `data.detail` / non-generic message), when available.
   */
  errorDetail?: string;
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
    try {
      imageBlocks = await toReferences(pending.workspaceId, imageBlocks as WireImageBlock[]);
    } catch (error) {
      return { sent: false, errorDetail: extractPlacementErrorDetail(error) };
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
        messageId: pending.messageId,
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
      return { sent: false, errorDetail: error.length > 0 ? error : undefined };
    }
    return { sent: true, ...(pending.messageId ? { messageId: pending.messageId } : {}) };
  } catch (error) {
    const deliveryUnknown =
      !error ||
      typeof error !== 'object' ||
      typeof (error as { rpcCode?: unknown }).rpcCode !== 'number';
    return {
      sent: false,
      errorDetail: extractPlacementErrorDetail(error),
      ...(deliveryUnknown ? { deliveryUnknown: true } : {}),
    };
  }
}
