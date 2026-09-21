import { diffArrays, diffChars } from 'diff';
import { normalizeAnchorPositions } from '$lib/utils/anchor-normalization';
import { createTiptapTaskListMarked } from '$lib/utils/tiptap-task-list-extension';

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
 * Words, whitespace runs, a masked run (see `maskHidden`), and single code
 * points (a surrogate pair is one token).
 */
const TOKEN = /[\p{L}\p{N}_]+|\s+|\0+|./gsu;
/** `TOKEN` anchored at `lastIndex`, for reading the one token that starts there. */
const TOKEN_AT = /[\p{L}\p{N}_]+|\s+|\0+|./suy;
const WORD_AT = /[\p{L}\p{N}_]+/uy;
const NOT_LETTER = /\P{L}+/gu;
const BLANK = /^\s+$/u;
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
 * of it would spend the whole budget on carets that clamp anyway. A region
 * that holds an unanchorable line (see `maskHidden`) is exempt: its text was
 * declined, not missing, and the deadline alone bounds its diff.
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
 * The markdown the editor does not show — link destinations, images, link
 * definitions — is masked first (`maskHidden`) so that no search or diff
 * matches it, and a markdown line with link syntax the mask did not account
 * for — every link line of a source too long to lex — is never anchored
 * (`Mask.unanchorable`): its text reaches a diff only, and that diff is
 * bounded by the line (`refineByLine`).
 * The mask, the anchor loop and every diff share one deadline: past it, the
 * remaining text is emitted as one replaced span. A surrogate pair never straddles a
 * span boundary: anchors, trimmed prefixes and tokens stop outside pairs and
 * jsdiff's `diffChars` treats a pair as one character.
 *
 * Unlike `charHunks`, the result is not the minimal edit script; only the
 * offset mappers (remote carets) use it, never `rebaseText`.
 */
function anchoredHunks(from: string, markdown: string): Hunk[] {
  const out: Hunk[] = [];
  if (from === markdown) return out;
  const deadline = performance.now() + ALIGNMENT_BUDGET_MS;
  const { text: to, unanchorable } = maskHidden(markdown);
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
    // The markdown the block is looked for in.
    const reach = toPos + gap + (lineEnd - cursor) + slack;
    let at = -1;
    let anchor = cursor;
    let whole = false;
    let beyond = false;
    let declined = false;
    // Among the probes tried, the hit that skips the least markdown wins, so
    // a probe is only looked for short of the hit found so far.
    const consider = (start: number, end: number) => {
      let limit = reach - (lineEnd - end);
      if (at !== -1) limit = Math.min(limit, at - 1 + (end - start));
      run.advanceTo(start);
      const skipped = new LineWalk(to, toPos);
      // The run's text lines are all ended before the text at `start`, and
      // its line holds the same letters before `start` as the markdown line
      // holds before the hit (see `LineWalk`); a hit on a line the mask did
      // not account for is declined.
      const hit = findAnchor(to, from.slice(start, end), toPos, limit, (candidate) => {
        if (overlaps(unanchorable, candidate, candidate + (end - start))) {
          if (end === lineEnd) declined = true;
          return false;
        }
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
      refine(out, from, to, fromPos, anchor, toPos, at, deadline, unanchorable);
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
    // then anchor its original rather than the duplicate. Likewise once the
    // markdown the block was looked for in holds an unanchorable line, unless
    // the block is that line's text: the pieces of the blocks around the line
    // anchor, so its text reaches the diff alone — the diff of a region that
    // holds the line and a neighbouring paragraph too would match the
    // paragraph's words inside the unmasked destination.
    if (
      !pieces &&
      (beyond ||
        lineEnd + 1 - fromPos > MAX_UNANCHORED_RUN ||
        (!declined && overlaps(unanchorable, toPos, reach)))
    ) {
      pieces = true;
      cursor = fromPos;
      run = new LineWalk(from, fromPos);
      nextHardBreak = -1;
    } else {
      // The rest of a line found whole on an unanchorable markdown line is
      // that line's text: none of its pieces anchor, so it is not walked in
      // pieces — for a long code span that walk is quadratic — and it reaches
      // the diff whole instead.
      cursor = pieces && !declined ? cursor + tokenLength(from, cursor) : lineEnd + 1;
    }
  }
  refine(out, from, to, fromPos, from.length, toPos, to.length, deadline, unanchorable);
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
 * `**`, `[`, a masked run) adds none, while a word of an earlier
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

/** The token shape `maskHidden` reads: `raw` is the source a token consumed. */
interface LexedToken {
  type: string;
  raw: string;
  tokens?: LexedToken[];
  items?: LexedToken[];
  header?: Array<{ tokens: LexedToken[] }>;
  rows?: Array<Array<{ tokens: LexedToken[] }>>;
}

/**
 * Where each line of a token's `text` — the string its children's `raw`s add
 * up to — starts in the source. Between two line starts the text and the
 * source run in step, so `sourceStarts[k] + (offset - lineStarts[k])` is the
 * source offset of `text[offset]` on line `k`.
 */
interface TextMap {
  text: string;
  lineStarts: number[];
  sourceStarts: number[];
}

/** Every hidden run — link destination, image, definition — sits after one of these. */
const HIDEABLE = /\]\(|\]\[|\]:/;
const HIDEABLE_ALL = /\]\(|\]\[|\]:/g;
/**
 * Longest markdown the mask lexes. The renderer's lexer is quadratic in the
 * token count (the `start` hooks of its math tokenizers scan the rest of the
 * source on every token): 16k one-link paragraphs of 128 KB lex in ~170 ms,
 * one 128 KB paragraph of 18k links in ~60 ms, and a 1 MB note of dense
 * links takes over half a second with the math tokenizers or without. A
 * longer source is not masked at all; see `maskHidden` for what holds then.
 */
