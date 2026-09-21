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
/**
 * Words, whitespace runs, a masked destination (see `maskDestinations`), and
 * single code points (a surrogate pair is one token).
 */
const TOKEN = /[\p{L}\p{N}_]+|\s+|\0+|./gsu;
/** `TOKEN` anchored at `lastIndex`, for reading the one token that starts there. */
const TOKEN_AT = /[\p{L}\p{N}_]+|\s+|\0+|./suy;
const WORD_AT = /[\p{L}\p{N}_]+/uy;
const NOT_LETTER = /\P{L}+/gu;
const BLANK = /^\s+$/u;
/** A link destination `](…)` or reference label `][…]`, closed on its own line. */
const DESTINATION = /\]\([^()\n]*\)|\]\[[^\]\n]*\]/g;
/** Textblocks at least this long are trusted as verbatim anchors. */
const MIN_ANCHOR_LENGTH = 12;
/**
 * A block is looked for at most this far beyond twice the unanchored text
 * before it (see `MAX_ANCHOR_GAP`). A block whose markdown lies further away
 * — the syntax before it expanded the text by more than that — stays
 * unanchored, and the window of the blocks after it grows by its length.
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
 * Align the plain text `from` with its `markdown` as a list of replaced spans
 * in UTF-16 code-unit offsets; the text between consecutive spans is
 * identical on both sides.
 *
 * A full `diffChars` is O(N·D) and D is in the thousands between a note's
 * plain-text projection and its markdown (every syntax character differs), so
 * instead each block of `from` between line breaks (`\n`, or the U+FFFC a hard
 * break projects to — a markdown line of its own) that appears verbatim in
 * the markdown — plain paragraphs, headings, list items, fenced code — is
 * anchored with a forward `indexOf`, and only the short regions between
 * anchors are diffed (`refine`). A hit is held to the structure of the
 * markdown — the text lines it ends and the letters on its line, see
 * `LineWalk` — which declines a hit that lies past the block's formatted
 * original on a later duplicate of it, or short of it on an earlier one. A
 * run of blocks that never match verbatim (inline formatting in each) is
 * anchored piecewise instead, see `MAX_UNANCHORED_RUN`; so is a run whose
 * next block matches only beyond textblocks the run does not account for.
 * Link destinations are masked first (`maskDestinations`) so that no search
 * or diff matches text the plain text does not show.
 * The anchor loop and every diff share one deadline: past it, the remaining
 * text is emitted as one replaced span. A surrogate pair never straddles a
 * span boundary: anchors, trimmed prefixes and tokens stop outside pairs and
 * jsdiff's `diffChars` treats a pair as one character.
 *
 * Unlike `charHunks`, the result is not the minimal edit script; only the
 * offset mappers (remote carets) use it, never `rebaseText`.
 */
