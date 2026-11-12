// @vitest-environment node
// A baselined rule skips disabled lines so they do not use up a file's allowance. It
// must still report them: ESLint drops the report and marks the directive used. If the
// rule stays silent, reportUnusedDisableDirectives fails lint on a needed exception.
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import noClassNameAssertionsInTests from './no-class-name-assertions-in-tests.js';
import noFixedWaitTimeoutInTests from './no-fixed-wait-timeout-in-tests.js';
import noHoverThenClickInCt from './no-hover-then-click-in-ct.js';
import noSourceLiteralAssertionsInTests from './no-source-literal-assertions-in-tests.js';
import noWaitForTimeoutInCt from './no-wait-for-timeout-in-ct.js';
import noWallClockAssertionsInTests from './no-wall-clock-assertions-in-tests.js';

const cases = [
  {
    name: 'no-wait-for-timeout-in-ct',
    rule: noWaitForTimeoutInCt,
    filename: 'src/lib/components/example/example.ct.spec.ts',
    prelude: '',
    offending: 'await page.waitForTimeout(150);',
  },
  {
    name: 'no-hover-then-click-in-ct',
    rule: noHoverThenClickInCt,
    filename: 'src/lib/components/example/example.ct.spec.ts',
    prelude: 'await row.hover();\n',
    offending: "await row.getByRole('button', { name: 'Copy' }).click();",
  },
  {
    name: 'no-class-name-assertions-in-tests',
    rule: noClassNameAssertionsInTests,
    filename: 'src/features/example/__tests__/example.test.ts',
    prelude: '',
    offending: "expect(a.className).toContain('x');",
  },
  {
    name: 'no-fixed-wait-timeout-in-tests',
    rule: noFixedWaitTimeoutInTests,
    filename: 'src/features/example/__tests__/example.test.ts',
    header: "import { waitFor } from '@testing-library/svelte';\n",
    prelude: '',
    offending: 'await waitFor(check, { timeout: 3000 });',
  },
  {
    name: 'no-wall-clock-assertions-in-tests',
    rule: noWallClockAssertionsInTests,
    filename: 'src/features/example/__tests__/example.test.ts',
    prelude: '',
    offending: 'expect(Date.now() - start).toBeLessThan(500);',
  },
  {
    name: 'no-source-literal-assertions-in-tests',
    rule: noSourceLiteralAssertionsInTests,
    filename: 'src/features/example/__tests__/example.test.ts',
    prelude: '',
    offending: "readFileSync('../Foo.svelte', 'utf8');",
  },
];

const lint = ({ name, rule, filename, header = '' }, body, allowed = 0) =>
  new Linter().verify(
    `${header}test('example', async () => {\n${body}\n});`,
    [
      {
        files: ['**/*.ts'],
        plugins: { intent: { rules: { [name]: rule } } },
        rules: {
          [`intent/${name}`]: allowed ? ['error', { baseline: { [filename]: allowed } }] : 'error',
        },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
      },
    ],
    filename,
  );

describe.each(cases)('$name with reportUnusedDisableDirectives', (testCase) => {
  const directive = `// eslint-disable-next-line intent/${testCase.name} -- deliberate`;

  it('reports the finding without a directive', () => {
    const messages = lint(testCase, `${testCase.prelude}${testCase.offending}`);
    expect(messages.map((message) => message.ruleId)).toEqual([`intent/${testCase.name}`]);
  });

  it('treats a directive over a finding as used', () => {
    const messages = lint(testCase, `${testCase.prelude}${directive}\n${testCase.offending}`);
    expect(messages).toEqual([]);
  });

  it('treats a directive as used without spending the allowance', () => {
    const body = `${testCase.prelude}${directive}\n${testCase.offending}\n${testCase.offending}`;
    expect(lint(testCase, body, 1)).toEqual([]);
  });

  it('reports a directive over a clean line as unused', () => {
    const messages = lint(testCase, `${directive}\nconst clean = 1;`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: null, severity: 2 });
    expect(messages[0].message).toMatch(/Unused eslint-disable directive/);
  });
});
