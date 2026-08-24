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
  placeAttachment,
  sendAttachmentUploadChunk,
  type PlaceAttachmentResult,
} from './context-api';
import {
  extractPlacementErrorDetail,
  MAX_REMOTE_ATTACHMENT_BYTES,
  UPLOAD_CHUNK_BYTES,
} from './attachment-placement';

/** Inline image block (bytes on the wire — the legacy arm). */
export interface InlineImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
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
}

const defaultApi: ImagePlacementApi = {
  placeAttachment,
  beginAttachmentUpload,
  sendAttachmentUploadChunk,
  commitAttachmentUpload,
  abortAttachmentUpload,
};

/**
 * Place one in-memory base64 image into the workspace's attachment registry.
 * Single-shot `data` arm up to 25 MB decoded (stays well under the 40 MiB
 * frame cap after base64 inflation), staged chunked upload above that —
 * identical to the sourcePath-based transport placement, minus the disk
 * reads. Errors propagate to the caller.
 */
export async function placeImageAttachment(
  workspaceId: string,
  fileName: string,
  source: { data: string; mimeType?: string },
  api: ImagePlacementApi = defaultApi,
): Promise<PlaceAttachmentResult> {
  if (base64DecodedBytes(source.data) <= MAX_REMOTE_ATTACHMENT_BYTES) {
    return api.placeAttachment(workspaceId, fileName, {
      data: source.data,
      mimeType: source.mimeType,
    });
  }
  const bytes = base64ToBytes(source.data);
  const sha256 = await sha256Hex(bytes);
  const { uploadId, maxChunkBytes } = await api.beginAttachmentUpload(
    workspaceId,
    fileName,
    bytes.byteLength,
    sha256,
    source.mimeType,
  );
  const chunkBytes = Math.min(UPLOAD_CHUNK_BYTES, maxChunkBytes);
  const totalChunks = Math.ceil(bytes.byteLength / chunkBytes);
  try {
    for (let seq = 0; seq < totalChunks; seq++) {
      const slice = bytes.subarray(seq * chunkBytes, (seq + 1) * chunkBytes);
      await api.sendAttachmentUploadChunk(uploadId, seq, bytesToBase64(slice));
    }
    return await api.commitAttachmentUpload(uploadId);
  } catch (error) {
    await api.abortAttachmentUpload(uploadId).catch(() => {
      // Best-effort: the daemon sweeps orphaned sessions on the next begin.
    });
    throw error;
  }
}

/** Generated file name for a pasted/dropped image with no original name. */
export function imageAttachmentFileName(mimeType: string | undefined, index: number): string {
  const ext = (mimeType && MIME_EXTENSIONS[mimeType.toLowerCase()]) || 'png';
  return `image-${Date.now()}-${index + 1}.${ext}`;
}

/**
 * Convert inline image blocks into attachment-reference blocks by placing
 * each one (one placement request per image, chunked when large). Blocks
 * already carrying an `attachmentId` pass through untouched, so retries and
 * edit/regenerate never re-upload. FAIL-CLOSED: any placement failure
 * rejects with an error naming the failed image(s) (daemon detail included
 * when available) — images are never silently dropped or partially sent.
 */
export async function toImageReferenceBlocks(
  workspaceId: string,
  blocks: WireImageBlock[],
  api: ImagePlacementApi = defaultApi,
): Promise<ImageReferenceBlock[]> {
  const out: ImageReferenceBlock[] = [];
  const failures: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if ('attachmentId' in block && block.attachmentId) {
      out.push({
        type: 'image',
        attachmentId: block.attachmentId,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
      });
      continue;
    }
    const inline = block as InlineImageBlock;
    const fileName = imageAttachmentFileName(inline.mimeType, i);
    try {
      const placed = await placeImageAttachment(
        workspaceId,
        fileName,
        { data: inline.data, mimeType: inline.mimeType },
        api,
      );
      out.push({
        type: 'image',
        attachmentId: placed.attachmentId,
        ...((placed.mimeType ?? inline.mimeType)
          ? { mimeType: placed.mimeType ?? inline.mimeType }
          : {}),
      });
    } catch (error) {
      const detail = extractPlacementErrorDetail(error);
      failures.push(detail ? `${fileName} (${detail})` : fileName);
    }
  }
  if (failures.length > 0) {
    throw new Error(m.chat_imagePlacement_failed_error({ names: failures.join(', ') }));
  }
  return out;
}
