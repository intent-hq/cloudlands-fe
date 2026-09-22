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
/** `-`, `=`, `*`, `_`, `|`, `:` — a line of these alone is a setext underline, a thematic break or a table delimiter row. */
const RULE = new Set([45, 61, 42, 95, 124, 58]);
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
  const { text: to, unanchorable, splits } = maskHidden(markdown);
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
      const skipped = new LineWalk(to, toPos, splits, run);
      // The run's text lines are all ended before the text at `start` — by
      // text lines of the markdown, or by an image splitting one — and its
      // line holds the same letters before `start` as the markdown line
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
 * anchor: the lines it ends that hold text (`isTextLine`: not blank, and not
 * a line of syntax alone — a code fence, a setext underline, a definition —
 * which delimits or annotates lines of text without being one) and the
 * letters after its last line break. Lines end at `\n`; `linesWithHardBreaks`
 * also counts those ended at U+FFFC, which in the plain text projects a hard
 * break (a markdown line of its own) or an inline leaf such as a mention
 * (which is not).
 *
 * In the markdown a line may also end at an image (`splits`, the offsets of
 * its `![`): the note editor shows an image as a block, so the paragraph's
 * text before it and after it are plain-text lines of their own, where an
 * editor without the image block shows the paragraph on one line. Which of
 * the two the plain text did is read off the plain text: the image ended a
 * line if the walk over the plain text (`plain`, advanced to the probe) ended
 * a line holding the letters of the markdown before the image — the lines
 * are paired in order, an unpaired plain line (a mention's) skipped — and is
 * no line break otherwise.
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
 * line of an HTML block or of a multi-line comment is a markdown line with
 * no plain-text line of its own — so a hit beyond it is declined rather than
 * skipped over, at a bounded cost: the text is anchored by its pieces
 * instead, and its later pieces are not held to this rule.
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
  /** Text lines ended at `\n` (or at an image the plain text ended a line at). */
  lines = 0;
  /** Text lines ended at `\n`, U+FFFC or such an image. */
  linesWithHardBreaks = 0;
  /** Letters after the last line break. */
  letters = '';
  /** The `[start, end)` of every text line ended, flattened, in order. */
  private readonly ended: number[] = [];
  /** The next line of `plain` an image may be paired with. */
  private plainLine = 0;
  private pos: number;
  private lineStart: number;
  private nextSplit: number;

  constructor(
    private readonly text: string,
    private readonly start: number,
    private readonly splits: number[] = [],
    private readonly plain?: LineWalk,
  ) {
    this.pos = start;
    this.lineStart = start;
    this.nextSplit = lowerBound(splits, start);
  }

  advanceTo(pos: number): this {
    if (pos < this.pos) {
      this.pos = this.start;
      this.lineStart = this.start;
      this.lines = 0;
      this.linesWithHardBreaks = 0;
      this.letters = '';
      this.ended.length = 0;
      this.plainLine = 0;
      this.nextSplit = lowerBound(this.splits, this.start);
    }
    const { text, splits } = this;
    let lineStart = this.lineStart;
    for (let i = this.pos; i < pos; i += 1) {
      const code = text.charCodeAt(i);
      const split = this.nextSplit < splits.length && splits[this.nextSplit] === i;
      if (split) this.nextSplit += 1;
      else if (code !== 10 && code !== 0xfffc) continue;
      if (isTextLine(text, lineStart, i)) {
        if (split) {
          const paired = this.pairPlainLine(lettersOf(text, lineStart, i));
          if (paired === -1) continue;
          this.plainLine = paired + 1;
        } else if (this.plainLine < (this.plain?.ended.length ?? 0) >> 1) {
          this.plainLine += 1;
        }
        if (split || code === 10) this.lines += 1;
        this.linesWithHardBreaks += 1;
        this.ended.push(lineStart, i);
      } else if (split) continue;
      lineStart = split ? i : i + 1;
    }
    const from = lineStart > this.lineStart ? lineStart : this.pos;
    const added = lettersOf(text, from, pos);
    this.letters = lineStart > this.lineStart ? added : this.letters + added;
    this.lineStart = lineStart;
    this.pos = pos;
    return this;
  }

  /** The first line of `plain` from `plainLine` on holding `letters`, or -1. */
  private pairPlainLine(letters: string): number {
    const { plain } = this;
    if (!plain) return -1;
    for (let k = this.plainLine; k < plain.ended.length >> 1; k += 1) {
      if (lettersOf(plain.text, plain.ended[2 * k], plain.ended[2 * k + 1]) === letters) return k;
    }
    return -1;
  }
}

