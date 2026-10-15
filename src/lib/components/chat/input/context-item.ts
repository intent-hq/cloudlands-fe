/**
 * Context item used in rich input for attaching files, notes, selections, etc.
 */
export interface ContextItem {
  id: string;
  type: 'file' | 'note' | 'selection' | 'workspace' | 'memory' | 'personality' | 'folder';
  label: string;
  description?: string;
  /** Explicit note identity; never infer it from the pill id, label or path. */
  noteId?: string;
  workspaceId?: string;
  content?: string;
  path?: string; // For file items
  metadata?: Record<string, any>; // For additional data
  file?: File; // For uploaded/pasted files (images, etc.)
  // For base64 image data (e.g., from loaded messages)
  imageData?: string; // Base64 encoded image data
  imageMimeType?: string; // MIME type of the image
  // For placed workspace attachments (file.placeAttachment, PROTOCOL §5.9):
  // the UUID registry key plus the metadata needed to build the
  // attachment-reference file block — no bytes are kept on the item.
  attachmentId?: string; // UUID from the daemon's attachment registry
  attachmentMimeType?: string; // MIME type recorded at placement
  attachmentSize?: number; // Placed byte length
  // Placement lifecycle for non-image attachments. Placement copies from
  // `sourcePath` on the local sidecar and sends base64 bytes via the `data`
  // arm against a remote backend (attachment-placement.ts): `placing` while
  // file.placeAttachment is in flight, `failed` when it errored (no
  // resolvable path, daemon error, stale/missing source). Absent/'placed'
  // means the item is ready to send. Send/create is blocked while any item
  // is placing or failed.
  placementStatus?: 'placing' | 'failed' | 'placed';
  // Chunk-acknowledged upload fraction (0..1) while a chunked remote
  // placement (>25MB, file.attachmentUpload.*) is in flight — drives the
  // uploading pill's percent label. Absent for single-shot placements
  // (indeterminate spinner) and outside the 'placing' state. Transient
  // UI-only state, never persisted.
  placementProgress?: number;
  // Human-readable reason for a failed placement (daemon error detail, e.g.
  // "sourcePath is a directory"), shown in the failed pill tooltip. Absent
  // when no informative detail was available.
  placementError?: string;
  // Absolute host-local source path captured at drop/pick time — what
  // placeAttachment copies from and what a retry re-places from. Also the
  // staging key for pre-workspace surfaces (modal/onboarding), where
  // placement is deferred until workspace.create returns.
  sourcePath?: string;
  // Client-minted `idempotencyKey` (PROTOCOL §5.9) shared by every
  // placement attempt of this item, so a retry after a lost reply replays
  // the committed attachment instead of placing a duplicate. Minted once
  // per item when the daemon supports it; absent against older daemons.
  placementIdempotencyKey?: string;
  // File name requested by a keyed image placement whose attempt failed
  // (in-memory images get a generated name), retained with the key so the
  // retry resends the identical placement the daemon can replay.
  placementFileName?: string;
  // Attachment id an image item's placement produced during a held first
  // send that then failed downstream, retained so the resumed send passes a
  // reference instead of placing the image again. Client-side only: never
  // persisted in a draft, since it is bound to the workspace of that send.
  placementAttachmentId?: string;
}
