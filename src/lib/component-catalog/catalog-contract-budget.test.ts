import { describe, expect, it } from 'vitest';
import {
  catalogContractBudgetMs,
  MS_PER_SNAPSHOT_LINE,
  snapshotLineCounts,
  snapshotLinesFor,
  UNSNAPSHOTTED_BUDGET_MS,
} from './catalog-contract-budget';

function entry(key: string, bodyLines: number, counter = 1): string {
  const body = Array.from({ length: bodyLines }, (_, index) => `line ${index}`).join('\n');
  return `exports[\`contracts > '${key}' ${counter}\`] = \`${body}\`;\n`;
}

const snapshot = [
  '// Snapshot v1\n',
  entry('primitive:button:states', 3),
  entry('pattern:settings:schema-controls', 2000),
  entry('product:popovers:non-modal-overlay-ma…', 400),
].join('\n');

describe('snapshotLineCounts', () => {
  it('counts the body lines of every entry by its rendered key', () => {
    expect(Object.fromEntries(snapshotLineCounts(snapshot))).toEqual({
      'primitive:button:states': 3,
      'pattern:settings:schema-controls': 2000,
      'product:popovers:non-modal-overlay-ma…': 400,
    });
  });

  it('does not end an entry at an escaped backtick', () => {
    const source = "exports[`contracts > 'a:b:c' 1`] = `one \\`;\ntwo`;\n";
    expect(snapshotLineCounts(source).get('a:b:c')).toBe(2);
  });

  it('is empty for a missing snapshot', () => {
    expect(snapshotLineCounts('').size).toBe(0);
  });
});

describe('snapshotLinesFor', () => {
  const counts = snapshotLineCounts(snapshot);

  it('matches a full key exactly', () => {
    expect(snapshotLinesFor(counts, 'pattern:settings:schema-controls')).toBe(2000);
    expect(snapshotLinesFor(counts, 'pattern:settings:schema')).toBeUndefined();
  });

  it('matches a key vitest truncated in the title by its prefix', () => {
    expect(snapshotLinesFor(counts, 'product:popovers:non-modal-overlay-matrix')).toBe(400);
  });

  it('takes the largest of several truncated titles sharing a prefix', () => {
    const shared = snapshotLineCounts(
      entry('product:fields:state-matrix-lo…', 10) + entry('product:fields:state-matr…', 900),
    );
    expect(snapshotLinesFor(shared, 'product:fields:state-matrix-long')).toBe(900);
  });

  it('is undefined for an entry with no snapshot yet', () => {
    expect(snapshotLinesFor(counts, 'pattern:new:fixture')).toBeUndefined();
  });
});

describe('catalogContractBudgetMs', () => {
  it('keeps light entries on the default budget', () => {
    expect(catalogContractBudgetMs(3, 30_000)).toBe(30_000);
    expect(catalogContractBudgetMs(3, 60_000)).toBe(60_000);
  });

  it('scales heavy entries with their snapshot size', () => {
    expect(catalogContractBudgetMs(2000, 30_000)).toBe(2000 * MS_PER_SNAPSHOT_LINE);
    expect(catalogContractBudgetMs(4000, 30_000)).toBeGreaterThan(
      catalogContractBudgetMs(2000, 30_000),
    );
  });

  it('gives an unsnapshotted entry the generous fallback', () => {
    expect(catalogContractBudgetMs(undefined, 30_000)).toBe(UNSNAPSHOTTED_BUDGET_MS);
    expect(catalogContractBudgetMs(undefined, 600_000)).toBe(600_000);
  });
});
