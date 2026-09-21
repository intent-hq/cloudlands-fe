// @vitest-environment node
import path from 'node:path';
import { RuleTester, ESLint } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import typescriptParser from '@typescript-eslint/parser';
import { expect, it } from 'vitest';
import rule from './no-uppercase.js';
import cssParser from './css-parser.js';

const errors = [{ messageId: 'sentenceCase' }];
new RuleTester({ languageOptions: { parser: svelteParser } }).run('no-uppercase Svelte', rule, {
  valid: [
    '<p class="type-caption font-medium">Settings change</p>',
    '<p>PR</p><style>/* text-transform: uppercase */ p { text-transform: none; }</style>',
    '<p title="uppercase">Label</p>',
  ],
  invalid: [
    { code: '<p class="uppercase">Label</p>', errors },
    { code: '<p class="hover:uppercase">Label</p>', errors },
    { code: '<p class:uppercase={true}>Label</p>', errors },
    { code: '<p class={true ? "uppercase" : "normal-case"}>Label</p>', errors },
    { code: '<style>p { text-transform: uppercase; }</style>', errors },
    { code: '<style>p { text-transform: /* label */ UPPERCASE !important; }</style>', errors },
  ],
});
new RuleTester({ languageOptions: { parser: typescriptParser } }).run('no-uppercase TS', rule, {
  valid: ['const initials = name.toUpperCase();', 'const className = "type-caption";'],
  invalid: [
    { code: 'const className = "font-medium uppercase";', errors },
    { code: 'const className = `uppercase ${extra}`;', errors },
  ],
});
new RuleTester({ languageOptions: { parser: cssParser } }).run('no-uppercase CSS', rule, {
  valid: [{ filename: 'src/theme.css', code: '/* text-transform: uppercase */ p { color: red; }' }],
  invalid: [{ filename: 'src/theme.css', code: 'p { text-transform: uppercase; }', errors }],
});
it('enables the rule for source CSS through the repository config', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText('p { text-transform: uppercase; }', {
    filePath: path.resolve('src/uppercase-fixture.css'),
  });
  expect(result.messages.map((message) => message.ruleId)).toEqual(['intent/no-uppercase']);
});
