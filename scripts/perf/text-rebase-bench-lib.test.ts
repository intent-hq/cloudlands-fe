// @vitest-environment node
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  aggregate,
  formatHeader,
  formatMs,
  formatTable,
  median,
  parseArgs,
  percentile,
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
const document = (tree: 'head' | 'base', rows: Row[]) => ({ tree, sha: `${tree}sha`, rows });

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

  it('the header names both trees, the run shape and the caveat', () => {
    const header = formatHeader({
      head: 'working tree (abc)',
      base: 'origin/main (def)',
      runs: 5,
      repeats: 5,
      node: 'v24.0.0',
    });
    expect(header).toContain('head working tree (abc) vs base origin/main (def)');
    expect(header).toContain('5 paired cold process(es) per tree');
    expect(header).toContain('shapes: all; node v24.0.0');
    expect(header).toContain('resolve from the current node_modules for BOTH trees');
  });
});
