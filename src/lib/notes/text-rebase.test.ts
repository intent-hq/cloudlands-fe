import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor, type EditorOptions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { docTextOffsets } from './doc-text-offsets';
import {
  createBidirectionalOffsetMapper,
  createOffsetMapper,
  mapOffsetThroughDiff,
  rebaseText,
} from './text-rebase';

/** While `abort` is set, every jsdiff call behaves as if its `timeout` had elapsed. */
const jsdiff = vi.hoisted(() => ({ abort: false }));
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>();
  const abortable =
    <A extends unknown[], R>(diff: (...args: A) => R) =>
    (...args: A) =>
      jsdiff.abort ? undefined : diff(...args);
  return {
    ...actual,
    diffChars: abortable(actual.diffChars),
    diffArrays: abortable(actual.diffArrays),
  };
});

/**
 * Run `fn` with the alignment deadline out of reach: `performance.now` is
 * frozen, so an exactness assertion cannot flip to the clamped fallback on a
 * loaded runner. Timing bounds are asserted in separate tests.
 */
function withoutDeadline<T>(fn: () => T): T {
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    return fn();
  } finally {
    now.mockRestore();
  }
}

/**
 * Run `fn` with the alignment deadline already spent: the clock reads 0 when
 * the deadline is set and far past it on every later read, so every diff and
 * search is declined and the alignment degrades the whole way.
 */
function withExpiredDeadline<T>(fn: () => T): T {
  const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(1e9);
  try {
    return fn();
  } finally {
    now.mockRestore();
  }
}

/** A markdown piece and whether the editor projects it into the plain text. */
type Piece = [markdown: string, shared: boolean];

interface LargeNote {
  markdown: string;
  /** Every shared piece, in document order. */
  shared: string[];
}

interface ProjectedNote extends LargeNote {
  /** The production plain-text projection of `markdown` (`docTextOffsets`). */
  plain: string;
  /**
   * `[plainOffset, markdownOffset]` strictly inside runs the two texts share,
   * where the mapping is unambiguous (an offset on a run's edge may map to
   * either side of the adjacent syntax).
   */
  samples: Array<[number, number]>;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'alignment',
  'caret',
  'daemon',
  'editor',
  'markdown',
  'note',
  'offset',
  'peer',
  'presence',
  'projection',
  'render',
  'selection',
  'span',
  'sync',
  'text',
  'workspace',
];

/**
 * A synthetic markdown note — headings, lists, fenced code, bold, italic and
 * links — deterministic for a seed, with every piece of text the editor
 * projects verbatim recorded in order so `sampleSharedRuns` can locate the
 * shared runs independently of the alignment under test.
 */
function generateLargeNote(minMarkdownLength: number, seed = 1): LargeNote {
  const rng = mulberry32(seed);
  const pick = () => WORDS[Math.floor(rng() * WORDS.length)];
  const words = (n: number) => Array.from({ length: n }, pick).join(' ');
  const sentence = (n: number) => {
    const s = words(n);
    return s[0].toUpperCase() + s.slice(1) + '.';
  };
  const shared = (text: string): Piece => [text, true];
  const syntax = (text: string): Piece => [text, false];
  const plainBlock = (): Piece[] => [shared(sentence(8 + Math.floor(rng() * 12)))];
  const formattedBlock = (): Piece[] => {
    const link = words(2);
    return [
      shared(sentence(4) + ' '),
      syntax('**'),
      shared(words(2)),
      syntax('**'),
      shared(' ' + words(5) + ' '),
      syntax('['),
      shared(link),
      syntax(`](https://example.com/${link.replace(' ', '-')}/${pick()})`),
      shared(' '),
      syntax('*'),
      shared(pick()),
      syntax('*'),
      shared(' ' + sentence(6)),
    ];
  };
  const blocks: Piece[][] = [];
  const pushHeading = (level: number) =>
    blocks.push([syntax('#'.repeat(level) + ' '), shared(words(3))]);
  const pushList = () => {
    const items = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < items; i += 1) {
      blocks.push([syntax('- '), ...(rng() < 0.4 ? formattedBlock() : plainBlock())]);
    }
  };
  const pushCode = () => {
    const lines = Array.from(
      { length: 3 + Math.floor(rng() * 8) },
      () => `const ${pick()} = ${pick()}(${pick()});`,
    ).join('\n');
    blocks.push([syntax('```ts\n'), shared(lines), syntax('\n```')]);
  };

  let markdownLength = 0;
  pushHeading(1);
  while (markdownLength < minMarkdownLength) {
    const before = blocks.length;
    const roll = rng();
    if (roll < 0.1) pushHeading(2 + Math.floor(rng() * 2));
    else if (roll < 0.35) pushList();
    else if (roll < 0.45) pushCode();
    else if (roll < 0.7) blocks.push(formattedBlock());
    else blocks.push(plainBlock());
    for (const block of blocks.slice(before)) {
      markdownLength += block.reduce((n, [md]) => n + md.length, 2);
    }
  }

  const markdown: string[] = [];
  const sharedPieces: string[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) {
      const listRun = block[0][0] === '- ' && blocks[index - 1][0][0] === '- ';
      markdown.push(listRun ? '\n' : '\n\n');
    }
    for (const [md, isShared] of block) {
      markdown.push(md);
      if (isShared) sharedPieces.push(md);
    }
  });
  return { markdown: markdown.join(''), shared: sharedPieces };
}

/**
 * The plain text the remote-cursors binding maps against: the markdown parsed
 * the way the note editor does it, then projected by production
 * `docTextOffsets`. With `production`, the document is the note editor's own
 * (`createEditorConfig`) plus its comment-anchor node — the one part of
 * `enableComments` the projection sees; the rest is a decorations plugin over
 * the app store — so a comment anchor is an inline leaf, not dropped markup.
 */
async function projectWithEditor(markdown: string, production = false): Promise<string> {
  const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });
  const element = document.createElement('div');
  let options: Partial<EditorOptions>;
  if (production) {
    options = createEditorConfig({
      element,
      content: html,
      editable: true,
      onUpdate: () => {},
      useMarkdown: true,
    });
    options.extensions = [...(options.extensions ?? []), CommentAnchor];
  } else {
    options = { element, extensions: [StarterKit], content: html };
  }
  const editor = new Editor(options);
  try {
    return docTextOffsets(editor.state.doc).text;
  } finally {
    editor.destroy();
  }
}

/**
 * Locate every shared piece in both texts by a forward `indexOf` from the end
 * of the previous piece (pieces occur in order on both sides, and only syntax
 * sits between them in the markdown) and record the offset of its middle
 * character — an oracle that never consults the alignment under test.
 */
function sampleSharedRuns(plain: string, markdown: string, shared: string[]) {
  const samples: Array<[number, number]> = [];
  let plainPos = 0;
  let markdownPos = 0;
  for (const piece of shared) {
    const inPlain = plain.indexOf(piece, plainPos);
    const inMarkdown = markdown.indexOf(piece, markdownPos);
    if (inPlain === -1 || inMarkdown === -1) {
      throw new Error(`shared piece ${JSON.stringify(piece)} missing from a projection`);
    }
    if (piece.length > 1) {
      samples.push([inPlain + (piece.length >> 1), inMarkdown + (piece.length >> 1)]);
    }
    plainPos = inPlain + piece.length;
    markdownPos = inMarkdown + piece.length;
  }
  return samples;
}

async function projectLargeNote(minMarkdownLength: number, seed = 1): Promise<ProjectedNote> {
  const note = generateLargeNote(minMarkdownLength, seed);
  const plain = await projectWithEditor(note.markdown);
  return { ...note, plain, samples: sampleSharedRuns(plain, note.markdown, note.shared) };
}

let largeNote: ProjectedNote;
beforeAll(async () => {
  largeNote = await projectLargeNote(150 * 1024);
}, 120_000);

describe('mapOffsetThroughDiff', () => {
  it('leaves offsets before a change unchanged', () => {
    expect(mapOffsetThroughDiff('abcdef', 'abcXYZdef', 2)).toBe(2);
    expect(mapOffsetThroughDiff('abcdef', 'abcXYZdef', 3)).toBe(3);
  });

  it('shifts offsets after a change by the net delta', () => {
    expect(mapOffsetThroughDiff('abcdef', 'abcXYZdef', 4)).toBe(7);
    expect(mapOffsetThroughDiff('abcXYZdef', 'abcdef', 7)).toBe(4);
    expect(mapOffsetThroughDiff('body', 'AGENT\nbody', 4)).toBe(10);
  });

  it('clamps offsets inside a replaced or deleted span to the span end', () => {
    expect(mapOffsetThroughDiff('abcXYZdef', 'abc12def', 4)).toBe(5);
    expect(mapOffsetThroughDiff('abcXYZdef', 'abcdef', 5)).toBe(3);
  });

  it('never splits a surrogate pair', () => {
    const from = 'a😀b';
    const to = 'a😀😀b';
    expect(mapOffsetThroughDiff(from, to, 1)).toBe(1);
    expect(mapOffsetThroughDiff(from, to, 3)).toBe(3);
    expect(mapOffsetThroughDiff(from, to, 4)).toBe(6);
    expect(mapOffsetThroughDiff('a😀b', 'ab', 2)).toBe(1);
  });

  it('clamps out-of-range offsets to the text bounds', () => {
    expect(mapOffsetThroughDiff('abc', 'abXc', 99)).toBe(4);
    expect(mapOffsetThroughDiff('abc', 'xabc', -1)).toBe(0);
  });
});

describe('createBidirectionalOffsetMapper', () => {
  // The shared runs of these pairs match in exactly one way, so `a → b` and
  // `b → a` have the same minimal alignment and an independent reverse diff
  // is a valid oracle for the inversion.
  const unambiguousPairs: Array<[string, string]> = [
    ['abcdef', 'abcXYZdef'],
    ['abcXYZdef', 'abc12def'],
    ['body', 'AGENT\nbody'],
    ['Body bold tail', 'Body **bold** tail'],
  ];
  // A repeated character next to a change (the doubled emoji, the doubled
  // newline, the moved "ab") admits several equally short alignments; the two
  // directions must still be one alignment, but not necessarily the one a
  // reverse diff would pick.
  const ambiguousPairs: Array<[string, string]> = [
    ['a😀b', 'a😀😀b'],
    ['Title\nBody', '# Title\n\nBody'],
    ['abXY', 'XYab'],
    ['aaa', 'aa'],
  ];
  const allPairs = [...unambiguousPairs, ...ambiguousPairs];

  it('maps a → b exactly like createOffsetMapper(a, b)', () => {
    for (const [a, b] of allPairs) {
      const forward = createOffsetMapper(a, b);
      const { aToB } = createBidirectionalOffsetMapper(a, b);
      for (let offset = -1; offset <= a.length + 1; offset += 1) {
        expect(aToB(offset), `${JSON.stringify([a, b])} @ ${offset}`).toBe(forward(offset));
      }
    }
  });

  it('is idempotent: a → b → a lands on a fixed point of the one alignment', () => {
    for (const [a, b] of allPairs) {
      const { aToB, bToA } = createBidirectionalOffsetMapper(a, b);
      // An offset strictly inside a common run survives a → b → a unchanged.
      // One inside a changed span, or on a run boundary whose affinity points
      // the other way, is moved to a span edge in `a` — whose own image in `b`
      // is the point it was moved to, so a second pass changes nothing.
      const label = JSON.stringify([a, b]);
      let roundTripped = 0;
      for (let offset = 0; offset <= a.length; offset += 1) {
        const mapped = aToB(offset);
        const back = bToA(mapped);
        if (back === offset) roundTripped += 1;
        expect(aToB(back), `${label} @ ${offset}`).toBe(mapped);
        expect(bToA(aToB(back)), `${label} @ ${offset}`).toBe(back);
      }
      expect(roundTripped, label).toBeGreaterThanOrEqual(1);
      expect(bToA(aToB(0)), label).toBe(0);
    }
  });

  it('agrees with createOffsetMapper(b, a) on unambiguous pairs outside changed spans', () => {
    for (const [a, b] of unambiguousPairs) {
      const reverse = createOffsetMapper(b, a);
      const { aToB, bToA } = createBidirectionalOffsetMapper(a, b);
      const reachable = new Set<number>();
      for (let offset = 0; offset <= a.length; offset += 1) reachable.add(aToB(offset));
      for (const offset of reachable) {
        expect(bToA(offset), `${JSON.stringify([a, b])} @ ${offset}`).toBe(reverse(offset));
      }
    }
  });

  it('keeps one alignment for both directions when the reverse diff would pick another', () => {
    // a → b: delete "ab", keep "XY", insert "ab". A fresh b → a diff keeps
    // "ab" instead, so the two would disagree on where "XY" sits.
    const { aToB, bToA } = createBidirectionalOffsetMapper('abXY', 'XYab');
    // Shared interior: between X and Y.
    expect(aToB(3)).toBe(1);
    expect(bToA(1)).toBe(3);
    expect(bToA(aToB(3))).toBe(3);
    // Boundary affinity: the edge of the deleted "ab" is the start of "XY".
    expect(aToB(2)).toBe(0);
    expect(bToA(0)).toBe(0);
    // Inside the inserted "ab" in b: clamp to the span end in a.
    expect(bToA(3)).toBe(4);
    expect(bToA(4)).toBe(4);
    // Inside the deleted "ab" in a: clamp to the span end in b.
    expect(aToB(1)).toBe(0);
  });

  it('clamps offsets inside a changed span to the span end on the other side', () => {
    const { bToA } = createBidirectionalOffsetMapper('abcdef', 'abcXYZdef');
    expect(bToA(4)).toBe(3);
    expect(bToA(5)).toBe(3);
    expect(bToA(6)).toBe(3);
    expect(bToA(7)).toBe(4);

    const replaced = createBidirectionalOffsetMapper('abcXYZdef', 'abc12def');
    expect(replaced.aToB(4)).toBe(5);
    expect(replaced.bToA(4)).toBe(6);
    expect(replaced.bToA(5)).toBe(6);
    expect(replaced.bToA(6)).toBe(7);
  });

  it('clamps out-of-range offsets to each side of the pair', () => {
    const { aToB, bToA } = createBidirectionalOffsetMapper('abc', 'abXc');
    expect(aToB(99)).toBe(4);
    expect(aToB(-1)).toBe(0);
    expect(bToA(99)).toBe(3);
    expect(bToA(-1)).toBe(0);
  });
});