function lettersOf(text: string, start: number, end: number): string {
  return text.slice(start, end).replace(NOT_LETTER, '');
}

/** The index of the first element of sorted `values` that is `>= at`. */
function lowerBound(values: number[], at: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Whether `text[start, end)` is a line the editor shows text of: not blank,
 * not masked whole (a definition, an image, a hidden HTML block below the
 * cap), not a code fence, not a setext underline, thematic break or table
 * delimiter row (`RULE` characters only), and — unmasked, past the cap — not
 * a link reference definition nor a comment the whole line long. A markdown
 * line that is none of a plain-text line's must not count as one: counted, it
 * puts every hit for the rest of the run one text line beyond the run, until
 * a hard break of the plain text (counted on one side only) admits a hit one
 * line short of the text's own; and two such lines before a run of pieces
 * stand in for two plain-text lines the run crossed, so a hit that opens the
 * paragraph two lines short of the text's own ends as many text lines as
 * the run did.
 */
function isTextLine(text: string, start: number, end: number): boolean {
  let i = start;
  while (
    i < end &&
    (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9 || text.charCodeAt(i) === 0)
  ) {
    i += 1;
  }
  if (i >= end || text.charCodeAt(i) === 13) return false;
  const code = text.charCodeAt(i);
  if (code === 96 || code === 126) {
    return !(i + 2 < end && text.charCodeAt(i + 1) === code && text.charCodeAt(i + 2) === code);
  }
  if (RULE.has(code)) {
    let j = i + 1;
    while (
      j < end &&
      (RULE.has(text.charCodeAt(j)) || text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)
    ) {
      j += 1;
    }
    return j < end && text.charCodeAt(j) !== 13;
  }
  if (code === 91) {
    let close = i + 1;
    while (close < end && text.charCodeAt(close) !== 93) close += 1;
    const after = close + 2 < end ? text.charCodeAt(close + 2) : 32;
    return !(
      close > i + 1 &&
      close + 1 < end &&
      text.charCodeAt(close + 1) === 58 &&
      (after === 32 || after === 9 || after === 0)
    );
  }
  if (code === 60 && text.startsWith('<!--', i)) {
    let last = end;
    while (last > i && (text.charCodeAt(last - 1) === 32 || text.charCodeAt(last - 1) === 9)) {
      last -= 1;
    }
    return !(last - i >= 7 && text.startsWith('-->', last - 3));
  }
  return true;
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
 * The HTML the renderer hides in a markdown note: a comment that is not a
 * comment anchor, and the tags it leaves unescaped and renders (`<br>`,
 * `<sub>`, `<sup>`; every other tag is escaped and shown as written).
 */
const HIDDEN_HTML = /<!--(?!anchor:)[\s\S]*?-->|<br[ \t]*\/?>|<\/?su[bp]>/gi;
/** Every tag and comment: what an HTML parser consumes of a note it reads as HTML. */
const HTML_TAG = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
/**
 * A line the renderer may read as HTML — one whose first character is `<`
 * before anything but whitespace or a comment anchor — or that holds a
 * comment it hides. Such a line is sealed when the mask did not account for
 * it (`unanchorableLines`).
 */
const HTML_LINE = /^[ \t]*<(?![ \t\r\n]|!--anchor:)|<!--(?!anchor:)/gm;
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
 * `unanchorable` the sorted, flattened `[start, end)` ranges of the lines
 * of `text` that no anchor may land on, and `splits` the sorted offsets of
 * the images (`![`), each of which the editor may split a plain-text line at
 * (see `LineWalk`).
 */
interface Mask {
  text: string;
  unanchorable: number[];
  splits: number[];
}

const IMAGE_OPENER = /!\[/g;

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
 * The HTML the renderer hides is masked the same way. A note whose first
 * character is `<` (other than a comment anchor) the renderer does not parse
 * as markdown at all but as HTML, so every tag and comment in it is hidden
 * (`HTML_TAG`) and the text between them shown; in any other note a tag is
 * escaped and shown as written, except a comment (dropped) and the `<br>`,
 * `<sub>`, `<sup>` it renders (`HIDDEN_HTML`), which are read off the
 * lexer's `html` tokens.
 *
 * The lexer is the renderer's own, configured as the renderer configures it,
 * up to `MAX_LEXED_LENGTH`; a longer source is not lexed and nothing in it
 * is masked, so every line of it that holds link syntax is unanchorable, and
 * so is a line the renderer may read as HTML (`HTML_LINE`): each reaches the
 * diff alone, bounded by its own line (`refineByLine` pairs the lines of
 * such a region by their text and never diffs a plain-text line against a
 * sealed line it is not the text of), so a caret on a line without link
 * syntax is exact, and one on a link line stays on that line, off by at
 * most its hidden destination. Lexing counts against the alignment budget
 * (`anchoredHunks` starts its deadline before it) and is memoised for the
 * last markdown; a source with nothing hideable in it (`HIDEABLE`,
 * `HIDDEN_HTML`) is not lexed either.
 */
function maskHidden(markdown: string): Mask {
  if (lastMask?.markdown === markdown) return lastMask.mask;
  const text = computeHiddenMask(markdown);
  const splits: number[] = [];
  for (const image of markdown.matchAll(IMAGE_OPENER)) splits.push(image.index);
  const mask = {
    text: text ?? markdown,
    unanchorable: unanchorableLines(text ?? markdown, text === undefined),
    splits,
  };
  lastMask = { markdown, mask };
  return mask;
}

/** `markdown` masked, or `undefined` when its hidden text could not be accounted for. */
function computeHiddenMask(markdown: string): string | undefined {
  if (markdown.length > MAX_LEXED_LENGTH) return undefined;
  if (isHtmlNote(markdown)) return maskMatches(markdown, HTML_TAG);
  HIDDEN_HTML.lastIndex = 0;
  if (!HIDEABLE.test(markdown) && !HIDDEN_HTML.test(markdown)) return markdown;
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
    return undefined;
  }
  const top: TextMap = { text: joinRaw(tokens), lineStarts: [0], sourceStarts: [0] };
  // marked normalises line endings; a source it rewrote has no exact offsets.
  if (top.text !== source) return undefined;
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

/** Whether the renderer reads `markdown` as HTML rather than markdown (its `skipIfHTML`). */
function isHtmlNote(markdown: string): boolean {
  const trimmed = markdown.trimStart();
  return (
    trimmed.charCodeAt(0) === 60 &&
    !trimmed.startsWith(COMMENT_ANCHOR) &&
    !markdown.includes('```ws-block')
  );
}

/** `text` with every match of `pattern` replaced by U+0000, code unit for code unit. */
function maskMatches(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => '\u0000'.repeat(match.length));
}

/**
 * The lines of `masked` that hold an opener the mask did not account for
 * (see `maskHidden`) — and, when the mask accounted for nothing (`unmasked`),
 * the lines the renderer may read as HTML (`HTML_LINE`) — as sorted,
 * flattened `[start, end)` ranges. One pass per pattern: a line is bounded
 * once, at its first such opener, and the scan resumes past its end, so the
 * cost is linear in `masked` however many openers a line holds.
 */
function unanchorableLines(masked: string, unmasked = false): number[] {
  const lines: number[] = [];
  HIDEABLE_ALL.lastIndex = 0;
  let opener = HIDEABLE_ALL.exec(masked);
  while (opener) {
    const next = masked.charCodeAt(opener.index + 2);
    const closer = opener[0] === '](' ? 41 : opener[0] === '][' ? 93 : -1;
    if (next !== 0 && next !== closer) {
      HIDEABLE_ALL.lastIndex = pushLine(lines, masked, opener.index);
    }
    opener = HIDEABLE_ALL.exec(masked);
  }
  if (!unmasked) return lines;
  const html: number[] = [];
  HTML_LINE.lastIndex = 0;
  let tag = HTML_LINE.exec(masked);
  while (tag) {
    HTML_LINE.lastIndex = pushLine(html, masked, tag.index);
    tag = HTML_LINE.exec(masked);
  }
  return html.length === 0 ? lines : mergeLines(lines, html);
}

/** Push the `[start, end)` of the line of `text` at `at` and return `end`. */
function pushLine(lines: number[], text: string, at: number): number {
  const start = text.lastIndexOf('\n', at) + 1;
  let end = text.indexOf('\n', at);
  if (end === -1) end = text.length;
  lines.push(start, end);
  return end;
}

/** Merge two sorted, flattened line lists, each line once. */
function mergeLines(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || (i < a.length && a[i] <= b[j]) ? a : b;
    const start = next === a ? a[i] : b[j];
    const end = next === a ? a[i + 1] : b[j + 1];
    if (next === a) i += 2;
    else j += 2;
    if (out.length === 0 || out[out.length - 2] !== start) out.push(start, end);
  }
  return out;
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
    } else if (token.type === 'html') {
      HIDDEN_HTML.lastIndex = 0;
      let hidden = HIDDEN_HTML.exec(raw);
      while (hidden) {
        hide(map, at + hidden.index, at + hidden.index + hidden[0].length, source, ranges);
        hidden = HIDDEN_HTML.exec(raw);
      }
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
 * to `out`. A region that meets an `unanchorable` line of `to` is diffed
 * line by line (`refineByLine`); any other region is diffed whole
 * (`diffRegion`).
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
  if (overlaps(unanchorable, toStart, toEnd)) {
    refineByLine(out, from, to, fromStart, fromEnd, toStart, toEnd, deadline, unanchorable);
  } else {
    diffRegion(out, from, to, fromStart, fromEnd, toStart, toEnd, deadline, unanchorable);
  }
}

/**
 * Append the replaced spans of `from[fromStart, fromEnd)` → `to[toStart, toEnd)`
 * to `out`: trim the common prefix and suffix, diff what is left by token,
 * then `diffChars` each replaced token span. Tokens first because a plain
 * word is a pure insertion apart from the syntax around it, and `diffChars`
 * alone would happily match its letters one by one inside `](https://…)`.
 * Two spans that only whitespace keeps apart are diffed as one (see
 * `mergeAcrossWhitespace`). A region longer than `MAX_REFINE_LENGTH` is not
 * diffed unless it meets an `unanchorable` line; any diff past the budget
 * emits its input as one replaced span instead.
 */
function diffRegion(
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
 * `refine` a region that holds a sealed line of `to` — one with link syntax
 * the mask did not account for, or that the renderer may read as HTML; every
 * such line of a source past `MAX_LEXED_LENGTH` — one line at a time, so
 * that a word of the plain text is never matched inside the unmasked
 * destination on a link line it is not the text of (`**sel**ection daemon`
 * after `[render](https://sync/selection/editor)`), whichever pairing the
 * diff of the whole region would have chosen.
 *
 * The lines of plain text (`\n` or U+FFFC ends one; a blank line is not
 * one) are paired with the lines of markdown by their text, not by count
 * (`pairLines`): the letters of a plain line are those of its markdown line
 * with the syntax gone, so they are a subsequence of it, and a run of plain
 * lines an inline leaf split is paired with the one markdown line that holds
 * them all. A markdown line no plain line is the text of — a fence, a
 * setext underline, a comment, a line of a note the renderer collapsed — is
 * deleted against nothing, and a plain line no markdown line accounts for is
 * inserted. Each pair is diffed alone (`diffRegion`), and so is each gap
 * between pairs unless a sealed line lies in it: that gap is emitted as one
 * replaced span, never diffed, so a position of its plain text maps to the
 * gap's end and a position of the sealed line to the end of the plain text
 * before it — neither into the other.
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
): void {
  const fragments = textLines(from, fromStart, fromEnd, true);
  const lines = textLines(to, toStart, toEnd, false, unanchorable);
  const gap = (fromA: number, fromB: number, toA: number, toB: number) => {
    if (fromA === fromB && toA === toB) return;
    if (!overlaps(unanchorable, toA, toB)) {
      diffRegion(out, from, to, fromA, fromB, toA, toB, deadline, unanchorable);
      return;
    }
    out.push({ fromStart: fromA, fromEnd: fromB, toStart: toA, toEnd: toB });
  };
  let fromPos = fromStart;
  let toPos = toStart;
  for (const [first, last, line] of pairLines(fragments, lines, deadline)) {
    const fromA = fragments[first].start;
    const fromB = fragments[last].end;
    gap(fromPos, fromA, toPos, line.start);
    diffRegion(out, from, to, fromA, fromB, line.start, line.end, deadline, unanchorable);
    fromPos = fromB;
    toPos = line.end;
  }
  gap(fromPos, fromEnd, toPos, toEnd);
}

/** A line of text without its break, the letters and digits on it, and whether it is sealed. */
interface TextLine {
  start: number;
  end: number;
  letters: string;
  sealed: boolean;
}

const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/**
 * The lines of `text[start, end)` that hold a letter or a digit, without
 * their breaks: `\n`, and with `hardBreaks` U+FFFC too.
 */
function textLines(
  text: string,
  start: number,
  end: number,
  hardBreaks: boolean,
  unanchorable: number[] = [],
): TextLine[] {
  const lines: TextLine[] = [];
  let pos = start;
  while (pos < end) {
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1 || lineEnd > end) lineEnd = end;
    if (hardBreaks) {
      const hardBreak = text.indexOf('\uFFFC', pos);
      if (hardBreak !== -1 && hardBreak < lineEnd) lineEnd = hardBreak;
    }
    if (lineEnd > pos) {
      const letters = text.slice(pos, lineEnd).replace(NOT_LETTER_OR_DIGIT, '');
      if (letters !== '') {
        lines.push({
          start: pos,
          end: lineEnd,
          letters,
          sealed: overlaps(unanchorable, pos, lineEnd),
        });
      }
    }
    pos = lineEnd + 1;
  }
  return lines;
}