function anchoredHunks(from: string, markdown: string): Hunk[] {
  const out: Hunk[] = [];
  if (from === markdown) return out;
  const to = maskDestinations(markdown);
  const deadline = performance.now() + ALIGNMENT_BUDGET_MS;
  let fromPos = 0;
  let toPos = 0;
  let cursor = 0;
  let pieces = false;
  let run = new LineWalk(from, fromPos);
  // The block ends at the next `\n` or U+FFFC; the latter is looked up once
  // per run of blocks, not once per block.
  let nextHardBreak = -1;
  while (cursor < from.length && performance.now() < deadline) {
    let lineEnd = from.indexOf('\n', cursor);
    if (lineEnd === -1) lineEnd = from.length;
    if (nextHardBreak < cursor) {
      nextHardBreak = from.indexOf('\uFFFC', cursor);
      if (nextHardBreak === -1) nextHardBreak = from.length;
    }
    if (nextHardBreak < lineEnd) lineEnd = nextHardBreak;
    const slack = pieces ? PIECE_SEARCH_SLACK : ANCHOR_SEARCH_SLACK;
    const gap = Math.min(2 * (cursor - fromPos), MAX_ANCHOR_GAP);
    let at = -1;
    let anchor = cursor;
    let whole = false;
    let beyond = false;
    // Among the probes tried, the hit that skips the least markdown wins, so
    // a probe is only looked for short of the hit found so far.
    const consider = (start: number, end: number) => {
      let limit = toPos + gap + (end - cursor) + slack;
      if (at !== -1) limit = Math.min(limit, at - 1 + (end - start));
      run.advanceTo(start);
      const skipped = new LineWalk(to, toPos);
      // The run's text lines are all ended before the text at `start`, and
      // its line holds the same letters before `start` as the markdown line
      // holds before the hit (see `LineWalk`).
      const hit = findAnchor(to, from.slice(start, end), toPos, limit, (candidate) => {
        skipped.advanceTo(candidate);
        return skipped.lines >= run.lines && skipped.letters === run.letters;
      });
      if (hit === -1 || (at !== -1 && hit >= at)) return;
      // A hit past the textblocks the run accounts for may be a later
      // duplicate of the line; a shorter probe may still hit its original.
      if (skipped.advanceTo(hit).lines > run.linesWithHardBreaks) {
        beyond = true;
        return;
      }
      at = hit;
      anchor = start;
      whole = end === lineEnd;
    };
    const wholeLine = lineEnd - cursor >= MIN_ANCHOR_LENGTH;
    if (wholeLine) consider(cursor, lineEnd);
    if (at === -1 && pieces) {
      for (const [start, end] of pieceProbes(from, cursor, lineEnd)) {
        if (!(wholeLine && start === cursor && end === lineEnd)) consider(start, end);
      }
    }
    if (at !== -1) {
      const length = commonRun(from, anchor, to, at);
      refine(out, from, to, fromPos, anchor, toPos, at, deadline);
      fromPos = anchor + length;
      toPos = at + length;
      cursor = fromPos;
      pieces = !whole;
      run = new LineWalk(from, fromPos);
      continue;
    }
    // Re-walk the unanchored run in pieces once it is long enough — this
    // failed block included, so a long final paragraph is not skipped whole —
    // or once a block of it matches only beyond the run: the pieces consume
    // the markdown of the run's earlier blocks, and the block's own pieces
    // then anchor its original rather than the duplicate.
    if (!pieces && (beyond || lineEnd + 1 - fromPos > MAX_UNANCHORED_RUN)) {
      pieces = true;
      cursor = fromPos;
      run = new LineWalk(from, fromPos);
      nextHardBreak = -1;
    } else {
      cursor = pieces ? cursor + tokenLength(from, cursor) : lineEnd + 1;
    }
  }
  refine(out, from, to, fromPos, from.length, toPos, to.length, deadline);
  return out;
}

/**
 * The structure of `text[start, pos)` as `pos` advances, for `start` the last
 * anchor: the lines it ends that hold text — not blank, and not a code fence,
 * which delimits lines of text without being one — and the letters after its
 * last line break. Lines end at `\n`; `linesWithHardBreaks` also counts those
 * ended at U+FFFC, which in the plain text projects a hard break (a markdown
 * line of its own) or an inline leaf such as an image (which is not).
 *
 * Every plain-text line ends a markdown line of its own, so between the last
 * anchor (`fromPos`, `toPos`) and a hit `at` for the text at `cursor`, the
 * markdown must end at least as many text lines as the plain text crossed on
 * `\n` alone — a hit short of that is an earlier occurrence of the text
 * (`- a\n\npeer markdown\n\n**pee**r markdown`: the paragraph's markdown is
 * not the earlier paragraph) — and at most as many as it crossed counting
 * hard breaks too; a hit that ends more may be a later duplicate
 * (`**Repeated** heading\n\nRepeated heading`: the formatted original is a
 * text line inside the skipped markdown). The latter bound is not tight — a
 * setext underline or an HTML comment is a markdown line with no plain-text
 * line of its own — so a hit beyond it is declined rather than skipped over,
 * at a bounded cost: the text is anchored by its pieces instead, and its
 * later pieces are not held to this rule.
 *
 * The plain text and the markdown also hold the same letters between the
 * anchor and a true hit: block and inline syntax (`## `, `- `, `1. `, `> `,
 * `**`, `[`, a masked destination) adds none, while a word of an earlier
 * textblock on the hit's markdown line, or of the plain line itself before a
 * later occurrence of the probe (`**edi**tor caret. editor`), does. Only the
 * letters after the last break are compared, which keeps the comparison short
 * and confines a letter the syntax does add (a fence info string, a task
 * marker) to the line it is on.
 *
 * `advanceTo` is incremental for a non-decreasing `pos` — one pass over the
 * run however many probes and candidates read it — and restarts otherwise.
 */
