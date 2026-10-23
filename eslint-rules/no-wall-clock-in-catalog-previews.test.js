// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import typescriptParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-wall-clock-in-catalog-previews.js';

const tsFile = path.resolve('src/lib/component-catalog/subscription-rows/probe-fixtures.ts');
const svelteFile = path.resolve('src/lib/component-catalog/renderers/ProbeCatalogPreview.svelte');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const svelte = (script) => ({
  code: `<script lang="ts">\n${script}\n</script>\n<div></div>\n`,
  filename: svelteFile,
  languageOptions: { parser: svelteParser, parserOptions: { parser: typescriptParser } },
});

const error = (read, line = 1) => ({ messageId: 'wallClock', data: { read }, line });

describe('no-wall-clock-in-catalog-previews guidance', () => {
  it('names the read, cites the incident, and points at the catalog clock', () => {
    const message = rule.meta.messages.wallClock;
    expect(message).toContain('({{read}})');
    expect(message).toContain('"20s" instead of "18s"');
    expect(message).toContain('$lib/component-catalog/catalog-clock');
    expect(message).toContain('catalogTime()');
    expect(message).toContain('catalogNow()');
    expect(message).toContain('catalogStopwatch()');
  });

  it('takes no options: it is enforced at zero debt', () => {
    expect(rule.meta.schema).toEqual([]);
  });
});

tester.run('no-wall-clock-in-catalog-previews', rule, {
  valid: [
    { code: "const at = new Date('2026-09-01T11:59:42.000Z').toISOString();", filename: tsFile },
    { code: 'const at = new Date(1_000);', filename: tsFile },
    { code: 'const at = new Date(catalogNow() - 18_000);', filename: tsFile },
    { code: 'const elapsed = catalogStopwatch();', filename: tsFile },
    { code: "const parsed = Date.parse('2026-09-01');", filename: tsFile },
    { code: 'const now = clock.now();', filename: tsFile },
    svelte('  const at = catalogTime(-18_000);'),
  ],
  invalid: [
    // The incident: ToastCatalogPreview.svelte stamped its attention toast from the real clock.
    {
      ...svelte('  const timestamp = new Date(Date.now() - 18_000).toISOString();'),
      errors: [error('Date.now()', 2)],
    },
    { ...svelte('  const timestamp = new Date();'), errors: [error('new Date()', 2)] },
    { code: 'const fixtureNow = Date.now();', filename: tsFile, errors: [error('Date.now()')] },
    {
      code: 'const startedAt = performance.now();',
      filename: tsFile,
      errors: [error('performance.now()')],
    },
    {
      code: 'const a = globalThis.Date.now(); const b = window.performance.now();',
      filename: tsFile,
      errors: [error('globalThis.Date.now()'), error('window.performance.now()')],
    },
    { code: 'const ms = new Date().getTime();', filename: tsFile, errors: [error('new Date()')] },
    { code: 'const text = Date();', filename: tsFile, errors: [error('Date()')] },
  ],
});
