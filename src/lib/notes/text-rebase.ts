import { diffArrays, diffChars } from 'diff';

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
 * Total time the diffs of one alignment may spend. Once spent, the remaining
 * unanchored regions become one replaced span each (offsets inside clamp to
 * the span end), so a pathological pair degrades to slightly-off remote
 * carets instead of a frozen main thread.
 */
const ALIGNMENT_BUDGET_MS = 250;
/** Words, whitespace runs, and single code points (a surrogate pair is one token). */
const TOKEN = /[\p{L}\p{N}_]+|\s+|./gsu;
/** Textblocks at least this long are trusted as verbatim anchors. */
const MIN_ANCHOR_LENGTH = 12;
/**
 * A block is looked for at most this far beyond twice the unanchored text
 * before it, which bounds a failed search; markdown syntax never doubles a
 * region by more than this, and a later block re-anchors once its gap grows.
 */
const ANCHOR_SEARCH_SLACK = 8192;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Align `from` with `to` as a list of replaced spans in UTF-16 code-unit
 * offsets; the text between consecutive spans is identical on both sides.
 *
 * A full `diffChars` is O(N·D) and D is in the thousands between a note's
 * plain-text projection and its markdown (every syntax character differs), so
 * instead each `\n`-delimited block of `from` that appears verbatim in `to`
 * — plain paragraphs, headings, list items, fenced code — is anchored with a
 * forward `indexOf`, and only the short regions between anchors are diffed
 * (`refine`). Near-identical texts (the save path) anchor almost every line
 * the same way. A surrogate pair never straddles a span boundary: anchors,
 * trimmed prefixes and tokens stop outside pairs and jsdiff's `diffChars`
 * treats a pair as one character.
 */
function hunks(from: string, to: string): Hunk[] {
  const out: Hunk[] = [];
  if (from === to) return out;
  const deadline = performance.now() + ALIGNMENT_BUDGET_MS;
  let fromPos = 0;
  let toPos = 0;
  let blockStart = 0;
  while (blockStart < from.length) {
    let blockEnd = from.indexOf('\n', blockStart);
    if (blockEnd === -1) blockEnd = from.length;
    if (blockEnd - blockStart >= MIN_ANCHOR_LENGTH) {
      const block = from.slice(blockStart, blockEnd);
      const limit = toPos + 2 * (blockStart - fromPos) + block.length + ANCHOR_SEARCH_SLACK;
      const at = findAnchor(to, block, toPos, limit);
      if (at !== -1) {
        refine(out, from, to, fromPos, blockStart, toPos, at, deadline);
        fromPos = blockEnd;
        toPos = at + block.length;
      }
    }
    blockStart = blockEnd + 1;
  }
  refine(out, from, to, fromPos, from.length, toPos, to.length, deadline);
  return out;
}

/** First occurrence of `block` in `to[start, limit)` that does not split a surrogate pair. */
function findAnchor(to: string, block: string, start: number, limit: number): number {
  const window = limit < to.length ? to.slice(0, limit) : to;
  let at = window.indexOf(block, start);
  while (
    at !== -1 &&
    (isHighSurrogate(to.charCodeAt(at - 1)) || isLowSurrogate(to.charCodeAt(at + block.length)))
  ) {
    at = window.indexOf(block, at + 1);
  }
  return at;
}

/**
 * Append the replaced spans of `from[fromStart, fromEnd)` → `to[toStart, toEnd)`
 * to `out`: trim the common prefix and suffix, diff what is left by token,
 * then `diffChars` each replaced token span. Tokens first because a plain
 * word is a pure insertion apart from the syntax around it, and `diffChars`
 * alone would happily match its letters one by one inside `](https://…)`.
 * Any diff past the budget emits its input as one replaced span instead.
 */
