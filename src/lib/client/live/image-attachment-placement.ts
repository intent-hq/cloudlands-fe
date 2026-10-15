/**
 * In-memory image attachment placement (monorepo#3338). Chat images live as
 * base64 in composer state (pasted/dropped, no reliable host path), so before
 * `agent.sendMessage` / the held first message they are placed into the
 * workspace's attachment registry — single-shot `file.placeAttachment` up to
 * 25 MB decoded, the staged chunked `file.attachmentUpload.*` session above
 * that — and the wire carries `{ type: "image", attachmentId, mimeType }`
 * reference blocks instead of inline bytes (PROTOCOL §5.5). One request per
 * image; message frames stay constant-size.
 */
import { m } from '$shared/paraglide/messages.js';
import type {
  AttachmentPlacementApi,
  AttachmentPlacementOptions,
  PlaceAttachmentResult,
} from '$lib/client/live/attachment-upload-types';
import {
  assertPlacementCurrent,
  base64AttachmentSource,
  placeAttachmentBytes,
  extractPlacementErrorDetail,
} from '$lib/client/live/attachment-upload';
/**
 * Inline image block (bytes on the wire — the legacy arm). The optional
 * `placement*` fields are client-side only: `toImageReferenceBlocks` tags a
 * block that failed to place with the `idempotencyKey` and requested file
 * name of its attempt, so the retry (which resends these blocks) replays
 * the same placement instead of minting a new identity. They never reach
 * the wire — a tagged block is always converted to a reference first.
 */
interface InlineImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
  placementIdempotencyKey?: string;
  placementFileName?: string;
}

/** Attachment-registry reference image block (PROTOCOL §5.5, monorepo#3338). */
export interface ImageReferenceBlock {
  type: 'image';
  attachmentId: string;
  mimeType?: string;
}

/** Either arm of an image block as accepted by the daemon. */
export type WireImageBlock = InlineImageBlock | ImageReferenceBlock;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** The same injected placement seam is shared by source and React send owners. */
export interface ImagePlacementApi extends AttachmentPlacementApi {
  mintIdempotencyKey(existing?: string): string | undefined;
}

export async function placeImageAttachment(
  workspaceId: string,
  fileName: string,
  source: { data: string; mimeType?: string; idempotencyKey?: string },
  api: ImagePlacementApi,
  options: AttachmentPlacementOptions = {},
): Promise<PlaceAttachmentResult> {
  return placeAttachmentBytes(api, workspaceId, fileName, base64AttachmentSource(source.data), {
    ...options,
    mimeType: source.mimeType,
    idempotencyKey: source.idempotencyKey,
  });
}

/** Generated file name for a pasted/dropped image with no original name. */
function imageAttachmentFileName(mimeType: string | undefined, index: number): string {
  const ext = (mimeType && MIME_EXTENSIONS[mimeType.toLowerCase()]) || 'png';
  return `image-${Date.now()}-${index + 1}.${ext}`;
}

/**
 * `toImageReferenceBlocks` failure. `retryBlocks` is what the user-visible
 * retry must resend in place of the original blocks: a reference for every
 * image that did place (or already was one) and, for each that failed, the
 * inline block tagged with the `idempotencyKey` + file name of the attempt —
 * so an image whose placement committed behind a lost reply is replayed by
 * the daemon on retry, never placed a second time.
 */
export class ImagePlacementError extends Error {
  readonly retryBlocks: WireImageBlock[];

  constructor(message: string, retryBlocks: WireImageBlock[]) {
    super(message);
    this.name = 'ImagePlacementError';
    this.retryBlocks = retryBlocks;
  }
}

/**
 * The image blocks a retry should resend after `toImageReferenceBlocks`
 * rejected with `error`: its `retryBlocks` for a placement failure, else
 * `fallback` (the blocks of the failed attempt) unchanged.
 */
export function imageRetryBlocks(error: unknown, fallback: WireImageBlock[]): WireImageBlock[] {
  return error instanceof ImagePlacementError ? error.retryBlocks : fallback;
}

/**
 * Convert inline image blocks into attachment-reference blocks by placing
 * each one (one placement request per image, chunked when large). Blocks
 * already carrying an `attachmentId` pass through untouched, so retries and
 * edit/regenerate never re-upload. Each placement is keyed (`idempotencyKey`) — with
 * the block's retained `placementIdempotencyKey` when a previous attempt
 * tagged it, else a fresh key — so a lost reply is recovered instead of
 * failing the send and a retry replays rather than duplicates. FAIL-CLOSED:
 * any placement failure rejects with an `ImagePlacementError` naming the
 * failed image(s) (daemon detail included when available) and carrying the
 * blocks the retry must resend — images are never silently dropped or
 * partially sent.
 */
export async function toImageReferenceBlocks(
  workspaceId: string,
  blocks: WireImageBlock[],
  api: ImagePlacementApi,
  current: () => boolean = () => true,
): Promise<ImageReferenceBlock[]> {
  assertPlacementCurrent(current);
  const out: ImageReferenceBlock[] = [];
  const retryBlocks: WireImageBlock[] = [];
  const failures: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    assertPlacementCurrent(current);
    const block = blocks[i];
    if ('attachmentId' in block && block.attachmentId) {
      const reference: ImageReferenceBlock = {
        type: 'image',
        attachmentId: block.attachmentId,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
      };
      out.push(reference);
      retryBlocks.push(reference);
      continue;
    }
    const inline = block as InlineImageBlock;
    const fileName = inline.placementFileName ?? imageAttachmentFileName(inline.mimeType, i);
    const idempotencyKey = api.mintIdempotencyKey(inline.placementIdempotencyKey);
    try {
      const placed = await placeImageAttachment(
        workspaceId,
        fileName,
        {
          data: inline.data,
          mimeType: inline.mimeType,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        },
        api,
        { current },
      );
      assertPlacementCurrent(current);
      const reference: ImageReferenceBlock = {
        type: 'image',
        attachmentId: placed.attachmentId,
        ...((placed.mimeType ?? inline.mimeType)
          ? { mimeType: placed.mimeType ?? inline.mimeType }
          : {}),
      };
      out.push(reference);
      retryBlocks.push(reference);
    } catch (error) {
      assertPlacementCurrent(current);
      const detail = extractPlacementErrorDetail(error);
      failures.push(detail ? `${fileName} (${detail})` : fileName);
      retryBlocks.push(
        idempotencyKey !== undefined
          ? { ...inline, placementIdempotencyKey: idempotencyKey, placementFileName: fileName }
          : inline,
      );
    }
  }
  if (failures.length > 0) {
    throw new ImagePlacementError(
      m.chat_imagePlacement_failed_error({ names: failures.join(', ') }),
      retryBlocks,
    );
  }
  assertPlacementCurrent(current);
  return out;
}
