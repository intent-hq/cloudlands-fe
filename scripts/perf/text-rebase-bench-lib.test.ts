// @vitest-environment node
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  aggregate,
  formatHeader,
  formatMs,
  formatTable,
  mapperModeOf,
  mapperModeWarning,
  median,
  parseArgs,
  percentile,
  runOrder,
} from './text-rebase-bench-lib.mjs';

type Row = { shape: string; clock: string; phase: string; ms: number; deadlineHit: boolean | null };
const row = (
  shape: string,
  clock: string,
  phase: string,
  ms: number,
  deadlineHit: boolean | null = false,
): Row => ({
  shape,
  clock,
  phase,
  ms,
  deadlineHit,
});
const document = (tree: 'head' | 'base', rows: Row[], mapperMode = 'bidirectional') => ({
  tree,
  sha: `${tree}sha`,
  mapperMode,
  rows,
});

describe('parseArgs', () => {
  it('requires --base and applies the defaults', () => {
    expect(parseArgs(['--base', 'origin/main'])).toEqual({
      base: 'origin/main',
      runs: 5,
      repeats: 5,
    });
    expect(() => parseArgs([])).toThrow('--base is required.');
  });

  it('parses every option', () => {
    expect(
      parseArgs([
        '--base',
        'a',
        '--head',
        'b',
        '--runs',
        '2',
        '--repeats',
        '3',
        '--shapes',
        'mixed, 1mib',
        '--json',
        'out.json',
      ]),
    ).toEqual({
      base: 'a',
      head: 'b',
      runs: 2,
      repeats: 3,
      shapes: ['mixed', '1mib'],
      json: 'out.json',
    });
  });

  it('rejects malformed input', () => {
    expect(() => parseArgs(['--base'])).toThrow('--base requires a value.');
    expect(() => parseArgs(['--base', 'a', '--runs', '0'])).toThrow(
      '--runs must be an integer of at least 1.',
    );
    expect(() => parseArgs(['--base', 'a', '--repeats', '1.5'])).toThrow(
      '--repeats must be an integer',
    );
    expect(() => parseArgs(['--base', 'a', '--shapes', ' , '])).toThrow(
      '--shapes needs at least one shape name.',
    );
    expect(() => parseArgs(['--base', 'a', '--base', 'b'])).toThrow(
      '--base may only be specified once.',
    );
    expect(() => parseArgs(['--base', 'a', '--bogus'])).toThrow('Unknown option: --bogus');
  });

  it('rejects an explicitly empty ref instead of falling back to the working tree', () => {
    expect(() => parseArgs(['--base', 'HEAD', '--head', ''])).toThrow(
      '--head requires a non-empty ref.',
    );
    expect(() => parseArgs(['--base', 'HEAD', '--head', '  '])).toThrow(
      '--head requires a non-empty ref.',
    );
    expect(() => parseArgs(['--base', ''])).toThrow('--base requires a non-empty ref.');
  });

  it('leaves head unset when --head is omitted', () => {
    expect(parseArgs(['--base', 'HEAD'])).not.toHaveProperty('head');
  });
});

