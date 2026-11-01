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
import rule from './no-wait-for-timeout-in-ct.js';

const root = process.cwd();
const ruleName = 'no-wait-for-timeout-in-ct';
// `eslint-rules/baselines/no-wait-for-timeout-in-ct/<spec file>.json`, each holding
// `{ "count": N }`; lower it as sleeps are replaced and delete the file at zero.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const specRelative = 'src/lib/components/example/example.ct.spec.ts';
const filename = path.resolve(specRelative);
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = (line) => ({ messageId: 'fixedSleep', line });

const inTest = (body) => `
test('toggles the row', async ({ mount, page }) => {
${body}
});`;

describe('no-wait-for-timeout-in-ct guidance', () => {
  it('explains the dropped click, names the helpers, and cites the incidents', () => {
    const message = rule.meta.messages.fixedSleep;
    expect(message).toContain('hit-tests only pointerdown');
    expect(message).toContain('await clickAndSettle(control, region)');
    expect(message).toContain('expectMotionToSettle(region, { changedFrom })');
    expect(message).toContain('cloudlands-fe#3955');
    expect(message).toContain('cloudlands-fe#3920');
    expect(message).toContain('disable this rule on that line with a reason');
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-wait-for-timeout-in-ct baseline ratchet', () => {
  it('maps existing package-relative component specs to counted entries only', () => {
    for (const exception of baselineTree[ruleName] ?? []) {
      expect(exception.files, 'every entry must carry a count').toBeUndefined();
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be a package-relative component spec`).toMatch(
        /^src\/[^\\]*\.ct\.spec\.ts$/,
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

  // Lints every spec the real `eslint.config.js` lints (same rule entry, same global
  // ignores), so this ratchet and `pnpm lint` cannot disagree on scope.
  it('matches today’s sleeps exactly: no stale count, no new sleep', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the sleeps were replaced').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new page.waitForTimeout sleeps; wait for motion or state instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-wait-for-timeout-in-ct', rule, {
  valid: [
    {
      name: 'the shared settle helpers',
      filename,
      code: inTest(`
  await clickAndSettle(toggle, region);
  await expectMotionToSettle(region, { changedFrom: before });`),
    },
    {
      name: 'other waits',
      filename,
      code: inTest(`
  await page.waitForFunction(() => true);
  await page.waitForLoadState('load');
  await expect.poll(() => count()).toBe(2);`),
    },
    {
      name: 'files other than component specs',
      filename: path.resolve('src/test/ct-settle.ts'),
      code: inTest(`
  await page.waitForTimeout(400);`),
    },
    {
      name: 'Playwright e2e specs',
      filename: path.resolve('e2e/chat.spec.ts'),
      code: inTest(`
  await page.waitForTimeout(400);`),
    },
    {
      name: 'baselined sleeps up to the count',
      filename,
      options: [{ baseline: { [specRelative]: 2 } }],
      code: inTest(`
  await page.waitForTimeout(100);
  await component.page().waitForTimeout(200);`),
    },
    {
      name: 'a reasoned disable does not use up the allowance',
      filename,
      options: [{ baseline: { [specRelative]: 1 } }],
      code: inTest(`
  // eslint-disable-next-line rule-to-test/no-wait-for-timeout-in-ct -- observes a quiet period
  await page.waitForTimeout(400);
  await page.waitForTimeout(100);`),
    },
  ],
  invalid: [
    {
      name: 'a sleep on the page',
      filename,
      code: inTest(`
  await toggle.click();
  await page.waitForTimeout(400);`),
      errors: [error(5)],
    },
    {
      name: 'any receiver, computed keys, and indirect calls',
      filename,
      code: inTest(`
  await component.page().waitForTimeout(50);
  await this.page['waitForTimeout'](50);
  await page.waitForTimeout.call(page, 50);
  await page?.waitForTimeout(50);`),
      errors: [error(4), error(5), error(6), error(7)],
    },
    {
      name: 'a destructured sleep',
      filename,
      code: inTest(`
  const { waitForTimeout } = page;
  await waitForTimeout(50);`),
      errors: [error(4)],
    },
    {
      name: 'sleeps beyond the baselined count, in source order',
      filename,
      options: [{ baseline: { [specRelative]: 1 } }],
      code: inTest(`
  await page.waitForTimeout(100);
  await page.waitForTimeout(200);`),
      errors: [error(5)],
    },
    {
      name: 'a baseline for another file does not apply',
      filename,
      options: [{ baseline: { 'src/other.ct.spec.ts': 3 } }],
      code: inTest(`
  await page.waitForTimeout(100);`),
      errors: [error(4)],
    },
  ],
});