describe('plain-text ↔ markdown alignment of a large note', () => {
  it('projects the fixture through the editor without its markdown syntax', () => {
    const note = largeNote;
    expect(note.markdown.length).toBeGreaterThanOrEqual(150 * 1024);
    expect(note.plain.length).toBeLessThan(note.markdown.length);
    expect(note.plain).not.toContain('**');
    expect(note.plain).not.toContain('](https://');
    expect(note.plain).not.toContain('```');
    expect(note.plain).not.toContain('- ');
    expect(note.samples.length).toBeGreaterThan(1000);
  });

  it('aligns a ≥150 KB note in well under a second', () => {
    const note = largeNote;
    const started = performance.now();
    const { bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    // Generous CI bound; the alignment itself takes tens of milliseconds.
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
  });

  it('maps every shared character exactly, in both directions', () => {
    const note = largeNote;
    const { aToB, bToA } = withoutDeadline(() =>
      createBidirectionalOffsetMapper(note.plain, note.markdown),
    );
    expect(aToB(4)).toBe(note.markdown.indexOf(note.plain.slice(0, 8)) + 4);
    const misses: string[] = [];
    for (const [plainOffset, markdownOffset] of note.samples) {
      if (aToB(plainOffset) !== markdownOffset || bToA(markdownOffset) !== plainOffset) {
        misses.push(
          `${plainOffset}→${aToB(plainOffset)} (want ${markdownOffset}), ` +
            `${markdownOffset}→${bToA(markdownOffset)} (want ${plainOffset})`,
        );
      }
    }
    expect(misses, misses.slice(0, 5).join('\n')).toEqual([]);
  });
});

describe('plain-text ↔ markdown alignment of a note formatted on every line', () => {
  /** No line of this note appears verbatim in its markdown: bold splits every word. */
  const LINE = '- aaaaaa**aaaaaa**b\n';
  const LINES = 8192;
  let note: { plain: string; markdown: string };
  beforeAll(async () => {
    const markdown = LINE.repeat(LINES);
    note = { markdown, plain: await projectWithEditor(markdown) };
  }, 120_000);

  /** `[plainStart, markdownStart, length]` of each verbatim run of one line, by forward search on both sides. */
  function runsOfLine(line: number): Array<[number, number, number]> {
    const runs: Array<[number, number, number]> = [];
    let plainPos = 0;
    let markdownPos = 0;
    for (let i = 0; i <= line; i += 1) {
      for (const piece of ['aaaaaa', 'aaaaaa', 'b']) {
        const inPlain = note.plain.indexOf(piece, plainPos);
        const inMarkdown = note.markdown.indexOf(piece, markdownPos);
        if (i === line) runs.push([inPlain, inMarkdown, piece.length]);
        plainPos = inPlain + piece.length;
        markdownPos = inMarkdown + piece.length;
      }
    }
    return runs;
  }

  it('projects to one plain line per item', () => {
    expect(note.markdown.length).toBeGreaterThanOrEqual(160 * 1024);
    expect(note.plain).not.toContain('*');
    expect(note.plain).not.toContain('- ');
    expect(note.plain.split('\n').filter(Boolean)).toHaveLength(LINES);
  });

  it('aligns inside the budget', () => {
    const started = performance.now();
    const { bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
  });

  it.each([0, 1, 1000, LINES >> 1, LINES - 2, LINES - 1])(
    'maps the verbatim runs of line %i exactly, in both directions',
    (line) => {
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(note.plain, note.markdown),
      );
      expect(aToB(1)).toBe(note.markdown.indexOf('aaaaaa') + 1);
      for (const [plainStart, markdownStart, length] of runsOfLine(line)) {
        // The offset before a run may map to either side of the syntax that
        // precedes it; every other offset of the run maps to its counterpart.
        for (let k = 1; k <= length; k += 1) {
          expect(aToB(plainStart + k), `plain ${plainStart}+${k}`).toBe(markdownStart + k);
        }
        for (let k = 0; k <= length; k += 1) {
          expect(bToA(markdownStart + k), `markdown ${markdownStart}+${k}`).toBe(plainStart + k);
        }
      }
    },
  );
});

describe('plain-text ↔ markdown alignment of one long formatted paragraph', () => {
  /** One paragraph longer than any refine region, bold in every clause: no line of it is verbatim. */
  const UNIT = 'alpha **beta** gamma ';
  const PIECES = ['alpha ', 'beta', ' gamma '];
  const UNITS = 1000;
  let note: { plain: string; markdown: string };
  beforeAll(async () => {
    const markdown = UNIT.repeat(UNITS);
    note = { markdown, plain: await projectWithEditor(markdown) };
  }, 120_000);

  /** `[plainStart, markdownStart, length]` of each verbatim run of unit `unit`, by forward search on both sides. */
  function runsOfUnit(unit: number): Array<[number, number, number]> {
    const runs: Array<[number, number, number]> = [];
    let plainPos = 0;
    let markdownPos = 0;
    for (let i = 0; i <= unit; i += 1) {
      for (const piece of PIECES) {
        // The editor drops the paragraph's trailing space, so the last run is
        // searched without it and cut at the end of the plain text.
        const inPlain = note.plain.indexOf(piece.trimEnd(), plainPos);
        const inMarkdown = note.markdown.indexOf(piece, markdownPos);
        const length = Math.min(piece.length, note.plain.length - inPlain);
        if (i === unit) runs.push([inPlain, inMarkdown, length]);
        plainPos = inPlain + length;
        markdownPos = inMarkdown + piece.length;
      }
    }
    return runs;
  }

  it('projects to one plain line longer than a refine region', () => {
    expect(note.markdown.length).toBeGreaterThan(20 * 1024);
    expect(note.plain).toBe('alpha beta gamma '.repeat(UNITS).trimEnd());
    expect(note.plain.length).toBeGreaterThan(16 * 1024);
  });

  it('aligns inside the budget', () => {
    const started = performance.now();
    const { bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
  });

  it('maps the carets of the reviewed repro exactly', () => {
    const { aToB, bToA } = withoutDeadline(() =>
      createBidirectionalOffsetMapper(note.plain, note.markdown),
    );
    expect(aToB(1702)).toBe(2102);
    expect(bToA(2102)).toBe(1702);
  });

  it.each([0, 1, 100, UNITS >> 1, UNITS - 2, UNITS - 1])(
    'maps the verbatim runs of unit %i exactly, in both directions',
    (unit) => {
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(note.plain, note.markdown),
      );
      for (const [plainStart, markdownStart, length] of runsOfUnit(unit)) {
        for (let k = 1; k <= length; k += 1) {
          expect(aToB(plainStart + k), `plain ${plainStart}+${k}`).toBe(markdownStart + k);
        }
        for (let k = 0; k <= length; k += 1) {
          expect(bToA(markdownStart + k), `markdown ${markdownStart}+${k}`).toBe(plainStart + k);
        }
      }
    },
  );
});

describe('plain-text ↔ markdown alignment of repeated paragraphs', () => {
  it('anchors a formatted paragraph onto itself, not onto a later verbatim duplicate', async () => {
    const markdown = '**Repeated** heading\n\nRepeated heading';
    const plain = await projectWithEditor(markdown);
    expect(plain).toBe('Repeated heading\nRepeated heading');
    const { aToB, bToA } = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    // First paragraph: inside the bold word, not inside the second paragraph.
    expect(aToB(4)).toBe(6);
    expect(bToA(6)).toBe(4);
    expect(aToB(plain.indexOf('heading') + 3)).toBe(markdown.indexOf('heading') + 3);
    // Second paragraph.
    const second = plain.lastIndexOf('Repeated');
    const secondMarkdown = markdown.lastIndexOf('Repeated');
    expect(aToB(second + 4)).toBe(secondMarkdown + 4);
    expect(bToA(secondMarkdown + 4)).toBe(second + 4);
    expect(bToA(markdown.length)).toBe(plain.length);
  });

  it('keeps a formatted duplicate between two verbatim ones in place', async () => {
    const markdown = 'Repeated heading\n\n**Repeated** heading\n\nRepeated heading';
    const plain = await projectWithEditor(markdown);
    expect(plain).toBe('Repeated heading\nRepeated heading\nRepeated heading');
    const { aToB, bToA } = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    const starts = (text: string) =>
      [0, 1, 2].map((i) => text.split('Repeated', i + 1).join('Repeated').length);
    const plainStarts = starts(plain);
    const markdownStarts = starts(markdown);
    expect(plainStarts).toEqual([0, 17, 34]);
    expect(markdownStarts).toEqual([0, 20, 40]);
    for (let i = 0; i < 3; i += 1) {
      // "Repe|ated" of each paragraph maps into the same paragraph.
      expect(aToB(plainStarts[i] + 4), `paragraph ${i}`).toBe(markdownStarts[i] + 4);
      expect(bToA(markdownStarts[i] + 4), `paragraph ${i}`).toBe(plainStarts[i] + 4);
    }
  });

  /** Offset of the `n`-th (0-based) occurrence of `needle` in `text`, plus `into`. */
  const nth = (text: string, needle: string, n: number, into = 0) => {
    let at = -1;
    for (let i = 0; i <= n; i += 1) at = text.indexOf(needle, at + 1);
    if (at === -1)
      throw new Error(`${JSON.stringify(needle)} #${n} not in ${JSON.stringify(text)}`);
    return at + into;
  };

  it.each<
    [
      string,
      string,
      string,
      Array<[plainNeedle: [string, number], markdownNeedle: [string, number]]>,
    ]
  >([
    [
      'a word split by formatting',
      '**Repe**ated heading\n\nRepeated heading',
      'Repeated heading\nRepeated heading',
      [
        [
          ['Repe', 0],
          ['Repe', 0],
        ],
        [
          ['ated', 0],
          ['ated', 0],
        ],
        [
          ['Repe', 1],
          ['Repe', 1],
        ],
      ],
    ],
    [
      'a line without a word',
      '**!!!!** ????????\n\n!!!! ????????',
      '!!!! ????????\n!!!! ????????',
      [
        [
          ['!!!!', 0],
          ['!!!!', 0],
        ],
        [
          ['????', 0],
          ['????', 0],
        ],
        [
          ['!!!!', 1],
          ['!!!!', 1],
        ],
      ],
    ],
    [
      'accented and astral characters',
      '**Répeated** 😀 heading\n\nRépeated 😀 heading',
      'Répeated 😀 heading\nRépeated 😀 heading',
      [
        [
          ['Répe', 0],
          ['Répe', 0],
        ],
        [
          ['heading', 0],
          ['heading', 0],
        ],
        [
          ['Répe', 1],
          ['Répe', 1],
        ],
      ],
    ],
    [
      'blank lines around both paragraphs',
      '\n\n**Repeated** heading\n\n\n\nRepeated heading\n\n',
      '\n\nRepeated heading\n\n\nRepeated heading',
      [
        [
          ['Repe', 0],
          ['Repe', 0],
        ],
        [
          ['Repe', 1],
          ['Repe', 1],
        ],
      ],
    ],
    [
      'an earlier verbatim copy on a hard-break continuation line',
      '- span text \npeer markdown render\n\n**pee**r markdown',
      'span text\uFFFCpeer markdown render\npeer markdown',
      [
        [
          ['peer', 0],
          ['peer', 0],
        ],
        [
          ['pee', 1],
          ['pee', 1],
        ],
        [
          ['r markdown', 1],
          ['r markdown', 1],
        ],
      ],
    ],
    [
      'a later copy of a formatted word on the same line',
      '- 😀 *alignment* ñandú. alignment peer',
      '😀 alignment ñandú. alignment peer',
      [
        [
          ['alig', 0],
          ['alig', 0],
        ],
        [
          ['ñand', 0],
          ['ñand', 0],
        ],
        [
          ['alig', 1],
          ['alig', 1],
        ],
      ],
    ],
    [
      'the next words inside a link destination',
      'caret [render](https://sync/selection/editor) sync\n\n**sel**ection daemon',
      'caret render sync\nselection daemon',
      [
        [
          ['rend', 0],
          ['rend', 0],
        ],
        [
          ['sync', 0],
          ['sync', 1],
        ],
        [
          ['sel', 0],
          ['sel', 1],
        ],
        [
          ['ection', 0],
          ['ection', 1],
        ],
      ],
    ],
  ])(
    'anchors the first paragraph onto itself with %s',
    async (_name, markdown, expectedPlain, pairs) => {
      const plain = await projectWithEditor(markdown);
      expect(plain).toBe(expectedPlain);
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(plain, markdown),
      );
      for (const [[plainNeedle, i], [markdownNeedle, j]] of pairs) {
        const p = nth(plain, plainNeedle, i, 2);
        const m = nth(markdown, markdownNeedle, j, 2);
        expect(aToB(p), `${plainNeedle} #${i} →`).toBe(m);
        expect(bToA(m), `${markdownNeedle} #${j} ←`).toBe(p);
      }
    },
  );

  it.each<[string, string, string, [string, number]]>([
    [
      'the words of the next line in a URL',
      '[x](https://Repeated/heading)\n\nRepeated heading',
      'x\nRepeated heading',
      ['Repeated heading', 0],
    ],
    [
      'the words of the next line in an earlier line',
      '**Repeated** other heading\n\nRepeated heading',
      'Repeated other heading\nRepeated heading',
      ['Repeated heading', 0],
    ],
  ])(
    'keeps a verbatim line in place with %s',
    async (_name, markdown, expectedPlain, [needle, n]) => {
      const plain = await projectWithEditor(markdown);
      expect(plain).toBe(expectedPlain);
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(plain, markdown),
      );
      for (let into = 1; into < needle.length; into += 1) {
        const p = nth(plain, needle, n, into);
        const m = nth(markdown, needle, n, into);
        expect(aToB(p), `${needle}[${into}] →`).toBe(m);
        expect(bToA(m), `${needle}[${into}] ←`).toBe(p);
      }
    },
  );

  it('keeps a list item in place after a fence and formatted items sharing its first word', async () => {
    const markdown = [
      '```ts',
      'const a = one(two);',
      '```',
      '',
      '- Note text note selection. **markdown markdown** presence markdown editor.',
      '- Span markdown sync editor. **render sync** selection workspace note.',
      '- Span projection selection caret span sync editor span.',
      '- Presence presence note peer alignment peer note.',
    ].join('\n');
    const plain = await projectWithEditor(markdown);
    expect(plain).toBe(
      [
        'const a = one(two);',
        'Note text note selection. markdown markdown presence markdown editor.',
        'Span markdown sync editor. render sync selection workspace note.',
        'Span projection selection caret span sync editor span.',
        'Presence presence note peer alignment peer note.',
      ].join('\n'),
    );
    const { aToB, bToA } = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    // The words occur in the same order on both sides, so a forward scan
    // locates each one independently of the alignment under test.
    let plainPos = 0;
    let markdownPos = 0;
    for (const word of plain.match(/[a-z]{3,}/gi) ?? []) {
      const p = plain.indexOf(word, plainPos);
      const m = markdown.indexOf(word, markdownPos);
      expect(aToB(p + 1), `${word} →`).toBe(m + 1);
      expect(bToA(m + 1), `${word} ←`).toBe(p + 1);
      plainPos = p + word.length;
      markdownPos = m + word.length;
    }
  });
});