const MAX_LEXED_LENGTH = 128 * 1024;
/** A comment anchor; the editor renders it where `normalizeAnchorPositions` moves it. */
const COMMENT_ANCHOR = '<!--anchor:';

let hiddenTextLexer: ReturnType<typeof createTiptapTaskListMarked> | undefined;

/**
 * The markdown as the alignment reads it: `text` with the hidden runs masked,
 * and `unanchorable` the sorted, flattened `[start, end)` ranges of the lines
 * of `text` that no anchor may land on.
 */
interface Mask {
  text: string;
  unanchorable: number[];
}

/** The last mask: the base text is aligned again each time the editor text changes. */
let lastMask: { markdown: string; mask: Mask } | undefined;

/**
 * `markdown` with the text the editor does not show — the destination and
 * title of a link (`](…)` or `][…]`), an image, the URL and title of a link
 * definition — replaced by U+0000, code unit for code unit. That text is
 * absent from the plain text, so neither an anchor search nor a diff may
 * match a word inside it (`[render](https://sync/…) sync` against
 * `render sync`); the mask keeps every other offset where it was.
 *
 * What is hidden is read off the tokens of the renderer's own marked
 * instance, not off the syntax: link-shaped text the lexer reads as a code
 * span, a fence, an escape or an unresolved reference label is visible, and
 * never produces a link token. Tokens carry no offsets, but each `raw` is the
 * source it consumed: at the top level the raws add up to the source, and
 * inside a container — list item, block quote, heading — the children see
 * the container's text with its marker and indentation gone, each line a
 * suffix of the source line (`suffixLineMap`); a table cell's text is found
 * in its row. A container whose text does not map back that way is left
 * unmasked, and every range is checked against the source before it is
 * masked — a gap in the mapping costs a mask, never a visible character.
 *
 * The renderer parses the markdown with its comment anchors moved off the
 * block markers they precede (`normalizeAnchorPositions`; a line keeps its
 * length, so every offset after the swapped prefix stays put), and so does
 * the lexer here: as written, `<!--anchor:…-->## a [b](c)` is an HTML block
 * that holds no link token.
 *
 * The mask must never fall through to a visible destination. Once masked,
 * an opener (`HIDEABLE`) not followed by a masked run — or by the closer of
 * an empty destination — is link syntax the lexer read as something else: a
 * code span, an escape, an unresolved reference, an HTML block whose text
 * the editor shows as written, a link in a source that was not lexed, or a
 * construct it has no token for. Its line is `unanchorable`
 * (`unanchorableLines`): the anchor search declines every hit on it and the
 * line's text reaches the diff instead (`refine`, whose length cap the line
 * lifts), which costs a longer diff on a visible code span, never a caret in
 * a URL.
 *
 * The lexer is the renderer's own, configured as the renderer configures it,
 * up to `MAX_LEXED_LENGTH`; a longer source is not lexed and nothing in it
 * is masked, so every line of it that holds link syntax is unanchorable and
 * reaches the diff alone, bounded by its own line (`refine` pairs the lines
 * of such a region one to one): a caret on a line without link syntax is
 * exact, and one on a link line stays on that line, off by at most its
 * hidden destination. Lexing counts against the alignment budget
 * (`anchoredHunks` starts its deadline before it) and is memoised for the
 * last markdown; a source with nothing hideable in it (`HIDEABLE`) is not
 * lexed either.
 */
