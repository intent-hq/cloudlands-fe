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
 * remaining text is emitted as one replaced span, except that a region with
 * an unanchorable line is still paired line by line, with no diff, so the
 * line stays bounded by its own text. A surrogate pair never straddles a
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
      if (skipped.advanceTo(hit).linesWithHardBreaks > run.linesWithHardBreaks) {
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
 * In the markdown a line may also end at an image or at a table cell
 * (`splits`, the offsets of its `![` and of its unescaped `|`): the note
 * editor shows an image as a block and each cell of a row as a block, so the
 * text before and after the image, or of each cell, are plain-text lines of
 * their own, where an editor without the image or table block shows the
 * paragraph or the row on one line. Which of the two the plain text did is
 * read off the plain text: the image or the cell ended a line if the walk
 * over the plain text (`plain`, advanced to the probe) ended a line holding
 * the letters of the markdown before the split — the lines are paired in
 * order, an unpaired plain line (a mention's) skipped — and is no line break
 * otherwise; so a row of the note editor counts one line per cell and a
 * `|` in prose counts nothing.
 *
 * A markdown line ended at `\n` is paired the same way, so that a hard break
 * (`tk298z  \n`, a lazy continuation) — two markdown lines the plain text
 * shows as one, its `\n` a U+FFFC — counts toward `linesWithHardBreaks` but
 * not `lines`, as it does on the plain text; a markdown line no plain line
 * pairs with counts toward both, as before.
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
  /**
   * Text lines ended at `\n` (or at a split the plain text ended a line at),
   * less those paired with a plain line ended at U+FFFC.
   */
  lines = 0;
  /** Text lines ended at `\n`, U+FFFC or such a split. */
  linesWithHardBreaks = 0;
  /** Letters after the last line break. */
  letters = '';
  /** The `[start, end)` of every text line ended, flattened, in order. */
  private readonly ended: number[] = [];
  /** The letters of the text lines ended, by index, once asked for. */
  private readonly endedLetters: string[] = [];
  /** The next line of `plain` a line may be paired with. */
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
      this.endedLetters.length = 0;
      this.plainLine = 0;
      this.nextSplit = lowerBound(this.splits, this.start);
    }
    const { text, splits, plain } = this;
    let lineStart = this.lineStart;
    for (let i = this.pos; i < pos; i += 1) {
      const code = text.charCodeAt(i);
      const split = this.nextSplit < splits.length && splits[this.nextSplit] === i;
      if (split) this.nextSplit += 1;
      else if (code !== 10 && code !== 0xfffc) continue;
      if (isTextLine(text, lineStart, i)) {
        const paired = plain ? this.pairPlainLine(plain, lettersOf(text, lineStart, i)) : -1;
        if (paired === -1 || !plain) {
          if (split) continue;
          if (this.plainLine < (plain?.ended.length ?? 0) >> 1) this.plainLine += 1;
          if (code === 10) this.lines += 1;
        } else {
          this.plainLine = paired + 1;
          if (!plain.endsHard(paired)) this.lines += 1;
        }
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

  /**
   * The first line of `plain` from `plainLine` on holding `letters`, or -1.
   * The search is short — a mention's plain line or two is the most an
   * ordinary line skips — so a run of markdown lines with no plain-text
   * lines of their own (an HTML block) does not read the whole plain text
   * over for each of them.
   */
  private pairPlainLine(plain: LineWalk, letters: string): number {
    const end = Math.min(plain.ended.length >> 1, this.plainLine + PAIR_LOOKAHEAD);
    for (let k = this.plainLine; k < end; k += 1) {
      if (plain.lettersOfLine(k) === letters) return k;
    }
    return -1;
  }

  /** The letters of the `k`th text line ended, computed once. */
  private lettersOfLine(k: number): string {
    return (this.endedLetters[k] ??= lettersOf(
      this.text,
      this.ended[2 * k],
      this.ended[2 * k + 1],
    ));
  }

  /** Whether the `k`th text line ended was ended at U+FFFC. */
  private endsHard(k: number): boolean {
    return this.text.charCodeAt(this.ended[2 * k + 1]) === 0xfffc;
  }
}

/** Plain-text lines a markdown line looks past for its own — see `pairPlainLine`. */
const PAIR_LOOKAHEAD = 8;

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
 * delimiter row (`RULE` characters only), not the label line of a link
 * reference definition (`[label]:` with nothing but masked text after it;
 * one that visible text follows continues a paragraph and is shown as
 * written) and not a comment anchor the whole line long. A markdown
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
    if (close === i + 1 || close + 1 >= end || text.charCodeAt(close + 1) !== 58) return true;
    let after = close + 2;
    while (after < end && (text.charCodeAt(after) === 32 || text.charCodeAt(after) === 9)) {
      after += 1;
    }
    return after < end && text.charCodeAt(after) !== 0 && text.charCodeAt(after) !== 13;
  }
  if (code === 60 && text.startsWith(COMMENT_ANCHOR, i)) {
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
 * longer source is not lexed: its comments and link definitions are masked
 * by a linear scan (`maskHiddenBlocks`), as are the tags of a note the
 * renderer reads as HTML (`maskHtmlTags`); see `maskHidden` for what holds
 * then.
 */
const MAX_LEXED_LENGTH = 128 * 1024;
/** A comment anchor; the editor renders it where `normalizeAnchorPositions` moves it. */
const COMMENT_ANCHOR = '<!--anchor:';
/** The line endings the lexer rewrites to `\n` before it reads a source. */
const LINE_ENDING = /\r\n|\r/g;

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

/** An image's `![`, or a table row's unescaped `|` — see `LineWalk`. */
const LINE_SPLIT = /!\[|(?<!\\)\|/g;

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
 * (`maskHtmlTags`) and the text between them shown; in any other note a tag is
 * escaped and shown as written, except a comment (dropped) and the `<br>`,
 * `<sub>`, `<sup>` it renders (`HIDDEN_HTML`), which are read off the
 * lexer's `html` tokens.
 *
 * The lexer is the renderer's own, configured as the renderer configures it.
 * It reads the source with its line endings rewritten to `\n`
 * (`LINE_ENDING`), so a range it hides is found in that text and carried
 * back to the source by the count of `\r\n` pairs shortened before it
 * (`sourceShifts`); a hidden run never holds a line break, so one count
 * places both of its ends. The lexer runs up to `MAX_LEXED_LENGTH`; a longer
 * source is not lexed, and nothing in it is masked but its comments and
 * link definitions, which a scan places (`maskHiddenBlocks`; a note the
 * renderer reads as HTML is masked by a scan whatever its length), so
 * every line of it that holds link syntax is unanchorable, and so is a line
 * the renderer may read as HTML (`HTML_LINE`): each reaches the
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
  const lexed = computeHiddenMask(markdown);
  const text = lexed ?? maskHiddenBlocks(markdown);
  const splits: number[] = [];
  for (const split of markdown.matchAll(LINE_SPLIT)) splits.push(split.index);
  const mask = {
    text,
    unanchorable: unanchorableLines(text, lexed === undefined),
    splits,
  };
  lastMask = { markdown, mask };
  return mask;
}

/** `markdown` masked, or `undefined` when its hidden text could not be accounted for. */
function computeHiddenMask(markdown: string): string | undefined {
  if (isHtmlNote(markdown)) return maskHtmlTags(markdown);
  if (markdown.length > MAX_LEXED_LENGTH) return undefined;
  HIDDEN_HTML.lastIndex = 0;
  if (!HIDEABLE.test(markdown) && !HIDDEN_HTML.test(markdown)) return markdown;
  let source = markdown;
  if (markdown.includes(COMMENT_ANCHOR)) {
    const normalized = normalizeAnchorPositions(markdown);
    if (normalized.length === markdown.length) source = normalized;
  }
  const lexed = source.replace(LINE_ENDING, '\n');
  const shifts = lexed.length === source.length ? undefined : sourceShifts(source, lexed);
  let tokens: LexedToken[];
  try {
    hiddenTextLexer ??= createTiptapTaskListMarked();
    tokens = hiddenTextLexer.lexer(lexed) as unknown as LexedToken[];
  } catch {
    return undefined;
  }
  const top: TextMap = { text: joinRaw(tokens), lineStarts: [0], sourceStarts: [0] };
  // A source the lexer rewrote beyond its line endings has no exact offsets.
  if (top.text !== lexed) return undefined;
  const ranges: Array<[number, number]> = [];
  const lexedMarkdown = source === markdown ? lexed : markdown.replace(LINE_ENDING, '\n');
  collectHidden(tokens, top, 0, lexedMarkdown, ranges);
  if (ranges.length === 0) return markdown;
  if (shifts) {
    for (const range of ranges) {
      const shift = shifts[range[0]];
      range[0] += shift;
      range[1] += shift;
    }
  }
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
 * For every offset of `lexed` — `source` with its line endings rewritten to
 * `\n` — how far the same character sits later in `source`: the number of
 * `\r\n` pairs shortened at or before it (a lone `\r` keeps its length).
 */
function sourceShifts(source: string, lexed: string): Uint32Array {
  const shifts = new Uint32Array(lexed.length + 1);
  let removed = 0;
  let at = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 13 && source.charCodeAt(i + 1) === 10) {
      removed += 1;
      continue;
    }
    shifts[at] = removed;
    at += 1;
  }
  shifts[at] = removed;
  return shifts;
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

/**
 * `markdown` with every tag and comment — what an HTML parser consumes of a
 * note it reads as HTML — replaced by U+0000, code unit for code unit: a
 * comment `<!--` … `-->`, or `<`, an optional `/`, a letter and everything
 * up to the next `>` outside a quoted attribute value (`<p title="a>b">`
 * is one tag; a quoted value spans line breaks). A quote no closing quote
 * follows is unterminated: the renderer then shows nothing more of the
 * note, and the tag is taken to end at the next `>` or line break, so that
 * the mask never overshoots what it can account for. One scan, linear
 * whatever the note holds: once no `-->`, no `>`, no line break or no
 * closing quote of a kind lies ahead, none opened later closes either, so
 * the search for one is not repeated.
 */
function maskHtmlTags(markdown: string): string {
  let out = '';
  let pos = 0;
  let commentsClose = true;
  /** The quote characters a closing quote may still lie ahead of. */
  const quotesClose = new Set([34, 39]);
  const nextClose = memoisedIndexOf(markdown, '>');
  const nextBreak = memoisedIndexOf(markdown, '\n');
  /** The index past the `>` that ends the tag opened at `open`, or -1 when none lies ahead. */
  const tagEnd = (open: number) => {
    for (let i = open + 1; i < markdown.length; i += 1) {
      const code = markdown.charCodeAt(i);
      if (code === 62) return i + 1;
      if (code !== 34 && code !== 39) continue;
      const quote = quotesClose.has(code) ? markdown.indexOf(markdown[i], i + 1) : -1;
      if (quote !== -1) {
        i = quote;
        continue;
      }
      quotesClose.delete(code);
      const close = nextClose(i + 1);
      const lineEnd = nextBreak(i + 1);
      if (lineEnd !== -1 && (close === -1 || lineEnd < close)) return lineEnd;
      return close === -1 ? -1 : close + 1;
    }
    return -1;
  };
  let open = markdown.indexOf('<');
  while (open !== -1) {
    let end = -1;
    if (commentsClose && markdown.startsWith('<!--', open)) {
      const close = markdown.indexOf('-->', open + 4);
      if (close === -1) commentsClose = false;
      else end = close + 3;
    }
    if (end === -1 && TAG_NAME.test(markdown.slice(open + 1, open + 3))) {
      end = tagEnd(open);
      if (end === -1) break;
    }
    if (end === -1) {
      open = markdown.indexOf('<', open + 1);
      continue;
    }
    out += markdown.slice(pos, open) + '\u0000'.repeat(end - open);
    pos = end;
    open = markdown.indexOf('<', end);
  }
  return out + markdown.slice(pos);
}

/** What follows the `<` of a tag: an optional `/` and a letter. */
const TAG_NAME = /^\/?[a-zA-Z]/;

/**
 * `(at) => text.indexOf(needle, at)` for a sequence of `at`s that never
 * decreases, each search resumed from the last hit: a hit at or past `at`
 * is returned again, and once none lies ahead none is searched for again.
 */
function memoisedIndexOf(text: string, needle: string): (at: number) => number {
  let found = -1;
  let exhausted = false;
  return (at: number) => {
    if (exhausted) return -1;
    if (found < at) {
      found = text.indexOf(needle, at);
      if (found === -1) exhausted = true;
    }
    return found;
  };
}

/** `memoisedIndexOf` for a global `pattern`: the index of its next match at or past `at`. */
function memoisedSearch(text: string, pattern: RegExp): (at: number) => number {
  let found = -1;
  let exhausted = false;
  return (at: number) => {
    if (exhausted) return -1;
    if (found < at) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (match) found = match.index;
      else exhausted = true;
    }
    return exhausted ? -1 : found;
  };
}

/**
 * What the scan stops at: a comment; a label at a line start; a run of
 * backticks or of three or more `~`; a `\` before a character it escapes
 * (`\\`, `\<`, `\[`, `` \` ``).
 */
const HIDDEN_BLOCK_OPENER = /<!--|^[ \t]{0,3}\[|`+|~{3,}|\\[\\<[`]/gm;
/** A line that may close a fence: a run of `` ` `` or `~` alone after blanks and `>`. */
const FENCE_CLOSE = /^[ \t>]*(?:`{3,}|~{3,})[ \t\r]*$/gm;
/** The two breaks of a blank line; no definition title or code span spans one. */
const BLANK_LINE = /\n[ \t\r]*\n/g;
/** A code unit that is not a line break. */
const NOT_BREAK = /[^\n\r]/g;

/**
 * `markdown` the lexer did not read with the hidden text a scan can place —
 * a comment (`<!--` … `-->`, or to the end of the note when none closes it;
 * a comment anchor excepted, as in `HIDDEN_HTML`) and the destination and
 * title of a link reference definition (`definitionHidden`) — replaced by
 * U+0000 code unit for code unit, its line breaks kept, as the lexer's mask
 * is laid (`hide`). A comment's body and a definition's title are the hidden
 * text that spans lines: left as written, each of their lines reads as a
 * text line (`isTextLine`) with no plain-text line of its own, and the
 * pairing of a run of sealed lines counts it as one (`refineByLine`,
 * `LineWalk`); masked, none is. A link's destination is not masked — its
 * line is unanchorable instead (`unanchorableLines`).
 *
 * What the renderer shows as written is not hidden, and the scan passes over
 * it as the lexer would: a fenced code block (a fence of three or more
 * `` ` `` or `~` at a line start, at most three blanks before it past the
 * quote and item markers of the line (`fenceIndent`), a backtick fence's
 * info string holding no backtick; closed by a line of the same character
 * alone, at least as long, indented at most three more columns than the
 * fence was past its markers, or running to the end of the note), an
 * indented code block (lines of four columns of blanks or more, from the
 * line after a blank one or the note's first to the next line of fewer that
 * is not blank; `indentedCodeEnd`), a code span (a run of backticks closed
 * by the next run of the same length before a blank line; a run none closes
 * is literal) and an escaped character (`\<`, `\[`; `\\` escapes the
 * backslash). Whichever opens first wins: a comment that opens before a
 * fence hides the fence, a fence that opens before a comment shows it. A
 * definition is one only where a block may open (`startsBlock`): a `[` on
 * the line after a paragraph's, an item's or a quote's continues that
 * paragraph, and the line is shown as written. One linear scan: a `-->`, a
 * closing quote, a fence line or a closing run of a length none of lies
 * ahead is not searched for again, and a title or a code span is closed
 * before the next blank line or not at all.
 */
function maskHiddenBlocks(markdown: string): string {
  let out = '';
  let pos = 0;
  /** The end of the last block the scan closed — a fence, a comment or a definition at a line start. */
  let blockEnd = 0;
  /** The end of the last indented line found to continue a paragraph; the indented lines after it do too. */
  let continuationEnd = -1;
  const nextCommentClose = memoisedIndexOf(markdown, '-->');
  const nextBlankLine = memoisedSearch(markdown, BLANK_LINE);
  const nextFenceClose = memoisedSearch(markdown, FENCE_CLOSE);
  const closes = new Map<string, (at: number) => number>();
  const nextTitleClose = (closer: number) => {
    const quote = String.fromCharCode(closer);
    let next = closes.get(quote);
    if (!next) closes.set(quote, (next = memoisedIndexOf(markdown, quote)));
    return next;
  };
  const nextSpanClose = (run: string) => {
    let next = closes.get(run);
    if (!next)
      closes.set(run, (next = memoisedSearch(markdown, new RegExp(`(?<!\`)${run}(?!\`)`, 'g'))));
    return next;
  };
  const mask = (start: number, end: number) => {
    out += markdown.slice(pos, start) + markdown.slice(start, end).replace(NOT_BREAK, '\u0000');
    pos = end;
  };
  const lineEndAt = (at: number) => {
    const lineEnd = markdown.indexOf('\n', at);
    return lineEnd === -1 ? markdown.length : lineEnd;
  };
  HIDDEN_BLOCK_OPENER.lastIndex = 0;
  let opener = HIDDEN_BLOCK_OPENER.exec(markdown);
  let lineStart = 0;
  let lineEnd = -1;
  while (opener) {
    const found = opener[0];
    const at = opener.index;
    let end = at + found.length;
    if (at > lineEnd) {
      lineStart = markdown.lastIndexOf('\n', at - 1) + 1;
      lineEnd = lineEndAt(at);
    }
    const indented = indentOf(markdown, lineStart) >= 4;
    const codeEnd = indented ? indentedCodeEnd(markdown, lineStart, blockEnd, continuationEnd) : -1;
    if (indented && codeEnd === -1) continuationEnd = lineEnd;
    if (codeEnd !== -1) {
      end = codeEnd;
      blockEnd = end;
    } else if (found === '<!--') {
      if (!markdown.startsWith(COMMENT_ANCHOR, at)) {
        const close = nextCommentClose(end);
        end = close === -1 ? markdown.length : close + 3;
        mask(at, end);
        if (atLineStart(markdown, at)) blockEnd = end;
      }
    } else if (found.charCodeAt(0) === 92) {
      // An escaped character: shown as written.
    } else if (found.endsWith('[')) {
      if (startsBlock(markdown, at, blockEnd)) {
        const hidden = definitionHidden(markdown, end - 1, nextTitleClose, nextBlankLine);
        if (hidden) {
          mask(hidden[0], hidden[1]);
          end = hidden[1];
          blockEnd = end;
        }
      }
    } else {
      const fenceChar = found.charCodeAt(0);
      const length = found.length;
      const indent = fenceIndent(markdown, lineStart, at);
      const isFence =
        indent !== -1 &&
        indent <= 3 &&
        (fenceChar === 126 || length >= 3) &&
        (fenceChar === 126 || !markdown.slice(end, lineEnd).includes('`'));
      if (isFence) {
        const offset = columnsPastQuote(markdown, lineStart, at) - indent;
        let close = nextFenceClose(lineEnd + 1);
        while (close !== -1) {
          let closeRun = close;
          while (isBlank(markdown.charCodeAt(closeRun)) || markdown.charCodeAt(closeRun) === 62) {
            closeRun += 1;
          }
          let closeEnd = closeRun;
          while (markdown.charCodeAt(closeEnd) === fenceChar) closeEnd += 1;
          if (
            closeEnd - closeRun >= length &&
            columnsPastQuote(markdown, close, closeRun) <= 3 + offset
          )
            break;
          close = nextFenceClose(close + 1);
        }
        end = close === -1 ? markdown.length : lineEndAt(close);
        blockEnd = end;
      } else if (fenceChar === 96) {
        const close = nextSpanClose(found)(end);
        const blank = nextBlankLine(end);
        if (close !== -1 && (blank === -1 || close < blank)) end = close + length;
      }
    }
    HIDDEN_BLOCK_OPENER.lastIndex = end;
    opener = HIDDEN_BLOCK_OPENER.exec(markdown);
  }
  return out + markdown.slice(pos);
}

/** Whether `at` of `text` sits at a line start, at most three blanks after it. */
function atLineStart(text: string, at: number): boolean {
  let start = at;
  while (start > 0 && isBlank(text.charCodeAt(start - 1))) start -= 1;
  return at - start <= 3 && (start === 0 || text.charCodeAt(start - 1) === 10);
}

/** The columns of the blanks that open the line of `text` at `lineStart`; a tab reaches the next multiple of four. */
function indentOf(text: string, lineStart: number): number {
  let columns = 0;
  for (let at = lineStart; ; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 32) columns += 1;
    else if (code === 9) columns += 4 - (columns % 4);
    else return columns;
  }
}