describe('alignment of link-shaped text the editor shows', () => {
  it.each<[string, string, string]>([
    [
      'a code span',
      'intro `[x](abcdef)` outro\n\nabcdef outro',
      'intro [x](abcdef) outro\nabcdef outro',
    ],
    ['a fence', '```\n[x](abcdef)\n```\n\nabcdef outro', '[x](abcdef)\nabcdef outro'],
    [
      'a reference without a definition',
      '**intro** [x][abcdef] outro\n\nabcdef outro',
      'intro [x][abcdef] outro\nabcdef outro',
    ],
    [
      'an escaped link',
      '**intro** \\[x](abcdef) outro\n\nabcdef outro',
      'intro [x](abcdef) outro\nabcdef outro',
    ],
  ])('maps every character of %s', async (_name, markdown, expectedPlain) => {
    const plain = await projectWithEditor(markdown);
    expect(plain).toBe(expectedPlain);
    const { aToB, bToA } = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    const needle = /\[x\]\S+/.exec(plain)?.[0] ?? '';
    expect(needle).not.toBe('');
    for (let into = 1; into < needle.length; into += 1) {
      const p = plain.indexOf(needle) + into;
      const m = markdown.indexOf(needle) + into;
      expect(aToB(p), `${needle}[${into}] →`).toBe(m);
      expect(bToA(m), `${needle}[${into}] ←`).toBe(p);
    }
  });
});