function maskHidden(markdown: string): Mask {
  if (lastMask?.markdown === markdown) return lastMask.mask;
  const text = computeHiddenMask(markdown);
  const mask = { text, unanchorable: unanchorableLines(text) };
  lastMask = { markdown, mask };
  return mask;
}

function computeHiddenMask(markdown: string): string {
  if (!HIDEABLE.test(markdown) || markdown.length > MAX_LEXED_LENGTH) return markdown;
  let source = markdown;
  if (markdown.includes(COMMENT_ANCHOR)) {
    const normalized = normalizeAnchorPositions(markdown);
    if (normalized.length === markdown.length) source = normalized;
  }
  let tokens: LexedToken[];
  try {
    hiddenTextLexer ??= createTiptapTaskListMarked();
    tokens = hiddenTextLexer.lexer(source) as unknown as LexedToken[];
  } catch {
    return markdown;
  }
  const top: TextMap = { text: joinRaw(tokens), lineStarts: [0], sourceStarts: [0] };
  // marked normalises line endings; a source it rewrote has no exact offsets.
  if (top.text !== source) return markdown;
  const ranges: Array<[number, number]> = [];
  collectHidden(tokens, top, 0, markdown, ranges);
  if (ranges.length === 0) return markdown;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start < pos) continue;
    out += markdown.slice(pos, start) + '\u0000'.repeat(end - start);
    pos = end;
  }
  return out + markdown.slice(pos);
}

/**
 * The lines of `masked` that hold an opener the mask did not account for
 * (see `maskHidden`), as sorted, flattened `[start, end)` ranges. One pass:
 * a line is bounded once, at its first such opener, and the scan resumes
 * past its end, so the cost is linear in `masked` however many openers a
 * line holds.
 */
function unanchorableLines(masked: string): number[] {
  const lines: number[] = [];
  HIDEABLE_ALL.lastIndex = 0;
  let opener = HIDEABLE_ALL.exec(masked);
  while (opener) {
    const next = masked.charCodeAt(opener.index + 2);
    const closer = opener[0] === '](' ? 41 : opener[0] === '][' ? 93 : -1;
    if (next !== 0 && next !== closer) {
      const start = masked.lastIndexOf('\n', opener.index) + 1;
      let end = masked.indexOf('\n', opener.index);
      if (end === -1) end = masked.length;
      lines.push(start, end);
      HIDEABLE_ALL.lastIndex = end;
    }
    opener = HIDEABLE_ALL.exec(masked);
  }
  return lines;
}