class LineWalk {
  /** Text lines ended at `\n`. */
  lines = 0;
  /** Text lines ended at `\n` or U+FFFC. */
  linesWithHardBreaks = 0;
  /** Letters after the last line break. */
  letters = '';
  private pos: number;
  private lineStart: number;

  constructor(
    private readonly text: string,
    private readonly start: number,
  ) {
    this.pos = start;
    this.lineStart = start;
  }

  advanceTo(pos: number): this {
    if (pos < this.pos) {
      this.pos = this.start;
      this.lineStart = this.start;
      this.lines = 0;
      this.linesWithHardBreaks = 0;
      this.letters = '';
    }
    const { text } = this;
    let lineStart = this.lineStart;
    for (let i = this.pos; i < pos; i += 1) {
      const code = text.charCodeAt(i);
      if (code !== 10 && code !== 0xfffc) continue;
      if (isTextLine(text, lineStart, i)) {
        if (code === 10) this.lines += 1;
        this.linesWithHardBreaks += 1;
      }
      lineStart = i + 1;
    }
    const from = lineStart > this.lineStart ? lineStart : this.pos;
    const added = text.slice(from, pos).replace(NOT_LETTER, '');
    this.letters = lineStart > this.lineStart ? added : this.letters + added;
    this.lineStart = lineStart;
    this.pos = pos;
    return this;
  }
}