describe('alignment of link syntax the lexer does not account for', () => {
  const LINK = '[render](https://sync/selection/editor)';
  const FILLER = 'unchanged prose lines.\n\n';
  /** The 128 KB the mask lexes up to, comfortably exceeded. */
  const PAST_CAP = 6700;

  /**
   * Every offset strictly inside the `plainIndex`-th occurrence of `needle` in
   * `plain` maps to the same offset inside its `markdownIndex`-th occurrence in
   * `markdown`, and back.
   */
  function expectExactRun(
    plain: string,
    markdown: string,
    map: ReturnType<typeof createBidirectionalOffsetMapper>,
    needle: string,
    plainIndex: number,
    markdownIndex: number,
  ) {
    const p = nthIndexOf(plain, needle, plainIndex);
    const m = nthIndexOf(markdown, needle, markdownIndex);
    expect(p, `${needle} in plain`).toBeGreaterThanOrEqual(0);
    expect(m, `${needle} in markdown`).toBeGreaterThanOrEqual(0);
    for (let into = 1; into < needle.length; into += 1) {
      expect(map.aToB(p + into), `${needle}[${into}] →`).toBe(m + into);
      expect(map.bToA(m + into), `${needle}[${into}] ←`).toBe(p + into);
    }
  }

  function nthIndexOf(text: string, needle: string, n: number): number {
    let at = -1;
    for (let k = 0; k <= n; k += 1) {
      at = text.indexOf(needle, at + 1);
      if (at === -1) return -1;
    }
    return at;
  }

  /**
   * The text of `plain` from the line break before `plainNeedle` up to
   * `until` — a run of lines left to the diff between two anchors — maps into
   * the markdown from the first line break before `markdownNeedle` up to its
   * `until`, and back, never moving backwards: a caret in it lands between
   * the anchors around it, whatever the diff pairs inside.
   */
  function expectBetweenAnchors(
    plain: string,
    markdown: string,
    map: ReturnType<typeof createBidirectionalOffsetMapper>,
    plainNeedle: string,
    markdownNeedle: string,
    until: string,
  ) {
    const region = (text: string, needle: string): [number, number] => {
      const at = text.indexOf(needle);
      const end = text.indexOf(until, at);
      expect(at, needle).toBeGreaterThanOrEqual(0);
      expect(end, until).toBeGreaterThan(at);
      let start = at;
      while (start > 0 && text.charCodeAt(start - 1) === 10) start -= 1;
      return [start, end];
    };
    const [pStart, pEnd] = region(plain, plainNeedle);
    const [mStart, mEnd] = region(markdown, markdownNeedle);
    for (const [from, to, start, end, tStart, tEnd] of [
      [map.aToB, 'aToB', pStart, pEnd, mStart, mEnd],
      [map.bToA, 'bToA', mStart, mEnd, pStart, pEnd],
    ] as const) {
      let previous = tStart;
      for (let offset = start; offset <= end; offset += 1) {
        const mapped = from(offset);
        expect(mapped, `${to}(${offset})`).toBeGreaterThanOrEqual(previous);
        expect(mapped, `${to}(${offset})`).toBeLessThanOrEqual(tEnd);
        previous = mapped;
      }
    }
  }

  it('hides the destination of a link on a heading a comment anchor precedes', async () => {
    // As written the anchor makes the line an HTML block with no link token;
    // the editor renders the heading (the anchor moved after its marker) and
    // hides the destination.
    const markdown = `intro\n\n<!--anchor:c:start-->## caret ${LINK} sync\n\n**sel**ection daemon<!--anchor:c:end-->`;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).toBe('intro\n\uFFFCcaret render sync\nselection daemon\uFFFC');
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    expectExactRun(plain, markdown, map, 'sync', 0, 1);
    expectExactRun(plain, markdown, map, 'render', 0, 0);
    expectExactRun(plain, markdown, map, 'daemon', 0, 0);
  });

  it('shows a link on a list item a comment anchor precedes as written', async () => {
    // The anchor moves after the list marker, where it opens an HTML block
    // the editor shows as written, link syntax included.
    const markdown = `<!--anchor:c:start-->- caret ${LINK} sync\n- **sel**ection daemon<!--anchor:c:end-->`;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).toBe(`\uFFFCcaret ${LINK} sync\nselection daemon\uFFFC`);
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    expectExactRun(plain, markdown, map, LINK, 0, 0);
    expectExactRun(plain, markdown, map, 'sync', 1, 1);
    expectExactRun(plain, markdown, map, 'daemon', 0, 0);
  });

  it('shows a link inside an HTML block as written', async () => {
    const markdown = `<div>caret ${LINK} sync</div>\n\n**sel**ection daemon`;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).toBe(`caret ${LINK} sync\n **sel**ection daemon`);
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    expectExactRun(plain, markdown, map, LINK, 0, 0);
    expectExactRun(plain, markdown, map, 'sync', 1, 1);
    expectExactRun(plain, markdown, map, 'daemon', 0, 0);
  });

  // A note past the cap the mask lexes up to is not lexed at all, so nothing
  // is masked, and what the alignment then guarantees is: no anchor lands on
  // a line that holds link syntax; the link line alone is left to the diff,
  // bounded by its own line, so a caret on it stays on it but may sit off by
  // the hidden destination; every other line is exact — the paragraphs beside
  // the link line included, whose words are never diffed against the
  // destination (`selection` below occurs verbatim only inside the URL).
  it.each<[string, (link: string) => string]>([
    [
      'at its start',
      (link) => `caret ${link} sync\n\n**sel**ection daemon\n\n$x$\n\n${FILLER.repeat(PAST_CAP)}`,
    ],
    [
      'past the cap',
      (link) => `${FILLER.repeat(PAST_CAP)}caret ${link} sync\n\n**sel**ection daemon\n\n$x$\n\n`,
    ],
  ])(
    'leaves the line of a link %s to the diff in a note past the lexing cap',
    async (_where, note) => {
      const markdown = note(LINK);
      expect(markdown.length).toBeGreaterThan(128 * 1024);
      const plain = await projectWithEditor(markdown, true);
      expect(plain).not.toContain('](');
      expect(plain).toContain('$x$');
      const started = performance.now();
      const map = createBidirectionalOffsetMapper(plain, markdown);
      expect(map.aToB(1)).toBe(1);
      const elapsed = performance.now() - started;
      // Generous CI bound; the alignment itself takes tens of milliseconds.
      expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
      expectBetweenAnchors(plain, markdown, map, 'caret render', 'caret [render', '\n');
      expectExactRun(plain, markdown, map, 'sel', 0, 1);
      expectExactRun(plain, markdown, map, 'ection daemon', 0, 0);
      expectExactRun(plain, markdown, map, '$x$', 0, 0);
      expectExactRun(plain, markdown, map, 'unchanged prose', 100, 100);
      expectExactRun(plain, markdown, map, 'unchanged prose', PAST_CAP - 1, PAST_CAP - 1);
    },
    60_000,
  );

  // The note editor shows each cell of a table row as a block of its own, so
  // a row is one markdown line ending several plain-text lines; the plain
  // text of a hard break (`ij  \n`) or a lazy continuation (`- mn\nop`) is
  // the reverse, one line ending two markdown lines. Past the cap the link
  // lines are unanchorable, so the run from `tk1` reaches `tk2` unanchored:
  // held to a count of markdown lines that does not pair them with the plain
  // lines, `tk2`'s own line is declined as too early and its `anchor` lands
  // on the heading two lines on — every line in between with it.
  const SHORT_CELLS = '| ab | cd |\n|---|---|\n| ef | gh |\n\n';
  const HARD_BREAKS = 'ij  \nkl\n\n- mn\nop\n\n';
  const LINK_LINES = Array.from(
    { length: 6 },
    (_, i) => `[link ${i}](https://sync/a/b) text ${i}\n\n`,
  ).join('');
  it.each<[string, string, string]>([
    ['a table', SHORT_CELLS, 'ab\ncd\nef\ngh\n'],
    [
      'a table and hard breaks',
      SHORT_CELLS + HARD_BREAKS,
      'ab\ncd\nef\ngh\nij\ufffckl\nmn\ufffcop\n',
    ],
    [
      'hard breaks and a table',
      HARD_BREAKS + SHORT_CELLS,
      'ij\ufffckl\nmn\ufffcop\nab\ncd\nef\ngh\n',
    ],
    ['pipes in prose', 'ab \\| cd\n\n`ef | gh`\n\nij | kl\n\n', 'ab | cd\nef | gh\nij | kl\n'],
  ])(
    'counts the lines of %s an unanchored run crosses as the note editor shows them',
    async (_shape, between, shown) => {
      const tail = `Intro line tk1\n\n${LINK_LINES}${between}anchor editor tk2\n\nfiller line tk3\n\n## anchor remote tk4`;
      const markdown = FILLER.repeat(PAST_CAP) + tail;
      expect(markdown.length).toBeGreaterThan(128 * 1024);
      // The filler projects by repetition (validated on two paragraphs); only
      // the tail is projected whole.
      const shownFiller = 'unchanged prose lines.\n';
      expect(await projectWithEditor(FILLER.repeat(2) + 'Intro line tk1', true)).toBe(
        shownFiller.repeat(2) + 'Intro line tk1',
      );
      const shownTail = await projectWithEditor(tail, true);
      expect(shownTail).toBe(
        `Intro line tk1\n${Array.from({ length: 6 }, (_, i) => `link ${i} text ${i}\n`).join('')}${shown}anchor editor tk2\nfiller line tk3\nanchor remote tk4`,
      );
      const plain = shownFiller.repeat(PAST_CAP) + shownTail;
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      expectExactRun(plain, markdown, map, 'anchor editor tk2', 0, 0);
      expectExactRun(plain, markdown, map, 'filler line tk3', 0, 0);
      expectExactRun(plain, markdown, map, 'anchor remote tk4', 0, 0);
      expectExactRun(plain, markdown, map, 'Intro line tk1', 0, 0);
    },
    60_000,
  );

  // The reviewer's repro: the formatted paragraph after the link line shares
  // no whole line with the markdown, and its `selection` occurs verbatim only
  // inside the URL — diffed together with the unmasked link line it would be
  // matched there. Below the cap the link line is masked and exact; past it
  // the line is diffed alone and every other run is exact. Both projections,
  // with and without a math delimiter past the cap: no content is masked
  // there.
  it.each<[string, string, string, boolean]>([
    ['below the cap', '$5', 'StarterKit', false],
    ['below the cap', '$5', 'the note editor', true],
    ['past the cap', '$5', 'StarterKit', false],
    ['past the cap', '$5', 'the note editor', true],
    ['past the cap', 'no', 'StarterKit', false],
    ['past the cap', 'no', 'the note editor', true],
  ])(
    'keeps every run beside a link line exact in a note %s with %s math projected by %s',
    async (where, math, _projection, production) => {
      const filler = 'q'.repeat((where === 'below the cap' ? 127 : 129) * 1024);
      const intro = math === 'no' ? 'intro ordinary' : `intro ${math} ordinary`;
      const markdown = `${intro}\n\ncaret ${LINK} sync\n\n**sel**ection daemon\n\nend marker\n\n${filler}`;
      const plain = await projectWithEditor(markdown, production);
      expect(plain).not.toContain('](');
      expect(plain).toContain('\nselection daemon\n');
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      if (where === 'below the cap') {
        expectExactRun(plain, markdown, map, 'caret', 0, 0);
        expectExactRun(plain, markdown, map, 'render', 0, 0);
        expectExactRun(plain, markdown, map, 'sync', 0, 1);
      } else {
        expectBetweenAnchors(plain, markdown, map, 'caret render', 'caret [render', '\n');
      }
      expectExactRun(plain, markdown, map, 'ordinary', 0, 0);
      expectExactRun(plain, markdown, map, 'sel', 0, 1);
      expectExactRun(plain, markdown, map, 'ection daemon', 0, 0);
      expectExactRun(plain, markdown, map, 'end marker', 0, 0);
      expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
    },
    60_000,
  );

  // A paragraph beside the link line no piece of which anchors — no four
  // characters of it occur in its markdown, while its words occur in order
  // inside the URL — is still diffed on its own line: the line breaks around
  // the link line bound its diff, so `selection editor` is never paired with
  // the URL's (`aToB(18)` landed at 28, inside the destination, when the two
  // lines were diffed as one region).
  it.each<[string, boolean]>([
    ['StarterKit', false],
    ['the note editor', true],
  ])(
    'keeps a paragraph no piece of which anchors on its own line beside a link line past the cap projected by %s',
    async (_projection, production) => {
      const spelled = '**se**le**ct**io**n** **ed**it**or**';
      const markdown = `caret ${LINK} sync\n\n${spelled}\n\nend marker\n\n${'q'.repeat(129 * 1024)}`;
      const plain = await projectWithEditor(markdown, production);
      expect(plain).toContain('\nselection editor\n');
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      expectBetweenAnchors(plain, markdown, map, 'caret render', 'caret [render', '\n');
      expectBetweenAnchors(plain, markdown, map, 'selection editor', spelled, '\n');
      const inUrl = markdown.indexOf('selection') + 4;
      expect(map.bToA(inUrl)).toBeLessThanOrEqual(plain.indexOf('\n'));
      expectExactRun(plain, markdown, map, 'end marker', 0, 0);
      expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
    },
    60_000,
  );

  /**
   * Every offset strictly inside the plain-text line (`\n` or U+FFFC bounds
   * it) that holds `plainNeedle` maps inside the markdown line that holds
   * `markdownNeedle`, and every offset strictly inside that markdown line
   * maps inside the plain line — the same-line invariant, whatever the diff
   * pairs inside the two. A line's ends are the line breaks around it and
   * may map to either side of the blank lines between the two.
   */
  function expectSameLine(
    plain: string,
    markdown: string,
    map: ReturnType<typeof createBidirectionalOffsetMapper>,
    plainNeedle: string,
    markdownNeedle: string,
  ) {
    const lineAround = (text: string, needle: string, breaks: RegExp): [number, number] => {
      const at = text.indexOf(needle);
      expect(at, needle).toBeGreaterThanOrEqual(0);
      let start = at;
      while (start > 0 && !breaks.test(text[start - 1])) start -= 1;
      let end = at + needle.length;
      while (end < text.length && !breaks.test(text[end])) end += 1;
      return [start, end];
    };
    const [pStart, pEnd] = lineAround(plain, plainNeedle, /[\n\uFFFC]/);
    const [mStart, mEnd] = lineAround(markdown, markdownNeedle, /\n/);
    for (let offset = pStart + 1; offset < pEnd; offset += 1) {
      expect(map.aToB(offset), `aToB(${offset})`).toBeGreaterThanOrEqual(mStart);
      expect(map.aToB(offset), `aToB(${offset})`).toBeLessThanOrEqual(mEnd);
    }
    for (let offset = mStart + 1; offset < mEnd; offset += 1) {
      expect(map.bToA(offset), `bToA(${offset})`).toBeGreaterThanOrEqual(pStart);
      expect(map.bToA(offset), `bToA(${offset})`).toBeLessThanOrEqual(pEnd);
    }
  }

  // The same-line invariant past the cap, on every line shape the reviewer
  // raised beside the link line: no offset of a plain-text line that is not
  // the link line's text maps into the link line, and no offset of the link
  // line maps outside its own text; every run beside the link line is exact
  // — the paragraph's `sel` included, which is no piece long enough to
  // anchor and occurs verbatim inside the URL (and inside the comment, whose
  // letters are the paragraph's). A comment, a definition, a setext
  // underline and a table delimiter are markdown lines with no plain-text
  // line of their own; a hard break, a soft break and a lazy continuation
  // put two markdown lines on one plain-text line, split at U+FFFC.
  const SPELLED = '**sel**ection daemon';
  const VARIANTS: Array<{
    name: string;
    note: string;
    /** Plain text the projection must hold, per projection. */
    plain: string;
    /** `[needle, plainIndex, markdownIndex]` of every run beside the link line, exact past the cap. */
    exact: Array<[string, number, number]>;
    /** `[plainNeedle, markdownNeedle]` of the formatted paragraph, held to its own line. */
    sameLine: [string, string];
    /** Exact below the cap only: runs on the link line. */
    onLinkLine: Array<[string, number, number]>;
  }> = [
    {
      name: "the reviewer's paragraph",
      note: `caret ${LINK} sync\n\n**se**le**ct**io**n** **ed**it**or**\n\nend marker`,
      plain: '\nselection editor\nend marker',
      exact: [['end marker', 0, 0]],
      sameLine: ['selection editor', '**se**le**ct**io**n**'],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'an HTML comment',
      note: `caret ${LINK} sync\n\n<!-- selection daemon -->\n\n${SPELLED}\n\nend marker`,
      plain: '\nselection daemon\nend marker',
      exact: [
        ['sel', 0, 2],
        ['ection daemon', 0, 1],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'a hard break',
      note: `caret ${LINK} sync  \n${SPELLED}\n\nend marker`,
      plain: '\uFFFCselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'a soft break',
      note: `caret ${LINK} sync\n${SPELLED}\n\nend marker`,
      plain: '\uFFFCselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'a lazy list continuation',
      note: `- caret ${LINK} sync\n${SPELLED}\n\nend marker`,
      plain: '\uFFFCselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'a lazy blockquote continuation',
      note: `> caret ${LINK} sync\n${SPELLED}\n\nend marker`,
      plain: '\uFFFCselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'an empty label',
      note: `caret [](https://sync/selection/editor) sync\n\n${SPELLED}\n\nend marker`,
      plain: 'caret sync\nselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['caret', 0, 0],
        ['sync', 0, 1],
      ],
    },
    {
      name: 'a reference definition',
      note: `caret [render][r] sync\n\n[r]: https://sync/selection/daemon\n\n${SPELLED}\n\nend marker`,
      plain: 'caret render sync\nselection daemon\nend marker',
      exact: [
        ['sel', 0, 1],
        ['ection daemon', 0, 0],
        ['end marker', 0, 0],
      ],
      sameLine: ['selection daemon', SPELLED],
      onLinkLine: [
        ['render', 0, 0],
        ['sync', 0, 0],
      ],
    },
  ];
  const PLACEMENTS: Array<[string, (note: string) => string]> = [
    ['below the cap', (note) => `${note}\n\n${'q'.repeat(127 * 1024)}`],
    ['past the cap at its start', (note) => `${note}\n\n${'q'.repeat(129 * 1024)}`],
    ['past the cap at its end', (note) => `${'q'.repeat(129 * 1024)}\n\n${note}`],
  ];
  const PROJECTIONS: Array<[string, boolean]> = [
    ['StarterKit', false],
    ['the note editor', true],
  ];
  const CELLS = PLACEMENTS.flatMap(([where, place]) =>
    PROJECTIONS.map(([projection, production]): [string, string, typeof place, boolean] => [
      where,
      projection,
      place,
      production,
    ]),
  );

  describe.each(VARIANTS)('beside $name', ({ note, plain: shape, exact, sameLine, onLinkLine }) => {
    it.each(CELLS)(
      'keeps every run beside the link line exact in a note %s projected by %s',
      async (where, _projection, place, production) => {
        const markdown = place(note);
        const plain = await projectWithEditor(markdown, production);
        expect(plain).toContain(shape);
        expect(plain).not.toContain('](');
        const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
        for (const [needle, plainIndex, markdownIndex] of exact) {
          expectExactRun(plain, markdown, map, needle, plainIndex, markdownIndex);
        }
        expectSameLine(plain, markdown, map, ...sameLine);
        // A definition's URL, a markdown line with no plain-text line, maps
        // to the line break before the paragraph at most, never past it.
        const url = markdown.indexOf('https://sync/selection/');
        const [pStart, pEnd] = [plain.indexOf(sameLine[0]), plain.indexOf('\nend marker')];
        for (let offset = url + 1; offset < url + 'https://sync/selection/'.length; offset += 1) {
          expect(map.bToA(offset), `bToA(${offset}) inside the URL`).toBeLessThanOrEqual(pStart);
        }
        for (let offset = pStart; offset <= pEnd; offset += 1) {
          const mapped = map.aToB(offset);
          expect(
            mapped <= url || mapped >= url + 'https://sync/selection/'.length,
            `aToB(${offset}) = ${mapped} lands inside the URL at ${url}`,
          ).toBe(true);
        }
        if (where === 'below the cap') {
          for (const [needle, plainIndex, markdownIndex] of onLinkLine) {
            expectExactRun(plain, markdown, map, needle, plainIndex, markdownIndex);
          }
        }
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
      },
      60_000,
    );
  });

  // A table row holds the link and the paragraph on one markdown line: the
  // paragraph is the link line's text, so its `selection` may be paired with
  // the URL's, but stays on the row, and every other cell and line is exact.
  // StarterKit has no table node and runs the cells into one line; only the
  // note editor's projection has cells of its own.
  it.each(CELLS)(
    'keeps a table row that holds a link on its own line in a note %s projected by %s',
    async (where, _projection, place, production) => {
      const row = `| ${LINK} | ${SPELLED} |`;
      const markdown = place(`| a | b |\n|---|---|\n${row}\n\nend marker`);
      const plain = await projectWithEditor(markdown, production);
      expect(plain).not.toContain('](');
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      expectExactRun(plain, markdown, map, 'end marker', 0, 0);
      expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
      if (production) {
        expect(plain).toContain('a\nb\nrender\nselection daemon\nend marker');
        expectExactRun(plain, markdown, map, 'render', 0, 0);
        expectSameLine(plain, markdown, map, 'render\nselection daemon', row);
        if (where === 'below the cap') expectExactRun(plain, markdown, map, 'sel', 0, 1);
      } else {
        expect(plain).toContain('abrenderselection daemon\nend marker');
        expectBetweenAnchors(plain, markdown, map, 'abrender', '| a | b |', 'end marker');
      }
    },
    60_000,
  );

  // Two markdown lines the editor shows no text of — a definition and a
  // comment — stand between a link line and two paragraphs that anchor only
  // in pieces (the second holds a link). A hit the count of markdown lines
  // admits is not thereby the text's own: the word that opens the last
  // paragraph opens the paragraph two lines before it too, as many lines past
  // the anchor as the plain text crossed once the two are miscounted as text
  // lines. Every paragraph must stay on its own line, on either side of the cap.
  it.each(CELLS)(
    'does not count a definition or a comment as a text line of the markdown in a note %s projected by %s',
    async (where, _projection, place, production) => {
      const markdown = place(
        'caret [render][r] sync\n\n[r]: https://sync/selection/daemon\n\n<!-- render caret -->\n\nedit selection daemon\n\neditor sync [](https://sync/render/editor) offset\n\neditor render caret',
      );
      const plain = await projectWithEditor(markdown, production);
      expect(plain).toContain(
        'caret render sync\nedit selection daemon\neditor sync offset\neditor render caret',
      );
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      expectExactRun(plain, markdown, map, 'edit selection daemon', 0, 0);
      expectExactRun(plain, markdown, map, 'editor sync', 0, 0);
      expectExactRun(plain, markdown, map, 'offset', 0, 0);
      expectExactRun(plain, markdown, map, 'editor render caret', 0, 0);
      expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
      expectSameLine(plain, markdown, map, 'caret render sync', 'caret [render][r] sync');
      if (where === 'below the cap') {
        expectExactRun(plain, markdown, map, 'caret', 0, 0);
        expectExactRun(plain, markdown, map, 'render', 0, 0);
        expectExactRun(plain, markdown, map, 'sync', 0, 0);
      }
    },
    60_000,
  );

  // A note that opens with `<` the renderer reads as HTML, not markdown: the
  // tag — here an autolink at the start of the line — is dropped, and every
  // other character is shown as written on one line, the line breaks
  // collapsed. Its tags are masked by a scan, not the lexer, so the cap does
  // not apply: at any length nothing maps into the URL and every run is
  // exact. (Sealing the tag's line past the cap instead left the one
  // plain-text line the text of no markdown line, and the whole note one gap
  // holding a sealed line — every caret in it at one end of the note.)
  const DROPPED_AUTOLINK = '<https://selection/editor>';
  const DROPPED_SPELLED = '**se**le**ct**io**n** **ed**it**or**';

  /**
   * Every offset of the URL maps outside the text and no plain-text offset
   * maps into the URL — reported as the offending offsets, never the note.
   */
  function expectAutolinkDropped(plain: string, markdown: string, spelled: string) {
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    const url = markdown.indexOf('https://selection/editor');
    const urlEnd = url + 'https://selection/editor'.length;
    const paragraphEnd = plain.indexOf(spelled) + spelled.length;
    const intoText: number[] = [];
    for (let offset = url + 1; offset < urlEnd; offset += 1) {
      const mapped = map.bToA(offset);
      if (mapped > 0 && mapped < paragraphEnd) intoText.push(offset);
    }
    expect(intoText, 'bToA offsets inside the URL that land in the text').toEqual([]);
    const intoUrl: number[] = [];
    for (let offset = 0; offset <= plain.length; offset += 1) {
      const mapped = map.aToB(offset);
      if (mapped > url && mapped < urlEnd) intoUrl.push(offset);
    }
    expect(intoUrl, `aToB offsets that land inside the URL at ${url}`).toEqual([]);
    expect([map.aToB(1), map.bToA(28)]).toEqual([28, 1]);
    return map;
  }

  // The filler and the projection are separate columns so the title never
  // holds the filler: a 130 KiB title printed per cell stalls the CI log.
  it.each<[string, string, string, boolean]>([
    ['with no filler', 'StarterKit', '', false],
    ['with no filler', 'the note editor', '', true],
    ['below the cap', 'StarterKit', `\n\n${'q'.repeat(127 * 1024)}`, false],
    ['below the cap', 'the note editor', `\n\n${'q'.repeat(127 * 1024)}`, true],
    ['past the cap', 'StarterKit', `\n\n${'q'.repeat(129 * 1024)}`, false],
    ['past the cap', 'the note editor', `\n\n${'q'.repeat(129 * 1024)}`, true],
  ])(
    'never maps into the autolink a note the renderer reads as HTML drops, %s, projected by %s',
    async (_where, _projection, filler, production) => {
      const spelled = DROPPED_SPELLED;
      const markdown = `${DROPPED_AUTOLINK} sync\n\n${spelled}${filler}`;
      const plain = await projectWithEditor(markdown, production);
      expect(plain.startsWith(`sync ${spelled}`)).toBe(true);
      expect(plain.indexOf('https')).toBe(-1);
      const map = expectAutolinkDropped(plain, markdown, spelled);
      expectExactRun(plain, markdown, map, 'sync', 0, 0);
      expectExactRun(plain, markdown, map, spelled, 0, 0);
      if (filler) expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
    },
    60_000,
  );

  // Far past the cap the mapper alone is under test: the editor projects the
  // head with a token of filler, which fixes how a filler paragraph reads —
  // one space for the blank line between — and the 1 MiB plain text follows.
  it('never maps into the autolink a note the renderer reads as HTML drops, far past the cap', async () => {
    const spelled = DROPPED_SPELLED;
    const head = `${DROPPED_AUTOLINK} sync\n\n${spelled}`;
    const token = 'qq';
    const projectedHead = await projectWithEditor(`${head}\n\n${token}`, true);
    expect(projectedHead).toBe(`sync ${spelled} ${token}`);
    const filler = 'q'.repeat(1024 * 1024);
    const markdown = `${head}\n\n${filler}`;
    const plain = `sync ${spelled} ${filler}`;
    const map = expectAutolinkDropped(plain, markdown, spelled);
    expectExactRun(plain, markdown, map, 'sync', 0, 0);
    expectExactRun(plain, markdown, map, spelled, 0, 0);
    expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
  }, 60_000);

  // The tag scan is quote-aware, as the renderer's tokenizer is: inside a tag
  // a `>` within a quoted attribute value does not close it — the value runs
  // to its closing quote, over a line break too — and a `>` inside a comment
  // closes nothing. A quote never closed swallows the rest of the note in the
  // renderer, which shows nothing more of it; the scan ends such a tag at the
  // next `>` or line break, fail-safe, and the (empty) text maps within
  // itself. (Ended at the first `>` whatever the quotes, the tag's value was
  // shown as text and a caret in `selection` landed inside the attribute.)
  const QUOTED_TAGS: Array<[string, string, string]> = [
    ['a > in a double-quoted value', '<p title=">selection">selection</p>', 'selection'],
    ['a > in a single-quoted value', "<p title='>selection'>selection</p>", 'selection'],
    ['a > inside a comment', '<p><!-- a > b -->selection</p>', 'selection'],
    ['a quoted > over a line break', '<p title="a\n>b">selection</p>', 'selection'],
    ['a quoted > after a line break', '<p\n title=">selection">selection</p>', 'selection'],
    ['a quote never closed', '<p title=">selection</p>', ''],
  ];
  const QUOTED_TAG_CELLS = QUOTED_TAGS.flatMap(([shape, note, shown]) =>
    (
      [
        ['with no filler', ''],
        ['below the cap', `\n\n${'q'.repeat(127 * 1024)}`],
        ['past the cap', `\n\n${'q'.repeat(129 * 1024)}`],
      ] as Array<[string, string]>
    ).flatMap(([where, filler]) =>
      PROJECTIONS.map(
        ([projection, production]): [string, string, string, string, string, string, boolean] => [
          shape,
          where,
          projection,
          note,
          shown,
          filler,
          production,
        ],
      ),
    ),
  );
  it.each(QUOTED_TAG_CELLS)(
    'masks a tag holding %s in a note the renderer reads as HTML, %s, projected by %s',
    async (_shape, _where, _projection, note, shown, filler, production) => {
      const markdown = `${note}${filler}`;
      const plain = await projectWithEditor(markdown, production);
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      if (shown === '') {
        expect(plain).toBe('');
        for (let offset = 0; offset <= markdown.length; offset += 1 + (markdown.length >> 5)) {
          expect(map.bToA(offset), `bToA(${offset})`).toBe(0);
        }
        return;
      }
      expect(plain.startsWith(shown)).toBe(true);
      expect(plain).not.toContain('>');
      const m = note.lastIndexOf(shown);
      expect([map.aToB(1), map.bToA(m + 1)]).toEqual([m + 1, 1]);
      expectExactRun(plain, markdown, map, shown, 0, note.indexOf(shown) === m ? 0 : 1);
      for (let offset = 1; offset < m; offset += 1) {
        expect(map.bToA(offset), `bToA(${offset}) inside the tag`).toBe(0);
      }
      if (filler) expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
    },
    60_000,
  );

  // The tag scan of a note the renderer reads as HTML is linear whatever the
  // note holds: a tag never closed, or a comment never closed, is looked for
  // once, not once per opener, and so are the `>` and the line break that end
  // a tag whose quote is never closed. (The regular expression it replaces
  // took 2.7 s on 128 KB of `<a` and 165 s on 1 MB.)
  it.each<[string, string, string]>([
    ['tags never closed', '<a'.repeat(512 * 1024), ''],
    ['comments never closed', '<!--'.repeat(256 * 1024), ''],
    ['quotes never closed', '<a title="'.repeat(104 * 1024), ''],
    ['quotes never closed, a > after each', '<a title=">'.repeat(96 * 1024), ''],
    ['quotes never closed, a line break after each', '<a title="\n'.repeat(96 * 1024), ''],
    [
      'a quoted > in every tag',
      '<p title=">">sync <b>edit</b> selection</p>\n'.repeat(23 * 1024),
      'sync edit selection\n'.repeat(23 * 1024).trimEnd(),
    ],
    [
      'tags closed',
      '<p>sync <b>edit</b> selection</p>\n'.repeat(32 * 1024),
      'sync edit selection\n'.repeat(32 * 1024).trimEnd(),
    ],
  ])(
    'masks a 1 MB note the renderer reads as HTML with %s in linear time',
    (_case, markdown, plain) => {
      const started = performance.now();
      const map = createBidirectionalOffsetMapper(plain, markdown);
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(400);
      if (plain !== '') {
        expect(map.aToB(1)).toBe(markdown.indexOf('sync') + 1);
        expect(map.bToA(markdown.indexOf('edit') + 2)).toBe(plain.indexOf('edit') + 2);
      }
    },
  );

  // The control: prefixed by a word the autolink is inline, shown as written,
  // and the note is markdown — every run is exact.
  it.each<[string, string, string, boolean]>([
    ['below the cap', 'StarterKit', `\n\n${'q'.repeat(127 * 1024)}`, false],
    ['below the cap', 'the note editor', `\n\n${'q'.repeat(127 * 1024)}`, true],
    ['past the cap', 'StarterKit', `\n\n${'q'.repeat(129 * 1024)}`, false],
    ['past the cap', 'the note editor', `\n\n${'q'.repeat(129 * 1024)}`, true],
  ])(
    'shows an autolink after a word as written in a note %s projected by %s',
    async (_where, _projection, filler, production) => {
      const spelled = '**se**le**ct**io**n** **ed**it**or**';
      const head = 'see <https://selection/editor> sync';
      const markdown = `${head}\n\n${spelled}${filler}`;
      const plain = await projectWithEditor(markdown, production);
      expect(plain.startsWith(`${head}\nselection editor\n`)).toBe(true);
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      expectExactRun(plain, markdown, map, head, 0, 0);
      expectSameLine(plain, markdown, map, 'selection editor', spelled);
      expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
    },
    60_000,
  );

  // The reviewer's minimal repro, below the cap: the mask hides the
  // destination whether or not the note holds a math delimiter.
  it.each<[string, string]>([
    ['math', '$x$\n\n'],
    ['no math', ''],
  ])('hides the destination of a link in a note below the cap with %s', async (_case, math) => {
    const markdown = `caret ${LINK} sync\n\n**sel**ection daemon\n\n${math}${'q'.repeat(127 * 1024)}`;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).not.toContain('](');
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    expect([map.aToB(15), map.bToA(48)]).toEqual([48, 15]);
    expect([map.aToB(20), map.bToA(56)]).toEqual([56, 20]);
    expectExactRun(plain, markdown, map, 'sync', 0, 1);
    expectExactRun(plain, markdown, map, 'render', 0, 0);
    expectExactRun(plain, markdown, map, 'daemon', 0, 0);
  });

  it('leaves the line of a link to the diff in a note past the cap', async () => {
    const markdown = `caret ${LINK} sync\n\n**sel**ection daemon\n\n$x$\n\n${'q'.repeat(129 * 1024)}`;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).not.toContain('](');
    const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
    expectBetweenAnchors(plain, markdown, map, 'caret render', 'caret [render', '\n');
    expectExactRun(plain, markdown, map, 'sel', 0, 1);
    expectExactRun(plain, markdown, map, 'ection daemon', 0, 0);
    expectExactRun(plain, markdown, map, '$x$', 0, 0);
    expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
  });

  // A formula is displayed as written, link-shaped text inside it included:
  // below the cap the renderer's own lexer reads it as math and masks
  // nothing in it; past the cap nothing is masked, and its line is diffed
  // alone. The reviewer's repro, in both projections the binding sees.
  it.each<[number, string, boolean]>([
    [127, 'StarterKit', false],
    [127, 'the note editor', true],
    [129, 'StarterKit', false],
    [129, 'the note editor', true],
  ])(
    'shows link-shaped text inside a formula as written at %i KiB projected by %s',
    async (kilobytes, _projection, production) => {
      const formula = '$[label](https://sync/selection/editor)$';
      const head = `before ${formula} sync after`;
      const markdown = `${head}\n\n${'q'.repeat(kilobytes * 1024)}`;
      const plain = await projectWithEditor(markdown, production);
      expect(plain.startsWith(`${head}\n`)).toBe(true);
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      // Offset 30 is inside the visible `selection`.
      expect([map.aToB(30), map.bToA(30)]).toEqual([30, 30]);
      expectExactRun(plain, markdown, map, formula, 0, 0);
      expectExactRun(plain, markdown, map, 'before', 0, 0);
      expectExactRun(plain, markdown, map, ' sync after', 0, 0);
    },
    60_000,
  );

  // Link syntax the lexer read as a code span leaves its line unanchorable:
  // the line is aligned by the diff, exactly, however long it is — the
  // length cap on a region nothing anchored inside does not apply to one
  // whose anchors were declined. A line of many words is not walked word by
  // word once its rest was found whole on the unanchorable markdown line:
  // that walk, every hit declined, was quadratic and spent the budget.
  it.each([
    ['one', 9_000],
    ['one', 50_000],
    ['many', 9_000],
    ['many', 50_000],
  ])(
    'aligns a %s-word %i-character visible code line exactly, well inside the deadline',
    async (words, length) => {
      const visible =
        words === 'one'
          ? `${'a'.repeat(length)} [x](u)`
          : 'alpha [x](u) beta '.repeat(Math.ceil(length / 18)).trimEnd();
      const markdown = `\`${visible}\``;
      const plain = await projectWithEditor(markdown, true);
      expect(plain).toBe(visible);
      const started = performance.now();
      const map = createBidirectionalOffsetMapper(plain, markdown);
      const elapsed = performance.now() - started;
      expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(100);
      expect([map.aToB(100), map.bToA(101)]).toEqual([101, 100]);
      for (let offset = 1; offset < plain.length; offset += 97) {
        expect([map.aToB(offset), map.bToA(offset + 1)], `@ ${offset}`).toEqual([
          offset + 1,
          offset,
        ]);
      }
    },
    60_000,
  );

  it('aligns a 300 KiB visible code line of residual link syntax exactly', async () => {
    // Every opener on the line is residual (past the cap nothing is masked;
    // below it a code span masks nothing either): the lines are bounded in
    // one pass, not once per opener — the mask alone took over a second when
    // it rescanned the line for every opener — and the line, declined whole,
    // reaches the diff whole rather than token by token, so it is found
    // inside its backticks in one search.
    const visible = '[x](u) '.repeat(Math.ceil((300 * 1024) / 7)).trimEnd();
    const markdown = `\`${visible}\``;
    const plain = await projectWithEditor(markdown, true);
    expect(plain).toBe(visible);
    const started = performance.now();
    const { aToB, bToA } = createBidirectionalOffsetMapper(plain, markdown);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(100);
    for (let offset = 1; offset < plain.length; offset += 1009) {
      expect([aToB(offset), bToA(offset + 1)], `@ ${offset}`).toEqual([offset + 1, offset]);
    }
  }, 120_000);

  // The lexer reads a note with its `\r\n` line endings rewritten to `\n`,
  // so every range it hides sits earlier in that text than in the note; the
  // mask carries each back by the line endings shortened before it. A CRLF
  // note is masked exactly as its LF twin: below the cap a caret one letter
  // into the label maps one letter into the label, never into the URL.
  describe('in a note with CRLF line endings', () => {
    const LABELS: Array<[string, string, string[]]> = [
      ['a label split once', '**sel**ection', ['sel', 'ection']],
      ['a label split on every letter pair', '**se**le**ct**io**n**', ['se', 'le', 'ct', 'io']],
    ];
    const CRLF_PLACEMENTS: Array<[string, (note: string) => string]> = [
      ['below the cap', (note) => note],
      ['past the cap', (note) => `${note}\r\n\r\n${'q'.repeat(129 * 1024)}`],
    ];
    const CRLF_CELLS = LABELS.flatMap(([name, label, runs]) =>
      CRLF_PLACEMENTS.flatMap(([where, place]) =>
        PROJECTIONS.map(
          ([projection, production]): [
            string,
            string,
            string,
            string,
            string[],
            typeof place,
            boolean,
          ] => [name, where, projection, label, runs, place, production],
        ),
      ),
    );

    /** No plain-text offset from `start` on maps strictly inside a URL of `markdown`. */
    function expectUrlsHidden(
      plain: string,
      markdown: string,
      map: ReturnType<typeof createBidirectionalOffsetMapper>,
      start = 0,
    ) {
      const urls = [...markdown.matchAll(/https?:\/\/[^\s)]+/g)].map(
        (url) => [url.index, url.index + url[0].length] as const,
      );
      expect(urls.length).toBeGreaterThan(0);
      for (let offset = start; offset <= plain.length; offset += 1) {
        const mapped = map.aToB(offset);
        for (const [start, stop] of urls) {
          expect(
            mapped <= start || mapped >= stop,
            `aToB(${offset}) = ${mapped} lands inside the URL at ${start}`,
          ).toBe(true);
        }
      }
    }

    it.each(CRLF_CELLS)(
      'masks the URL beside %s in a note %s projected by %s',
      async (_name, where, _projection, label, runs, place, production) => {
        const markdown = place(`[${label}](https://selection/editor) sync\r\n\r\nend marker`);
        const plain = await projectWithEditor(markdown, production);
        expect(plain.startsWith('selection sync\nend marker')).toBe(true);
        const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
        const url = markdown.indexOf('https://selection/editor');
        const lineEnd = plain.indexOf('\n');
        for (let offset = url + 1; offset < url + 'https://selection/editor'.length; offset += 1) {
          expect(map.bToA(offset), `bToA(${offset}) inside the URL`).toBeLessThanOrEqual(lineEnd);
        }
        expectExactRun(plain, markdown, map, 'end marker', 0, 0);
        if (where === 'below the cap') {
          expectUrlsHidden(plain, markdown, map);
          expect([map.aToB(1), map.bToA(4)]).toEqual([4, 1]);
          for (const run of runs) expectExactRun(plain, markdown, map, run, 0, 0);
          expectExactRun(plain, markdown, map, 'sync', 0, 0);
        } else {
          // Past the cap the link line is sealed: its text stays on the line,
          // off by at most the hidden destination, as in its LF twin.
          expectUrlsHidden(plain, markdown, map, lineEnd);
          expectSameLine(plain, markdown, map, 'selection sync', 'sync');
          expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        }
      },
      60_000,
    );

    const NOTES: Array<[string, string, Array<[string, number, number]>]> = [
      [
        'mixed CR LF and LF line endings',
        'caret [render](https://sync/selection) sync\r\nsoft wrap\n\r\n- item [edit](https://edit/or) daemon\n\r\nend marker',
        [
          ['caret', 0, 0],
          ['render', 0, 0],
          ['sync', 0, 1],
          ['soft wrap', 0, 0],
          ['item', 0, 0],
          ['edit', 0, 0],
          ['daemon', 0, 0],
          ['end marker', 0, 0],
        ],
      ],
      [
        'a code span and a fence beside the link',
        '`[x](y)` [**sel**ection](https://selection/editor) sync\r\n\r\n```\r\n[a](b)\r\n```\r\n\r\nend marker',
        [
          ['[x](y)', 0, 0],
          ['sel', 0, 0],
          ['ection', 0, 0],
          ['sync', 0, 0],
          ['[a](b)', 0, 0],
          ['end marker', 0, 0],
        ],
      ],
      [
        'the link in a list item',
        '- item [**sel**ection](https://selection/editor) sync\r\n- second\r\n\r\nend marker',
        [
          ['item', 0, 0],
          ['sel', 0, 0],
          ['ection', 0, 0],
          ['sync', 0, 0],
          ['second', 0, 0],
          ['end marker', 0, 0],
        ],
      ],
    ];
    const NOTE_CELLS = NOTES.flatMap(([name, markdown, runs]) =>
      PROJECTIONS.map(
        ([projection, production]): [
          string,
          string,
          string,
          Array<[string, number, number]>,
          boolean,
        ] => [name, projection, markdown, runs, production],
      ),
    );

    it.each(NOTE_CELLS)(
      'keeps every run exact with %s, projected by %s',
      async (_name, _projection, markdown, runs, production) => {
        const plain = await projectWithEditor(markdown, production);
        expect(plain).not.toContain('https');
        expect(plain).not.toContain('\r');
        const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
        expectUrlsHidden(plain, markdown, map);
        for (const [needle, plainIndex, markdownIndex] of runs) {
          expectExactRun(plain, markdown, map, needle, plainIndex, markdownIndex);
        }
      },
      60_000,
    );
  });

  // A run of hundreds of link lines past the cap, each sealed and each the
  // text of one plain-text line. The pairing search is bounded by the product
  // of the two line counts (2^18 cells): at 513 lines it is unaffordable, and
  // a spent deadline declines it — and every diff — at any count. Whichever
  // way the lines are paired, a sealed line stays bounded by its own pair:
  // no offset inside a link line maps outside its plain-text line, and none
  // inside the plain-text line maps outside its link line.
  describe('a run of sealed lines the pairing search cannot afford', () => {
    /** The `[start, end)` of every line of `text` that holds `needle`, breaks excluded. */
    function linesHolding(text: string, needle: string, breaks: RegExp): Array<[number, number]> {
      const lines: Array<[number, number]> = [];
      let start = 0;
      for (const match of text.matchAll(breaks)) {
        if (text.slice(start, match.index).includes(needle)) lines.push([start, match.index]);
        start = match.index + match[0].length;
      }
      if (text.slice(start).includes(needle)) lines.push([start, text.length]);
      return lines;
    }

    /** Every offset strictly inside the k-th line of one side maps inside the k-th line of the other. */
    function expectLinesBounded(
      map: ReturnType<typeof createBidirectionalOffsetMapper>,
      plainLines: Array<[number, number]>,
      markdownLines: Array<[number, number]>,
    ) {
      expect(plainLines.length).toBe(markdownLines.length);
      const escaped: string[] = [];
      for (let k = 0; k < markdownLines.length; k += 1) {
        const [pStart, pEnd] = plainLines[k];
        const [mStart, mEnd] = markdownLines[k];
        for (let offset = mStart + 1; offset < mEnd; offset += 1) {
          const mapped = map.bToA(offset);
          if (mapped < pStart || mapped > pEnd)
            escaped.push(`bToA(${offset}) = ${mapped} on line ${k}`);
        }
        for (let offset = pStart + 1; offset < pEnd; offset += 1) {
          const mapped = map.aToB(offset);
          if (mapped < mStart || mapped > mEnd)
            escaped.push(`aToB(${offset}) = ${mapped} on line ${k}`);
        }
      }
      expect(escaped, escaped.slice(0, 8).join('\n')).toEqual([]);
    }

    type Clock = <T>(fn: () => T) => T;
    const CLOCKS: Array<[string, Clock]> = [
      ['within the budget', withoutDeadline],
      ['past the deadline', withExpiredDeadline],
    ];
    const RUNS = [257, 513, 600];
    const RUN_CELLS = RUNS.flatMap((count) =>
      CLOCKS.map(([when, clock]): [number, string, Clock] => [count, when, clock]),
    );

    it.each(RUN_CELLS)(
      'keeps each of %i link lines bounded by its own plain-text line %s',
      async (count, _when, clock) => {
        const markdown = `${'q'.repeat(129 * 1024)}\n\n${'[xy](https://ab/xy)\n'.repeat(count)}\n**ab**`;
        const plain = await projectWithEditor(markdown, true);
        expect(plain).not.toContain('https');
        const started = performance.now();
        const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
        const elapsed = performance.now() - started;
        expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(1_000);
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        expectLinesBounded(
          map,
          linesHolding(plain, 'xy', /\n|\uFFFC/g),
          linesHolding(markdown, '](', /\n/g),
        );
        expectSameLine(plain, markdown, map, 'ab', '**ab**');
      },
      60_000,
    );

    // A comment between every three link lines: the renderer drops it, so the
    // markdown has more lines than the plain text and the lines are not paired
    // by position; the product of the counts is past the search's bound, so
    // they are paired greedily in order — the comment lines deleted, each
    // link line paired with the plain-text line of its own label.
    it.each(CLOCKS)(
      'pairs each link line with its own plain-text line when the counts differ %s',
      async (_when, clock) => {
        const run = Array.from({ length: 600 }, (_, k) =>
          k % 3 === 2 ? `[xy](https://ab/xy)\n<!-- sync -->` : '[xy](https://ab/xy)',
        ).join('\n');
        const markdown = `${'q'.repeat(129 * 1024)}\n\n${run}\n\n**ab**`;
        const plain = await projectWithEditor(markdown, true);
        expect(plain).not.toContain('https');
        expect(plain).not.toContain('sync');
        const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        expectLinesBounded(
          map,
          linesHolding(plain, 'xy', /\n|\uFFFC/g),
          linesHolding(markdown, '](', /\n/g),
        );
        expectSameLine(plain, markdown, map, 'ab', '**ab**');
      },
      60_000,
    );

    // Nine comment lines after the first of 600 link lines: the counts are
    // past the search's bound under any clock, so the lines are paired
    // greedily, and the run is longer than the pairing looks ahead. (As
    // candidates, the comments put every link line past the lookahead: the
    // second link's plain-text line mapped inside the first comment, and its
    // markdown to a later line — 599 of the 600 lines wrong.)
    it.each(
      PROJECTIONS.flatMap(([projection, production]) =>
        [...CLOCKS, ['under the natural clock', (fn) => fn()] as [string, Clock]].map(
          ([when, clock]): [string, string, boolean, Clock] => [
            projection,
            when,
            production,
            clock,
          ],
        ),
      ),
    )(
      'keeps 600 link lines bounded by their own plain-text lines after a run of comments, projected by %s %s',
      async (_projection, _when, production, clock) => {
        const comments = Array.from({ length: 9 }, (_, k) => `<!-- sync ${k} -->`).join('\n');
        const links = '[xy](https://ab/xy)\n'.repeat(599);
        const markdown = `${'q'.repeat(129 * 1024)}\n\n[xy](https://ab/xy)\n${comments}\n${links}\n**ab**`;
        const plain = await projectWithEditor(markdown, production);
        expect(plain).not.toContain('https');
        expect(plain).not.toContain('sync');
        const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        const plainLines = linesHolding(plain, 'xy', /\n|\uFFFC/g);
        expect(plainLines).toHaveLength(600);
        expectLinesBounded(map, plainLines, linesHolding(markdown, '](', /\n/g));
        expectSameLine(plain, markdown, map, 'ab', '**ab**');
      },
      60_000,
    );

    // A run of lines the editor shows no text of — comments, or reference
    // definitions — before a sealed link line, longer than the greedy pairing
    // looks ahead. Such a line is no candidate for a pair (`isTextLine`), so
    // past the deadline, the lines paired greedily, the link line beyond the
    // run is still paired with its own plain-text line, however long the run.
    // (As candidates, nine of them put the link line past the lookahead: its
    // plain-text line was inserted at the note's end and its markdown mapped
    // to the line before the run.)
    const HIDDEN_RUNS: Array<[string, (k: number) => string]> = [
      ['comment', (k) => `<!-- sync ${k} -->`],
      ['definition', (k) => `[r${k}]: https://sync/${k}`],
    ];
    const HIDDEN_RUN_CELLS = HIDDEN_RUNS.flatMap(([kind, line]) =>
      [9, 50, 500].flatMap((count) =>
        PROJECTIONS.flatMap(([projection, production]) =>
          CLOCKS.map(
            ([when, clock]): [
              number,
              string,
              string,
              string,
              (k: number) => string,
              boolean,
              Clock,
            ] => [count, kind, projection, when, line, production, clock],
          ),
        ),
      ),
    );

    it.each(HIDDEN_RUN_CELLS)(
      'keeps a link line after %i %s lines bounded by its own plain-text line, projected by %s %s',
      async (count, _kind, _projection, _when, line, production, clock) => {
        const run = Array.from({ length: count }, (_, k) => line(k)).join('\n');
        const markdown = `${'q'.repeat(129 * 1024)}\n\nedit one\n\n${run}\n[ab](https://sync/ab)\n\n**cd** two`;
        const plain = await projectWithEditor(markdown, production);
        expect(plain).not.toContain('https');
        expect(plain).toContain('edit one\nab\ncd two');
        const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        expectSameLine(plain, markdown, map, 'edit one', 'edit one');
        expectSameLine(plain, markdown, map, 'ab', '[ab](');
        expectSameLine(plain, markdown, map, 'cd two', '**cd** two');
      },
      60_000,
    );

    // A run of plain-text lines that are byte-identical duplicates — list
    // items, or the cells of table rows — before a sealed link line, longer
    // than the pairing looks ahead over the plain text. The pairing cannot be
    // derailed the way a run of comments derailed it over the markdown: every
    // plain-text line ends a markdown text line of its own (a mention's is
    // the most the markdown lacks), so the lines are consumed in order and
    // the k-th duplicate pairs with the k-th; the link line beyond the run is
    // still paired with its own plain-text line, however long the run. (Only
    // the note editor shows cells of their own, and only within the budget:
    // past the deadline the lines are paired greedily, a row as one line.)
    const DUPLICATE_RUNS: Array<
      [string, (count: number) => string, Array<[string, boolean]>, Array<[string, Clock]>]
    > = [
      ['list items', (count) => '- same item\n'.repeat(count), PROJECTIONS, CLOCKS],
      [
        'table cells',
        (count) =>
          `| same item | same item | same item |\n|---|---|---|\n${'| same item | same item | same item |\n'.repeat(count / 3 - 1)}`,
        PROJECTIONS.filter(([, production]) => production),
        CLOCKS.filter(([when]) => when === 'within the budget'),
      ],
    ];
    const DUPLICATE_RUN_CELLS = DUPLICATE_RUNS.flatMap(([kind, run, projections, clocks]) =>
      [9, 51].flatMap((count) =>
        projections.flatMap(([projection, production]) =>
          clocks.map(
            ([when, clock]): [
              number,
              string,
              string,
              string,
              (count: number) => string,
              boolean,
              Clock,
            ] => [count, kind, projection, when, run, production, clock],
          ),
        ),
      ),
    );

    it.each(DUPLICATE_RUN_CELLS)(
      'pairs each of %i duplicate %s with its own plain-text line, and a link line after them, projected by %s %s',
      async (count, _kind, _projection, _when, run, production, clock) => {
        const markdown = `${'q'.repeat(129 * 1024)}\n\nedit one\n\n${run(count)}\n[ab](https://sync/ab)\n\n**cd** two`;
        const plain = await projectWithEditor(markdown, production);
        expect(plain).not.toContain('https');
        const plainLines = linesHolding(plain, 'same item', /\n|\uFFFC/g);
        expect(plainLines).toHaveLength(count);
        const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
        expectExactRun(plain, markdown, map, 'qqqqqqqq', 0, 0);
        expectSameLine(plain, markdown, map, 'edit one', 'edit one');
        expectLinesBounded(
          map,
          plainLines,
          [...markdown.matchAll(/same item/g)].map((m) => [m.index, m.index + m[0].length]),
        );
        expectSameLine(plain, markdown, map, 'ab', '[ab](');
        expectSameLine(plain, markdown, map, 'cd two', '**cd** two');
      },
      60_000,
    );
  });
});

