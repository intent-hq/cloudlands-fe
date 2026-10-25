// @vitest-environment node
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-one-shot-animation-count.js';

const filename = path.resolve('src/lib/components/example/__tests__/example.ct.spec.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});
const error = { messageId: 'oneShotAnimationCount' };
const inTest = (body) => `test('t', async ({ mount, page }) => {\n${body}\n});`;

describe('no-one-shot-animation-count guidance', () => {
  it('names both helpers, the deliberate-contract escape, and the incident', () => {
    const message = rule.meta.messages.oneShotAnimationCount;
    expect(message).toContain('expectAnimationsToSettle(locator)');
    expect(message).toContain('expectNoAnimations(locator, { ignore');
    expect(message).toContain('src/test/ct-test.ts');
    expect(message).toContain('cloudlands-fe#3651');
    expect(message).toContain('intent-hq/intent#7749');
    expect(message).toMatch(/disable this rule on that line with the reason/);
    expect(message).toContain('packages/cloudlands-fe/AGENTS.md');
  });

  it('takes no options: it is enforced at zero debt', () => {
    expect(rule.meta.schema).toEqual([]);
  });
});

tester.run('no-one-shot-animation-count', rule, {
  valid: [
    // Polling retries until animations settle.
    {
      code: inTest(
        'await expect.poll(() => row.evaluate((n) => n.getAnimations({ subtree: true }).length)).toBe(0);',
      ),
      filename,
    },
    // A toPass block retries every assertion inside it.
    {
      code: inTest(`await expect(async () => {
  const geometry = await strip.evaluate((n) => ({ running: n.getAnimations().length }));
  expect(geometry.running).toBe(0);
}).toPass();`),
      filename,
    },
    // The shared helpers.
    { code: inTest('await expectAnimationsToSettle(row);'), filename },
    {
      code: inTest(
        'await expectNoAnimations(mark, { ignore: [{ within: \'[data-slot="intent-mark-loader"]\' }] });',
      ),
      filename,
    },
    // Non-zero expectations assert that something does animate.
    {
      code: inTest('expect(await probe.evaluate((n) => n.getAnimations().length)).toBe(1);'),
      filename,
    },
    {
      code: inTest(
        'expect(await probe.evaluate((n) => n.getAnimations().length)).toBeGreaterThan(0);',
      ),
      filename,
    },
    {
      code: inTest('expect(await probe.evaluate((n) => n.getAnimations().length)).not.toBe(0);'),
      filename,
    },
    // Zero checks on values that never read getAnimations().
    { code: inTest('expect(await rows.count()).toBe(0);'), filename },
    {
      code: inTest(
        'const errors = await page.evaluate(() => window.errors);\nexpect(errors).toEqual([]);',
      ),
      filename,
    },
    // Another property of an object that also sampled animations.
    {
      code: inTest(
        'const sample = await search.evaluate((el) => ({ icons: el.querySelectorAll("svg").length, resizing: el.getAnimations().length > 0 }));\nexpect(sample.icons).toBe(0);',
      ),
      filename,
    },
    // Waiting on `finished` is a settle, not a count.
    {
      code: inTest(
        'await row.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));\nexpect(await rows.count()).toBe(0);',
      ),
      filename,
    },
  ],
  invalid: [
    // cloudlands-fe#3651's shape: one read inside evaluate.
    {
      code: inTest(
        'expect(await row.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // expect.soft and every zero matcher.
    {
      code: inTest('expect.soft(await row.evaluate((n) => n.getAnimations().length)).toBe(0);'),
      filename,
      errors: [error],
    },
    {
      code: inTest('expect(await row.evaluate((n) => n.getAnimations().length)).toEqual(0);'),
      filename,
      errors: [error],
    },
    {
      code: inTest('expect(await row.evaluate((n) => n.getAnimations())).toHaveLength(0);'),
      filename,
      errors: [error],
    },
    {
      code: inTest(
        'expect(await row.evaluate((n) => n.getAnimations().map((a) => a.playState))).toEqual([]);',
      ),
      filename,
      errors: [error],
    },
    {
      code: inTest(
        "expect(await row.evaluate((n) => n.getAnimations().filter((a) => a.playState === 'running')), 'evidence').toStrictEqual([]);",
      ),
      filename,
      errors: [error],
    },
    // Through a local binding, and a property of one.
    {
      code: inTest(
        'const count = await slots.evaluateAll((all) => all.flatMap((s) => s.getAnimations()).length);\nexpect(count, evidence).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    {
      code: inTest(
        'const geometry = await strip.evaluate((n) => ({ running: n.getAnimations().length }));\nexpect(geometry.running).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // A shorthand property whose binding read getAnimations().
    {
      code: inTest(
        'const result = await page.evaluate(() => {\n  const settled = document.getAnimations().length;\n  return { settled };\n});\nexpect(result.settled).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // A property with no object-literal entry falls back to the whole value.
    {
      code: inTest(
        'const animations = await row.evaluate((n) => n.getAnimations());\nexpect(animations.length).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // Through a for-of loop variable over values that read getAnimations().
    {
      code: inTest(
        'const dots = await track.evaluateAll((all) => all.map((d) => ({ animations: d.getAnimations().length })));\nfor (const dot of dots) expect(dot.animations).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // Through a local arrow helper.
    {
      code: inTest(
        'const animationCount = () => root.evaluate((n) => n.getAnimations({ subtree: true }).length);\nexpect(await animationCount()).toBe(0);',
      ),
      filename,
      errors: [error],
    },
    // Directly on document.getAnimations().
    {
      code: inTest('expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);'),
      filename,
      errors: [error],
    },
  ],
});

it('is enabled for component tests in the repository config', async () => {
  const eslint = new ESLint();
  const sample = `import { expect, test } from '../../../../test/ct-test';
test('t', async ({ page }) => {
  const row = page.getByRole('row');
  expect(await row.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});
`;
  const lint = async (filePath) =>
    (await eslint.lintText(sample, { filePath, warnIgnored: false }))[0]?.messages.filter(
      (message) => message.ruleId === 'intent/no-one-shot-animation-count',
    ) ?? [];
  const flagged = await lint(filename);
  expect(flagged).toHaveLength(1);
  expect(flagged[0]).toMatchObject({ line: 4, severity: 2 });
  // Unit tests and e2e specs are outside the rule's scope.
  expect(await lint(path.resolve('src/lib/components/example/__tests__/example.test.ts'))).toEqual(
    [],
  );
});