function refine(
  out: Hunk[],
  from: string,
  to: string,
  fromStart: number,
  fromEnd: number,
  toStart: number,
  toEnd: number,
  deadline: number,
): void {
  let prefix = 0;
  const maxPrefix = Math.min(fromEnd - fromStart, toEnd - toStart);
  while (
    prefix < maxPrefix &&
    from.charCodeAt(fromStart + prefix) === to.charCodeAt(toStart + prefix)
  ) {
    prefix += 1;
  }
  if (prefix > 0 && isHighSurrogate(from.charCodeAt(fromStart + prefix - 1))) prefix -= 1;
  fromStart += prefix;
  toStart += prefix;
  let suffix = 0;
  const maxSuffix = Math.min(fromEnd - fromStart, toEnd - toStart);
  while (
    suffix < maxSuffix &&
    from.charCodeAt(fromEnd - 1 - suffix) === to.charCodeAt(toEnd - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(from.charCodeAt(fromEnd - suffix))) suffix -= 1;
  fromEnd -= suffix;
  toEnd -= suffix;

  if (fromStart === fromEnd && toStart === toEnd) return;
  const whole: Hunk = { fromStart, fromEnd, toStart, toEnd };
  if (fromStart === fromEnd || toStart === toEnd) {
    out.push(whole);
    return;
  }
  const words = withinBudget(deadline, (timeout) =>
    diffArrays(
      from.slice(fromStart, fromEnd).match(TOKEN) ?? [],
      to.slice(toStart, toEnd).match(TOKEN) ?? [],
      { timeout },
    ),
  );
  if (!words) {
    out.push(whole);
    return;
  }
  const spans = groupChanges(
    words.map((part) => ({ value: part.value.join(''), added: part.added, removed: part.removed })),
    fromStart,
    toStart,
  );
  for (const span of spans) {
    const chars =
      span.fromStart < span.fromEnd && span.toStart < span.toEnd
        ? withinBudget(deadline, (timeout) =>
            diffChars(
              from.slice(span.fromStart, span.fromEnd),
              to.slice(span.toStart, span.toEnd),
              { timeout },
            ),
          )
        : undefined;
    if (chars) out.push(...groupChanges(chars, span.fromStart, span.toStart));
    else out.push(span);
  }
}

/** Run `diff` with the time left before `deadline`; `undefined` once it is spent or the diff aborts. */
function withinBudget<T>(
  deadline: number,
  diff: (timeout: number) => T | undefined,
): T | undefined {
  const timeout = deadline - performance.now();
  return timeout > 0 ? diff(timeout) : undefined;
}

/** Group consecutive added/removed parts into replaced spans, offset from `fromStart` / `toStart`. */
function groupChanges(parts: CharChange[], fromStart: number, toStart: number): Hunk[] {
  const out: Hunk[] = [];
  let fromPos = fromStart;
  let toPos = toStart;
  let open: Hunk | undefined;
  for (const part of parts) {
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

/** The same alignment read `to → from`: every span with its sides swapped. */
function invertHunks(spans: Hunk[]): Hunk[] {
  return spans.map((h) => ({
    fromStart: h.toStart,
    fromEnd: h.toEnd,
    toStart: h.fromStart,
    toEnd: h.fromEnd,
  }));
}

function offsetMapper(spans: Hunk[], fromLength: number): (offset: number) => number {
  return (offset) => mapOffset(spans, Math.max(0, Math.min(offset, fromLength)));
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
 * `mapOffsetThroughDiff` with the `from → to` diff computed once, for callers
 * mapping many offsets between the same two texts (remote cursors).
 */
export function createOffsetMapper(from: string, to: string): (offset: number) => number {
  return offsetMapper(hunks(from, to), from.length);
}

interface BidirectionalOffsetMapper {
  aToB: (offset: number) => number;
  bToA: (offset: number) => number;
}

/**
 * Both directions of `createOffsetMapper` from ONE `a → b` alignment. `bToA`
 * reads the same spans with their sides swapped instead of diffing again, so
 * the two directions always describe the same alignment: strictly inside a
 * common run `bToA` is the exact inverse of `aToB` (offsets round-trip); on a
 * run boundary each direction keeps `mapOffset`'s start affinity (the edge of
 * a change maps to the change's start, so it need not round-trip); and an
 * offset strictly inside a changed span clamps to that span's end in `a`.
 *
 * This is NOT always `createOffsetMapper(b, a)`: when repeated characters
 * admit several equally short alignments (`abXY` ↔ `XYab`), a fresh `b → a`
 * diff may pick a different one and disagree even on shared text. Callers
 * mapping in both directions want the single consistent alignment.
 */
export function createBidirectionalOffsetMapper(a: string, b: string): BidirectionalOffsetMapper {
  const spans = hunks(a, b);
  return {
    aToB: offsetMapper(spans, a.length),
    bToA: offsetMapper(invertHunks(spans), b.length),
  };
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
