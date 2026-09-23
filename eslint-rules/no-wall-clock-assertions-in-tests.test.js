// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  baselineCounts,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-wall-clock-assertions-in-tests.js';

const root = process.cwd();
const ruleName = 'no-wall-clock-assertions-in-tests';
// `eslint-rules/baselines/no-wall-clock-assertions-in-tests/<test file>.json`, each
// holding `{ "count": N }`; delete the file once its assertions are rewritten.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const testFile = path.resolve('src/features/example/__tests__/example.test.ts');
const otherTestFile = path.resolve('src/features/other/__tests__/other.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = { messageId: 'wallClockBudget' };

describe('no-wall-clock-assertions-in-tests guidance', () => {
  it('explains the CI-load failure, names the alternatives, and points at test:loaded', () => {
    const message = rule.meta.messages.wallClockBudget;
    expect(message).toMatch(/shared runners starve a fork ~4×/);
    expect(message).toContain('intent-hq/cloudlands-fe#2740');
    expect(message).toMatch(/operation-unit growth bound/);
    expect(message).toContain('src/lib/notes/text-rebase.test.ts');
    expect(message).toContain('intent-hq/cloudlands-fe#2828');
    expect(message).toContain('vi.useFakeTimers()');
    expect(message).toContain('pnpm test:loaded <file>');
    expect(message).toMatch(/AGENTS\.md 'test that budgets wall time' paragraph/);
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-wall-clock-assertions-in-tests baseline ratchet', () => {
  it('maps existing package-relative test files to counted entries only', () => {
    for (const exception of baselineTree[ruleName] ?? []) {
      expect(exception.files, 'every entry must carry a count').toBeUndefined();
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be package-relative with forward slashes`).toMatch(
        /^[^/\\][^\\]*\.(test|spec)\.(js|ts)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  it('never grows a count against the comparison revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, rules: [ruleName] });
    // A revision whose eslint.config.js does not enable the rule enforced nothing, so
    // the initial baseline may be established against it; afterwards counts only shrink.
    const comparisonConfig = execFileSync('git', ['show', `${comparison.ref}:eslint.config.js`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const newRules = comparisonConfig.includes(`'${ruleId}'`) ? [] : [ruleName];
    expect(
      findBaselineGrowth(comparison.baseline, baselineTree, { newRules }),
      `per-file counts may only shrink relative to ${comparison.ref}`,
    ).toEqual({});
  });

  // Lints every test file the real `eslint.config.js` lints (same rule entry, same
  // global ignores), so this ratchet and `pnpm lint` cannot disagree on scope. It takes
  // over a minute on the shared host; keep the budget local to the ratchet.
  it('matches today’s offenders exactly: no stale count, no new violation', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the assertions were rewritten').toEqual(
      {},
    );
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new wall-clock duration assertions; fix them instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-wall-clock-assertions-in-tests', rule, {
  valid: [
    // Operation-unit growth bounds: neither operand reads the clock.
    {
      code: 'const growth = reads - baselineReads;\nexpect(growth).toBeLessThan(50);',
      filename: testFile,
    },
    { code: 'expect(afterOps - beforeOps).toBeLessThanOrEqual(BUDGET_OPS);', filename: testFile },
    // Fake timers make the clock deterministic anywhere in the file.
    {
      code: 'vi.useFakeTimers();\nconst t0 = Date.now();\nconst d = Date.now() - t0;\nexpect(d).toBeLessThan(100);',
      filename: testFile,
    },
    {
      code: 'const d = performance.now() - t0;\nexpect(d).toBeLessThan(100);\nbeforeEach(() => { vi.useFakeTimers(); });',
      filename: testFile,
    },
    // Timestamp differences used as data, not asserted against a budget.
    { code: 'record({ elapsedMs: Date.now() - start });', filename: testFile },
    { code: 'expect(onDone).toHaveBeenCalledWith(Date.now() - start);', filename: testFile },
    // Equality-style matchers on a clock difference.
    { code: 'expect(Date.now() - start).toBe(0);', filename: testFile },
    { code: 'expect(performance.now() - t0).toEqual(0);', filename: testFile },
    { code: 'expect(performance.now() - t0).toBeCloseTo(16, 0);', filename: testFile },
    // A clock read on its own is a timestamp, not an elapsed duration.
    { code: 'expect(Date.now()).toBeGreaterThan(0);', filename: testFile },
    // Fixed-timestamp Date arithmetic never reads the clock.
    {
      code: 'expect(new Date(1000).getTime() - new Date(0).getTime()).toBeLessThan(2000);',
      filename: testFile,
    },
    { code: 'expect(+new Date(1000) - +new Date(0)).toBeLessThan(2000);', filename: testFile },
    {
      code: "const d = new Date('2026-01-01').getTime() - epoch;\nexpect(d).toBeGreaterThan(0);",
      filename: testFile,
    },
    // Non-literal budgets are not millisecond constants the rule can reason about.
    { code: 'expect(performance.now() - t0).toBeLessThan(BUDGET_MS);', filename: testFile },
    {
      code: 'const d = Date.now() - start;\nexpect(d).toBeLessThan(budget * 2);',
      filename: testFile,
    },
    // Identifiers the scope manager cannot pin to a single clock-difference initializer.
    { code: 'expect(elapsed).toBeLessThan(100);', filename: testFile },
    {
      code: 'let d = 0;\nd = Date.now() - start;\nexpect(d).toBeLessThan(100);',
      filename: testFile,
    },
    // Baselined file: the first `count` assertions in source order are tolerated.
    {
      code: 'const d = performance.now() - t0;\nexpect(d).toBeLessThan(100);',
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
    },
    {
      code: 'expect(Date.now() - a).toBeLessThan(500);\nexpect(Date.now() - b).toBeLessThan(100);',
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 2 } }],
    },
  ],
  invalid: [
    { code: 'expect(Date.now() - start).toBeLessThan(500);', filename: testFile, errors: [error] },
    {
      code: 'const d = performance.now() - t0;\nexpect(d).toBeLessThan(100);',
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    {
      code: 'expect(Date.now() - start).toBeLessThanOrEqual(500);',
      filename: testFile,
      errors: [error],
    },
    { code: 'expect(Date.now() - start).toBeGreaterThan(5);', filename: testFile, errors: [error] },
    {
      code: 'expect(Date.now() - start).toBeGreaterThanOrEqual(5);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(Date.now() - start).not.toBeGreaterThan(500);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'const d = Math.round(performance.now() - t0);\nexpect(d).toBeLessThan(100);',
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    {
      code: 'const d = performance.now() - t0;\nexpect(Math.floor(d)).toBeLessThan(100);',
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    {
      code: 'expect(Number(Date.now() - start)).toBeLessThan(100);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(start - performance.now()).toBeGreaterThan(-100);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(Date.now() - start).toBeLessThan(2 * 1000);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(globalThis.performance.now() - t0).toBeLessThan(100);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(window.performance.now() - t0).toBeLessThan(100);',
      filename: testFile,
      errors: [error],
    },
    {
      code: 'expect(new Date().getTime() - start).toBeLessThan(100);',
      filename: testFile,
      errors: [error],
    },
    { code: 'expect(+new Date() - start).toBeLessThan(100);', filename: testFile, errors: [error] },
    {
      code: 'const end = performance.now();\nexpect(end - start).toBeLessThan(100);',
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    {
      code: 'let elapsed = Date.now() - start;\nexpect(elapsed).toBeLessThan(100);',
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    // A baseline entry for another file does not cover this one.
    {
      code: 'expect(Date.now() - start).toBeLessThan(500);',
      filename: otherTestFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [error],
    },
    // A baselined file exceeding its count reports the excess in source order.
    {
      code: 'expect(Date.now() - a).toBeLessThan(500);\nexpect(Date.now() - b).toBeLessThan(100);',
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [{ ...error, line: 2 }],
    },
  ],
});