/** Whether the line of `text` at `lineStart` holds blanks alone. */
function isBlankLine(text: string, lineStart: number): boolean {
  let at = lineStart;
  while (at < text.length && (isBlank(text.charCodeAt(at)) || text.charCodeAt(at) === 13)) at += 1;
  return at >= text.length || text.charCodeAt(at) === 10;
}

/**
 * The end of the indented code block the line of `text` at `lineStart` — of
 * four columns of blanks or more — belongs to: the start of the next line of
 * fewer that is not blank, or the note's end. `-1` when the line is no code
 * but continues a paragraph: the lines above it, indented like it, reach one
 * that is neither blank nor indented nor within the last block the scan
 * closed (`blockEnd`), or one already found to continue a paragraph
 * (`continuationEnd`).
 */
function indentedCodeEnd(
  text: string,
  lineStart: number,
  blockEnd: number,
  continuationEnd: number,
): number {
  let start = lineStart;
  while (start > 0) {
    const previous = text.lastIndexOf('\n', start - 2) + 1;
    if (previous < blockEnd || isBlankLine(text, previous)) break;
    if (previous < continuationEnd || indentOf(text, previous) < 4) return -1;
    start = previous;
  }
  let lineEnd = text.indexOf('\n', lineStart);
  while (lineEnd !== -1 && lineEnd + 1 < text.length) {
    const next = lineEnd + 1;
    if (!isBlankLine(text, next) && indentOf(text, next) < 4) return next;
    lineEnd = text.indexOf('\n', next);
  }
  return text.length;
}

