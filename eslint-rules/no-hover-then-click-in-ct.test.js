// @vitest-environment node
// The ratchet lints every file in the rule's eslint.config.js scope.
// @verify-changed-triggers: src/**/*.ct.spec.ts, eslint.config.js,
//   eslint-rules/baselines/no-hover-then-click-in-ct/**
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import {
  baselineCounts,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-hover-then-click-in-ct.js';

const root = process.cwd();
const ruleName = 'no-hover-then-click-in-ct';
// `eslint-rules/baselines/no-hover-then-click-in-ct/<spec file>.json`, each holding
// `{ "count": N }`; lower it as sites are converted and delete the file at zero.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const specRelative = 'src/lib/components/example/example.ct.spec.ts';
const filename = path.resolve(specRelative);
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
});

const error = (line) => ({ messageId: 'hoverThenClick', line });

const inTest = (body) => `
test('copies the message', async ({ mount, page }) => {
${body}
});`;

describe('no-hover-then-click-in-ct guidance', () => {
  it('explains the stranded pointer, names the helper, and cites the incidents', () => {
    const message = rule.meta.messages.hoverThenClick;
    expect(message).toContain('checks the hit target before it moves the pointer');
    expect(message).toContain('await activateHoverAction(action, region)');
    expect(message).toContain('requireChange: false');
    expect(message).toContain('cloudlands-fe#4112');
    expect(message).toContain('cloudlands-fe#4078');
    expect(message).toContain('disable this rule on that line with a reason');
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-hover-then-click-in-ct baseline ratchet', () => {
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
  it('matches today’s sites exactly: no stale count, no new site', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the sites were converted').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new hover-then-click sites; use activateHoverAction instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-hover-then-click-in-ct', rule, {
  valid: [
    {
      name: 'the shared helper',
      filename,
      code: inTest(`
  const row = component.getByTestId('row');
  await row.hover();
  await activateHoverAction(row.getByRole('button', { name: 'Copy' }), scroller);`),
    },
    {
      name: 'clicking the hovered element itself, or a narrowing of it',
      filename,
      code: inTest(`
  const rows = component.getByTestId('row');
  await rows.first().hover();
  await rows.first().click();
  await rows.filter({ hasText: 'One' }).click();`),
    },
    {
      name: 'hovering a page-level locator does not mark the page hovered',
      filename,
      code: inTest(`
  await page.getByRole('menuitem', { name: 'Label' }).hover();
  await page.getByRole('menuitem', { name: 'Bug' }).click();
  await component.getByRole('button', { name: 'Save' }).click();`),
    },
    {
      name: 'a click on something outside the hovered locator',
      filename,
      code: inTest(`
  await row.hover();
  await other.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'a later hover moves the pointer off the first row',
      filename,
      code: inTest(`
  await row.hover();
  await other.hover();
  await row.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'a click elsewhere moves the pointer off the row',
      filename,
      code: inTest(`
  await row.hover();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await row.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'a mouse move or mouse click moves the pointer off the row',
      filename,
      code: inTest(`
  await row.hover();
  await page.mouse.move(0, 0);
  await row.getByRole('button', { name: 'Copy' }).click();
  await row.hover();
  await page.mouse.click(0, 0);
  await row.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'a double-click on content inside the row',
      filename,
      code: inTest(`
  await row.hover();
  await row.getByTestId('message-text').dblclick();`),
    },
    {
      name: 'keyboard activation and focus',
      filename,
      code: inTest(`
  await row.hover();
  await row.getByRole('button', { name: 'Copy' }).focus();
  await row.getByRole('button', { name: 'Copy' }).press('Enter');`),
    },
    {
      name: 'a hover in another test does not carry over',
      filename,
      code: `
test('a', async () => {
  await row.hover();
});
test('b', async () => {
  await row.getByRole('button', { name: 'Copy' }).click();
});`,
    },
    {
      name: 'a selector hover does not mark its receiver hovered',
      filename,
      code: inTest(`
  await page.hover('.row');
  await page.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'known limitation: a hover inside a local helper is not followed to its calls',
      filename,
      code: inTest(`
  const hoverRow = async () => {
    await row.hover();
  };
  await hoverRow();
  await row.getByRole('button', { name: 'Copy' }).click();`),
    },
    {
      name: 'files other than component specs',
      filename: path.resolve('src/test/ct-hover-action.ts'),
      code: inTest(`
  await row.hover();
  await row.getByRole('button').click();`),
    },
    {
      name: 'baselined sites up to the count',
      filename,
      options: [{ baseline: { [specRelative]: 2 } }],
      code: inTest(`
  await row.hover();
  await row.getByRole('button', { name: 'Copy' }).click();
  await row.getByRole('button', { name: 'Edit' }).click();`),
    },
    {
      name: 'a reasoned disable does not use up the allowance',
      filename,
      options: [{ baseline: { [specRelative]: 1 } }],
      code: inTest(`
  await row.hover();
  // eslint-disable-next-line rule-to-test/no-hover-then-click-in-ct -- covers the pointer path on a still row
  await row.getByRole('button', { name: 'Copy' }).click();
  await row.getByRole('button', { name: 'Edit' }).click();`),
    },
  ],
  invalid: [
    {
      name: 'a click on a button inside the hovered row',
      filename,
      code: inTest(`
  await row.hover();
  await row.getByRole('button', { name: 'Copy' }).click();`),
      errors: [error(5)],
    },
    {
      name: 'a hover inside a test.step carries out to the enclosing test',
      filename,
      code: inTest(`
  await test.step('hover the row', async () => {
    await row.hover();
  });
  await row.getByRole('button', { name: 'Copy' }).click();`),
      errors: [error(7)],
    },
    {
      name: 'through const aliases of the row and of the action',
      filename,
      code: inTest(`
  const row = component.locator('[data-message-id="m-1"]');
  const toolbar = row.locator('[data-actions]');
  const copy = toolbar.getByRole('button', { name: 'Copy' });
  await row.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await copy.click();`),
      errors: [error(9)],
    },
    {
      name: 'hovering an alias and clicking through its definition',
      filename,
      code: inTest(`
  const first = rows.first();
  await first.hover();
  await rows.first().getByRole('button', { name: 'Edit' }).click();
  await first.getByRole('button', { name: 'Save' }).click();`),
      errors: [error(6), error(7)],
    },
    {
      name: 'the click helper and a click split over lines',
      filename,
      code: inTest(`
  await source.hover();
  await clickAndSettle(source.getByRole('button', { name: 'Scroll' }), scroll);
  await source
    .getByTestId('actions')
    .getByRole('button', { name: 'Remove' })
    .click({ force: true });`),
      errors: [error(5), error(9)],
    },
    {
      name: 'a click in a nested callback after the hover',
      filename,
      code: inTest(`
  await row.hover();
  await expect(async () => {
    await row.getByRole('button', { name: 'Copy' }).click();
  }).toPass();`),
      errors: [error(6)],
    },
    {
      name: 'hovering a helper-built row',
      filename,
      code: inTest(`
  await rowFor(page, 'a').hover();
  await rowFor(page, 'a').getByRole('button', { name: 'Remove' }).click();`),
      errors: [error(5)],
    },
    {
      name: 'sites beyond the baselined count, in source order',
      filename,
      options: [{ baseline: { [specRelative]: 1 } }],
      code: inTest(`
  await row.hover();
  await row.getByRole('button', { name: 'Copy' }).click();
  await row.getByRole('button', { name: 'Edit' }).click();`),
      errors: [error(6)],
    },
    {
      name: 'a baseline for another file does not apply',
      filename,
      options: [{ baseline: { 'src/other.ct.spec.ts': 3 } }],
      code: inTest(`
  await row.hover();
  await row.getByRole('button').click();`),
      errors: [error(5)],
    },
  ],
});