describe('median / percentile', () => {
  it('takes the middle sample, averaging an even count', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('p90 is the nearest-rank sample', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([3, 1, 2], 0.9)).toBe(3);
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('aggregate', () => {
  const head = [
    document('head', [
      row('mixed', 'natural', 'cold', 10),
      row('mixed', 'natural', 'cached', 2, true),
      row('1mib', 'unbounded', 'cold', 100, null),
    ]),
    document('head', [
      row('mixed', 'natural', 'cold', 30),
      row('mixed', 'natural', 'cached', 1),
      row('1mib', 'unbounded', 'cold', 120, null),
    ]),
    document('head', [
      row('mixed', 'natural', 'cold', 20),
      row('mixed', 'natural', 'cached', 3),
      row('1mib', 'unbounded', 'cold', 110, null),
    ]),
  ];
  const base = [
    document('base', [
      row('mixed', 'natural', 'cold', 40),
      row('mixed', 'natural', 'cached', 1),
      row('1mib', 'unbounded', 'cold', 50, null),
    ]),
    document('base', [
      row('mixed', 'natural', 'cold', 20),
      row('mixed', 'natural', 'cached', 2),
      row('1mib', 'unbounded', 'cold', 60, null),
    ]),
    document('base', [
      row('mixed', 'natural', 'cold', 60),
      row('mixed', 'natural', 'cached', 4),
      row('1mib', 'unbounded', 'cold', 55, null),
    ]),
  ];

  it('folds paired runs per shape x clock x phase in head order', () => {
    const summary = aggregate(head, base);
    expect(
      summary.map((entry: { shape: string; clock: string; phase: string }) => [
        entry.shape,
        entry.clock,
        entry.phase,
      ]),
    ).toEqual([
      ['mixed', 'natural', 'cold'],
      ['mixed', 'natural', 'cached'],
      ['1mib', 'unbounded', 'cold'],
    ]);
    const cold = summary[0];
    expect(cold.head).toEqual({ n: 3, median: 20, p90: 30, deadlineHits: 0 });
    expect(cold.base).toEqual({ n: 3, median: 40, p90: 60, deadlineHits: 0 });
    expect(cold.ratio).toBeCloseTo(0.5);
    expect(cold.pairs).toBe(3);
    expect(cold.headSlowerPairs).toBe(1);
    expect(summary[1].head.deadlineHits).toBe(1);
    expect(summary[2].head.deadlineHits).toBeNull();
    expect(summary[2].ratio).toBeCloseTo(2);
    expect(summary[2].headSlowerPairs).toBe(3);
  });

  it('refuses unpaired input', () => {
    expect(() => aggregate(head, base.slice(1))).toThrow('paired aggregation needs equal counts');
    const missing = [document('base', [row('mixed', 'natural', 'cold', 1)])];
    expect(() => aggregate(head.slice(0, 1), missing)).toThrow(
      'mixed/natural/cached: 1 head rows vs 0 base rows',
    );
  });
});

describe('formatting', () => {
  it('scales units', () => {
    expect(formatMs(0.4567)).toBe('0.46 ms');
    expect(formatMs(12.34)).toBe('12.3 ms');
    expect(formatMs(345.6)).toBe('346 ms');
    expect(formatMs(12_345)).toBe('12.35 s');
  });

  it('renders an aligned table with ratio, slower pairs and deadline hits', () => {
    const summary = aggregate(
      [
        document('head', [
          row('mixed', 'natural', 'cold', 120, true),
          row('mixed', 'unbounded', 'cold', 5, null),
        ]),
      ],
      [
        document('base', [
          row('mixed', 'natural', 'cold', 24_000),
          row('mixed', 'unbounded', 'cold', 10, null),
        ]),
      ],
    );
    const lines = formatTable(summary).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(
      /^shape {2}clock {6}phase {2}head med {2}head p90 {2}base med {2}base p90 {2}head\/base {2}head slower {2}deadline h\|b$/,
    );
    expect(lines[1]).toMatch(/^-+( {2}-+)+$/);
    expect(lines[2]).toBe(
      'mixed  natural    cold     120 ms    120 ms   24.00 s   24.00 s    0.0050x          0/1       1/1|0/1',
    );
    expect(lines[3]).toBe(
      'mixed  unbounded  cold    5.00 ms   5.00 ms   10.0 ms   10.0 ms      0.50x          0/1           -|-',
    );
    expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  });

  it('the header names both trees with their mapper modes, the run shape and the caveat', () => {
    const header = formatHeader({
      head: 'working tree (abc)',
      headMode: 'bidirectional',
      base: 'origin/main (def)',
      baseMode: 'bidirectional',
      runs: 5,
      repeats: 5,
      node: 'v24.0.0',
    });
    expect(header).toContain(
      'head working tree (abc) [bidirectional] vs base origin/main (def) [bidirectional]',
    );
    expect(header).toContain('5 paired cold process(es) per tree');
    expect(header).toContain('head/base order alternating per run');
    expect(header).toContain('shapes: all; node v24.0.0');
    expect(header).toContain('resolve from the current node_modules for BOTH trees');
    expect(header).not.toContain('WARNING');
  });

  it('the header warns once when the mapper modes differ, naming the two-alignment tree', () => {
    const header = formatHeader({
      head: 'working tree (abc)',
      headMode: 'bidirectional',
      base: '914c00f3f (914c00f3f123)',
      baseMode: 'legacy-two-mapper',
      runs: 1,
      repeats: 5,
      shapes: 'mixed',
      node: 'v24.0.0',
    });
    expect(header).toContain(
      'head working tree (abc) [bidirectional] vs base 914c00f3f (914c00f3f123) [legacy-two-mapper]',
    );
    const warnings = header.split('\n').filter((line: string) => line.startsWith('WARNING'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('base measures two one-way alignments');
    expect(warnings[0]).toContain('not comparable like-for-like');
  });
});

describe('runOrder', () => {
  it('alternates head-first and base-first from run 1 so both trees lead equally often', () => {
    const orders = [1, 2, 3, 4, 5, 6].map((run) => runOrder(run));
    expect(orders[0]).toEqual(['head', 'base']);
    expect(orders[1]).toEqual(['base', 'head']);
    expect(orders[2]).toEqual(['head', 'base']);
    expect(orders[3]).toEqual(['base', 'head']);
    expect(orders.filter((order) => order[0] === 'head')).toHaveLength(3);
    expect(orders.filter((order) => order[0] === 'base')).toHaveLength(3);
    for (const order of orders) expect([...order].sort()).toEqual(['base', 'head']);
  });

  it('rejects non-positive and fractional run numbers', () => {
    expect(() => runOrder(0)).toThrow('run must be a positive integer, got 0');
    expect(() => runOrder(1.5)).toThrow('run must be a positive integer, got 1.5');
  });
});

describe('mapperModeWarning', () => {
  it('is silent for equal modes and names whichever side is legacy', () => {
    expect(
      mapperModeWarning({ headMode: 'legacy-two-mapper', baseMode: 'legacy-two-mapper' }),
    ).toBeNull();
    expect(
      mapperModeWarning({ headMode: 'legacy-two-mapper', baseMode: 'bidirectional' }),
    ).toContain('head measures two one-way alignments');
  });
});

describe('mapperModeOf', () => {
  it('returns the one mode the documents agree on', () => {
    expect(
      mapperModeOf('base', [
        document('base', [], 'legacy-two-mapper'),
        document('base', [], 'legacy-two-mapper'),
      ]),
    ).toBe('legacy-two-mapper');
  });

  it('rejects disagreeing, missing and absent documents', () => {
    expect(() =>
      mapperModeOf('head', [document('head', []), document('head', [], 'legacy-two-mapper')]),
    ).toThrow('head documents report inconsistent mapperMode: bidirectional, legacy-two-mapper');
    expect(() => mapperModeOf('head', [{ tree: 'head', sha: 'x', rows: [] }])).toThrow(
      'head documents report no mapperMode',
    );
    expect(() =>
      mapperModeOf('head', [document('head', []), { tree: 'head', sha: 'x', rows: [] }]),
    ).toThrow('head documents report inconsistent mapperMode: bidirectional');
    expect(() => mapperModeOf('base', [])).toThrow('base documents report no mapperMode');
  });
});
