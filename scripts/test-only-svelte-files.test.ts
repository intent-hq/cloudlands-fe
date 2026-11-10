// @verify-changed-triggers: knip.jsonc
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripJsonc } from './check-dead-code-lib.mjs';
import { isTestOnlySvelteFile, TEST_ONLY_SVELTE_SUFFIXES } from './test-only-svelte-files.mjs';

const knipConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../knip.jsonc');

function knipTestOnlySvelteGlobs(): string[] {
  const config = JSON.parse(stripJsonc(readFileSync(knipConfigPath, 'utf8'))) as {
    project: string[];
  };
  return config.project.filter((entry) => /^!src\/\*\*\/\*\{.*\}\.svelte!$/.test(entry));
}

describe('test-only Svelte file endings', () => {
  it('match the endings knip.jsonc excludes from its production pass', () => {
    expect(knipTestOnlySvelteGlobs()).toEqual([
      `!src/**/*{${TEST_ONLY_SVELTE_SUFFIXES.join(',')}}.svelte!`,
    ]);
  });

  it.each(TEST_ONLY_SVELTE_SUFFIXES)('treat a file ending in %s as test-only', (suffix) => {
    expect(isTestOnlySvelteFile(`src/lib/components/ui/Widget${suffix}.svelte`)).toBe(true);
  });

  it.each([
    'src/lib/components/ui/Button.svelte',
    'src/lib/components/ui/button.preview.svelte',
    'src/lib/components/ui/HarnessPanel.svelte',
    'src/lib/components/ui/ContestHost.svelte',
    'src/lib/components/ui/WidgetHarness.ts',
  ])('treat %s as production', (file) => {
    expect(isTestOnlySvelteFile(file)).toBe(false);
  });
});