describe('alignment past the cap of notes drawn from every line shape', () => {
  /** A seeded generator (mulberry32): the same seed draws the same note. */
  function random(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Few words, so the letters of any line occur inside the destinations of
  // many links — the leak a diff across a link line would take.
  const WORDS = [
    'selection',
    'editor',
    'daemon',
    'render',
    'caret',
    'sync',
    'cursor',
    'remote',
    'anchor',
    'offset',
    'sel',
    'edit',
  ];

  /**
   * A note past `MAX_LEXED_LENGTH` of blocks drawn from every line shape,
   * link lines (inline, reference, image, autolink, empty label, one after a
   * run of comments and definitions longer than the greedy pairing looks
   * ahead) among them. Every line that has text of its own carries a token
   * `tk<n>z` that occurs
   * once in the note, by which its plain-text line is found; an image line
   * carries one on each side of the leaf that splits its plain-text line.
   */
  function drawNote(seed: number): string {
    const next = random(seed);
    let tokens = 0;
    const tok = () => `tk${(tokens += 1)}z`;
    const w = () => WORDS[Math.floor(next() * WORDS.length)];
    const words = (n: number) => Array.from({ length: n }, w).join(' ');
    const url = () => `https://sync/${w()}/${w()}`;
    const split = () => {
      const word = w();
      return word.length < 5 ? `**${word}**` : `**${word.slice(0, 3)}**${word.slice(3)}`;
    };
    const text: Array<() => string> = [
      () => `${words(6)} ${tok()}`,
      () => `${split()} ${words(3)} ${tok()}`,
      () => `## ${words(3)} ${tok()}`,
      () => `${words(3)} ${tok()}\n---`,
      () => `- ${words(3)} ${tok()}\n${words(3)} ${tok()}`,
      () => `> ${words(4)} ${tok()}`,
      () =>
        `| ${w()} ${tok()} | ${w()} ${tok()} |\n|---|---|\n| ${w()} ${tok()} | ${w()} ${tok()} |`,
      () => `\`\`\`\n${words(3)} ${tok()}\n\`\`\``,
      () => `<!-- ${words(3)} ${tok()} -->`,
      () => `${words(3)} ${tok()}  \n${words(3)} ${tok()}`,
      () => `${words(4)} ${tok()}\r`,
      () => `<div>${words(3)} ${tok()}</div>`,
      () => `${words(2)} <b>${w()} ${tok()}</b> ${words(2)}`,
    ];
    const links: Array<() => string> = [
      () => `${words(2)} [${w()} ${tok()}](${url()}) ${words(2)}`,
      () => {
        const label = `r${tokens}`;
        return `${words(2)} [${w()} ${tok()}][${label}] ${words(2)}\n\n[${label}]: ${url()}`;
      },
      () => `${tok()} ![${w()}](${url()}.png) ${words(2)} ${tok()}`,
      () => `${words(2)} <${url()}> ${tok()}`,
      () => `${words(2)} [](${url()}) ${tok()}`,
      () => {
        const run = Array.from({ length: 9 + Math.floor(next() * 41) }, (_, k) =>
          next() < 0.5 ? `<!-- ${words(2)} -->` : `[n${tokens}k${k}]: ${url()}`,
        ).join('\n');
        return `${run}\n[${w()} ${tok()}](${url()})`;
      },
    ];
    const blocks = [text[0]()];
    let length = blocks[0].length;
    while (length <= 129 * 1024) {
      const pool = next() < 0.3 ? links : text;
      const block = pool[Math.floor(next() * pool.length)]();
      blocks.push(block);
      length += block.length + 2;
    }
    // Past the cap, a run of 300 to 1000 link lines, a comment among every
    // eight: hundreds of sealed lines whose counts differ, more than the
    // pairing search can afford from about 512 on.
    const run = 300 + Math.floor(next() * 701);
    blocks.push(
      Array.from({ length: run }, (_, k) =>
        k % 8 === 7 ? `<!-- ${w()} ${tok()} -->` : `[${w()} ${tok()}](${url()})`,
      ).join('\n'),
      text[0](),
    );
    return blocks.join('\n\n');
  }

  /**
   * Link syntax, a comment (dropped), or a line that opens with a tag — which
   * the renderer shows as written in a markdown note, and the alignment seals
   * past the cap all the same. A `<` after text is shown as written and hides
   * nothing. A line that holds any is not the text of a plain-text line
   * beside it.
   */
  const SYNTAX = /\]\(|\]\[|\]:|<!--|^[ \t]*<[^ \t]/;

  interface Line {
    start: number;
    end: number;
    syntax: boolean;
  }

  /** The lines of `text` without their breaks, as `[start, end)`. */
  function linesOf(text: string, breaks: RegExp, syntax: (line: string) => boolean): Line[] {
    const lines: Line[] = [];
    let start = 0;
    for (const match of text.matchAll(breaks)) {
      lines.push({ start, end: match.index, syntax: syntax(text.slice(start, match.index)) });
      start = match.index + match[0].length;
    }
    lines.push({ start, end: text.length, syntax: syntax(text.slice(start)) });
    return lines;
  }

  /** The line `offset` is strictly inside, or `undefined` at a break or a line's end. */
  function lineStrictlyAround(lines: Line[], offset: number): Line | undefined {
    let low = 0;
    let high = lines.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lines[mid].end < offset) low = mid + 1;
      else if (lines[mid].start > offset) high = mid - 1;
      else return lines[mid].start < offset && offset < lines[mid].end ? lines[mid] : undefined;
    }
    return undefined;
  }

  // Within the budget, and again with the deadline spent — every diff and
  // pairing search declined, the alignment degraded the whole way — since
  // the sealed lines must stay bounded by their own text whatever the budget.
  it.each([1, 2, 3])(
    'never maps a plain-text line into a line of syntax, nor a syntax line out of its own text (seed %i)',
    async (seed) => {
      const markdown = drawNote(seed);
      expect(markdown.length).toBeGreaterThan(128 * 1024);
      const plain = await projectWithEditor(markdown, true);
      expect(plain).toContain('<b>');
      expect(plain).toContain(' <https://sync/');
      expect(plain).toContain('<div>');
      expect(plain).not.toContain('](');
      expect(plain).not.toContain('<!--');
      const violations = [
        ...syntaxViolations(plain, markdown, withoutDeadline).map((v) => `within the budget: ${v}`),
        ...syntaxViolations(plain, markdown, withExpiredDeadline).map(
          (v) => `past the deadline: ${v}`,
        ),
      ];
      expect(violations.length, violations.slice(0, 12).join('\n')).toBe(0);
    },
    180_000,
  );

  /**
   * Every plain-text line that maps into a line of syntax it is not the text
   * of, and every offset of a syntax line that maps out of its own text, in
   * the alignment of `plain` with `markdown` run under `clock`.
   */
  function syntaxViolations(
    plain: string,
    markdown: string,
    clock: <T>(fn: () => T) => T,
  ): string[] {
    const map = clock(() => createBidirectionalOffsetMapper(plain, markdown));
    const markdownLines = linesOf(markdown, /\n/g, (line) => SYNTAX.test(line));
    const tokenLines = new Map<string, Line>();
    for (const [token] of markdown.matchAll(/tk\d+z/g)) {
      const line = lineStrictlyAround(markdownLines, markdown.indexOf(token) + 1);
      if (line) tokenLines.set(token, line);
    }
    // A plain-text line is syntax when it holds the token of a syntax line.
    const plainLines = linesOf(plain, /\n|\uFFFC/g, (line) => {
      const tokens = line.match(/tk\d+z/g) ?? [];
      return tokens.some((token) => tokenLines.get(token)?.syntax);
    });
    const violations: string[] = [];
    const seen = new Set<Line>();
    for (const [token, line] of tokenLines) {
      const at = plain.indexOf(token);
      if (at === -1) continue;
      const plainLine = lineStrictlyAround(plainLines, at + 1);
      if (!plainLine || seen.has(plainLine)) continue;
      seen.add(plainLine);
      if (!line.syntax) {
        for (let offset = plainLine.start + 1; offset < plainLine.end; offset += 1) {
          const target = lineStrictlyAround(markdownLines, map.aToB(offset));
          if (target?.syntax) {
            violations.push(
              `aToB(${offset}) on ${JSON.stringify(plain.slice(plainLine.start, plainLine.end))} → ${JSON.stringify(markdown.slice(target.start, target.end))}`,
            );
          }
        }
      }
    }
    for (const line of new Set(tokenLines.values())) {
      const tokens = markdown.slice(line.start, line.end).match(/tk\d+z/g) ?? [];
      const own = tokens
        .map((token) => plain.indexOf(token))
        .filter((at) => at !== -1)
        .map((at) => lineStrictlyAround(plainLines, at + 1))
        .filter((plainLine): plainLine is Line => plainLine !== undefined);
      if (own.length === 0) continue;
      const [ownStart, ownEnd] = [
        Math.min(...own.map((l) => l.start)),
        Math.max(...own.map((l) => l.end)),
      ];
      for (let offset = line.start + 1; offset < line.end; offset += 1) {
        const mapped = map.bToA(offset);
        const target = lineStrictlyAround(plainLines, mapped);
        if (line.syntax ? mapped < ownStart || mapped > ownEnd : target?.syntax) {
          violations.push(
            `bToA(${offset}) on ${JSON.stringify(markdown.slice(line.start, line.end))} → ${mapped} ${target ? JSON.stringify(plain.slice(target.start, target.end)) : 'at a break'}`,
          );
        }
      }
    }
    return violations;
  }

  it.each([1, 2, 3])(
    'maps every token of the note exactly, in both directions (seed %i)',
    async (seed) => {
      const markdown = drawNote(seed);
      const plain = await projectWithEditor(markdown, true);
      const map = withoutDeadline(() => createBidirectionalOffsetMapper(plain, markdown));
      const failures: string[] = [];
      let checked = 0;
      for (const match of markdown.matchAll(/tk\d+z/g)) {
        const at = plain.indexOf(match[0]);
        if (at === -1) continue;
        checked += 1;
        const [p, m] = [at + 2, match.index + 2];
        if (map.aToB(p) !== m || map.bToA(m) !== p) {
          failures.push(
            `${match[0]} plain ${p}→${map.aToB(p)} (want ${m}), markdown ${m}→${map.bToA(m)} (want ${p})`,
          );
        }
      }
      expect(checked).toBeGreaterThan(2_000);
      expect(failures, failures.slice(0, 12).join('\n')).toEqual([]);
    },
    120_000,
  );
});