/**
 * The columns of blanks between the last quote or item marker (`>`, `-`,
 * `*`, `+`, `1.`, `1)`) on the line of `text` at `lineStart` — or its start
 * — and `at`; `-1` when other text lies between them.
 */
function fenceIndent(text: string, lineStart: number, at: number): number {
  let columns = 0;
  for (let i = lineStart; i < at; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 32) columns += 1;
    else if (code === 9) columns += 4 - (columns % 4);
    else if (code === 62) columns = 0;
    else if (
      (code === 45 || code === 42 || code === 43) &&
      i + 1 < at &&
      isBlank(text.charCodeAt(i + 1))
    ) {
      columns = 0;
    } else if (code >= 48 && code <= 57) {
      let digits = i + 1;
      while (digits < i + 9 && text.charCodeAt(digits) >= 48 && text.charCodeAt(digits) <= 57)
        digits += 1;
      const delimiter = text.charCodeAt(digits);
      if (
        (delimiter !== 46 && delimiter !== 41) ||
        digits + 1 >= at ||
        !isBlank(text.charCodeAt(digits + 1))
      )
        return -1;
      columns = 0;
      i = digits;
    } else return -1;
  }
  return columns;
}

/** The columns from the last `>` of `text` between `from` and `to` — or `from` — to `to`. */
function columnsPastQuote(text: string, from: number, to: number): number {
  let columns = 0;
  for (let at = from; at < to; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 62) columns = 0;
    else if (code === 9) columns += 4 - (columns % 4);
    else columns += 1;
  }
  return columns;
}

