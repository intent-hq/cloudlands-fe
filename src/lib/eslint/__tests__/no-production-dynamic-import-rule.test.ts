import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';

import noProductionDynamicImportRule from '../../../../eslint-rules/no-production-dynamic-import.js';

const productionModuleFiles = ['src/**/*.{js,jsx,ts,tsx,svelte}'];
const productionModuleIgnores = [
  '**/__tests__/**',
  '**/tests/**',
  '**/*.test.{js,jsx,ts,tsx,svelte}',
  '**/*.spec.{js,jsx,ts,tsx,svelte}',
  '**/*.generated.{js,jsx,ts,tsx,svelte}',
  '**/generated/**',
  'src/preload/generated-channels.ts',
];

async function lintCode(code: string, filePath = 'src/features/example/example.ts') {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser: typescriptParser as any,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
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
        files: productionModuleFiles,
        ignores: productionModuleIgnores,
        plugins: {
          intent: {
            rules: {
              'no-production-dynamic-import': noProductionDynamicImportRule,
            },
          },
        },
        rules: {
          'intent/no-production-dynamic-import': 'error',
        },
      },
    ],
  });

  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return result?.messages ?? [];
}

describe('no-production-dynamic-import ESLint rule', () => {
  it('reports runtime dynamic imports in production TypeScript modules', async () => {
    const messages = await lintCode("const mod = await import('$lib/runtime');");

    expect(messages.map((message) => message.ruleId)).toEqual([
      'intent/no-production-dynamic-import',
    ]);
  });

  it('reports runtime dynamic imports in production Svelte modules', async () => {
    const messages = await lintCode(
      `<script lang="ts">\nconst mod = await import('$lib/runtime');\n</script>`,
      'src/routes/+page.svelte',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('intent/no-production-dynamic-import');
  });

  it('allows static imports and type-only import annotations', async () => {
    const messages = await lintCode(`
      import { runtime } from '$lib/runtime';
      import type { Runtime } from '$lib/runtime-types';
      type RuntimeModule = import('$lib/runtime-types').RuntimeModule;
      export const value: Runtime | RuntimeModule = runtime;
    `);

    expect(messages).toHaveLength(0);
  });

  it('allows import text inside strings and templates', async () => {
    const messages = await lintCode(`
      const text = "await import('$lib/runtime')";
      const template = \`const mod = import('$lib/runtime')\`;
      export const rewritten = text + template;
    `);

    expect(messages).toHaveLength(0);
  });

  it('does not apply to test, docs, e2e, or generated source', async () => {
    const [testMessages, docsMessages, e2eMessages, generatedMessages] = await Promise.all([
      lintCode("const mod = await import('$lib/runtime');", 'src/features/example/example.test.ts'),
      lintCode("const mod = await import('$lib/runtime');", 'docs/example.ts'),
      lintCode("const mod = await import('$lib/runtime');", 'e2e/example.ts'),
      lintCode("const mod = await import('$lib/runtime');", 'src/main/build-config.generated.ts'),
    ]);

    expect(testMessages).toHaveLength(0);
    expect(docsMessages).toHaveLength(0);
    expect(e2eMessages).toHaveLength(0);
    expect(generatedMessages).toHaveLength(0);
  });
});