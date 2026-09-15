import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import noDirectReducedMotionQueryRule, {
  SOURCE_OF_TRUTH_FILES,
} from '../../../../eslint-rules/no-direct-reduced-motion-query.js';

const RULE_ID = 'intent/no-direct-reduced-motion-query';
const productionModuleIgnores = [
  '**/__tests__/**',
  '**/tests/**',
  '**/*.test.{js,jsx,ts,tsx,svelte}',
  '**/*.spec.{js,jsx,ts,tsx,svelte}',
  '**/*.generated.{js,jsx,ts,tsx,svelte}',
  '**/generated/**',
];

async function lintCode(code: string, filePath = 'src/features/example/example.ts') {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: typescriptParser as any,
          parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
      },
      {
        files: ['**/*.svelte'],
        languageOptions: {
          parser: svelteParser as any,
          parserOptions: {
            parser: typescriptParser as any,
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        },
      },
      {
        files: ['src/**/*.{js,ts,svelte}'],
        ignores: [...productionModuleIgnores, ...SOURCE_OF_TRUTH_FILES],
        plugins: {
          intent: { rules: { 'no-direct-reduced-motion-query': noDirectReducedMotionQueryRule } },
        },
        rules: { [RULE_ID]: 'error' },
      },
    ],
  });
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
}

const svelte = (script: string, style = '') =>
  `<script lang="ts">\n${script}\n</script>\n<div></div>\n${style ? `<style>\n${style}\n</style>\n` : ''}`;

describe('no-direct-reduced-motion-query ESLint rule', () => {
  it('reports a direct matchMedia query in a TypeScript module', async () => {
    const messages = await lintCode(
      "export const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
    );
    expect(messages.map((m) => [m.ruleId, m.line, m.column])).toEqual([[RULE_ID, 1, 44]]);
    expect(messages[0]?.message).toContain('battery mode');
    expect(messages[0]?.message).toContain('$lib/utils/reduced-motion');
  });

  it('reports the query in template literals, includes() probes, and Svelte script', async () => {
    const [template, probe, script] = await Promise.all([
      lintCode('export const q = `(prefers-reduced-motion: ${"reduce"})`;'),
      lintCode("export const isMotion = (q: string) => q.includes('prefers-reduced-motion');"),
      lintCode(
        svelte("const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;"),
        'src/lib/components/Probe.svelte',
      ),
    ]);
    expect(template.map((m) => m.ruleId)).toEqual([RULE_ID]);
    expect(probe.map((m) => m.ruleId)).toEqual([RULE_ID]);
    expect(script.map((m) => [m.ruleId, m.line])).toEqual([[RULE_ID, 2]]);
  });

  it('reports a direct @media query inside a Svelte <style> block', async () => {
    const messages = await lintCode(
      svelte(
        'export const x = 1;',
        '.spin { animation: spin 1s; }\n@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }',
      ),
      'src/lib/components/Probe.svelte',
    );
    expect(messages.map((m) => [m.ruleId, m.line])).toEqual([[RULE_ID, 7]]);
  });

  it('reports every occurrence in one file', async () => {
    const messages = await lintCode(
      [
        "const a = matchMedia('(prefers-reduced-motion: reduce)');",
        "const b = matchMedia('(prefers-reduced-motion: no-preference)');",
        'export { a, b };',
      ].join('\n'),
    );
    expect(messages.map((m) => m.line)).toEqual([1, 2]);
  });

  it('allows the container-query route and the shared helper', async () => {
    const [ts, style] = await Promise.all([
      lintCode(
        "import { prefersReducedMotion } from '$lib/utils/reduced-motion';\nexport const r = prefersReducedMotion();",
      ),
      lintCode(
        svelte(
          'export const x = 1;',
          '@container style(--motion-reduced: 1) { .spin { animation: none; } }',
        ),
        'src/lib/components/Probe.svelte',
      ),
    ]);
    expect(ts).toEqual([]);
    expect(style).toEqual([]);
  });

  it('allows the query in comments', async () => {
    const messages = await lintCode(
      '// mirrors prefers-reduced-motion via --motion-reduced\n/* prefers-reduced-motion */\nexport const x = 1;',
    );
    expect(messages).toEqual([]);
  });

  it('does not apply to the source-of-truth files or tests', async () => {
    const code = "export const q = '(prefers-reduced-motion: reduce)';";
    const results = await Promise.all(
      [
        'src/lib/utils/reduced-motion.ts',
        'src/lib/utils/reduced-motion-battery.ts',
        'src/lib/constants/specialists.ts',
        'src/features/example/example.test.ts',
        'src/features/example/example.ct.spec.ts',
        'src/lib/components/__tests__/helpers/visual-state.ts',
        'e2e/example.ts',
      ].map((filePath) => lintCode(code, filePath)),
    );
    expect(results.flat()).toEqual([]);
  });
});
