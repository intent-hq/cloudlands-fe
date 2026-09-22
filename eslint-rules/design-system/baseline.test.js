// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  baselineCounts,
  baselineFiles,
  lintRuleFromRepoConfig,
  readComparisonBaseline,
} from '../lib/baseline-ratchet.js';
import { designSystemRules } from './index.js';

const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'eslint-rules/design-system/baseline.json')),
);
const ruleNames = Object.keys(designSystemRules).sort();

describe('design-system ESLint baseline', () => {
  it('contains only owned, reasoned exceptions with sorted unique files', () => {
    expect(Object.keys(baseline).every((rule) => ruleNames.includes(rule))).toBe(true);
    for (const exceptions of Object.values(baseline)) {
      expect(exceptions.length).toBeGreaterThan(0);
      for (const exception of exceptions) {
        expect(exception.owner.trim()).not.toBe('');
        expect(exception.reason.trim()).not.toBe('');
        if (exception.files) {
          expect(exception.files).toEqual([...new Set(exception.files)].sort());
        } else {
          const countEntries = Object.entries(exception.counts);
          expect(countEntries.map(([file]) => file)).toEqual(
            countEntries.map(([file]) => file).sort(),
          );
          expect(countEntries.every(([, count]) => Number.isInteger(count) && count > 0)).toBe(
            true,
          );
        }
      }
      const files = baselineFiles(exceptions);
      expect(files).toEqual([...new Set(files)]);
    }
  });

  it('does not add entries relative to the CI base revision', () => {
    const comparison = readComparisonBaseline({ cwd: root });
    if (!comparison) return;
    // An unreadable base rule set treats every rule as pre-existing (zero-debt).
    const baseRules = comparison.rules ?? ruleNames;
    const newRules = ruleNames.filter((rule) => !baseRules.includes(rule));
    expect(() =>
      assertBaselineOnlyShrinks(comparison.baseline, baseline, { newRules }),
    ).not.toThrow();
  });

  // Lints every file the real `eslint.config.js` applies these rules to (same entries,
  // same language options incl. the type-aware main-process parser, same global
  // ignores), so this ratchet and `pnpm lint` cannot disagree on scope. It takes ~3 min
  // alone on the shared host and exceeded 240 s while competing with the other shard
  // workers; keep the budget local to the ratchet, since a global timeout increase would
  // hide unrelated hung tests.
  it('only shrinks: current violations never exceed the checked-in baseline', async () => {
    const counts = await lintRuleFromRepoConfig({
      cwd: root,
      ruleIds: ruleNames.map((rule) => `intent/${rule}`),
    });

    const additions = {};
    for (const rule of ruleNames) {
      const current = Object.entries(counts[`intent/${rule}`]);
      const allowedCounts = baselineCounts(baseline[rule]);
      if (allowedCounts) {
        const increased = current
          .filter(([file, count]) => count > (allowedCounts[file] ?? 0))
          .map(([file, count]) => ({ file, allowed: allowedCounts[file] ?? 0, current: count }));
        if (increased.length) additions[rule] = increased;
        continue;
      }
      const allowed = new Set(baselineFiles(baseline[rule]));
      const added = current
        .map(([file]) => file)
        .filter((file) => !allowed.has(file))
        .sort();
      if (added.length) additions[rule] = added;
    }
    expect(additions).toEqual({});
  }, 480_000);
});
