import { describe, expect, it } from 'vitest';
import {
  catalogContractBudgetMs,
  MIN_RENDER_WAIT_MS,
  MS_PER_SNAPSHOT_LINE,
  renderWaitMs,
  snapshotLineCounts,
  snapshotLinesFor,
  UNSNAPSHOTTED_BUDGET_MS,
} from './catalog-contract-budget';

const DESCRIBE = 'contracts';

function entry(key: string, bodyLines: number, counter = 1, describe = DESCRIBE): string {
  const body = Array.from({ length: bodyLines }, (_, index) => `line ${index}`).join('\n');
  return `exports[\`${describe} > '${key}' ${counter}\`] = \`${body}\`;\n`;
}

const snapshot = [
  '// Snapshot v1\n',
  entry('primitive:button:states', 3),
  entry('pattern:settings:schema-controls', 2000),
  entry('product:popovers:non-modal-overlay-ma…', 400),
].join('\n');

describe('snapshotLineCounts', () => {
  it('counts the body lines of every entry by its rendered key', () => {
    expect(Object.fromEntries(snapshotLineCounts(snapshot, DESCRIBE))).toEqual({
      'primitive:button:states': 3,
      'pattern:settings:schema-controls': 2000,
      'product:popovers:non-modal-overlay-ma…': 400,
    });
  });

  it('does not end an entry at an escaped backtick', () => {
    const source = "exports[`contracts > 'a:b:c' 1`] = `one \\`;\ntwo`;\n";
    expect(snapshotLineCounts(source, DESCRIBE).get('a:b:c')).toBe(2);
  });

  it('ends an entry whose body ends in an escaped backslash', () => {
    const source =
      "exports[`contracts > 'a:b:c' 1`] = `one\\\\`;\n" +
      "exports[`contracts > 'd:e:f' 1`] = `two\nthree`;\n";
    expect(Object.fromEntries(snapshotLineCounts(source, DESCRIBE))).toEqual({
      'a:b:c': 1,
      'd:e:f': 2,
    });
  });

  it('ignores snapshots from other describes', () => {
    const source = entry('a:b:c', 2) + entry('a:b:c', 50, 1, 'other');
    expect(Object.fromEntries(snapshotLineCounts(source, DESCRIBE))).toEqual({ 'a:b:c': 2 });
  });

  it('is empty for a missing snapshot', () => {
    expect(snapshotLineCounts('', DESCRIBE).size).toBe(0);
  });
});

describe('snapshotLinesFor', () => {
  const counts = snapshotLineCounts(snapshot, DESCRIBE);

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
      DESCRIBE,
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
    expect(catalogContractBudgetMs(undefined, 30_000)).toBeGreaterThan(
      catalogContractBudgetMs(1000, 30_000),
    );
  });

  it('scales derived budgets with a larger default, as on CI', () => {
    expect(catalogContractBudgetMs(2000, 60_000)).toBe(2 * catalogContractBudgetMs(2000, 30_000));
    expect(catalogContractBudgetMs(undefined, 60_000)).toBe(2 * UNSNAPSHOTTED_BUDGET_MS);
  });
});

describe('renderWaitMs', () => {
  it('stops waiting for the render marker before the test budget runs out', () => {
    expect(renderWaitMs(30_000)).toBeLessThan(30_000);
    expect(renderWaitMs(174_000)).toBeLessThan(174_000);
  });

  it('never waits less than the minimum', () => {
    expect(renderWaitMs(20_000)).toBe(MIN_RENDER_WAIT_MS);
  });
});
