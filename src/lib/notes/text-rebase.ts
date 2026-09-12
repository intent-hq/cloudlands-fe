import { diffChars } from 'diff';

/**
 * One-sided text rebase for the note save path: when the daemon echoes a
 * merged text for a sent draft while a newer local draft is pending, the
 * pending draft's edits (relative to the sent text) are replayed onto the
 * echo. This is an offset-mapping patch, not a merge engine — the daemon
 * remains the merge oracle; the client only avoids replaying already
 * persisted intent (or swallowing a local undo) on the next save.
 */

/** A contiguous replaced span: `from[fromStart, fromEnd)` became `to[toStart, toEnd)`. */
interface Hunk {
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
}

interface CharChange {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/**
 * Group `diffChars(from, to)` parts into replaced spans. Offsets are UTF-16
 * code-unit indexes into `from` / `to`; jsdiff splits surrogate pairs as whole
 * characters, so a pair never straddles a span boundary.
 */
function hunks(from: string, to: string): Hunk[] {
  const out: Hunk[] = [];
  let fromPos = 0;
  let toPos = 0;
  let open: Hunk | undefined;
  for (const part of diffChars(from, to) as CharChange[]) {
    if (part.added || part.removed) {
      open ??= { fromStart: fromPos, fromEnd: fromPos, toStart: toPos, toEnd: toPos };
      if (part.removed) fromPos += part.value.length;
      else toPos += part.value.length;
      open.fromEnd = fromPos;
      open.toEnd = toPos;
    } else {
      if (open) out.push(open);
      open = undefined;
      fromPos += part.value.length;
      toPos += part.value.length;
    }
  }
  if (open) out.push(open);
  return out;
}

function mapOffset(spans: Hunk[], offset: number): number {
  let delta = 0;
  for (const h of spans) {
    if (offset <= h.fromStart) return offset + delta;
    if (offset < h.fromEnd) return h.toEnd;
    delta = h.toEnd - h.fromEnd;
  }
  return offset + delta;
}

/**
 * Map a UTF-16 offset in `from` to the corresponding offset in `to`. Offsets
 * before a change are unchanged, offsets strictly inside a replaced/deleted
 * span clamp to that span's end in `to`, offsets after are shifted by the net
 * length delta of the preceding changes. An offset at the very start of a
 * change maps to the change's start (the text there is still the same).
 */
export function mapOffsetThroughDiff(from: string, to: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, from.length));
  return mapOffset(hunks(from, to), clamped);
}

/**
 * Replay the edits `base → ours` onto `theirs`, returning the rebased text.
 * Each `diffChars(base, ours)` op has its base offsets mapped through
 * `base → theirs`; insertions land at the mapped point (inside a span theirs
 * replaced, at the clamp point after the replacement); deletions remove only
 * the base characters theirs kept, so characters theirs already removed are
 * no-ops and theirs' insertions inside a deleted range survive.
 */
export function rebaseText(base: string, theirs: string, ours: string): string {
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const spans = hunks(base, theirs);
  const map = (offset: number) => mapOffset(spans, offset);
  let result = '';
  let basePos = 0;
  let theirsPos = 0;
  for (const part of diffChars(base, ours) as CharChange[]) {
    if (part.added) {
      const at = map(basePos);
      result += theirs.slice(theirsPos, at) + part.value;
      theirsPos = at;
    } else if (part.removed) {
      const end = basePos + part.value.length;
      let cursor = basePos;
      for (const h of spans) {
        // Spans already emitted by the preceding op; a pure insertion sitting
        // exactly at the range start still belongs to theirs and is kept.
        if (h.fromEnd < cursor || (h.fromEnd === cursor && h.fromStart < h.fromEnd)) continue;
        if (h.fromStart >= end) break;
        if (h.fromStart > cursor) theirsPos = map(h.fromStart);
        result += theirs.slice(theirsPos, h.toEnd);
        theirsPos = h.toEnd;
        cursor = Math.min(h.fromEnd, end);
      }
      if (cursor < end) theirsPos = map(end);
      basePos = end;
    } else {
      const end = basePos + part.value.length;
      const at = map(end);
      result += theirs.slice(theirsPos, at);
      theirsPos = at;
      basePos = end;
    }
  }
  return result + theirs.slice(theirsPos);
}