/**
 * Whether a block may open on the line of `text` that starts at `lineStart`:
 * the note's first line, a line after a blank one, or the line after the one
 * the last block the scan closed ended on (`blockEnd`). Any other line
 * continues the paragraph of the line before it — its own, a list item's or
 * a block quote's — which a link reference definition cannot interrupt.
 */
function startsBlock(text: string, lineStart: number, blockEnd: number): boolean {
  if (lineStart === 0) return true;
  const previous = text.lastIndexOf('\n', lineStart - 2) + 1;
  if (blockEnd > previous) return true;
  let at = previous;
  while (at < lineStart - 1 && (isBlank(text.charCodeAt(at)) || text.charCodeAt(at) === 13))
    at += 1;
  return at >= lineStart - 1;
}

/**
 * The `[start, end)` of the text the editor hides of the link reference
 * definition whose label opens at `bracket`: what follows its `]:` — blanks,
 * a destination (on the line, or alone on the next), and a title (`"…"`,
 * `'…'` or `(…)`, on the line or on the next, over line breaks, closed
 * before the next blank line by a quote no `\` precedes, with blanks alone
 * after it on its line) — or `undefined` when the line is no definition: a
 * label not closed on its line, no destination, or text after the
 * destination on its line that is no title. Text on the next line that is
 * no title is a paragraph of its own; the definition ends at its
 * destination.
 */
