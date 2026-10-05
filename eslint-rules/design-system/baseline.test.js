// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  baselineCounts,
  baselineFiles,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from '../lib/baseline-ratchet.js';
import { designSystemRules } from './index.js';

const root = process.cwd();
const ruleNames = Object.keys(designSystemRules).sort();
// `eslint-rules/baselines/<rule>/<source>.json`, one entry file per exempted source file.
const baseline = loadBaseline({ cwd: root, rules: ruleNames });

describe('design-system ESLint baseline', () => {
  it('contains only owned, reasoned exceptions', () => {
    for (const exceptions of Object.values(baseline)) {
      expect(exceptions.length).toBeGreaterThan(0);
      for (const exception of exceptions) {
        expect(typeof exception.owner).toBe('string');
        expect(typeof exception.reason).toBe('string');
      }
    }
  });

  it('does not add entries relative to the CI base revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, rules: ruleNames });
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
