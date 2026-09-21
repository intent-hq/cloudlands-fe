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
    const { aToB, bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    // Generous CI bound; the alignment itself takes tens of milliseconds.
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(aToB(4)).toBe(note.markdown.indexOf(note.plain.slice(0, 8)) + 4);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
  });

  it('maps every shared character exactly, in both directions', () => {
    const note = largeNote;
    const { aToB, bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
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
    const { aToB, bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
    const elapsed = performance.now() - started;
    expect(elapsed, `alignment took ${elapsed.toFixed(0)} ms`).toBeLessThan(300);
    expect(bToA(note.markdown.length)).toBe(note.plain.length);
    expect(aToB(1)).toBe(note.markdown.indexOf('aaaaaa') + 1);
  });

  it.each([0, 1, 1000, LINES >> 1, LINES - 2, LINES - 1])(
    'maps the verbatim runs of line %i exactly, in both directions',
    (line) => {
      const { aToB, bToA } = createBidirectionalOffsetMapper(note.plain, note.markdown);
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
    const { aToB, bToA } = createBidirectionalOffsetMapper(a + tail, b + tail);
    const inTail = a.length + tail.indexOf('share');
    expect(aToB(inTail)).toBe(b.length + tail.indexOf('share'));
    expect(bToA(b.length + tail.indexOf('share'))).toBe(inTail);
  });
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