/** Whether `[start, end)` meets one of the flattened `ranges`. */
function overlaps(ranges: number[], start: number, end: number): boolean {
  let low = 0;
  let high = ranges.length >> 1;
  // The first range that ends after `start`.
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ranges[2 * mid + 1] <= start) low = mid + 1;
    else high = mid;
  }
  return low < ranges.length >> 1 && ranges[2 * low] < end;
}

function joinRaw(tokens: LexedToken[]): string {
  let text = '';
  for (const token of tokens) text += token.raw;
  return text;
}

function mapToSource(map: TextMap, offset: number): number {
  let k = map.lineStarts.length - 1;
  while (k > 0 && map.lineStarts[k] > offset) k -= 1;
  return map.sourceStarts[k] + (offset - map.lineStarts[k]);
}

/**
 * The map of `text`, the children's text of the container whose `raw` sits at
 * `at` in `parent`: line `k` of `text` must be a suffix of line `k` of `raw` —
 * what is left once the marker or indentation before it is gone — and the
 * lines of `raw` after the last line of `text` must be blank. `undefined`
 * when `raw` is not shaped that way.
 */
function suffixLineMap(
  parent: TextMap,
  at: number,
  raw: string,
  text: string,
): TextMap | undefined {
  const rawLines = raw.split('\n');
  const textLines = text.split('\n');
  if (textLines.length > rawLines.length) return undefined;
  const map: TextMap = { text, lineStarts: [], sourceStarts: [] };
  let rawPos = 0;
  let textPos = 0;
  for (let k = 0; k < rawLines.length; k += 1) {
    const rawLine = rawLines[k];
    if (k < textLines.length) {
      const line = textLines[k];
      if (!rawLine.endsWith(line)) return undefined;
      map.lineStarts.push(textPos);
      map.sourceStarts.push(mapToSource(parent, at + rawPos) + (rawLine.length - line.length));
      textPos += line.length + 1;
    } else if (rawLine.trim() !== '') {
      return undefined;
    }
    rawPos += rawLine.length + 1;
  }
  return map;
}

/**
 * Append to `ranges` the source ranges hidden inside `tokens`, consecutive
 * in `map.text` from `at`.
 */
function collectHidden(
  tokens: LexedToken[],
  map: TextMap,
  at: number,
  source: string,
  ranges: Array<[number, number]>,
): void {
  for (const token of tokens) {
    const { raw } = token;
    if (token.type === 'link' || token.type === 'image') {
      collectHiddenInLink(token, map, at, source, ranges);
    } else if (token.type === 'def') {
      const colon = raw.indexOf(']:');
      if (colon !== -1) hide(map, at + colon + 2, at + raw.trimEnd().length, source, ranges);
    } else if (token.type === 'table') {
      collectHiddenInTable(token, map, at, source, ranges);
    } else {
      const children = token.tokens ?? token.items;
      if (children) {
        const inner = childMap(map, at, raw, joinRaw(children));
        if (inner) collectHidden(children, inner.map, inner.at, source, ranges);
      }
    }
    at += raw.length;
  }
}

/**
 * Where the children of the token whose `raw` sits at `at` in `parent` see
 * their text: at the start of `raw` (a paragraph, a list, an inline text
 * block), at its only occurrence on a one-line `raw` (`**` or `*` around it,
 * a heading's marker before it), or one suffix per line (`suffixLineMap`).
 */
function childMap(
  parent: TextMap,
  at: number,
  raw: string,
  text: string,
): { map: TextMap; at: number } | undefined {
  if (raw.startsWith(text)) return { map: parent, at };
  if (!text.includes('\n')) {
    const found = raw.indexOf(text);
    if (found !== -1 && raw.indexOf(text, found + 1) === -1) {
      return {
        map: { text, lineStarts: [0], sourceStarts: [mapToSource(parent, at + found)] },
        at: 0,
      };
    }
  }
  const map = suffixLineMap(parent, at, raw, text);
  return map && { map, at: 0 };
}

