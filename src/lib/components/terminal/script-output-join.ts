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

/** Decode `bytes` from `from`, leaving a character cut at the end to the chunk that completes it. */
function decodeFrom(bytes: Uint8Array, from: number): string {
  return new TextDecoder().decode(bytes.subarray(from), { stream: true });
}

function base64Bytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/**
 * Apply one live chunk. A chunk without a position is a daemon notice and is
 * written as is. A positioned chunk of the joined stream is written from
 * `next` on; one already written is skipped. `gap` reports output that was
 * never seen (a later position, another boot, or another run that does not
 * start at 0): its chunk is still written so the view keeps moving, and the
 * caller reads a fresh snapshot.
 */
export function joinLiveChunk(
  join: StreamJoin,
  chunk: ScriptOutputChunk,
): { text: string; join: StreamJoin; gap: boolean } {
  const position = chunk.position;
  if (!position) return { text: chunk.text, join, gap: false };
  const { runId, bootId, start, end } = position;
  const sameStream = bootId === join.bootId && runId === join.runId;
  if (sameStream && end <= join.next) return { text: '', join, gap: false };
  const moved = { runId, bootId, next: end };
  if (sameStream && start < join.next) {
    // Only a chunk that straddles a snapshot's end: its text is its bytes,
    // except where a character crosses a chunk boundary.
    const bytes = new TextEncoder().encode(chunk.text);
    return { text: decodeFrom(bytes, join.next - start), join: moved, gap: false };
  }
  const continues = sameStream
    ? start === join.next
    : bootId === join.bootId && start === 0;
  return { text: chunk.text, join: moved, gap: !continues };
}

/**
 * Apply a positioned snapshot. When it continues the shown stream (same run
 * and boot, starting at or before `next`, with no gap seen since), only its
 * bytes past `next` are added. Otherwise it replaces the view.
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