describe('alignment of blocks that never anchor', () => {
  /** Every block of `a` is long enough to anchor, yet not four code units of it occur in `b`. */
  const unanchorable = (size: number): [string, string] => {
    const blocks = Math.ceil(size / 14);
    return ['abcdefghijklm\n'.repeat(blocks), 'nopqrstuvwxyz\n'.repeat(blocks)];
  };

  /** `map` never moves backwards, never leaves `to`, and lands on `to`'s end for `from`'s end. */
  function expectMonotonic(
    map: (offset: number) => number,
    fromLength: number,
    toLength: number,
    stride: number,
  ) {
    let previous = 0;
    for (let offset = 0; offset <= fromLength; offset += stride) {
      const mapped = map(offset);
      expect(mapped, `@ ${offset}`).toBeGreaterThanOrEqual(previous);
      expect(mapped, `@ ${offset}`).toBeLessThanOrEqual(toLength);
      previous = mapped;
    }
    expect(map(fromLength)).toBe(toLength);
  }

  it.each([150, 1024])('gives up on a %i KB pair inside the budget', (kilobytes) => {
    const [a, b] = unanchorable(kilobytes * 1024);
    const started = performance.now();
    const { aToB, bToA } = createBidirectionalOffsetMapper(a, b);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(600);
    expectMonotonic(aToB, a.length, b.length, 1009);
    expectMonotonic(bToA, b.length, a.length, 1009);
    expect(aToB(0)).toBe(0);
  });

  it.each([120, 150, 1024])(
    'gives up on a %i KB line of one-letter links inside the budget',
    (kilobytes) => {
      // No four code units of the projection occur in the markdown, and a
      // link per word is the most expensive source a note this size has: the
      // 120 KB one is masked (the lexer's cost counts against the budget),
      // the longer ones are past the cap and not lexed — the lexer alone took
      // over half a second on the 1 MB one. The projection is modelled: the
      // editor's own takes a minute on this many links, and only the word of
      // each survives it.
      const links = Math.ceil((kilobytes * 1024) / 7);
      const markdown = '[x](u) '.repeat(links);
      const plain = 'x '.repeat(links).trimEnd();
      const started = performance.now();
      const { aToB, bToA } = createBidirectionalOffsetMapper(plain, markdown);
      expect(aToB(0)).toBe(0);
      const elapsed = performance.now() - started;
      expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(400);
      expectMonotonic(aToB, plain.length, markdown.length, 1009);
      expectMonotonic(bToA, markdown.length, plain.length, 1009);
    },
    60_000,
  );

  it('still anchors the blocks that do match after a run that does not', () => {
    const [a, b] = unanchorable(20 * 1024);
    const tail = 'A closing paragraph that both sides share verbatim.';
    const { aToB, bToA } = withoutDeadline(() =>
      createBidirectionalOffsetMapper(a + tail, b + tail),
    );
    const inTail = a.length + tail.indexOf('share');
    expect(aToB(inTail)).toBe(b.length + tail.indexOf('share'));
    expect(bToA(b.length + tail.indexOf('share'))).toBe(inTail);
  });
});

