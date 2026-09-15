import path from 'node:path';
import { RuleTester } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import rule from './no-raw-typography.js';

const tester = new RuleTester({ languageOptions: { parser: svelteParser } });
const filename = path.resolve('src/lib/components/settings/Example.svelte');
tester.run('no-raw-typography', rule, {
  valid: [
    { filename, code: '<p class="type-body font-medium!">Label</p>' },
    { filename, code: '<p class="type-caption" class:font-medium={active}>Label</p>' },
    { filename, code: '<p class={cn("type-body", active && "font-medium")}>Label</p>' },
    { filename, code: '<p title="text-xs">text-sm</p>' },
    {
      filename: path.resolve('src/features/example/Example.svelte'),
      code: '<p class="text-xs font-medium" />',
    },
  ],
  invalid: [
    ...['text-xs', 'text-sm', 'text-base', 'text-lg', 'md:text-xs!', '!text-sm', 'text-base/6'].map(
      (token) => ({ filename, code: `<p class="${token}" />`, errors: [{ messageId: 'rawSize' }] }),
    ),
    {
      filename,
      code: '<p class={active ? "text-xs" : "type-body"} />',
      errors: [{ messageId: 'rawSize' }],
    },
    {
      filename,
      code: '<p class={`type-body ${active ? "text-lg" : ""}`} />',
      errors: [{ messageId: 'rawSize' }],
    },
    { filename, code: '<p class:text-xs={active} />', errors: [{ messageId: 'rawSize' }] },
    { filename, code: '<p class="font-medium!" />', errors: [{ messageId: 'rawWeight' }] },
    {
      filename,
      code: '<div class="type-body"><p class="font-medium" /></div>',
      errors: [{ messageId: 'rawWeight' }],
    },
    {
      filename: path.resolve('src/routes/(app)/settings/+page.svelte'),
      code: '<p class="text-xs" />',
      errors: [{ messageId: 'rawSize' }],
    },
    {
      filename: path.resolve('src/lib/components/patterns/settings/Example.svelte'),
      code: '<p class="text-xs" />',
      errors: [{ messageId: 'rawSize' }],
    },
  ],
});