function definitionHidden(
  text: string,
  bracket: number,
  nextTitleClose: (closer: number) => (at: number) => number,
  nextBlankLine: (at: number) => number,
): [number, number] | undefined {
  let label = bracket + 1;
  while (label < text.length && text.charCodeAt(label) !== 93 && text.charCodeAt(label) !== 10) {
    label += 1;
  }
  if (label === bracket + 1 || text.charCodeAt(label) !== 93 || text.charCodeAt(label + 1) !== 58) {
    return undefined;
  }
  const start = label + 2;
  const destination = skipBlanks(text, start, true);
  let destinationEnd = destination;
  while (destinationEnd < text.length && !isSpace(text.charCodeAt(destinationEnd))) {
    destinationEnd += 1;
  }
  if (destinationEnd === destination) return undefined;
  const afterDestination = skipBlanks(text, destinationEnd, false);
  const onLine = afterDestination < text.length && !isBreak(text.charCodeAt(afterDestination));
  const title = onLine ? afterDestination : skipBlanks(text, destinationEnd, true);
  const quote = text.charCodeAt(title);
  const closer = quote === 34 || quote === 39 ? quote : quote === 40 ? 41 : -1;
  if (closer !== -1) {
    const nextClose = nextTitleClose(closer);
    let close = nextClose(title + 1);
    while (close !== -1 && text.charCodeAt(close - 1) === 92) close = nextClose(close + 1);
    const blank = nextBlankLine(title);
    if (close !== -1 && (blank === -1 || close < blank)) {
      const lineEnd = skipBlanks(text, close + 1, false);
      if (lineEnd >= text.length || isBreak(text.charCodeAt(lineEnd))) return [start, close + 1];
    }
  }
  return onLine ? undefined : [start, destinationEnd];
}

