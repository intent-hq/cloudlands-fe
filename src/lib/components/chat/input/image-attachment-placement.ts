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
import {
  abortAttachmentUpload,
  beginAttachmentUpload,
  commitAttachmentUpload,
  getAttachmentInfo,
  placeAttachment,
  sendAttachmentUploadChunk,
  type PlaceAttachmentResult,
} from './context-api';
import {
  extractPlacementErrorDetail,
  isAlreadyCommittedError,
  MAX_REMOTE_ATTACHMENT_BYTES,
  mintPlacementIdempotencyKey,
  recoverPlacementByKey,
  shouldRecoverPlacement,
  UPLOAD_CHUNK_BYTES,
} from './attachment-placement';

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

/** Decode raw base64 (no data-URL prefix) into bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode bytes to base64 without blowing the argument-spread stack cap. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Decoded byte length of a raw base64 string, without decoding it. */
export function base64DecodedBytes(b64: string): number {
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** SHA-256 (lowercase hex) of the decoded payload via WebCrypto. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Placement seam injected by tests. */
export interface ImagePlacementApi {
  placeAttachment: typeof placeAttachment;
  beginAttachmentUpload: typeof beginAttachmentUpload;
  sendAttachmentUploadChunk: typeof sendAttachmentUploadChunk;
  commitAttachmentUpload: typeof commitAttachmentUpload;
  abortAttachmentUpload: typeof abortAttachmentUpload;
  /** Key arm of `file.getAttachmentInfo` — lost-reply recovery (v9.13). */
  getAttachmentInfo: typeof getAttachmentInfo;
  /**
   * Version-gated key resolution: reuses the retained key it is given,
   * mints one when there is none; `undefined` against pre-9.13 daemons.
   */
  mintIdempotencyKey: typeof mintPlacementIdempotencyKey;
}

const defaultApi: ImagePlacementApi = {
  placeAttachment,
  beginAttachmentUpload,
  sendAttachmentUploadChunk,
  commitAttachmentUpload,
  abortAttachmentUpload,
  getAttachmentInfo,
  mintIdempotencyKey: mintPlacementIdempotencyKey,
};

/**
 * Place one in-memory base64 image into the workspace's attachment registry.
 * Single-shot `data` arm up to 25 MB decoded (stays well under the 40 MiB
 * frame cap after base64 inflation), staged chunked upload above that —
 * identical to the sourcePath-based transport placement, minus the disk
 * reads. With `source.idempotencyKey` (v9.13) a lost placement/commit reply
 * is recovered through the key lookup instead of failing. Errors propagate
 * to the caller.
 */
export async function placeImageAttachment(
  workspaceId: string,
  fileName: string,
  source: { data: string; mimeType?: string; idempotencyKey?: string },
  api: ImagePlacementApi = defaultApi,
): Promise<PlaceAttachmentResult> {
  const { idempotencyKey } = source;
  const keyed = idempotencyKey !== undefined ? { idempotencyKey } : {};
  const recover = async (error: unknown): Promise<PlaceAttachmentResult | undefined> =>
    shouldRecoverPlacement(error, idempotencyKey)
      ? recoverPlacementByKey(workspaceId, idempotencyKey, api.getAttachmentInfo)
      : undefined;

  if (base64DecodedBytes(source.data) <= MAX_REMOTE_ATTACHMENT_BYTES) {
    try {
      return await api.placeAttachment(workspaceId, fileName, {
        data: source.data,
        mimeType: source.mimeType,
        ...keyed,
      });
    } catch (error) {
      const recovered = await recover(error);
      if (recovered) return recovered;
      throw error;
    }
  }
  const bytes = base64ToBytes(source.data);
  const sha256 = await sha256Hex(bytes);
  let uploadId: string;
  let maxChunkBytes: number;
  try {
    ({ uploadId, maxChunkBytes } = await api.beginAttachmentUpload(
      workspaceId,
      fileName,
      bytes.byteLength,
      sha256,
      { mimeType: source.mimeType, ...keyed },
    ));
  } catch (error) {
    // Begin refusing a key that is "already committed" means an earlier
    // commit landed but its reply was lost — resolve it through the lookup.
    if (idempotencyKey !== undefined && isAlreadyCommittedError(error)) {
      const recovered = await recoverPlacementByKey(
        workspaceId,
        idempotencyKey,
        api.getAttachmentInfo,
      );
      if (recovered) return recovered;
    }
    throw error;
  }
  const chunkBytes = Math.min(UPLOAD_CHUNK_BYTES, maxChunkBytes);
  const totalChunks = Math.ceil(bytes.byteLength / chunkBytes);
  let committing = false;
  try {
    for (let seq = 0; seq < totalChunks; seq++) {
      const slice = bytes.subarray(seq * chunkBytes, (seq + 1) * chunkBytes);
      await api.sendAttachmentUploadChunk(uploadId, seq, bytesToBase64(slice));
    }
    committing = true;
    return await api.commitAttachmentUpload(uploadId);
  } catch (error) {
    // Only a lost commit reply can hide a placed file behind the key.
    const recovered = committing ? await recover(error) : undefined;
    if (recovered) return recovered;
    await api.abortAttachmentUpload(uploadId).catch(() => {
      // Best-effort: the daemon sweeps orphaned sessions on the next begin.
    });
    throw error;
  }
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
 * edit/regenerate never re-upload. Each placement is keyed (v9.13) — with
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
  api: ImagePlacementApi = defaultApi,
): Promise<ImageReferenceBlock[]> {
  const out: ImageReferenceBlock[] = [];
  const retryBlocks: WireImageBlock[] = [];
  const failures: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
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
      );
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
  return out;
}
