// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import typescriptParser from '@typescript-eslint/parser';
import { ESLint, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  baselineCounts,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-fixed-wait-timeout-in-tests.js';

const root = process.cwd();
const ruleName = 'no-fixed-wait-timeout-in-tests';
const ruleId = `intent/${ruleName}`;
// `eslint-rules/baselines/no-fixed-wait-timeout-in-tests/<test file>.json`, each holding
// `{ owner, reason, count }`; lower the count as deliberate limits go away.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};

const filename = path.resolve('src/features/example/__tests__/example.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: typescriptParser },
});
const error = { messageId: 'fixedWaitTimeout' };
const testTimeoutError = { messageId: 'testTimeoutCutsOffWait' };
const tl =
  "import { screen, waitFor, waitForElementToBeRemoved } from '@testing-library/svelte';\n";
const inTest = (body) => `${tl}it('t', async () => {\n${body}\n});`;

describe('no-fixed-wait-timeout-in-tests guidance', () => {
  it('states both defaults, the evidence, and every escape hatch', () => {
    const message = rule.meta.messages.fixedWaitTimeout;
    expect(message).toContain('15 s locally, 30 s on CI');
    expect(message).toContain('defaultAsyncUtilTimeoutMs()');
    expect(message).toContain('src/test-setup.ts');
    expect(message).toContain('cloudlands-fe#3958, #3964');
    expect(message).toContain('.rejects');
    expect(message).toMatch(/disable this rule on this line and give the reason after `--`/);
  });

  it('explains why a per-test limit cuts off a failing wait', () => {
    const message = rule.meta.messages.testTimeoutCutsOffWait;
    expect(message).toContain('30 s');
    expect(message).toContain('before a failing wait reports its own assertion');
    expect(message).toContain('cloudlands-fe#3964');
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-fixed-wait-timeout-in-tests baseline ratchet', () => {
  it('gives every entry an owner, a reason and a count for an existing test file', () => {
    for (const group of baselineTree[ruleName] ?? []) {
      expect(group.files, 'every entry must carry a count').toBeUndefined();
      expect(group.owner, 'every entry names an owner').toEqual(expect.any(String));
      expect(group.reason, 'every entry says why the limit is deliberate').toEqual(
        expect.any(String),
      );
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be package-relative with forward slashes`).toMatch(
        /^[^/\\][^\\]*\.test\.(c|m)?(js|ts)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  it('never grows a count against the comparison revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, rules: [ruleName] });
    // A revision whose eslint.config.js does not enable the rule enforced nothing, so the
    // initial baseline may be established against it; afterwards counts only shrink.
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

  // Lints every test file the real `eslint.config.js` lints, so this ratchet and
  // `pnpm lint` cannot disagree on scope. It takes about a minute on the shared host.
  it('matches today’s deliberate cases exactly: no stale count, no new limit', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the limits were removed').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(grown, 'new fixed wait limits; remove them instead of raising the baseline').toEqual({});
  }, 240_000);
});

describe('no-fixed-wait-timeout-in-tests in the repo config', () => {
  // The check this rule was added for: a new fixed limit in a unit test fails `pnpm lint`.
  it('fails a new waitFor(..., { timeout: 3000 }) in a unit test', async () => {
    const eslint = new ESLint({ cwd: root });
    const file = path.join(root, 'src/features/example/__tests__/new-wait.test.ts');
    const [result] = await eslint.lintText(
      `${tl}import { expect, it } from 'vitest';\n` +
        "it('waits', async () => {\n" +
        '  await waitFor(() => expect(1).toBe(1), { timeout: 3000 });\n' +
        '});\n',
      { filePath: file },
    );
    expect(result.messages.filter((m) => m.ruleId === ruleId)).toEqual([
      expect.objectContaining({ ruleId, severity: 2, messageId: 'fixedWaitTimeout', line: 4 }),
    ]);
  }, 120_000);
});

tester.run(ruleName, rule, {
  valid: [
    // The default limit.
    { code: inTest('await waitFor(() => expect(x).toBe(1));'), filename },
    { code: inTest("await screen.findByText('Ready');"), filename },
    { code: inTest("await screen.findByRole('button', { name: 'Save' });"), filename },
    { code: inTest('await vi.waitFor(() => expect(x).toBe(1), { interval: 10 });'), filename },
    { code: inTest('await vi.waitUntil(() => ready);'), filename },
    // Limits computed at run time follow a budget instead of a fixed number.
    {
      code: inTest('await waitFor(check, { timeout: defaultAsyncUtilTimeoutMs() * 2 });'),
      filename,
    },
    { code: inTest('await waitFor(check, { timeout: renderWaitMs(budgetMs(c)) });'), filename },
    {
      code: `${tl}async function waitForRemoval(get, timeoutMs = defaultAsyncUtilTimeoutMs()) {\n  await vi.waitFor(get, { timeout: timeoutMs });\n}`,
      filename,
    },
    { code: inTest('await vi.waitFor(check, budget);'), filename },
    // A later spread we cannot read may supply a run-time limit over the fixed one.
    {
      code: inTest('await waitFor(check, { timeout: 3000, ...budgetOptions() });'),
      filename,
    },
    // A `let` that is reassigned no longer holds its initializer.
    {
      code: inTest(
        'let limit = 3000;\nlimit = budget();\nawait waitFor(check, { timeout: limit });',
      ),
      filename,
    },
    // A wait the test expects to fail keeps a short limit to fail fast.
    {
      code: inTest('await expect(waitFor(check, { timeout: 50 })).rejects.toThrow();'),
      filename,
    },
    {
      code: inTest(
        "await expect(screen.findByText('Gone', undefined, { timeout: 50 })).rejects.toThrow();",
      ),
      filename,
    },
    {
      code: inTest('await expect(() => vi.waitFor(check, { timeout: 50 })).rejects.toThrow();'),
      filename,
    },
    { code: inTest('await vi.waitUntil(check, 50).catch(() => undefined);'), filename },
    {
      code: inTest('void waitFor(check, { timeout: 50 }).then(onOk, (e) => (error = e));'),
      filename,
    },
    {
      code: inTest(
        'const pending = waitFor(check, { timeout: 50 });\nawait vi.advanceTimersByTimeAsync(60);\nawait expect(pending).rejects.toThrow();',
      ),
      filename,
    },
    {
      code: inTest(
        'try {\n  await waitFor(check, { timeout: 100 });\n} catch {\n  probe = false;\n}',
      ),
      filename,
    },
    // `waitFor` that is not Testing Library's, and member `.waitFor` that is not `vi`'s.
    {
      code: "import { waitFor } from '../testing/agent-test-utils';\nawait waitFor(check, { timeout: 3000 });",
      filename,
    },
    { code: inTest('await locator.waitFor({ timeout: 3000 });'), filename },
    { code: inTest('await target.waitFor(check, { timeout: 3000 });'), filename },
    // A reasoned same-line disable.
    {
      code: inTest(
        'await waitFor(check, { timeout: 35_000 }); // eslint-disable-line rule-to-test/no-fixed-wait-timeout-in-tests -- real daemon RPC',
      ),
      filename,
    },
    // A baselined file may keep its counted limits.
    {
      code: inTest(
        'await waitFor(a, { timeout: 10_000 });\nawait waitFor(b, { timeout: 10_000 });',
      ),
      filename,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 2 } }],
    },
    // Per-test limits: above the CI wait default, or with no wait on the default inside.
    { code: `${tl}it('t', async () => {\n  await waitFor(check);\n}, 45_000);`, filename },
    { code: `${tl}it('t', async () => {\n  expect(compute()).toBe(1);\n}, 5_000);`, filename },
    {
      code: `${tl}it('t', async () => {\n  await expect(waitFor(check, { timeout: 50 })).rejects.toThrow();\n}, 5_000);`,
      filename,
    },
    {
      code: `${tl}it('t', async () => {\n  await waitFor(check);\n}, defaultTestTimeoutMs() * 2);`,
      filename,
    },
  ],
  invalid: [
    // Renaming the import does not hide the wait.
    {
      code: "import { waitFor as wait } from '@testing-library/svelte';\nawait wait(check, { timeout: 3000 });",
      filename,
      errors: [error],
    },
    {
      code: "import { waitForElementToBeRemoved as gone } from '@testing-library/dom';\nawait gone(() => el, { timeout: 3000 });",
      filename,
      errors: [error],
    },
    // A fixed property after the unreadable spread sets the limit again.
    {
      code: inTest('await waitFor(check, { ...budgetOptions(), timeout: 3000 });'),
      filename,
      errors: [error],
    },
    {
      code: inTest('await waitFor(() => expect(x).toBe(1), { timeout: 3000 });'),
      filename,
      errors: [error],
    },
    {
      code: inTest('await waitFor(check, { timeout: 2 * 1_000, interval: 50 });'),
      filename,
      errors: [error],
    },
    {
      code: inTest('await waitForElementToBeRemoved(() => el, { timeout: 5_000 });'),
      filename,
      errors: [error],
    },
    {
      code: inTest("await screen.findByText('Ready', undefined, { timeout: 5_000 });"),
      filename,
      errors: [error],
    },
    {
      code: inTest("await view.findAllByRole('row', {}, { timeout: 3_000 });"),
      filename,
      errors: [error],
    },
    {
      code: `${tl}it('t', async () => {\n  const { findByTestId } = render(C);\n  await findByTestId('x', {}, { timeout: 3000 });\n});`,
      filename,
      errors: [error],
    },
    { code: inTest('await vi.waitFor(check, { timeout: 4000 });'), filename, errors: [error] },
    { code: inTest('await vi.waitUntil(check, 2_000);'), filename, errors: [error] },
    {
      code: inTest('await waitFor(check, { timeout: isCi ? 10_000 : 5_000 });'),
      filename,
      errors: [error],
    },
    // A limit held in a named constant (the case the cleanup scan missed).
    {
      code: `${tl}const SETTLE_TIMEOUT_MS = 5000;\nit('t', async () => {\n  await waitFor(check, { timeout: SETTLE_TIMEOUT_MS });\n});`,
      filename,
      errors: [{ ...error, line: 4 }],
    },
    {
      code: `${tl}const RENDER_WAIT = { timeout: 3000 };\nit('t', async () => {\n  await waitFor(a, RENDER_WAIT);\n  await waitFor(b, RENDER_WAIT);\n});`,
      filename,
      // One fixed limit, reported once where it is written.
      errors: [{ ...error, line: 2 }],
    },
    {
      code: `${tl}const WAITS = { render: 3000 } as const;\nit('t', async () => {\n  await vi.waitFor(check, { timeout: WAITS.render });\n});`,
      filename,
      errors: [error],
    },
    {
      code: `${tl}const BASE = { timeout: 3000 };\nit('t', async () => {\n  await waitFor(check, { ...BASE, interval: 10 });\n});`,
      filename,
      errors: [error],
    },
    {
      code: `${tl}const SECOND = 1000;\nconst LIMIT = 3 * SECOND;\nit('t', async () => {\n  await waitFor(check, { timeout: LIMIT as number });\n});`,
      filename,
      errors: [error],
    },
    // A promise that is only awaited, not asserted to reject, is not an expected failure.
    {
      code: inTest('const pending = waitFor(check, { timeout: 50 });\nawait pending;'),
      filename,
      errors: [error],
    },
    // `try` without `catch` still fails the test.
    {
      code: inTest(
        'try {\n  await waitFor(check, { timeout: 100 });\n} finally {\n  cleanup();\n}',
      ),
      filename,
      errors: [error],
    },
    // A disable that names another rule does not cover this one.
    {
      code: inTest(
        'await waitFor(check, { timeout: 3000 }); // eslint-disable-line no-console -- unrelated',
      ),
      filename,
      errors: [error],
    },
    // A multi-line block `eslint-disable-next-line` covers the line after it ends, and
    // uses none of the allowance either.
    {
      code: inTest(
        '/* eslint-disable-next-line\n   rule-to-test/no-fixed-wait-timeout-in-tests -- deliberate */\nawait waitFor(a, { timeout: 1000 });\nawait waitFor(b, { timeout: 2000 });\nawait waitFor(c, { timeout: 3000 });',
      ),
      filename,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [{ ...error, line: 7 }],
    },
    // Findings past a file's baseline allowance are reported; a disabled line uses none.
    {
      code: inTest(
        'await waitFor(a, { timeout: 1000 }); // eslint-disable-line rule-to-test/no-fixed-wait-timeout-in-tests -- deliberate\nawait waitFor(b, { timeout: 2000 });\nawait waitFor(c, { timeout: 3000 });',
      ),
      filename,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [{ ...error, line: 5 }],
    },
    // A per-test limit at or below the CI wait default cuts off a wait on that default.
    {
      code: `${tl}it('t', async () => {\n  await waitFor(check);\n}, 30_000);`,
      filename,
      errors: [{ ...testTimeoutError, line: 4 }],
    },
    {
      code: `${tl}it('t', { timeout: 15_000 }, async () => {\n  await screen.findByText('x');\n});`,
      filename,
      errors: [testTimeoutError],
    },
    {
      code: `${tl}it.each([1, 2])('t %s', async () => {\n  await vi.waitFor(check);\n}, { timeout: 10_000 });`,
      filename,
      errors: [testTimeoutError],
    },
    {
      code: `${tl}test.concurrent('t', async () => {\n  await waitFor(check);\n}, 20_000);`,
      filename,
      errors: [testTimeoutError],
    },
  ],
});