/** Past the blanks of `text` from `at` — and, with `oneBreak`, one line break and the blanks after it. */
function skipBlanks(text: string, at: number, oneBreak: boolean): number {
  while (at < text.length && isBlank(text.charCodeAt(at))) at += 1;
  if (!oneBreak || at >= text.length || !isBreak(text.charCodeAt(at))) return at;
  at += text.charCodeAt(at) === 13 && text.charCodeAt(at + 1) === 10 ? 2 : 1;
  while (at < text.length && isBlank(text.charCodeAt(at))) at += 1;
  return at;
}

/** Whether `code` is a line break's `\n` or `\r`. */
function isBreak(code: number): boolean {
  return code === 10 || code === 13;
}

/** Whether `code` is a blank or a line break. */
function isSpace(code: number): boolean {
  return isBlank(code) || isBreak(code);
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
 * one) are paired with the lines of markdown by their text, not by count:
 * the letters of a plain line are those of its markdown line with the
 * syntax gone, so they are a subsequence of it, and a run of plain lines an
 * inline leaf split is paired with the one markdown line that holds them
 * all. As many plain lines as markdown lines, each the text of the line at
 * its own position, are paired in one pass (`pairPositionally`); otherwise
 * the pairing that accounts for the most letters is searched (`pairLines`),
 * and when that search is unaffordable the lines are paired greedily in
 * order (`pairGreedily`) — every way linear or bounded, never a diff of the
 * region whole, so that a sealed line is bounded by its own pair whatever
 * the budget. A markdown line that is not a text line (`isTextLine`: a
 * fence, a setext underline, a rule, a table delimiter row, a definition,
 * a comment the whole line long) is no candidate for a pair at all, however
 * many stand in a row, so a run of them never derails the greedy pairing
 * (whose lookahead is bounded) from the sealed line beyond them; such a
 * line, and any other no plain line is the text of — a line of a note the
 * renderer collapsed — is deleted against nothing, and a plain line no
 * markdown line accounts for is inserted. Each pair is diffed alone
 * (`diffRegion`; past the deadline the
 * pair is one replaced span, still bounded by its lines), and so is each gap
 * between pairs unless a sealed line lies in it: that gap is never diffed —
 * its markdown up to the end of its last sealed line is deleted against
 * nothing, and its plain text replaces what follows — so a position of its
 * plain text maps to the gap's end and a position of the sealed line to the
 * end of the plain text before it, neither into the other.
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
  const lines = textLines(to, toStart, toEnd, false, unanchorable).filter((line) =>
    isTextLine(to, line.start, line.end),
  );
  for (const line of lines) line.cells = tableCells(to, line);
  const gap = (fromA: number, fromB: number, toA: number, toB: number) => {
    if (fromA === fromB && toA === toB) return;
    if (!overlaps(unanchorable, toA, toB)) {
      diffRegion(out, from, to, fromA, fromB, toA, toB, deadline, unanchorable);
      return;
    }
    const sealedEnd = Math.min(lastOverlapEnd(unanchorable, toA, toB), toB);
    out.push({ fromStart: fromA, fromEnd: fromA, toStart: toA, toEnd: sealedEnd });
    if (fromA < fromB || sealedEnd < toB) {
      out.push({ fromStart: fromA, fromEnd: fromB, toStart: sealedEnd, toEnd: toB });
    }
  };
  const pairs =
    pairPositionally(fragments, lines) ??
    pairLines(fragments, lines, deadline) ??
    pairGreedily(fragments, lines);
  let fromPos = fromStart;
  let toPos = toStart;
  for (const [first, last, line] of pairs) {
    const fromA = fragments[first].start;
    const fromB = fragments[last].end;
    gap(fromPos, fromA, toPos, line.start);
    diffRegion(out, from, to, fromA, fromB, line.start, line.end, deadline, unanchorable);
    fromPos = fromB;
    toPos = line.end;
  }
  gap(fromPos, fromEnd, toPos, toEnd);
}

