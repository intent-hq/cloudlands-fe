/**
 * Slim note.list projection helpers (PROTOCOL §5.2 `projection: "slim"`).
 *
 * Slim rows carry `content: ""` plus `contentPreview`/`contentLength`; a row
 * whose `contentLength` says the note has content while `content` is empty has
 * not had its full body fetched yet. Content-rendering surfaces use this to
 * decide when a targeted full `note.get` is required before trusting
 * `note.content`.
 */

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
 * param as unknown (JSON-RPC -32602 Invalid params, the strict-deserialization
 * response of daemons predating §5.2 `projection`). Duck-typed on the numeric
 * `rpcCode` that both transports (`BackendError`, `JsonRpcError`) thread
 * through for daemon-issued error responses — transport failures carry no
 * `rpcCode` and must NOT trigger a projection-less retry.
 */
export function isProjectionRejected(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { rpcCode?: unknown }).rpcCode === -32602;
}