function isTextLine(text: string, start: number, end: number): boolean {
  let i = start;
  while (i < end && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i += 1;
  if (i >= end || text.charCodeAt(i) === 13) return false;
  const code = text.charCodeAt(i);
  const fence = (code === 96 || code === 126) && i + 2 < end;
  return !(fence && text.charCodeAt(i + 1) === code && text.charCodeAt(i + 2) === code);
}

/**
 * `[start, end)` of the word-level probes for the text of `from` at `cursor`,
 * tried after the rest of the line: the leading word, its first few code
 * units, and its last few — formatting may split the word either way
 * (`**pro**jection`, `projec**tion**`), and a probe on the split side of it
 * sees only a later occurrence of the word. A probe only locates the run;
 * `commonRun` then extends the anchor as far as the texts agree.
 */
function pieceProbes(from: string, cursor: number, lineEnd: number): Array<[number, number]> {
  const probes: Array<[number, number]> = [];
  WORD_AT.lastIndex = cursor;
  const word = WORD_AT.exec(from);
  const wordEnd = word ? Math.min(cursor + word[0].length, lineEnd) : cursor;
  if (wordEnd - cursor >= MIN_PIECE_LENGTH) probes.push([cursor, wordEnd]);
  let shortEnd = cursor + MIN_PIECE_LENGTH;
  if (isHighSurrogate(from.charCodeAt(shortEnd - 1))) shortEnd += 1;
  if (shortEnd <= lineEnd && shortEnd !== wordEnd) probes.push([cursor, shortEnd]);
  let tailStart = wordEnd - MIN_PIECE_LENGTH;
  if (isLowSurrogate(from.charCodeAt(tailStart))) tailStart -= 1;
  if (tailStart > cursor) probes.push([tailStart, wordEnd]);
  return probes;
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

/**
 * First occurrence of `block` in `to[start, limit)` that does not split a
 * surrogate pair and that `accept` admits.
 */
function findAnchor(
  to: string,
  block: string,
  start: number,
  limit: number,
  accept: (at: number) => boolean,
): number {
  const window = to.slice(start, Math.min(limit, to.length));
  let at = window.indexOf(block);
  while (
    at !== -1 &&
    (isHighSurrogate(to.charCodeAt(start + at - 1)) ||
      isLowSurrogate(to.charCodeAt(start + at + block.length)) ||
      !accept(start + at))
  ) {
    at = window.indexOf(block, at + 1);
  }
  return at === -1 ? -1 : start + at;
}

/**
 * `markdown` with every link destination and reference label — the text
 * between a `](` or `][` and its `)` / `]` on the same line — replaced by
 * U+0000, code unit for code unit. That text is absent from the plain text,
 * so neither an anchor search nor a diff may match a word inside it
 * (`[render](https://sync/…) sync` against `render sync`); the mask keeps
 * every other offset where it was.
 */
function maskDestinations(markdown: string): string {
  let out = '';
  let pos = 0;
  for (const match of markdown.matchAll(DESTINATION)) {
    const inner = match[0].slice(2, -1);
    const start = match.index + 2;
    out += markdown.slice(pos, start) + '\u0000'.repeat(inner.length);
    pos = start + inner.length;
  }
  return pos === 0 ? markdown : out + markdown.slice(pos);
}

/**
 * Append the replaced spans of `from[fromStart, fromEnd)` → `to[toStart, toEnd)`
 * to `out`: trim the common prefix and suffix, diff what is left by token,
 * then `diffChars` each replaced token span. Tokens first because a plain
 * word is a pure insertion apart from the syntax around it, and `diffChars`
 * alone would happily match its letters one by one inside `](https://…)`.
 * Two spans that only whitespace keeps apart are diffed as one (see
 * `mergeAcrossWhitespace`). Any diff past the budget emits its input as one
 * replaced span instead.
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
  // Nothing inside a long region anchored, and nothing is searched once the
  // budget is spent: either way the region is emitted as is.
  if (
    fromEnd - fromStart > MAX_REFINE_LENGTH ||
    toEnd - toStart > MAX_REFINE_LENGTH ||
    performance.now() >= deadline
  ) {
    out.push(whole);
    return;
  }
  // A `from` region that survives whole inside the `to` region — text between
  // two pieces of inline syntax — is a pure insertion around it; the diff
  // would say the same, at a cost per gap.
  const inside = findAnchor(to, from.slice(fromStart, fromEnd), toStart, toEnd, () => true);
  if (inside !== -1) {
    if (inside > toStart) out.push({ fromStart, fromEnd: fromStart, toStart, toEnd: inside });
    const after = inside + (fromEnd - fromStart);
    if (after < toEnd) out.push({ fromStart: fromEnd, fromEnd, toStart: after, toEnd });
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
  const spans = mergeAcrossWhitespace(
    groupChanges(
      words.map((part) => ({
        value: part.value.join(''),
        added: part.added,
        removed: part.removed,
      })),
      fromStart,
      toStart,
    ),
    from,
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

/**
 * Merge consecutive token spans whose only separation is equal whitespace.
 * A whitespace token matches as readily on one side of a change as on the
 * other — `render workspace` against `- **ren**der workspace` may pair the
 * space after `render` with the one after `-`, leaving `render` against `-`
 * and `**ren**der` as an insertion — so the two changes and the whitespace
 * are handed to `diffChars` as one span, where the letters pair up.
 */
function mergeAcrossWhitespace(spans: Hunk[], from: string): Hunk[] {
  const out: Hunk[] = [];
  for (const span of spans) {
    const previous = out.at(-1);
    if (previous && BLANK.test(from.slice(previous.fromEnd, span.fromStart))) {
      previous.fromEnd = span.fromEnd;
      previous.toEnd = span.toEnd;
    } else {
      out.push({ ...span });
    }
  }
  return out;
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