/** The end of the last of the sorted, flattened `ranges` that overlaps `[start, end)`, or `start`. */
function lastOverlapEnd(ranges: number[], start: number, end: number): number {
  let low = 0;
  let high = ranges.length >> 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ranges[2 * mid + 1] <= start) low = mid + 1;
    else high = mid;
  }
  let last = start;
  for (let range = low; range < ranges.length >> 1 && ranges[2 * range] < end; range += 1) {
    last = ranges[2 * range + 1];
  }
  return last;
}

/**
 * A line of text without its break, the letters and digits on it, whether
 * it is sealed, and — a table row's — its `cells` (`tableCells`).
 */
interface TextLine {
  start: number;
  end: number;
  letters: string;
  sealed: boolean;
  cells?: TextLine[];
}

const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/** Whether `code` is a space or a tab. */
function isBlank(code: number): boolean {
  return code === 32 || code === 9;
}

/**
 * The cells of the table row `line` of `text` — the text between its
 * unescaped `|`, each without the blanks around it, that holds a letter or a
 * digit — when the line opens with `|` and holds two or more; `undefined`
 * otherwise. The note editor shows each cell as a plain-text line of its own
 * (see `LineWalk`), so a run of them is paired cell by cell (`pairGreedily`).
 */
function tableCells(text: string, line: TextLine): TextLine[] | undefined {
  let i = line.start;
  while (i < line.end && isBlank(text.charCodeAt(i))) i += 1;
  if (i >= line.end || text.charCodeAt(i) !== 124) return undefined;
  const cells: TextLine[] = [];
  let cellStart = i + 1;
  for (let j = i + 1; j <= line.end; j += 1) {
    if (j < line.end && (text.charCodeAt(j) !== 124 || text.charCodeAt(j - 1) === 92)) continue;
    let start = cellStart;
    let end = j;
    while (start < end && isBlank(text.charCodeAt(start))) start += 1;
    while (end > start && isBlank(text.charCodeAt(end - 1))) end -= 1;
    if (start < end) {
      const letters = text.slice(start, end).replace(NOT_LETTER_OR_DIGIT, '');
      if (letters !== '') cells.push({ start, end, letters, sealed: line.sealed });
    }
    cellStart = j + 1;
  }
  return cells.length > 1 ? cells : undefined;
}

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

/** A run `fragments[first..last]` of plain-text lines that is the text of the markdown `line`. */
type LinePair = [first: number, last: number, line: TextLine];

/** Most fragments `pairLines` pairs with one line, and `pairGreedily` too. */
const MAX_RUN_LENGTH = 127;

/**
 * The pairs of the plain-text `fragments` with the markdown `lines` when
 * there are as many of each and every fragment's letters are a subsequence
 * of the letters of the line at its own position; `undefined` otherwise.
 * One pass over the letters, whatever the budget.
 */
