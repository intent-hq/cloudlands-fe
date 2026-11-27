import type {
  ScriptOutputChunk,
  ScriptRetainedOutput,
} from '$store/renderer/slices/scripts/scripts-types';
import { retainedOutputTerminalText } from './retained-output-text';

/**
 * How far a viewer has written one run's output stream (PROTOCOL §5.8 output
 * cursors): every byte before `next` of `(bootId, runId)` is on screen.
 * `runId` is `null` before the script's first run.
 */
export type StreamJoin = { runId: string | null; bootId: string; next: number };

/** A stream identity, comparable across chunks and snapshots. */
export function streamKey(bootId: string, runId: string | null): string {
  return `${bootId}\u0000${runId ?? ''}`;
}

/**
 * What one live chunk means for the joined stream:
 * - `write`: render `text` and continue from `join` (a notice keeps `join`);
 * - `skip`: the snapshot or an earlier chunk already holds its bytes;
 * - `gap`: output between `next` and the chunk was never seen;
 * - `foreign`: another run or boot, which only a snapshot can confirm as newer.
 */
export type LiveStep =
  | { kind: 'write'; text: string; join: StreamJoin }
  | { kind: 'skip' }
  | { kind: 'gap' }
  | { kind: 'foreign'; key: string };

/** Decode `bytes` from `from`, leaving a character cut at the end to the chunk that completes it. */
function decodeFrom(bytes: Uint8Array, from: number): string {
  return new TextDecoder().decode(bytes.subarray(from), { stream: true });
}

function base64Bytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

export function joinLiveChunk(join: StreamJoin, chunk: ScriptOutputChunk): LiveStep {
  const position = chunk.position;
  if (!position) return { kind: 'write', text: chunk.text, join };
  const { runId, bootId, start, end } = position;
  if (bootId !== join.bootId || runId !== join.runId) {
    return { kind: 'foreign', key: streamKey(bootId, runId) };
  }
  if (end <= join.next) return { kind: 'skip' };
  if (start > join.next) return { kind: 'gap' };
  const moved = { runId, bootId, next: end };
  if (start === join.next) return { kind: 'write', text: chunk.text, join: moved };
  // Only a chunk that straddles a snapshot's end: its text is its bytes,
  // except where a character crosses a chunk boundary.
  const bytes = new TextEncoder().encode(chunk.text);
  return { kind: 'write', text: decodeFrom(bytes, join.next - start), join: moved };
}

/**
 * Apply a positioned snapshot. When it continues the joined stream (same run
 * and boot, starting at or before `next`), only its bytes past `next` are
 * added. Otherwise it replaces the view.
 */
export function joinSnapshot(
  join: StreamJoin | null,
  snapshot: ScriptRetainedOutput,
): { text: string; join: StreamJoin; reset: boolean } {
  const cursor = snapshot.cursor!;
  const fresh = { runId: cursor.runId, bootId: cursor.bootId, next: cursor.end };
  const continues =
    join !== null &&
    join.runId === cursor.runId &&
    join.bootId === cursor.bootId &&
    cursor.start <= join.next;
  if (!continues) {
    return { text: retainedOutputTerminalText(snapshot.text ?? ''), join: fresh, reset: true };
  }
  if (cursor.end <= join.next || !snapshot.data) return { text: '', join, reset: false };
  return {
    text: decodeFrom(base64Bytes(snapshot.data), join.next - cursor.start),
    join: fresh,
    reset: false,
  };
}