/**
 * An image shows as one object replacement character, so all of it is hidden.
 * A link shows its label, the text between `[` and `](` / `][`; the rest up to
 * the closing `)` / `]` is hidden. An autolink or a bare URL shows its text.
 */
function collectHiddenInLink(
  token: LexedToken,
  map: TextMap,
  at: number,
  source: string,
  ranges: Array<[number, number]>,
): void {
  const { raw } = token;
  if (token.type === 'image') {
    hide(map, at, at + raw.length, source, ranges);
    return;
  }
  const label = token.tokens ? joinRaw(token.tokens) : '';
  if (!token.tokens || raw.charCodeAt(0) !== 91 || !raw.startsWith(label, 1)) return;
  const after = 1 + label.length;
  const opener = raw.slice(after, after + 2);
  if ((opener === '](' || opener === '][') && raw.length > after + 2) {
    hide(map, at + after + 2, at + raw.length - 1, source, ranges);
  }
  collectHidden(token.tokens, map, at + 1, source, ranges);
}

/**
 * Line `0` of a table is its header, line `2 + i` its row `i`; each cell's
 * text (the cells are trimmed, so it is never blank) is the next occurrence
 * on its line after the cell before it.
 */
function collectHiddenInTable(
  token: LexedToken,
  map: TextMap,
  at: number,
  source: string,
  ranges: Array<[number, number]>,
): void {
  const lines = token.raw.split('\n');
  const lineStarts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStarts.push(pos);
    pos += line.length + 1;
  }
  const rows = [token.header ?? [], ...(token.rows ?? [])];
  rows.forEach((cells, index) => {
    const lineIndex = index === 0 ? 0 : index + 1;
    const line = lines[lineIndex];
    if (line === undefined) return;
    let cellPos = 0;
    for (const cell of cells) {
      const text = joinRaw(cell.tokens);
      if (text === '') continue;
      const found = line.indexOf(text, cellPos);
      if (found === -1) return;
      const cellMap: TextMap = {
        text,
        lineStarts: [0],
        sourceStarts: [mapToSource(map, at + lineStarts[lineIndex]) + found],
      };
      collectHidden(cell.tokens, cellMap, 0, source, ranges);
      cellPos = found + text.length;
    }
  });
}

/**
 * Append the source ranges of `map.text[start, end)` to `ranges`, one per
 * line, each only if the source holds that text there.
 */
function hide(
  map: TextMap,
  start: number,
  end: number,
  source: string,
  ranges: Array<[number, number]>,
): void {
  let pos = start;
  while (pos < end) {
    let lineEnd = map.text.indexOf('\n', pos);
    if (lineEnd === -1 || lineEnd > end) lineEnd = end;
    if (lineEnd > pos) {
      const from = mapToSource(map, pos);
      if (source.startsWith(map.text.slice(pos, lineEnd), from)) {
        ranges.push([from, from + (lineEnd - pos)]);
      }
    }
    pos = lineEnd + 1;
  }
}

