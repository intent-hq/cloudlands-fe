// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, eslint-rules/no-wall-clock-in-catalog-previews.js
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const RULE_ID = 'intent/no-wall-clock-in-catalog-previews';

// The actual eslint.config.js, so this proves what `pnpm run lint` enforces. The TS
// project is dropped so synthetic probes never build a TypeScript Program; the rule is
// syntax-only.
const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: [
    {
      files: ['**/*'],
      languageOptions: { parserOptions: { project: false, projectService: false } },
      rules: { '@typescript-eslint/no-floating-promises': 'off' },
    },
  ],
});

const CLOCK_READ = 'export const at = new Date(Date.now() - 18_000).toISOString();';
const svelte = (script: string) => `<script lang="ts">\n${script}\n</script>\n<div></div>\n`;

async function ruleHits(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  const messages = result?.messages ?? [];
  expect(
    messages.filter((m) => m.fatal),
    `${filePath} must parse under the real config`,
  ).toEqual([]);
  return messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.line);
}

describe('no-wall-clock-in-catalog-previews under the real eslint.config.js', () => {
  it.each([
    [
      'a catalog renderer',
      svelte(CLOCK_READ),
      'src/lib/component-catalog/renderers/Probe.svelte',
      2,
    ],
    ['a catalog fixture', CLOCK_READ, 'src/lib/component-catalog/subscription-rows/probe.ts', 1],
    ['a feature .preview.svelte', svelte(CLOCK_READ), 'src/features/probe/probe.preview.svelte', 2],
    ['a .preview.ts', CLOCK_READ, 'src/lib/components/layout/probe.preview.ts', 1],
  ])('reports a real-clock read in %s', async (_label, code, filePath, line) => {
    expect(await ruleHits(code, filePath)).toEqual([line]);
  });

  it.each([
    ['the catalog clock itself', CLOCK_READ, 'src/lib/component-catalog/catalog-clock.ts'],
    ['a catalog unit test', CLOCK_READ, 'src/lib/component-catalog/probe.test.ts'],
    ['a preview component test', CLOCK_READ, 'src/features/probe/probe.ct.spec.ts'],
    ['an ordinary component', svelte(CLOCK_READ), 'src/lib/components/ui/Probe.svelte'],
    ['an ordinary module', CLOCK_READ, 'src/lib/utils/probe.ts'],
  ])('leaves %s alone', async (_label, code, filePath) => {
    expect(await ruleHits(code, filePath)).toEqual([]);
  });
});