describe('alignment over a corpus of small notes', () => {
  /** A markdown piece paired with what the editor projects it to. */
  type Atom = [markdown: string, plain: string];

  /**
   * A small synthetic note built from atoms whose projection is modelled
   * independently of the alignment: headings, split-word and punctuation-only
   * formatting, URLs, fenced code, blank-line runs, soft wraps, unicode,
   * link-shaped text the editor shows (code spans, escapes, unresolved
   * references), text it hides (images, comment anchors, link definitions),
   * inline math, comment anchors written before a block marker, and
   * paragraphs repeated verbatim (formatted first, plain later). The atoms
   * are the oracle: an offset strictly inside an atom shared by both sides
   * must map to the same offset inside the same atom.
   */
  function generateSmallNote(seed: number): Atom[] {
    const rng = mulberry32(seed);
    const pick = () => WORDS[Math.floor(rng() * WORDS.length)];
    const unicode = ['Répétition', 'naïve', '日本語', '😀', 'ñandú'];
    const words = (n: number) => Array.from({ length: n }, pick).join(' ');
    const shared = (text: string): Atom => [text, text];
    const syntax = (md: string): Atom => [md, ''];
    const url = () => `https://${pick()}.example/${pick()}`;
    const definitions: Atom[][] = [];
    const sentences: Array<() => Atom[]> = [
      () => [shared(words(2 + Math.floor(rng() * 5)))],
      () => {
        const [head, tail] = [pick(), pick()];
        return [
          syntax('**'),
          shared(head.slice(0, 3)),
          syntax('**'),
          shared(`${head.slice(3)} ${tail}`),
        ];
      },
      () => [syntax('**'), shared(words(2)), syntax('**'), shared(` ${words(2)}`)],
      () => [
        shared(`${pick()} `),
        syntax('['),
        shared(pick()),
        syntax(`](https://${pick()}/${pick()}/${pick()})`),
        shared(` ${pick()}`),
      ],
      () => [syntax('**'), shared('!!!!'), syntax('**'), shared(' ????????')],
      () => [
        shared(`${unicode[Math.floor(rng() * unicode.length)]} `),
        syntax('*'),
        shared(pick()),
        syntax('*'),
        shared(` ${unicode[Math.floor(rng() * unicode.length)]}`),
      ],
      () => [shared(words(3)), [' \n', '\uFFFC'], shared(words(3))],
      // A link-shaped code span is shown as written.
      () => [
        shared(`${pick()} `),
        syntax('`'),
        shared(`[${pick()}](${pick()})`),
        syntax('`'),
        shared(` ${pick()}`),
      ],
      // An escape shows its character without the backslash.
      () => [
        shared(`${pick()} `),
        syntax('\\'),
        shared(`[${pick()}](${pick()}) `),
        syntax('\\'),
        shared(`*${pick()}`),
        syntax('\\'),
        shared(`* ${pick()}`),
      ],
      // A reference link shows its label; its definition at the end of the
      // note shows nothing.
      () => {
        const label = `ref-${definitions.length + 1}`;
        definitions.push([syntax(`[${label}]: ${url()}`)]);
        return [
          shared(`${pick()} `),
          syntax('['),
          shared(pick()),
          syntax(`][${label}]`),
          shared(` ${pick()}`),
        ];
      },
      // A reference without a definition is text.
      () => [shared(`${pick()} [${pick()}][missing-${pick()}] ${pick()}`)],
      // An image shows nothing, and so does a comment anchor.
      () => [shared(pick()), syntax(`![${pick()}](${url()}.png)`), shared(` ${pick()}`)],
      () => [
        shared(pick()),
        syntax(`<!--agent:${pick()}-${Math.floor(rng() * 1000)}-->`),
        shared(` ${pick()}`),
      ],
      // Inline math is shown as written.
      () => [shared(`${pick()} $${pick()}_${1 + Math.floor(rng() * 9)}$ ${pick()}`)],
      // A bare URL, and a link whose label is its own URL, show the URL once.
      () => [shared(`${pick()} ${url()} ${pick()}`)],
      () => {
        const target = url();
        return [
          shared(`${pick()} `),
          syntax('['),
          shared(target),
          syntax(`](${target})`),
          shared(` ${pick()}`),
        ];
      },
    ];
    const sentence = (): Atom[] => sentences[Math.floor(rng() * sentences.length)]();
    const paragraph = (): Atom[] => [
      ...sentence(),
      ...(rng() < 0.5 ? [shared('. '), ...sentence()] : []),
    ];

    // A comment anchor written before a block marker; the editor renders the
    // block with the anchor moved after the marker.
    const anchorBefore = () =>
      rng() < 0.3 ? `<!--anchor:c${Math.floor(rng() * 1000)}:start-->` : '';

    const blocks: Atom[][] = [];
    const plainParagraphs: string[] = [];
    const count = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < count; i += 1) {
      const roll = rng();
      let block: Atom[];
      if (roll < 0.12)
        block = [
          syntax(anchorBefore() + '#'.repeat(1 + Math.floor(rng() * 3)) + ' '),
          shared(words(3)),
        ];
      else if (roll < 0.17) {
        // Behind the moved anchor, the item's line is an HTML block shown as
        // written, so it holds plain words only.
        block = [syntax(`<!--anchor:c${Math.floor(rng() * 1000)}:start-->- `), shared(words(3))];
        block.push(['\n', '\n'], syntax('- '), ...paragraph());
      } else if (roll < 0.22) {
        const lines = Array.from(
          { length: 1 + Math.floor(rng() * 3) },
          () => `${pick()} = ${pick()};`,
        );
        block = [syntax('```\n'), shared(lines.join('\n')), syntax('\n```')];
      } else if (roll < 0.4) {
        const items = Array.from({ length: 2 + Math.floor(rng() * 3) }, (_, j) => [
          ...(j > 0 ? [[`\n`, '\n'] as Atom] : []),
          syntax('- '),
          ...paragraph(),
        ]);
        block = items.flat();
      } else if (roll < 0.55 && plainParagraphs.length > 0) {
        block = [shared(plainParagraphs[Math.floor(rng() * plainParagraphs.length)])];
      } else block = paragraph();
      const plain = block.map(([, p]) => p).join('');
      // A single-line paragraph's projection is itself valid markdown, as
      // long as the editor showed no `[` or `*` that would now be syntax.
      if (!/[\n\uFFFC[*]/.test(plain) && !/#+ $/.test(block[0][0])) plainParagraphs.push(plain);
      blocks.push(block);
    }

    const atoms: Atom[] = [];
    blocks.forEach((block, index) => {
      if (index > 0) {
        const extra = rng() < 0.2 ? 1 + Math.floor(rng() * 2) : 0;
        // Blank lines between two lists only make one loose list — unless
        // more than one of them precedes a list a comment anchor is written
        // before, which the editor renders as a list of its own.
        const listRun =
          block[0][0].endsWith('- ') &&
          blocks[index - 1][0][0].endsWith('- ') &&
          !(extra > 0 && block[0][0].startsWith('<!--anchor:'));
        atoms.push(['\n\n' + '\n'.repeat(extra), '\n' + (listRun ? '' : '\n'.repeat(extra))]);
      }
      atoms.push(...block);
    });
    for (const definition of definitions) atoms.push(['\n\n', ''], ...definition);
    return atoms;
  }

  /** `[plainOffset, markdownOffset]` for every code point strictly inside a shared atom. */
  function interiorPairs(atoms: Atom[]): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    let plainPos = 0;
    let markdownPos = 0;
    for (const [md, plain] of atoms) {
      if (md === plain && md.length > 1) {
        for (let i = 1; i < md.length; i += 1) {
          const code = md.charCodeAt(i);
          if (code >= 0xdc00 && code <= 0xdfff) continue;
          pairs.push([plainPos + i, markdownPos + i]);
        }
      }
      plainPos += plain.length;
      markdownPos += md.length;
    }
    return pairs;
  }

  const SEEDS = Array.from({ length: 200 }, (_, i) => 1000 + i);

  it('maps every interior offset exactly, in both directions, on 200 generated notes', async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const seed of SEEDS) {
      const atoms = generateSmallNote(seed);
      const markdown = atoms.map(([md]) => md).join('');
      const plain = await projectWithEditor(markdown);
      // The atom model must match production projection or the oracle is void.
      expect(plain, `seed ${seed} projection of ${JSON.stringify(markdown)}`).toBe(
        atoms.map(([, p]) => p).join(''),
      );
      const pairs = interiorPairs(atoms);
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(plain, markdown),
      );
      for (const [p, m] of pairs) {
        checked += 1;
        const forward = aToB(p);
        const backward = bToA(m);
        if (forward !== m || backward !== p) {
          failures.push(
            `seed ${seed} plain ${p}→${forward} (want ${m}), markdown ${m}→${backward} (want ${p}): ` +
              JSON.stringify(plain.slice(Math.max(0, p - 12), p + 12)),
          );
        }
      }
      // Differential guard against the pre-anchoring whole-text diff: the
      // anchored mapper may only disagree with it where legacy itself is
      // off the oracle (an arbitrary tie between equal-cost alignments).
      for (const [p, m] of pairs.filter((_, i) => i % 7 === 0)) {
        const legacy = withoutDeadline(() => mapOffsetThroughDiff(plain, markdown, p));
        if (legacy === m && aToB(p) !== m) {
          failures.push(
            `seed ${seed} plain ${p}: legacy exact (${m}) but anchored gave ${aToB(p)}`,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000);
    expect(failures, failures.slice(0, 20).join('\n')).toEqual([]);
  }, 240_000);

  it('maps every interior offset exactly on the same 200 notes with CRLF line endings', async () => {
    // The editor projects a CRLF note to the plain text of its LF twin, and
    // every interior offset must map as it did there, moved past the `\r`
    // of each line ending before it. An offset just before a line ending may
    // land before or between its two characters — there is no plain text
    // between them to tell the two apart.
    const failures: string[] = [];
    let checked = 0;
    for (const seed of SEEDS) {
      const atoms = generateSmallNote(seed);
      const lf = atoms.map(([md]) => md).join('');
      const markdown = lf.replace(/\n/g, '\r\n');
      const plain = await projectWithEditor(markdown);
      expect(plain, `seed ${seed} projection of ${JSON.stringify(markdown)}`).toBe(
        atoms.map(([, p]) => p).join(''),
      );
      const { aToB, bToA } = withoutDeadline(() =>
        createBidirectionalOffsetMapper(plain, markdown),
      );
      let breaks = 0;
      let scanned = 0;
      for (const [p, m] of interiorPairs(atoms)) {
        for (; scanned < m; scanned += 1) if (lf.charCodeAt(scanned) === 10) breaks += 1;
        const want = m + breaks;
        const beforeBreak = lf.charCodeAt(m) === 10;
        checked += 1;
        const forward = aToB(p);
        const backward = bToA(want);
        if ((forward !== want && !(beforeBreak && forward === want + 1)) || backward !== p) {
          failures.push(
            `seed ${seed} plain ${p}→${forward} (want ${want}), markdown ${want}→${backward} (want ${p}): ` +
              JSON.stringify(plain.slice(Math.max(0, p - 12), p + 12)),
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000);
    expect(failures, failures.slice(0, 20).join('\n')).toEqual([]);
  }, 240_000);

  it('maps every interior offset exactly on a note past the lexing cap', async () => {
    // Two generated notes around enough prose to pass the 128 KB the mask
    // lexes up to: nothing in them is masked.
    const atoms: Atom[] = [...generateSmallNote(1000), ['\n\n', '\n'], ['$x$', '$x$']];
    while (atoms.reduce((n, [md]) => n + md.length, 0) <= 130 * 1024) {
      atoms.push(['\n\n', '\n'], ['unchanged prose lines.', 'unchanged prose lines.']);
    }
    atoms.push(['\n\n', '\n'], ...generateSmallNote(1001));
    const markdown = atoms.map(([md]) => md).join('');
    const plain = await projectWithEditor(markdown);
    expect(plain).toBe(atoms.map(([, p]) => p).join(''));
    const started = performance.now();
    const { aToB, bToA } = createBidirectionalOffsetMapper(plain, markdown);
    expect(aToB(1)).toBe(1);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    const failures: string[] = [];
    for (const [p, m] of interiorPairs(atoms)) {
      if (aToB(p) !== m || bToA(m) !== p) {
        failures.push(`plain ${p}→${aToB(p)} (want ${m}), markdown ${m}→${bToA(m)} (want ${p})`);
      }
    }
    expect(failures, failures.slice(0, 20).join('\n')).toEqual([]);
  }, 120_000);
});

describe('alignment when the diff budget is exhausted', () => {
  afterEach(() => {
    jsdiff.abort = false;
  });

  it('turns a region jsdiff gave up on into one replaced span with clamped offsets', () => {
    jsdiff.abort = true;
    const { aToB, bToA } = createBidirectionalOffsetMapper('abcXYZdef', 'abc12def');
    expect(aToB(2)).toBe(2);
    expect(aToB(4)).toBe(5);
    expect(aToB(6)).toBe(5);
    expect(aToB(9)).toBe(8);
    expect(bToA(4)).toBe(6);
    expect(bToA(8)).toBe(9);
  });

  it('keeps anchored blocks exact and degrades only the region between them', () => {
    const plain = 'Heading line here\nbold term and more words here\nPlain closing paragraph.';
    const markdown =
      '# Heading line here\n\nbold **term** and *more* words here\n\nPlain closing paragraph.';
    const exact = createBidirectionalOffsetMapper(plain, markdown);
    jsdiff.abort = true;
    const degraded = createBidirectionalOffsetMapper(plain, markdown);

    const heading = plain.indexOf('line');
    const closing = plain.indexOf('closing');
    expect(degraded.aToB(heading)).toBe(markdown.indexOf('line'));
    expect(degraded.aToB(closing)).toBe(markdown.indexOf('closing'));
    expect(degraded.bToA(markdown.indexOf('closing'))).toBe(closing);
    expect(exact.aToB(heading)).toBe(markdown.indexOf('line'));
    expect(exact.aToB(closing)).toBe(markdown.indexOf('closing'));

    const words = plain.indexOf('words');
    expect(exact.aToB(words)).toBe(markdown.indexOf('words'));
    expect(degraded.aToB(words)).toBe(markdown.indexOf('\nPlain'));
    expect(degraded.bToA(markdown.indexOf('words'))).toBe(plain.indexOf('\nPlain'));
  });

  it('still aligns the large note quickly', () => {
    jsdiff.abort = true;
    const note = largeNote;
    const started = performance.now();
    const { aToB, bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
    const exact = note.samples.filter(([p, m]) => aToB(p) === m && bToA(m) === p).length;
    expect(exact, `${exact} of ${note.samples.length} samples exact`).toBeGreaterThan(0);
  });

  it('emits the text left once the deadline has passed as one span without probing it', () => {
    // A run that survives whole between two pieces of syntax: refine's
    // shortcut would find it inside `b` and map it exactly. Past the deadline
    // the region is emitted as is instead, so nothing is searched after the
    // budget is spent.
    const run = 'q'.repeat(4096);
    const a = `abc${run}xyz`;
    const b = `abc<${run}>xyz`;
    const exact = createBidirectionalOffsetMapper(a, b);
    expect(exact.aToB(3 + 100)).toBe(4 + 100);
    expect(exact.bToA(4 + 100)).toBe(3 + 100);

    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(0).mockReturnValue(Number.MAX_SAFE_INTEGER);
    try {
      const { aToB, bToA } = createBidirectionalOffsetMapper(a, b);
      expect(aToB(2)).toBe(2);
      expect(aToB(3 + 100)).toBe(b.length - 3);
      expect(aToB(a.length)).toBe(b.length);
      expect(bToA(4 + 100)).toBe(a.length - 3);
      expect(bToA(b.length)).toBe(a.length);
    } finally {
      now.mockRestore();
    }
  });
});

describe('rebaseText', () => {
  it('returns theirs when ours has no edits', () => {
    expect(rebaseText('body', 'AGENT\nbody', 'body')).toBe('AGENT\nbody');
  });

  it('returns ours when theirs has no edits', () => {
    expect(rebaseText('body', 'body', 'body first')).toBe('body first');
  });

  it('keeps an insertion before their change', () => {
    expect(rebaseText('abcdef', 'abcdXYZef', 'aQbcdef')).toBe('aQbcdXYZef');
  });

  it('shifts an insertion after their change', () => {
    expect(rebaseText('abcdef', 'aXYZbcdef', 'abcdeQf')).toBe('aXYZbcdeQf');
  });

  it('places an insertion inside a span theirs replaced at the clamp point', () => {
    expect(rebaseText('abcXYZdef', 'abc123def', 'abcXYQZdef')).toBe('abc123Qdef');
    expect(rebaseText('abcXYZdef', 'abcdef', 'abcXYQZdef')).toBe('abcQdef');
  });

  it('applies a deletion spanning their insertion while keeping their text', () => {
    expect(rebaseText('abcdefgh', 'abcdXYZefgh', 'abgh')).toBe('abXYZgh');
  });

  it('treats deleting characters theirs already removed as a no-op', () => {
    expect(rebaseText('abcXYZdef', 'abcdef', 'abcdef')).toBe('abcdef');
    expect(rebaseText('abcXYZdef', 'abc123def', 'abcdef')).toBe('abc123def');
  });

  it('keeps their prepended text when ours deletes from the start', () => {
    expect(rebaseText('body', 'AGENT\nbody', '')).toBe('AGENT\n');
    expect(rebaseText('body first', 'AGENT\nbody first', 'first')).toBe('AGENT\nfirst');
  });

  it('handles emoji edits on both sides', () => {
    expect(rebaseText('a😀b', 'a😀😀b', 'ab')).toBe('a😀b');
    expect(rebaseText('ab', 'a🎉b', 'a😀b')).toBe('a😀🎉b');
    expect(rebaseText('a😀b', 'a😀bc', 'a😀😀b')).toBe('a😀😀bc');
  });

  it('verifier scenario: typing after the sent text lands after the merged echo', () => {
    expect(rebaseText('body first', 'AGENT\nbody first', 'body first plus typing')).toBe(
      'AGENT\nbody first plus typing',
    );
  });

  it('verifier scenario: undoing the sent text removes it from the merged echo', () => {
    expect(rebaseText('body first', 'AGENT\nbody first', 'body')).toBe('AGENT\nbody');
  });

  it('does not re-apply a deletion theirs already made when a repeated line could anchor elsewhere', () => {
    // Anchoring the second "Repeated heading" onto the first would read the
    // deletion as a deleted first line, then delete again from the echo.
    const base = 'Repeated heading\nRepeated heading';
    const theirs = base.slice(2);
    expect(rebaseText(base, theirs, theirs)).toBe(theirs);
  });

  describe('near-identical triples', () => {
    const rng = mulberry32(7);
    const bases = [
      'alpha beta gamma\ndelta epsilon zeta\nfinal paragraph.',
      'Repeated heading\n- same list item\n- same list item\nRepeated heading\n- same list item\nend.',
      'a😀b\nThis is a long paragraph with text.\n',
      Array(6).fill('Repeated heading').join('\n'),
    ];
    const codePointBoundary = (text: string, offset: number) =>
      !(
        /[\uD800-\uDBFF]/.test(text[offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[offset] ?? '')
      );
    const boundaries = (text: string) =>
      Array.from({ length: text.length + 1 }, (_, i) => i).filter((i) =>
        codePointBoundary(text, i),
      );
    const deleteAt = (text: string, offset: number, length: number) => {
      let end = Math.min(offset + length, text.length);
      if (!codePointBoundary(text, end)) end += 1;
      return text.slice(0, offset) + text.slice(end);
    };

    it('the same deletion on both sides is applied once', () => {
      let checked = 0;
      for (const base of bases) {
        for (const offset of boundaries(base)) {
          for (const length of [1, 2, 5, 17]) {
            const theirs = deleteAt(base, offset, length);
            if (theirs === base) continue;
            expect(rebaseText(base, theirs, theirs), JSON.stringify({ base, theirs })).toBe(theirs);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(300);
    });

    it('an insertion of ours survives exactly once on top of their deletion', () => {
      let checked = 0;
      for (const base of bases) {
        const points = boundaries(base);
        for (let i = 0; i < 80; i += 1) {
          const theirsAt = points[Math.floor(rng() * points.length)];
          const theirs = deleteAt(base, theirsAt, 1 + Math.floor(rng() * 6));
          const oursAt = points[Math.floor(rng() * points.length)];
          const ours = base.slice(0, oursAt) + 'Ω' + base.slice(oursAt);
          const merged = rebaseText(base, theirs, ours);
          const label = JSON.stringify({ base, theirs, ours, merged });
          expect(merged.split('Ω').length, label).toBe(2);
          expect(merged.replace('Ω', ''), label).toBe(theirs);
          checked += 1;
        }
      }
      expect(checked).toBe(bases.length * 80);
    });
  });
});
