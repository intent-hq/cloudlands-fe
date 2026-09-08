// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import typescriptParser from '@typescript-eslint/parser';
import svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import {
  assertBaselineOnlyShrinks,
  baselineCounts,
  baselineFiles,
  readComparisonBaseline,
} from './baseline-ratchet.js';
import { namedColorAllowlist } from './common.js';
import { designSystemRules } from './index.js';

const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'eslint-rules/design-system/baseline.json')),
);
const ruleNames = Object.keys(designSystemRules).sort();
const enabledRules = Object.fromEntries(ruleNames.map((rule) => [`intent/${rule}`, 'error']));
enabledRules['intent/no-arbitrary-motion-or-color'] = ['error', { allowlist: namedColorAllowlist }];
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
        if (exception.files) {
          expect(exception.files).toEqual([...new Set(exception.files)].sort());
        } else {
          const countEntries = Object.entries(exception.counts);
          expect(countEntries.map(([file]) => file)).toEqual(
            countEntries.map(([file]) => file).sort(),
          );
          expect(countEntries.every(([, count]) => Number.isInteger(count) && count > 0)).toBe(
            true,
          );
        }
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

  // Full-source ESLint takes ~47s alone on the shared host, but exceeded 120s
  // while competing with the other shard workers. Keep this budget local to
  // the ratchet; a global timeout increase would hide unrelated hung tests.
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
    const current = Object.fromEntries(ruleNames.map((rule) => [rule, new Map()]));

    for (const result of results) {
      const file = path.relative(root, result.filePath).split(path.sep).join('/');
      for (const message of result.messages) {
        const rule = message.ruleId?.startsWith('intent/') ? message.ruleId.slice(7) : undefined;
        if (rule && current[rule]) {
          current[rule].set(file, (current[rule].get(file) ?? 0) + 1);
        }
      }
    }

    const additions = {};
    for (const rule of ruleNames) {
      const allowedCounts = baselineCounts(baseline[rule]);
      if (allowedCounts) {
        const increased = [...current[rule]]
          .filter(([file, count]) => count > (allowedCounts[file] ?? 0))
          .map(([file, count]) => ({ file, allowed: allowedCounts[file] ?? 0, current: count }));
        if (increased.length) additions[rule] = increased;
        continue;
      }
      const allowed = new Set(baselineFiles(baseline[rule]));
      const added = [...current[rule].keys()].filter((file) => !allowed.has(file)).sort();
      if (added.length) additions[rule] = added;
    }
    expect(additions).toEqual({});
  }, 240_000);
});