/** Most `fragments × lines` the pairing searches; past it, or past the deadline, nothing is paired. */
const MAX_PAIRING_CELLS = 1 << 18;

/**
 * The pairs `[first, last, line]` — the run of `fragments[first..last]` that
 * is the text of `line` — of the pairing of the plain-text `fragments` with
 * the markdown `lines`, in order on both sides, that accounts for the most
 * letters: a run is the text of a line when its letters are a subsequence of
 * the line's, and among pairings of equal letters one whose letters are equal
 * to the line's outranks one whose letters the syntax on the line pads, and
 * a pair on a line the mask accounted for outranks one on a sealed line —
 * so a paragraph beside a link line is never taken for the text of the link
 * line when it has a line of its own. A dynamic programme over the two
 * sequences; empty once the search would exceed `MAX_PAIRING_CELLS` or the
 * `deadline`, which the caller degrades safely.
 */
function pairLines(
  fragments: TextLine[],
  lines: TextLine[],
  deadline: number,
): Array<[number, number, TextLine]> {
  const n = fragments.length;
  const m = lines.length;
  if (n === 0 || m === 0 || n * m > MAX_PAIRING_CELLS) return [];
  const width = m + 1;
  // Best letters accounted for by `fragments[0, i)` and `lines[0, k)`; -1 unreached.
  const best = new Int32Array((n + 1) * width).fill(-1);
  // How the best was reached: -1 skipped a fragment, -2 skipped a line, r ≥ 0 paired a run of r + 1 fragments.
  const via = new Int8Array((n + 1) * width);
  best[0] = 0;
  for (let i = 0; i <= n; i += 1) {
    if (performance.now() >= deadline) return [];
    for (let k = 0; k <= m; k += 1) {
      const cell = i * width + k;
      if (i > 0 && best[cell - width] > best[cell]) {
        best[cell] = best[cell - width];
        via[cell] = -1;
      }
      if (k > 0 && best[cell - 1] > best[cell]) {
        best[cell] = best[cell - 1];
        via[cell] = -2;
      }
      if (best[cell] < 0 || i === n || k === m) continue;
      const line = lines[k];
      let at = 0;
      let letters = 0;
      for (let j = i; j < n && j - i < 127; j += 1) {
        at = subsequenceEnd(line.letters, fragments[j].letters, at);
        if (at === -1) break;
        letters += fragments[j].letters.length;
        const rank = letters === line.letters.length ? 2 : line.sealed ? 0 : 1;
        const score = best[cell] + 3 * letters + rank;
        const target = (j + 1) * width + k + 1;
        if (score > best[target]) {
          best[target] = score;
          via[target] = j - i;
        }
      }
    }
  }
  const pairs: Array<[number, number, TextLine]> = [];
  let i = n;
  let k = m;
  while (i > 0 || k > 0) {
    const step = via[i * width + k];
    if (step === -1) i -= 1;
    else if (step === -2) k -= 1;
    else {
      pairs.push([i - step - 1, i - 1, lines[k - 1]]);
      i -= step + 1;
      k -= 1;
    }
  }
  return pairs.reverse();
}

/** Where `needle` ends as a subsequence of `text` searched from `at`, or -1. */
function subsequenceEnd(text: string, needle: string, at: number): number {
  for (let i = 0; i < needle.length; i += 1) {
    at = text.indexOf(needle[i], at);
    if (at === -1) return -1;
    at += 1;
  }
  return at;
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
