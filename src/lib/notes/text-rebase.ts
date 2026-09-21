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
 * Group `diffChars(from, to)` parts into replaced spans. Offsets are UTF-16
 * code-unit indexes into `from` / `to`; jsdiff splits surrogate pairs as whole
 * characters, so a pair never straddles a span boundary. This is the save
 * path's alignment: its texts are near-identical, so Myers is cheap and the
 * globally minimal edit script is what `rebaseText` relies on (a deletion
 * theirs already made must align onto itself, not onto a repeated line).
 */
function charHunks(from: string, to: string): Hunk[] {
  return groupChanges(diffChars(from, to) as CharChange[], 0, 0);
}

/**
 * Total time one plain-text ↔ markdown alignment may spend, anchor search and
 * diffs together. Once spent, the rest of the text becomes one replaced span
 * (offsets inside clamp to the span end), so a pathological pair degrades to
 * slightly-off remote carets instead of a frozen main thread.
 */
const ALIGNMENT_BUDGET_MS = 250;
/** Words, whitespace runs, and single code points (a surrogate pair is one token). */
const TOKEN = /[\p{L}\p{N}_]+|\s+|./gsu;
/** `TOKEN` anchored at `lastIndex`, for reading the one token that starts there. */
const TOKEN_AT = /[\p{L}\p{N}_]+|\s+|./suy;
const WORD_AT = /[\p{L}\p{N}_]+/uy;
/** Textblocks at least this long are trusted as verbatim anchors. */
const MIN_ANCHOR_LENGTH = 12;
/**
 * A block is looked for at most this far beyond twice the unanchored text
 * before it; markdown syntax never doubles a region by more than this, and a
 * later block re-anchors once its gap grows.
 */
const ANCHOR_SEARCH_SLACK = 8192;
/**
 * Cap on the unanchored-gap allowance of one anchor search, so a run of
 * blocks that never match (each rescanning the text after the last anchor)
 * costs O(blocks · window) rather than O(blocks · remainder) before the
 * deadline stops it.
 */
const MAX_ANCHOR_GAP = 64 * 1024;
/**
 * Once this much of `from` has gone unanchored, the blocks stopped matching
 * verbatim (inline formatting in every one of them) and the run is re-walked
 * in pieces: the verbatim runs inside each block are anchored one at a time,
 * which keeps the search windows and the regions left to `refine` small
 * instead of growing with the run.
 */
const MAX_UNANCHORED_RUN = 2048;
/** Shortest run of a block anchored on its own; anything shorter is left to `refine`. */
const MIN_PIECE_LENGTH = 4;
/**
 * Lookahead past the expected position of a piece. Only inline syntax sits
 * between the pieces of one block, and a block-level gap a piece cannot see
 * over is covered by the unanchored-gap allowance as the run grows.
 */
const PIECE_SEARCH_SLACK = 1024;
/**
 * A region left between anchors that is longer than this on either side is
 * emitted as one replaced span: nothing inside it anchored, so a token diff
 * of it would spend the whole budget on carets that clamp anyway.
 */
const MAX_REFINE_LENGTH = 8192;

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
 * (`refine`). A run of blocks that never match verbatim (inline formatting in
 * each) is anchored piecewise instead, see `MAX_UNANCHORED_RUN`. The anchor
 * loop and every diff share one deadline: past it, the remaining text is
 * emitted as one replaced span. A surrogate pair never straddles a span
 * boundary: anchors, trimmed prefixes and tokens stop outside pairs and
 * jsdiff's `diffChars` treats a pair as one character.
 *
 * Unlike `charHunks`, the result is not the minimal edit script; only the
 * offset mappers (remote carets) use it, never `rebaseText`.
 */
function anchoredHunks(from: string, to: string): Hunk[] {
  const out: Hunk[] = [];
  if (from === to) return out;
  const deadline = performance.now() + ALIGNMENT_BUDGET_MS;
  let fromPos = 0;
  let toPos = 0;
  let cursor = 0;
  let pieces = false;
  while (cursor < from.length && performance.now() < deadline) {
    if (!pieces && cursor - fromPos > MAX_UNANCHORED_RUN) {
      pieces = true;
      cursor = fromPos;
    }
    let lineEnd = from.indexOf('\n', cursor);
    if (lineEnd === -1) lineEnd = from.length;
    const probes = pieces
      ? pieceProbes(from, cursor, lineEnd)
      : lineEnd - cursor >= MIN_ANCHOR_LENGTH
        ? [lineEnd]
        : [];
    const slack = pieces ? PIECE_SEARCH_SLACK : ANCHOR_SEARCH_SLACK;
    let anchored = false;
    for (const probeEnd of probes) {
      const probe = from.slice(cursor, probeEnd);
      const gap = Math.min(2 * (cursor - fromPos), MAX_ANCHOR_GAP);
      const at = findAnchor(to, probe, toPos, toPos + gap + probe.length + slack);
      if (at === -1) continue;
      const length = commonRun(from, cursor, to, at);
      refine(out, from, to, fromPos, cursor, toPos, at, deadline);
      fromPos = cursor + length;
      toPos = at + length;
      cursor = fromPos;
      if (probeEnd === lineEnd) pieces = false;
      anchored = true;
      break;
    }
    if (!anchored) cursor = pieces ? cursor + tokenLength(from, cursor) : lineEnd + 1;
  }
  refine(out, from, to, fromPos, from.length, toPos, to.length, deadline);
  return out;
}

