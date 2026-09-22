// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-source-literal-assertions-in-tests.js';

const root = process.cwd();
const baselinePath = path.join(
  root,
  'eslint-rules/no-source-literal-assertions-in-tests.baseline.json',
);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

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

  it('declares the baseline option in its schema', () => {
    expect(rule.meta.schema[0].properties.baseline.items).toEqual({ type: 'string' });
  });
});

describe('no-source-literal-assertions-in-tests baseline ratchet', () => {
  it('is a sorted list of unique, existing package-relative test files', () => {
    expect(baseline).toEqual([...new Set(baseline)].sort());
    for (const file of baseline) {
      expect(file, `${file} should be package-relative with forward slashes`).toMatch(
        /^src\/[^\\]*\.(test|spec)\.(js|ts)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  // Full-source ESLint over every test file takes tens of seconds on the shared
  // host; keep the budget local to the ratchet.
  it('only shrinks: every entry still offends, and no file outside it does', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        { ignores: ['src/shared/generated/**', 'src/shared/paraglide/**'] },
        { files: ['src/**/*.{ts,tsx}'], languageOptions: { parser: typescriptParser } },
        {
          files: ['**/*.{test,spec}.{js,ts}'],
          plugins: { intent: { rules: { 'no-source-literal-assertions-in-tests': rule } } },
          rules: { 'intent/no-source-literal-assertions-in-tests': ['error', { baseline: [] }] },
        },
      ],
      cache: false,
    });
    const results = await eslint.lintFiles(['src']);
    const offending = new Set();
    for (const result of results) {
      if (
        result.messages.some((m) => m.ruleId === 'intent/no-source-literal-assertions-in-tests')
      ) {
        offending.add(path.relative(root, result.filePath).split(path.sep).join('/'));
      }
    }

    const fixed = baseline.filter((file) => !offending.has(file));
    expect(fixed, 'remove these fixed files from the baseline').toEqual([]);
    const added = [...offending].filter((file) => !baseline.includes(file)).sort();
    expect(
      added,
      'new source-literal assertions; fix them instead of extending the baseline',
    ).toEqual([]);
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
      options: [{ baseline: ['src/features/example/__tests__/example.test.ts'] }],
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
      options: [{ baseline: ['src/features/example/__tests__/example.test.ts'] }],
      errors: [error('../Foo.svelte')],
    },
  ],
});
