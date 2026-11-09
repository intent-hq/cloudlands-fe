/**
 * The daemon refuses, before the model, a prompt whose prepared images together exceed this
 * many base64 bytes ("the prepared images together exceed the 8 MiB base64 prompt budget").
 * A refused message was already delivered, so Send checks it first.
 */
export const DOCK_PROMPT_IMAGE_BUDGET = 8 * 1024 * 1024;

/**
 * The daemon passes an image of at most this many raw bytes (and a bounded edge) through
 * unchanged; larger ones it re-encodes, so their prepared size is not known beforehand.
 */
export const DOCK_PREPARED_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Exported recording frames leave room under the prompt budget for the message's
 * screenshots and pasted images.
 */
export const DOCK_FRAME_IMAGE_BUDGET = 6 * 1024 * 1024;

/** Base64 bytes for `bytes` raw bytes. */
export function dockBase64Bytes(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 3) * 4;
}

/**
 * Exact prompt bytes of a recording frame main fitted (JPEG, long edge at most 1920, at
 * most 3 MiB), which the daemon sends unchanged. Any other image is prepared by the daemon
 * (it may shrink or re-encode, even grow) so its prompt size is unknown here: null.
 */
export function dockFittedFramePromptBytes(frame: { mimeType: string; size: number }): number | null {
  return frame.mimeType === 'image/jpeg' && frame.size > 0 && frame.size <= DOCK_PREPARED_IMAGE_MAX_BYTES
    ? dockBase64Bytes(frame.size)
    : null;
}

/**
 * Frame encodings, largest first: a bounded long edge (never upscaled) and JPEG quality.
 * The smallest keeps a desktop screenshot's controls legible at its long edge.
 */
export const DOCK_FRAME_ENCODINGS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: 1920, quality: 82 },
  { maxEdge: 1600, quality: 78 },
  { maxEdge: 1280, quality: 74 },
  { maxEdge: 1024, quality: 70 },
];

/** Output size for an image of `width`×`height` whose long edge is at most `maxEdge`. */
export function dockFrameSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The first encoding whose frames fit `budget` (summed per-frame base64), else the smallest
 * one. Every frame is kept: fitting only trades resolution and quality, never marks.
 */
export async function chooseDockFrameEncoding<T>(
  encode: (step: { maxEdge: number; quality: number }) => Promise<{ frames: T[]; bytes: number[] }>,
  budget: number = DOCK_FRAME_IMAGE_BUDGET,
): Promise<{ step: { maxEdge: number; quality: number }; frames: T[]; bytes: number[]; fits: boolean }> {
  let last: { step: { maxEdge: number; quality: number }; frames: T[]; bytes: number[]; fits: boolean } | null = null;
  for (const step of DOCK_FRAME_ENCODINGS) {
    const { frames, bytes } = await encode(step);
    const fits = bytes.reduce((sum, size) => sum + dockBase64Bytes(size), 0) <= budget;
    last = { step, frames, bytes, fits };
    if (fits) return last;
  }
  return last!;
}
