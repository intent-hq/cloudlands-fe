import type {
  ScriptOutputChunk,
  ScriptOutputCursor,
  ScriptRetainedOutput,
} from '$store/renderer/slices/scripts/scripts-types';
import { retainedOutputTerminalText } from './retained-output-text';

/**
 * How far a viewer has written one run's output stream (PROTOCOL §5.8 output
 * cursors): every byte before `next` of `(bootId, runId)` has gone through
 * `decoder`, which holds a character cut at `next` until its rest arrives.
 * `runId` is `null` before the script's first run.
 */
export type StreamJoin = {
  runId: string | null;
  bootId: string;
  next: number;
  decoder: TextDecoder;
};

/** A stream identity, comparable across chunks and snapshots. */
export function streamKey(bootId: string, runId: string | null): string {
  return `${bootId}\u0000${runId ?? ''}`;
}

/**
 * What one live chunk means for the joined stream:
 * - `write`: render `text` (a notice does not move the join);
 * - `skip`: the snapshot or an earlier chunk already holds its bytes;
 * - `gap`: output between `next` and the chunk was never seen;
 * - `foreign`: another run or boot, which only a snapshot can confirm as newer.
 */
export type LiveStep =
  | { kind: 'write'; text: string }
  | { kind: 'skip' }
  | { kind: 'gap' }
  | { kind: 'foreign'; key: string };

function base64Bytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

function chunkBytes(chunk: ScriptOutputChunk): Uint8Array {
  return chunk.data !== undefined ? base64Bytes(chunk.data) : new TextEncoder().encode(chunk.text);
}

/** Apply one live chunk, advancing `join` when it writes stream bytes. */
export function joinLiveChunk(join: StreamJoin, chunk: ScriptOutputChunk): LiveStep {
  const position = chunk.position;
  if (!position) return { kind: 'write', text: chunk.text };
  const { runId, bootId, start, end } = position;
  if (bootId !== join.bootId || runId !== join.runId) {
    return { kind: 'foreign', key: streamKey(bootId, runId) };
  }
  if (end <= join.next) return { kind: 'skip' };
  if (start > join.next) return { kind: 'gap' };
  const text = join.decoder.decode(chunkBytes(chunk).subarray(join.next - start), {
    stream: true,
  });
  join.next = end;
  return { kind: 'write', text };
}

/**
 * The buffered bytes of the snapshot's stream just before `cursor.start`,
 * when the buffer holds them contiguously up to it: output a capped snapshot
 * left out but the viewer already has.
 */
export function bufferedPrefix(
  chunks: readonly ScriptOutputChunk[],
  cursor: ScriptOutputCursor,
): Uint8Array | null {
  let parts: Uint8Array[] = [];
  let from = 0;
  let to = -1;
  for (const chunk of chunks) {
    const p = chunk.position;
    if (!p || p.runId !== cursor.runId || p.bootId !== cursor.bootId) continue;
    if (p.start >= cursor.start) break;
    if (p.start !== to) {
      parts = [];
      from = p.start;
    }
    parts.push(chunkBytes(chunk));
    to = p.end;
  }
  if (parts.length === 0 || from >= cursor.start || to < cursor.start) return null;
  const bytes = new Uint8Array(cursor.start - from);
  let at = 0;
  for (const part of parts) {
    const take = part.subarray(0, bytes.length - at);
    bytes.set(take, at);
    at += take.length;
  }
  return bytes;
}

/**
 * Apply a positioned snapshot. When it continues `join` (same run and boot,
 * starting at or before `next`), only its bytes past `next` are added.
 * Otherwise it replaces the view, after `prefix` (buffered output older than
 * the snapshot) when given.
 */
export function joinSnapshot(
  join: StreamJoin | null,
  snapshot: ScriptRetainedOutput,
  prefix: Uint8Array | null = null,
): { text: string; join: StreamJoin; reset: boolean } {
  const cursor = snapshot.cursor!;
  const bytes = snapshot.data ? base64Bytes(snapshot.data) : new Uint8Array();
  if (
    join !== null &&
    join.runId === cursor.runId &&
    join.bootId === cursor.bootId &&
    cursor.start <= join.next
  ) {
    if (cursor.end <= join.next) return { text: '', join, reset: false };
    const text = join.decoder.decode(bytes.subarray(join.next - cursor.start), { stream: true });
    join.next = cursor.end;
    return { text, join, reset: false };
  }
  const decoder = new TextDecoder();
  const fresh = { runId: cursor.runId, bootId: cursor.bootId, next: cursor.end, decoder };
  if (prefix) {
    const text = decoder.decode(prefix, { stream: true }) + decoder.decode(bytes, { stream: true });
    return { text, join: fresh, reset: true };
  }
  // The text form decoded the same bytes; the decoder keeps a character cut at the end.
  decoder.decode(bytes, { stream: true });
  return { text: retainedOutputTerminalText(snapshot.text ?? ''), join: fresh, reset: true };
}
