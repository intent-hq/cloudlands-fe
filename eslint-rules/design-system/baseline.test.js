// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  baselineFiles,
  readComparisonBaseline,
} from './baseline-ratchet.js';
import { designSystemRules } from './index.js';

const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'eslint-rules/design-system/baseline.json')),
);
const ruleNames = Object.keys(designSystemRules).sort();
const enabledRules = Object.fromEntries(ruleNames.map((rule) => [`intent/${rule}`, 'error']));
const productionIgnores = [
  '**/__tests__/**',
  '**/tests/**',
  '**/*.{test,spec}.{js,jsx,ts,tsx,svelte}',
  '**/*.generated.{js,jsx,ts,tsx,svelte}',
  '**/generated/**',
];

describe('design-system ESLint baseline', () => {
  it('contains only owned, reasoned exceptions with sorted unique files', () => {
    expect(Object.keys(baseline).every((rule) => ruleNames.includes(rule))).toBe(true);
    for (const exceptions of Object.values(baseline)) {
      expect(exceptions.length).toBeGreaterThan(0);
      for (const exception of exceptions) {
        expect(exception.owner.trim()).not.toBe('');
        expect(exception.reason.trim()).not.toBe('');
        expect(exception.files).toEqual([...new Set(exception.files)].sort());
      }
      const files = baselineFiles(exceptions);
      expect(files).toEqual([...new Set(files)]);
    }
  });

  it('does not add entries relative to the CI base revision', () => {
    const comparison = readComparisonBaseline({ cwd: root });
    if (!comparison) return;
    expect(() => assertBaselineOnlyShrinks(comparison.baseline, baseline)).not.toThrow();
  });

  it('only shrinks: current violations never exceed the checked-in baseline', async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        { ignores: ['src/shared/generated/**', 'src/shared/paraglide/**'] },
        {
          files: ['src/**/*.{ts,tsx}'],
          languageOptions: { parser: typescriptParser },
        },
        {
          files: ['src/**/*.svelte'],
          languageOptions: {
            parser: svelteParser,
            parserOptions: { parser: typescriptParser, ecmaVersion: 2022, sourceType: 'module' },
          },
        },
        {
          files: ['src/**/*.{js,mjs,ts,tsx,svelte}'],
          ignores: productionIgnores,
          plugins: { intent: { rules: designSystemRules } },
          rules: enabledRules,
        },
      ],
      cache: false,
    });
    const results = await eslint.lintFiles(['src']);
    const current = Object.fromEntries(ruleNames.map((rule) => [rule, new Set()]));

    for (const result of results) {
      const file = path.relative(root, result.filePath).split(path.sep).join('/');
      for (const message of result.messages) {
        const rule = message.ruleId?.startsWith('intent/') ? message.ruleId.slice(7) : undefined;
        if (rule && current[rule]) current[rule].add(file);
      }
    }

    const additions = {};
    for (const rule of ruleNames) {
      const allowed = new Set(baselineFiles(baseline[rule]));
      const added = [...current[rule]].filter((file) => !allowed.has(file)).sort();
      if (added.length) additions[rule] = added;
    }
    expect(additions).toEqual({});
  }, 120_000);
});