function pairPositionally(fragments: TextLine[], lines: TextLine[]): LinePair[] | undefined {
  if (fragments.length !== lines.length) return undefined;
  const pairs: LinePair[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (subsequenceEnd(lines[i].letters, fragments[i].letters, 0) === -1) return undefined;
    pairs.push([i, i, lines[i]]);
  }
  return pairs;
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
 * line when it has a line of its own — and among pairings equal in all that,
 * one of more pairs: each fragment on a line of its own rather than in a run
 * on the line before, whose hidden destination may repeat its letters
 * (`[xy](https://ab/xy)` fits `xy` twice). A dynamic programme over the two
 * sequences; `undefined` once the search would exceed `MAX_PAIRING_CELLS`
 * or the `deadline`, which the caller pairs greedily instead.
 */
function pairLines(
  fragments: TextLine[],
  lines: TextLine[],
  deadline: number,
): LinePair[] | undefined {
  const n = fragments.length;
  const m = lines.length;
  if (n === 0 || m === 0) return [];
  if (n * m > MAX_PAIRING_CELLS) return undefined;
  const width = m + 1;
  // Best letters accounted for by `fragments[0, i)` and `lines[0, k)`; -1 unreached.
  const best = new Int32Array((n + 1) * width).fill(-1);
  // The pairs of the best.
  const count = new Int32Array((n + 1) * width);
  // How the best was reached: -1 skipped a fragment, -2 skipped a line, r ≥ 0 paired a run of r + 1 fragments.
  const via = new Int8Array((n + 1) * width);
  const better = (score: number, pairs: number, cell: number) =>
    score > best[cell] || (score === best[cell] && pairs > count[cell]);
  best[0] = 0;
  for (let i = 0; i <= n; i += 1) {
    if (performance.now() >= deadline) return undefined;
    for (let k = 0; k <= m; k += 1) {
      const cell = i * width + k;
      if (i > 0 && better(best[cell - width], count[cell - width], cell)) {
        best[cell] = best[cell - width];
        count[cell] = count[cell - width];
        via[cell] = -1;
      }
      if (k > 0 && better(best[cell - 1], count[cell - 1], cell)) {
        best[cell] = best[cell - 1];
        count[cell] = count[cell - 1];
        via[cell] = -2;
      }
      if (best[cell] < 0 || i === n || k === m) continue;
      const line = lines[k];
      let at = 0;
      let letters = 0;
      for (let j = i; j < n && j - i < MAX_RUN_LENGTH; j += 1) {
        at = subsequenceEnd(line.letters, fragments[j].letters, at);
        if (at === -1) break;
        letters += fragments[j].letters.length;
        const rank = letters === line.letters.length ? 2 : line.sealed ? 0 : 1;
        const score = best[cell] + 3 * letters + rank;
        const target = (j + 1) * width + k + 1;
        if (better(score, count[cell] + 1, target)) {
          best[target] = score;
          count[target] = count[cell] + 1;
          via[target] = j - i;
        }
      }
    }
  }
  const pairs: LinePair[] = [];
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

/** Most lines, or fragments, `pairGreedily` looks ahead over for the pair of one that fits none at hand. */
const GREEDY_LOOKAHEAD = 8;

/**
 * The pairs of the plain-text `fragments` with the markdown `lines` found in
 * one pass, in order on both sides, when `pairLines` is unaffordable: a
 * fragment is paired with the line at hand when it is the text of it — and
 * the run extended over the fragments that follow it on that line, short of
 * one that is the text of a line just ahead, unless it completes the line's
 * letters (a hidden destination may repeat the letters of the line beside
 * it, `[xy](https://ab/xy)`) — unless its letters are those of the next line
 * whole and not of this one, when the line at hand is deleted (a fit on a
 * line that holds more letters than the fragment, sealed or not, is not
 * preferred to one on the line at hand: a token fits many a longer line). A
 * fragment that is not the text of the line at hand is the text of one of
 * the next `GREEDY_LOOKAHEAD` lines, or one of the next fragments is the
 * text of the line: whichever fit is nearer decides which side is skipped up
 * to it — the lines are text lines only (`refineByLine`), so the lookahead
 * counts none a definition, a comment or an underline is on — and when
 * neither is found within reach one of each is skipped. A table row whose
 * cells are each the text of the next fragment in turn is paired cell by
 * cell, each fragment with its own cell — the note editor shows each cell
 * as a line, and the cells of a row are as alike as the rows of a table, so
 * the run over the row would stop at one the next row fits too; a row shown
 * as one line (the fragment fits no single cell) is paired as one line.
 * Bounded by the letters of both sequences, not their product, so a sealed
 * line among hundreds is still bounded by its own pair.
 */
function pairGreedily(fragments: TextLine[], lines: TextLine[]): LinePair[] {
  const pairs: LinePair[] = [];
  const fits = (i: number, k: number) =>
    subsequenceEnd(lines[k].letters, fragments[i].letters, 0) !== -1;
  /** How far past `k` the nearest of the next `GREEDY_LOOKAHEAD` lines `fragments[i]` fits is, or 0. */
  const lineAhead = (i: number, k: number) => {
    for (let d = 1; d <= GREEDY_LOOKAHEAD && k + d < lines.length; d += 1) {
      if (fits(i, k + d)) return d;
    }
    return 0;
  };
  let i = 0;
  let k = 0;
  while (i < fragments.length && k < lines.length) {
    const fragment = fragments[i];
    const line = lines[k];
    let at = subsequenceEnd(line.letters, fragment.letters, 0);
    if (at === -1) {
      const skipLines = lineAhead(i, k);
      let skipFragments = 0;
      for (let d = 1; d <= GREEDY_LOOKAHEAD && i + d < fragments.length; d += 1) {
        if (fits(i + d, k)) {
          skipFragments = d;
          break;
        }
      }
      if (skipLines > 0 && (skipFragments === 0 || skipLines <= skipFragments)) k += skipLines;
      else if (skipFragments > 0) i += skipFragments;
      else {
        i += 1;
        k += 1;
      }
      continue;
    }
    if (
      k + 1 < lines.length &&
      fragment.letters !== line.letters &&
      fragment.letters === lines[k + 1].letters
    ) {
      k += 1;
      continue;
    }
    const cells = line.cells;
    if (
      cells &&
      i + cells.length <= fragments.length &&
      cells.every((cell, d) => subsequenceEnd(cell.letters, fragments[i + d].letters, 0) !== -1)
    ) {
      for (let d = 0; d < cells.length; d += 1) pairs.push([i + d, i + d, cells[d]]);
      i += cells.length;
      k += 1;
      continue;
    }
    let j = i;
    let letters = fragment.letters.length;
    while (j + 1 < fragments.length && j - i + 1 < MAX_RUN_LENGTH) {
      const next = fragments[j + 1];
      const end = subsequenceEnd(line.letters, next.letters, at);
      if (end === -1) break;
      letters += next.letters.length;
      if (letters !== line.letters.length && lineAhead(j + 1, k) > 0) break;
      at = end;
      j += 1;
    }
    pairs.push([i, j, line]);
    i = j + 1;
    k += 1;
  }
  return pairs;
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
