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
import rule from './no-class-name-assertions-in-tests.js';

const root = process.cwd();
const ruleName = 'no-class-name-assertions-in-tests';
// `eslint-rules/baselines/no-class-name-assertions-in-tests/<test file>.json`, each
// holding `{ "count": N }`; lower N as assertions are rewritten, delete the file at zero.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const testFile = path.resolve('src/features/example/__tests__/example.test.ts');
const otherTestFile = path.resolve('src/features/other/__tests__/other.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = { messageId: 'classNameAssertion' };

describe('no-class-name-assertions-in-tests guidance', () => {
  it('points at the AGENTS.md section and suggests behaviour or accessibility checks', () => {
    const message = rule.meta.messages.classNameAssertion;
    expect(message).toContain("'Do not write decorative appearance tests'");
    expect(message).toContain('packages/cloudlands-fe/AGENTS.md');
    expect(message).toContain('#do-not-write-decorative-appearance-tests');
    expect(message).toMatch(/behaviour or accessibility state/);
    expect(message).toMatch(/aria-\*/);
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-class-name-assertions-in-tests baseline ratchet', () => {
  it('maps existing package-relative test files to counted entries only', () => {
    for (const exception of baselineTree[ruleName] ?? []) {
      expect(exception.files, 'every entry must carry a count').toBeUndefined();
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be a package-relative src/ unit test`).toMatch(
        /^src\/[^\\]*\.test\.ts$/,
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
  // global ignores), so this ratchet and `pnpm lint` cannot disagree on scope.
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
      'new class-name assertions; assert behaviour instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-class-name-assertions-in-tests', rule, {
  valid: [
    // Behaviour and accessibility state.
    { code: "expect(el.getAttribute('aria-hidden')).toBe('true');", filename: testFile },
    { code: "expect(el.getAttribute('data-state')).toBe('open');", filename: testFile },
    { code: 'expect(button.hidden).toBe(true);', filename: testFile },
    { code: "expect(el.textContent).toContain('Saved');", filename: testFile },
    { code: 'expect(document.activeElement).toBe(input);', filename: testFile },
    // A string not read from an element's classes.
    { code: "const cls = 'a b';\nexpect(cls).toContain('a');", filename: testFile },
    { code: "expect(buildClasses('x')).toContain('x');", filename: testFile },
    // `contains` on something other than a classList (DOM containment is behaviour).
    { code: 'expect(container.contains(child)).toBe(true);', filename: testFile },
    // Matchers that do not compare the class spelling.
    { code: 'expect(el.className).toBeDefined();', filename: testFile },
    // Class reads outside an assertion are not reported.
    { code: "const isActive = el.classList.contains('active');", filename: testFile },
    { code: "el.classList.add('x');\nexpect(onChange).toHaveBeenCalled();", filename: testFile },
    // A binding reassigned after its declaration no longer holds the class read.
    {
      code: "let v = el.className;\nv = 'label';\nexpect(v).toBe('label');",
      filename: testFile,
    },
    // Baselined file: the first `count` assertions in source order are tolerated.
    {
      code: "expect(el.className).toContain('invisible');",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
    },
    {
      code: "expect(a.className).toContain('x');\nexpect(b.classList.contains('y')).toBe(true);",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 2 } }],
    },
  ],
  invalid: [
    // The cloudlands-fe#3463 shape.
    { code: "expect(el.className).toContain('invisible');", filename: testFile, errors: [error] },
    { code: "expect(el.className).not.toContain('hidden');", filename: testFile, errors: [error] },
    { code: 'expect(el.className).toMatch(/text-xs/);', filename: testFile, errors: [error] },
    { code: "expect(el.className).toBe('a b');", filename: testFile, errors: [error] },
    { code: "expect(el.className).toEqual('a b');", filename: testFile, errors: [error] },
    { code: "expect(el.className).toStrictEqual('a b');", filename: testFile, errors: [error] },
    { code: "expect(el.classList).toContain('active');", filename: testFile, errors: [error] },
    {
      code: "expect(el.classList.contains('active')).toBe(true);",
      filename: testFile,
      errors: [error],
    },
    {
      code: "expect(el.classList.contains('active')).toBeFalsy();",
      filename: testFile,
      errors: [error],
    },
    { code: "expect(el).toHaveClass('active');", filename: testFile, errors: [error] },
    { code: "expect(el).not.toHaveClass('active');", filename: testFile, errors: [error] },
    {
      code: "expect(el.getAttribute('class')).toContain('active');",
      filename: testFile,
      errors: [error],
    },
    // Optional chaining, element lookups and derived values.
    {
      code: "expect(container.querySelector('button')?.className).toContain('x');",
      filename: testFile,
      errors: [error],
    },
    {
      code: "expect(screen.getByRole('button', { name: 'Go' }).className).toContain('x');",
      filename: testFile,
      errors: [error],
    },
    {
      code: "expect(el.className.split(' ')).toContain('x');",
      filename: testFile,
      errors: [error],
    },
    {
      code: "expect(el.className.includes('x')).toBe(true);",
      filename: testFile,
      errors: [error],
    },
    { code: "expect(String(el.className)).toContain('x');", filename: testFile, errors: [error] },
    {
      code: "expect(Array.from(el.classList)).toEqual(['x']);",
      filename: testFile,
      errors: [error],
    },
    { code: "expect(el['className']).toContain('x');", filename: testFile, errors: [error] },
    // Values bound to a variable first.
    {
      code: "const classes = el.className.split(/\\s+/);\nexpect(classes).toContain('x');",
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    {
      code: "const list = el.classList;\nexpect(list.contains('x')).toBe(true);",
      filename: testFile,
      errors: [{ ...error, line: 2 }],
    },
    // Vitest's optional assertion message is analysed like the bare form.
    {
      code: "expect(el.className, 'hidden state').toContain('invisible');",
      filename: testFile,
      errors: [error],
    },
    // A baseline entry for another file does not cover this one.
    {
      code: "expect(el.className).toContain('invisible');",
      filename: otherTestFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [error],
    },
    // A baselined file exceeding its count reports the excess in source order.
    {
      code: "expect(a.className).toContain('x');\nexpect(b.className).toContain('y');",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [{ ...error, line: 2 }],
    },
  ],
});
