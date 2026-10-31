/**
 * Inline image block (bytes on the wire — the legacy arm). The optional
 * `placement*` fields are client-side only: `toImageReferenceBlocks` tags a
 * block that failed to place with the `idempotencyKey` and requested file
 * name of its attempt, so the retry (which resends these blocks) replays
 * the same placement instead of minting a new identity. They never reach
 * the wire — a tagged block is always converted to a reference first.
 */
export interface InlineImageBlock {
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
