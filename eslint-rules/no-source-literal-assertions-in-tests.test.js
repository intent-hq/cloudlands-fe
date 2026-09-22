// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-source-literal-assertions-in-tests.js';

const root = process.cwd();
const baselineFile = 'eslint-rules/no-source-literal-assertions-in-tests.baseline.json';
const baseline = JSON.parse(fs.readFileSync(path.join(root, baselineFile), 'utf8'));
const ruleId = 'intent/no-source-literal-assertions-in-tests';

const testFile = path.resolve('src/features/example/__tests__/example.test.ts');
const otherTestFile = path.resolve('src/features/other/__tests__/other.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = (filePath) => ({ messageId: 'sourceLiteralRead', data: { path: filePath } });

describe('no-source-literal-assertions-in-tests guidance', () => {
  it('explains the breakage, names the alternative, and cites the review PR', () => {
    const message = rule.meta.messages.sourceLiteralRead;
    expect(message).toMatch(/without changing the observable contract/);
    expect(message).toMatch(/Render the component or call the exported function/);
    expect(message).toContain('intent-hq/cloudlands-fe#2760');
  });

  it('declares the per-file count baseline in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 1 },
    });
  });
});

describe('no-source-literal-assertions-in-tests baseline ratchet', () => {
  it('maps sorted, existing package-relative test files to positive counts', () => {
    const files = Object.keys(baseline);
    expect(files).toEqual([...files].sort());
    for (const [file, count] of Object.entries(baseline)) {
      expect(file, `${file} should be package-relative with forward slashes`).toMatch(
        /^[^/\\][^\\]*\.(test|spec)\.(js|ts)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
      expect(Number.isInteger(count) && count >= 1, `${file} count must be >= 1`).toBe(true);
    }
  });

  it('never grows a count against the comparison revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, file: baselineFile });
    if (!comparison) return;
    const ruleName = 'no-source-literal-assertions-in-tests';
    expect(
      findBaselineGrowth(
        { [ruleName]: [{ counts: comparison.baseline }] },
        { [ruleName]: [{ counts: baseline }] },
      ),
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
    expect(stale, 'lower or remove these baseline counts; the reads were fixed').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new source-literal assertions; fix them instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-source-literal-assertions-in-tests', rule, {
  valid: [
    {
      code: "readFileSync(resolve(__dirname, '__fixtures__/Sample.svelte'), 'utf8');",
      filename: testFile,
    },
    {
      code: "fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.ts'), 'utf8');",
      filename: testFile,
    },
    {
      code: "fs.readFileSync(path.join(__dirname, 'fixtures', name, 'Sample.ts'), 'utf8');",
      filename: testFile,
    },
    {
      code: "readFileSync(resolve(__dirname, '../__mocks__', dir, 'store.ts'), 'utf8');",
      filename: testFile,
    },
    { code: "readFileSync('../__mocks__/store.ts', 'utf8');", filename: testFile },
    { code: "readFileSync('../goldens/output.ts', 'utf8');", filename: testFile },
    {
      code: "readFileSync(resolve(__dirname, '../messages/en.json'), 'utf8');",
      filename: testFile,
    },
    { code: "readFileSync(new URL('../README.md', import.meta.url), 'utf8');", filename: testFile },
    { code: "readFileSync(resolve(__dirname, '../app.css'), 'utf8');", filename: testFile },
    { code: "readFileSync(resolve(__dirname, '../types.d.ts'), 'utf8');", filename: testFile },
    { code: "readFileSync(resolve(__dirname, source), 'utf8');", filename: testFile },
    { code: "readFileSync(`${dir}/Foo.svelte`, 'utf8');", filename: testFile },
    { code: "readFileSync(sourcePath, 'utf8');", filename: testFile },
    {
      code: "readFileSync(resolve(__dirname, '../Foo.svelte').trim(), 'utf8');",
      filename: testFile,
    },
    { code: "readSource('../Foo.svelte');", filename: testFile },
    {
      code: "readFileSync(resolve(__dirname, '../Foo.svelte'), 'utf8');",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
    },
    {
      code: "readFileSync('../Foo.svelte', 'utf8');\nreadFileSync('../Bar.svelte', 'utf8');",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 2 } }],
    },
  ],
  invalid: [
    {
      code: "readFileSync('../Foo.svelte', 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "readFileSync(`../Foo.svelte`, 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "const layout = readFileSync(resolve(__dirname, '../Foo.svelte'), 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "fs.readFileSync(path.join(process.cwd(), 'src/x.ts'), 'utf8');",
      filename: testFile,
      errors: [error('src/x.ts')],
    },
    {
      code: "readFileSync(resolve(__dirname, '..', 'Foo.svelte'), 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "readFileSync(new URL('../Foo.svelte', import.meta.url), 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "const text = await fs.promises.readFile(resolve(__dirname, '../Foo.svelte'), 'utf8');",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "const text = await fsp.readFile(path.resolve(__dirname, '../store.ts'), 'utf8');",
      filename: testFile,
      errors: [error('../store.ts')],
    },
    {
      code: "readFile(join(__dirname, '../store.ts'), 'utf8', () => {});",
      filename: testFile,
      errors: [error('../store.ts')],
    },
    {
      code: "fs.readFile(join(__dirname, '../Foo.svelte'), 'utf8', () => {});",
      filename: testFile,
      errors: [error('../Foo.svelte')],
    },
    {
      code: "readFileSync(resolve(__dirname, '../Foo.svelte'), 'utf8');",
      filename: otherTestFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [error('../Foo.svelte')],
    },
    {
      code: "readFileSync('../Foo.svelte', 'utf8');\nreadFileSync('../Bar.svelte', 'utf8');",
      filename: testFile,
      options: [{ baseline: { 'src/features/example/__tests__/example.test.ts': 1 } }],
      errors: [{ ...error('../Bar.svelte'), line: 2 }],
    },
  ],
});
