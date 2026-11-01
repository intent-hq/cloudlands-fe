// @vitest-environment node
import path from 'node:path';
import { Linter, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { disableDirectives, suppressedLines } from './lib/disable-directives.js';
import rule from './require-disable-reason.js';

const filename = path.resolve('src/features/example/__tests__/example.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});
// Core rules stand in for the configured plugin rules, which RuleTester does not register.
const options = [{ rules: ['no-debugger'] }];
const missingReason = { messageId: 'missingReason' };
const notLineScoped = { messageId: 'notLineScoped' };

function sourceCodeOf(code) {
  const linter = new Linter();
  linter.verify(code, { languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
  return linter.getSourceCode();
}

describe('disable-directives', () => {
  it('reads kind, rules and reason the way ESLint does', () => {
    const directives = disableDirectives(
      sourceCodeOf(
        [
          'a(); // eslint-disable-line intent/x, no-console -- the reason',
          '// eslint-disable-next-line intent/x',
          'b();',
          '/* eslint-disable */',
          '/* eslint-enable */',
          '// eslint-disable -- line comments cannot open a block',
          'c(); // eslint-disable-line -- no rule list',
        ].join('\n'),
      ),
    );
    expect(directives.map(({ kind, rules, reason }) => ({ kind, rules, reason }))).toEqual([
      { kind: 'disable-line', rules: ['intent/x', 'no-console'], reason: 'the reason' },
      { kind: 'disable-next-line', rules: ['intent/x'], reason: '' },
      { kind: 'disable', rules: null, reason: '' },
      { kind: 'enable', rules: null, reason: '' },
      { kind: 'disable-line', rules: null, reason: 'no rule list' },
    ]);
  });

  it('maps line, next-line and block ranges to suppressed lines for one rule', () => {
    const suppressed = suppressedLines(
      sourceCodeOf(
        [
          'a(); // eslint-disable-line intent/x -- why',
          '// eslint-disable-next-line intent/x -- why',
          'b();',
          'c(); // eslint-disable-line intent/other -- why',
          '/* eslint-disable intent/x */',
          'd();',
          '/* eslint-enable intent/x */',
          'e();',
        ].join('\n'),
      ),
      'x',
    );
    expect([1, 2, 3, 4, 5, 6, 7, 8].filter(suppressed)).toEqual([1, 3, 5, 6, 7]);
  });
});

tester.run('require-disable-reason', rule, {
  valid: [
    {
      code: 'await w(); // eslint-disable-line no-debugger -- real daemon',
      filename,
      options,
    },
    {
      code: '// eslint-disable-next-line no-debugger -- real daemon\nawait w();',
      filename,
      options,
    },
    // Directives for rules outside the configured list are not checked.
    { code: 'a(); // eslint-disable-line no-console', filename, options },
    { code: '/* eslint-disable no-console */\na();', filename, options },
    // Plugin-prefixed names match by rule name.
    {
      code: 'a(); // eslint-disable-line no-debugger -- why',
      filename,
      options: [{ rules: ['intent/no-debugger'] }],
    },
  ],
  invalid: [
    {
      code: 'await w(); // eslint-disable-line no-debugger',
      filename,
      options,
      errors: [missingReason],
    },
    {
      code: '// eslint-disable-next-line no-console, no-debugger\nawait w();',
      filename,
      options,
      errors: [missingReason],
    },
    {
      code: 'await w(); // eslint-disable-line no-debugger --   ',
      filename,
      options,
      errors: [missingReason],
    },
    {
      code: '/* eslint-disable no-debugger -- whole file */\nawait w();',
      filename,
      options,
      errors: [notLineScoped],
    },
    // A directive that names no rule turns this one off too.
    {
      code: '// eslint-disable-next-line -- everything\nawait w();',
      filename,
      options,
      errors: [notLineScoped],
    },
  ],
});
