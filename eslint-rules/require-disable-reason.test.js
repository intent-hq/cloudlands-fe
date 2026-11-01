// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ESLint, Linter, RuleTester } from 'eslint';
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
          '/* eslint-disable-next-line',
          '   intent/x */',
          'd(); /* eslint-disable-line',
          '   intent/x */',
        ].join('\n'),
      ),
    );
    expect(directives.map(({ kind, rules, reason }) => ({ kind, rules, reason }))).toEqual([
      { kind: 'disable-line', rules: ['intent/x', 'no-console'], reason: 'the reason' },
      { kind: 'disable-next-line', rules: ['intent/x'], reason: '' },
      { kind: 'disable', rules: null, reason: '' },
      { kind: 'enable', rules: null, reason: '' },
      { kind: 'disable-line', rules: null, reason: 'no rule list' },
      // ESLint accepts a multi-line `disable-next-line` block but not a multi-line
      // `disable-line`.
      { kind: 'disable-next-line', rules: ['intent/x'], reason: '' },
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
          '/* eslint-disable-next-line',
          '   intent/x -- why */',
          'f();',
        ].join('\n'),
      ),
      'x',
    );
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(suppressed)).toEqual([1, 3, 5, 6, 7, 11]);
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
    // A multi-line block directive still needs its reason.
    {
      code: '/* eslint-disable-next-line\n   no-debugger */\nawait w();',
      filename,
      options,
      errors: [missingReason],
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

// The rules whose messages tell the reader to disable them on one line with a reason:
// for each, a reasoned disable is the sanctioned escape hatch, so this rule must check
// the directive wherever the rule runs.
function offersReasonedDisable(ruleModule) {
  return Object.values(ruleModule.meta?.messages ?? {}).some(
    (message) => /\bdisabl/i.test(message) && /\breason\b/i.test(message),
  );
}

function isOn(setting) {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== undefined && severity !== 0 && severity !== 'off';
}

describe('repository config', () => {
  const eslint = new ESLint();

  // A later config block's options for a rule replace an earlier block's for the same
  // file, so a block that lists only its own rule would silently drop the others.
  // Checking every tracked file catches that and a newly added reasoned-disable rule.
  it('checks the reason for exactly the enabled rules that offer a reasoned disable', async () => {
    const files = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs', '*.ts', '*.svelte'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    const offered = new Set();
    const mismatches = [];
    for (const file of files) {
      const config = await eslint.calculateConfigForFile(file);
      if (!config) continue;
      const pluginRules = config.plugins?.intent?.rules ?? {};
      const expected = Object.entries(pluginRules)
        .filter(
          ([name, ruleModule]) =>
            name !== 'require-disable-reason' && offersReasonedDisable(ruleModule),
        )
        .map(([name]) => `intent/${name}`)
        .filter((name) => {
          offered.add(name);
          return isOn(config.rules[name]);
        })
        .sort();
      const setting = config.rules['intent/require-disable-reason'];
      const checked = isOn(setting) ? [...(setting[1]?.rules ?? [])].sort() : [];
      if (JSON.stringify(checked) !== JSON.stringify(expected)) {
        mismatches.push({ file, checked, expected });
      }
    }
    // Guards the message scan itself: a reworded message must not drop a rule unnoticed.
    expect([...offered].sort()).toEqual([
      'intent/no-class-name-assertions-in-tests',
      'intent/no-fixed-wait-timeout-in-tests',
      'intent/no-hand-written-typing-check',
      'intent/no-one-shot-animation-count',
      'intent/no-raw-mouse-wheel-in-ct',
      'intent/no-unarmed-outside-click-in-ct',
      'intent/no-wait-for-timeout-in-ct',
    ]);
    expect(mismatches.slice(0, 10)).toEqual([]);
  }, 120_000);

  // The check the rule exists for: a bare disable for any of these rules fails `pnpm lint`.
  it.each([
    [
      'intent/no-one-shot-animation-count',
      'src/lib/components/example/__tests__/example.ct.spec.ts',
    ],
    [
      'intent/no-unarmed-outside-click-in-ct',
      'src/lib/components/example/__tests__/example.ct.spec.ts',
    ],
    ['intent/no-raw-mouse-wheel-in-ct', 'src/lib/components/example/__tests__/example.ct.spec.ts'],
    ['intent/no-wait-for-timeout-in-ct', 'src/lib/components/example/__tests__/example.ct.spec.ts'],
    ['intent/no-hand-written-typing-check', 'src/lib/components/example/example.ts'],
    ['intent/no-class-name-assertions-in-tests', 'src/features/example/__tests__/example.test.ts'],
    ['intent/no-fixed-wait-timeout-in-tests', 'src/features/example/__tests__/example.test.ts'],
    ['intent/no-fixed-wait-timeout-in-tests', 'scripts/example.test.mjs'],
  ])(
    'fails a bare disable of %s in %s',
    async (ruleName, file) => {
      const lint = async (directive) => {
        const [result] = await eslint.lintText(`${directive}\nexport const value = 1;\n`, {
          filePath: path.resolve(file),
        });
        return result.messages
          .filter((message) => message.ruleId === 'intent/require-disable-reason')
          .map(({ messageId, line, severity }) => ({ messageId, line, severity }));
      };
      expect(await lint(`// eslint-disable-next-line ${ruleName}`)).toEqual([
        { messageId: 'missingReason', line: 1, severity: 2 },
      ]);
      expect(await lint(`/* eslint-disable ${ruleName} -- whole file */`)).toEqual([
        { messageId: 'notLineScoped', line: 1, severity: 2 },
      ]);
      expect(await lint(`// eslint-disable-next-line ${ruleName} -- deliberate`)).toEqual([]);
    },
    120_000,
  );
});