/**
 * Ends of the probes tried, longest first, for the text of `from` between
 * `cursor` and `lineEnd`: the rest of the line (a plain line inside a
 * formatted run), its leading word, then its first few code units (a word
 * that formatting splits, `aaaaaa**aaaaaa**`). A probe only locates the run;
 * `commonRun` then extends the anchor as far as the texts agree.
 */
function pieceProbes(from: string, cursor: number, lineEnd: number): number[] {
  const ends: number[] = [];
  if (lineEnd - cursor >= MIN_ANCHOR_LENGTH) ends.push(lineEnd);
  WORD_AT.lastIndex = cursor;
  const word = WORD_AT.exec(from);
  const wordEnd = word ? Math.min(cursor + word[0].length, lineEnd) : cursor;
  if (wordEnd - cursor >= MIN_PIECE_LENGTH && wordEnd !== ends.at(-1)) ends.push(wordEnd);
  let shortEnd = cursor + MIN_PIECE_LENGTH;
  if (isHighSurrogate(from.charCodeAt(shortEnd - 1))) shortEnd += 1;
  if (shortEnd <= lineEnd && shortEnd !== ends.at(-1)) ends.push(shortEnd);
  return ends;
}

function tokenLength(text: string, at: number): number {
  TOKEN_AT.lastIndex = at;
  return TOKEN_AT.exec(text)?.[0].length ?? 1;
}

/** Length of the run `from[fromAt…]` and `to[toAt…]` share, not ending inside a surrogate pair. */
function commonRun(from: string, fromAt: number, to: string, toAt: number): number {
  const max = Math.min(from.length - fromAt, to.length - toAt);
  let n = 0;
  while (n < max && from.charCodeAt(fromAt + n) === to.charCodeAt(toAt + n)) n += 1;
  if (n > 0 && isHighSurrogate(from.charCodeAt(fromAt + n - 1))) n -= 1;
  return n;
}

/** First occurrence of `block` in `to[start, limit)` that does not split a surrogate pair. */
function findAnchor(to: string, block: string, start: number, limit: number): number {
  const window = to.slice(start, Math.min(limit, to.length));
  let at = window.indexOf(block);
  while (
    at !== -1 &&
    (isHighSurrogate(to.charCodeAt(start + at - 1)) ||
      isLowSurrogate(to.charCodeAt(start + at + block.length)))
  ) {
    at = window.indexOf(block, at + 1);
  }
  return at === -1 ? -1 : start + at;
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
  // A `from` region that survives whole inside the `to` region — text between
  // two pieces of inline syntax — is a pure insertion around it; the diff
  // would say the same, at a cost per gap.
  const inside = findAnchor(to, from.slice(fromStart, fromEnd), toStart, toEnd);
  if (inside !== -1) {
    if (inside > toStart) out.push({ fromStart, fromEnd: fromStart, toStart, toEnd: inside });
    const after = inside + (fromEnd - fromStart);
    if (after < toEnd) out.push({ fromStart: fromEnd, fromEnd, toStart: after, toEnd });
    return;
  }
  if (fromEnd - fromStart > MAX_REFINE_LENGTH || toEnd - toStart > MAX_REFINE_LENGTH) {
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
  return mapOffset(charHunks(from, to), clamped);
}

/**
 * Map many offsets between a note's plain-text projection and its markdown
 * (remote cursors) with the `from → to` alignment computed once. Uses the
 * anchored alignment, so unlike `mapOffsetThroughDiff` it is bounded by
 * `ALIGNMENT_BUDGET_MS` and not guaranteed to be the minimal edit script.
 */
export function createOffsetMapper(from: string, to: string): (offset: number) => number {
  return offsetMapper(anchoredHunks(from, to), from.length);
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
  const spans = anchoredHunks(a, b);
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
  const spans = charHunks(base, theirs);
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
