/**
 * Slim note.list projection helpers (PROTOCOL §5.2 `projection: "slim"`).
 *
 * Slim rows carry `content: ""` plus `contentPreview`/`contentLength`; a row
 * whose `contentLength` says the note has content while `content` is empty has
 * not had its full body fetched yet. Content-rendering surfaces use this to
 * decide when a targeted full `note.get` is required before trusting
 * `note.content`.
 */

import { NOTE_VIEW_MAX_CONTENT_BYTES } from '../constants/notes';
import type { Note } from '../types';

/**
 * True when `note` is a slim-projection row whose full content has not been
 * loaded: the daemon reported a non-empty content length but the local row
 * carries no content. Full rows (no `contentLength`) and genuinely empty
 * notes (`contentLength === 0`) are never stale.
 */
export function isNoteContentStale(
  note: Pick<Note, 'content' | 'contentLength'> | undefined | null,
): boolean {
  if (!note) return false;
  return typeof note.contentLength === 'number' && note.contentLength > 0 && !note.content;
}

/**
 * Whether a `note.list` failure is the daemon rejecting the `projection`
 * param (JSON-RPC -32602 Invalid params). Defense-in-depth only: daemons that
 * predate `note.list` `projection` extract named params manually and ignore
 * unknown keys, so they serve full rows rather than rejecting — full rows are
 * a valid superset and the actual degradation path. A daemon that knows
 * `projection` returns -32602 only for a malformed value, which this client
 * never sends. Duck-typed on
 * the numeric `rpcCode` that both transports (`BackendError`, `JsonRpcError`)
 * thread through for daemon-issued error responses — transport failures carry
 * no `rpcCode` and must NOT trigger a projection-less retry.
 */
export function isProjectionRejected(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { rpcCode?: unknown }).rpcCode === -32602;
}

/**
 * Whether `content` is over the note views' truncated-read limit (§5.2
 * "Truncated note reads"). Mutation responses (conflict `current`, a restore's
 * `note`) carry full content, so a body this large must be re-read through the
 * bounded view read instead of entering the cache whole.
 */
export function exceedsNoteViewLimit(content: string | undefined): boolean {
  if (!content || content.length * 3 <= NOTE_VIEW_MAX_CONTENT_BYTES) return false;
  return new TextEncoder().encode(content).length > NOTE_VIEW_MAX_CONTENT_BYTES;
}

/**
 * The daemon's truncated-read cut (§5.2 "Truncated note reads", cut rule): the
 * longest prefix of `content` within `limit` UTF-8 bytes that ends right after
 * a line feed; with no line feed in range, the longest prefix ending on a
 * character boundary (stepping back off a `\r` that a `\n` follows). Returns
 * `null` when the content fits, so nothing is cut.
 */
export function cutNoteContentForView(
  content: string,
  limit: number = NOTE_VIEW_MAX_CONTENT_BYTES,
): { content: string; contentBytes: number } | null {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length <= limit) return null;
  let end = bytes.lastIndexOf(0x0a, limit - 1) + 1;
  if (end === 0) {
    end = limit;
    // Step back to a UTF-8 character boundary (never inside a continuation byte).
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    if (end > 0 && bytes[end - 1] === 0x0d && bytes[end] === 0x0a) end--;
  }
  return {
    content: new TextDecoder().decode(bytes.subarray(0, end)),
    contentBytes: bytes.length,
  };
}
