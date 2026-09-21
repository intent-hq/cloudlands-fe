import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
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
 * `docTextOffsets`.
 */
async function projectWithEditor(markdown: string): Promise<string> {
  const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit],
    content: html,
  });
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
   * formatting, URLs, fenced code, blank-line runs, soft wraps, unicode, and
   * paragraphs repeated verbatim (formatted first, plain later). The atoms are
   * the oracle: an offset strictly inside an atom shared by both sides must map
   * to the same offset inside the same atom.
   */
  function generateSmallNote(seed: number): Atom[] {
    const rng = mulberry32(seed);
    const pick = () => WORDS[Math.floor(rng() * WORDS.length)];
    const unicode = ['Répétition', 'naïve', '日本語', '😀', 'ñandú'];
    const words = (n: number) => Array.from({ length: n }, pick).join(' ');
    const shared = (text: string): Atom => [text, text];
    const syntax = (md: string): Atom => [md, ''];
    const sentence = (): Atom[] => {
      const roll = rng();
      if (roll < 0.25) return [shared(words(2 + Math.floor(rng() * 5)))];
      if (roll < 0.4) {
        const [head, tail] = [pick(), pick()];
        return [
          syntax('**'),
          shared(head.slice(0, 3)),
          syntax('**'),
          shared(`${head.slice(3)} ${tail}`),
        ];
      }
      if (roll < 0.55)
        return [syntax('**'), shared(words(2)), syntax('**'), shared(` ${words(2)}`)];
      if (roll < 0.65) {
        return [
          shared(`${pick()} `),
          syntax('['),
          shared(pick()),
          syntax(`](https://${pick()}/${pick()}/${pick()})`),
          shared(` ${pick()}`),
        ];
      }
      if (roll < 0.75) return [syntax('**'), shared('!!!!'), syntax('**'), shared(' ????????')];
      if (roll < 0.85) {
        return [
          shared(`${unicode[Math.floor(rng() * unicode.length)]} `),
          syntax('*'),
          shared(pick()),
          syntax('*'),
          shared(` ${unicode[Math.floor(rng() * unicode.length)]}`),
        ];
      }
      return [shared(words(3)), [' \n', '\uFFFC'], shared(words(3))];
    };
    const paragraph = (): Atom[] => [
      ...sentence(),
      ...(rng() < 0.5 ? [shared('. '), ...sentence()] : []),
    ];

    const blocks: Atom[][] = [];
    const plainParagraphs: string[] = [];
    const count = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < count; i += 1) {
      const roll = rng();
      let block: Atom[];
      if (roll < 0.12)
        block = [syntax('#'.repeat(1 + Math.floor(rng() * 3)) + ' '), shared(words(3))];
      else if (roll < 0.22) {
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
      // A single-line paragraph's projection is itself valid markdown.
      if (!/[\n\uFFFC]/.test(plain) && !block[0][0].startsWith('#')) plainParagraphs.push(plain);
      blocks.push(block);
    }

    const atoms: Atom[] = [];
    blocks.forEach((block, index) => {
      if (index > 0) {
        const extra = rng() < 0.2 ? 1 + Math.floor(rng() * 2) : 0;
        // Blank lines between two lists only make one loose list.
        const listRun = block[0][0] === '- ' && blocks[index - 1][0][0] === '- ';
        atoms.push(['\n\n' + '\n'.repeat(extra), '\n' + (listRun ? '' : '\n'.repeat(extra))]);
      }
      atoms.push(...block);
    });
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