/**
 * Append the replaced spans of `from[fromStart, fromEnd)` → `to[toStart, toEnd)`
 * to `out`: trim the common prefix and suffix, diff what is left by token,
 * then `diffChars` each replaced token span. Tokens first because a plain
 * word is a pure insertion apart from the syntax around it, and `diffChars`
 * alone would happily match its letters one by one inside `](https://…)`.
 * Two spans that only whitespace keeps apart are diffed as one (see
 * `mergeAcrossWhitespace`). A region that meets an `unanchorable` line of
 * `to` is diffed line by line (`refineByLine`), and one longer than
 * `MAX_REFINE_LENGTH` is not diffed unless it meets such a line; any diff
 * past the budget emits its input as one replaced span instead.
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
  unanchorable: number[],
): void {
  if (
    overlaps(unanchorable, toStart, toEnd) &&
    refineByLine(out, from, to, fromStart, fromEnd, toStart, toEnd, deadline, unanchorable)
  ) {
    return;
  }
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
  // Nothing is searched once the budget is spent: the region is emitted as is.
  if (performance.now() >= deadline) {
    out.push(whole);
    return;
  }
  // A `from` region that survives whole inside the `to` region — text between
  // two pieces of inline syntax, or a code span between its backticks — is a
  // pure insertion around it; the diff would say the same, at a cost per gap.
  // One linear search, however long the region.
  const inside = findAnchor(to, from.slice(fromStart, fromEnd), toStart, toEnd, () => true);
  if (inside !== -1) {
    if (inside > toStart) out.push({ fromStart, fromEnd: fromStart, toStart, toEnd: inside });
    const after = inside + (fromEnd - fromStart);
    if (after < toEnd) out.push({ fromStart: fromEnd, fromEnd, toStart: after, toEnd });
    return;
  }
  // Nothing inside a long region anchored — unless its anchors were declined
  // (an unanchorable line), in which case the deadline alone bounds its diff
  // — so the region is emitted as is.
  if (
    (fromEnd - fromStart > MAX_REFINE_LENGTH || toEnd - toStart > MAX_REFINE_LENGTH) &&
    !overlaps(unanchorable, toStart, toEnd)
  ) {
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

/**
 * `refine` a region that holds an unanchorable line of `to` — one with link
 * syntax the mask did not account for, every line of a source past
 * `MAX_LEXED_LENGTH` included — one line at a time. Each plain-text line ends
 * a markdown line of its own, so when the region holds as many lines of text
 * on each side they pair up in order, and each pair is diffed alone with the
 * line breaks and blank lines between them as the boundaries: a word of the
 * next paragraph is never matched inside the destination on the link line
 * (`**sel**ection daemon` after `[render](https://sync/selection/editor)`),
 * whichever pairing the diff of the whole region would have chosen. Blank
 * lines are not lines of text; a region whose sides hold a different number
 * of lines — a fence, a setext underline or an HTML comment is a markdown
 * line with no plain-text line of its own — is not paired, and `false` is
 * returned for `refine` to diff it whole.
 */
function refineByLine(
  out: Hunk[],
  from: string,
  to: string,
  fromStart: number,
  fromEnd: number,
  toStart: number,
  toEnd: number,
  deadline: number,
  unanchorable: number[],
): boolean {
  const fromLines = textLines(from, fromStart, fromEnd);
  const toLines = textLines(to, toStart, toEnd);
  if (fromLines.length === 0 || fromLines.length !== toLines.length) return false;
  if (fromLines.length === 1) {
    // One line each: the pair is the region itself unless a break bounds it.
    const lineBreak = to.indexOf('\n', toStart);
    if (lineBreak === -1 || lineBreak >= toEnd) return false;
  }
  let fromPos = fromStart;
  let toPos = toStart;
  for (let k = 0; k < fromLines.length; k += 1) {
    const [lineFrom, lineFromEnd] = fromLines[k];
    const [lineTo, lineToEnd] = toLines[k];
    refine(out, from, to, fromPos, lineFrom, toPos, lineTo, deadline, unanchorable);
    refine(out, from, to, lineFrom, lineFromEnd, lineTo, lineToEnd, deadline, unanchorable);
    fromPos = lineFromEnd;
    toPos = lineToEnd;
  }
  refine(out, from, to, fromPos, fromEnd, toPos, toEnd, deadline, unanchorable);
  return true;
}

/** The `[start, end)` of each line of `text[start, end)` that is not blank, without its line break. */
function textLines(text: string, start: number, end: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let pos = start;
  while (pos < end) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1 || lineEnd > end) lineEnd = end;
    if (lineEnd > pos && !BLANK.test(text.slice(pos, lineEnd))) lines.push([pos, lineEnd]);
    pos = lineEnd + 1;
  }
  return lines;
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
