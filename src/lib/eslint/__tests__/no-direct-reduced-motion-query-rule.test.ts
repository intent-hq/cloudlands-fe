// @vitest-environment node
// @verify-changed-triggers: eslint.config.js, eslint-rules/no-direct-reduced-motion-query.js
import { describe, expect, it } from 'vitest';
import { ESLint, type Linter } from 'eslint';

const RULE_ID = 'intent/no-direct-reduced-motion-query';

// The actual eslint.config.js (vitest runs from the package root), so the matrix
// below proves what `pnpm run lint` enforces rather than a copy that can drift.
// The main/preload block is type-aware; the override below drops the TS project
// so synthetic probes never build a TypeScript Program (slow and flaky on the
// memory-capped CI runner). The reduced-motion rule is syntax-only, so the
// matrix still proves its coverage.
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

const DIRECT_QUERY_SCRIPT =
  "export const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;";

async function lintCode(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal);
  expect(fatal, `${filePath} must parse under the real config`).toEqual([]);
  return messages.filter((m) => m.ruleId === RULE_ID);
}

const ruleHits = (messages: Linter.LintMessage[]) => messages.map((m) => [m.line, m.column]);

const svelte = (script: string, style = '') =>
  `<script lang="ts">\n${script}\n</script>\n<div></div>\n${style ? `<style>\n${style}\n</style>\n` : ''}`;

describe('no-direct-reduced-motion-query under the real eslint.config.js', () => {
  it.each(['js', 'mjs', 'jsx', 'ts', 'tsx', 'mts', 'cts'])(
    'reports one direct matchMedia query in a production .%s module',
    async (extension) => {
      const messages = await lintCode(DIRECT_QUERY_SCRIPT, `src/lib/utils/probe.${extension}`);
      expect(ruleHits(messages)).toEqual([[1, 44]]);
      expect(messages[0]?.message).toContain('battery mode');
      expect(messages[0]?.message).toContain('$lib/utils/reduced-motion');
    },
  );

  it('reports the query in Svelte script and in a Svelte <style> block', async () => {
    const [script, style] = await Promise.all([
      lintCode(
        svelte("const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;"),
        'src/lib/components/Probe.svelte',
      ),
      lintCode(
        svelte(
          'export const x = 1;',
          '.spin { animation: spin 1s; }\n@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }',
        ),
        'src/lib/components/Probe.svelte',
      ),
    ]);
    expect(ruleHits(script)).toEqual([[2, 30]]);
    expect(ruleHits(style)).toEqual([[7, 9]]);
  });

  it.each([
    'src/lib/utils/probe.generated.ts',
    'src/lib/utils/generated/probe.ts',
    'src/lib/components/generated/Probe.svelte',
    'src/features/example/probe.ts',
    'src/main/probe.ts',
    'src/preload/probe.ts',
    'src/shared/probe.ts',
    'src/routes/probe.ts',
    'src/lib/utils/reduced-motion-helpers/probe.ts',
  ])('reports the query in the unsanctioned production path %s', async (filePath) => {
    const code = filePath.endsWith('.svelte') ? svelte(DIRECT_QUERY_SCRIPT) : DIRECT_QUERY_SCRIPT;
    expect(await lintCode(code, filePath)).toHaveLength(1);
  });

  it('reports template literals, includes() probes, and every occurrence in one file', async () => {
    const [template, probe, multiple] = await Promise.all([
      lintCode(
        'export const q = `(prefers-reduced-motion: ${"reduce"})`;',
        'src/lib/utils/probe.ts',
      ),
      lintCode(
        "export const isMotion = (q: string) => q.includes('prefers-reduced-motion');",
        'src/lib/utils/probe.ts',
      ),
      lintCode(
        [
          "const a = matchMedia('(prefers-reduced-motion: reduce)');",
          "const b = matchMedia('(prefers-reduced-motion: no-preference)');",
          'export { a, b };',
        ].join('\n'),
        'src/lib/utils/probe.ts',
      ),
    ]);
    expect(template).toHaveLength(1);
    expect(probe).toHaveLength(1);
    expect(multiple.map((m) => m.line)).toEqual([1, 2]);
  });

  it('matches the media feature case-insensitively in script and Svelte <style>', async () => {
    const [script, style] = await Promise.all([
      lintCode(
        "export const r = matchMedia('(PREFERS-REDUCED-MOTION: reduce)').matches;",
        'src/lib/utils/probe.ts',
      ),
      lintCode(
        svelte(
          'export const x = 1;',
          '@media (Prefers-Reduced-Motion: reduce) { .a { animation: none; } }',
        ),
        'src/lib/components/Probe.svelte',
      ),
    ]);
    expect(ruleHits(script)).toEqual([[1, 31]]);
    expect(ruleHits(style)).toEqual([[6, 9]]);
  });

  it('ignores Svelte HTML comments and <style> comments but not the query next to them', async () => {
    const commentsOnly = [
      '<script lang="ts">',
      '/* script prefers-reduced-motion */',
      'export const x = 1;',
      '</script>',
      '<!-- markup prefers-reduced-motion -->',
      '<div>',
      '  <!-- nested PREFERS-REDUCED-MOTION -->',
      '</div>',
      '<style>',
      '/* style prefers-reduced-motion',
      '   spans lines */',
      '.a { color: red; } /* trailing prefers-reduced-motion */',
      '</style>',
    ].join('\n');
    const withQuery = commentsOnly.replace(
      '.a { color: red; }',
      '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
    );
    const [clean, hit] = await Promise.all([
      lintCode(commentsOnly, 'src/lib/components/Probe.svelte'),
      lintCode(withQuery, 'src/lib/components/Probe.svelte'),
    ]);
    expect(clean).toEqual([]);
    expect(ruleHits(hit)).toEqual([[12, 9]]);
  });

  it('allows the container-query route, the shared helper, and comments', async () => {
    const [helper, container, comments] = await Promise.all([
      lintCode(
        "import { prefersReducedMotion } from '$lib/utils/reduced-motion';\nexport const r = prefersReducedMotion();",
        'src/lib/utils/probe.ts',
      ),
      lintCode(
        svelte(
          'export const x = 1;',
          '@container style(--motion-reduced: 1) { .spin { animation: none; } }',
        ),
        'src/lib/components/Probe.svelte',
      ),
      lintCode(
        '// mirrors prefers-reduced-motion via --motion-reduced\n/* prefers-reduced-motion */\nexport const x = 1;',
        'src/lib/utils/probe.ts',
      ),
    ]);
    expect(helper).toEqual([]);
    expect(container).toEqual([]);
    expect(comments).toEqual([]);
  });

  it.each([
    'src/lib/utils/reduced-motion.ts',
    'src/lib/utils/reduced-motion-battery.ts',
    'src/lib/constants/specialists.ts',
    'src/features/example/example.test.ts',
    'src/features/example/example.ct.spec.ts',
    'src/features/example/__tests__/helpers/visual-state.ts',
    'src/features/example/tests/fixture.ts',
    'src/lib/utils/__tests__/message-render-corpus/goldens/probe.ts',
  ])('exempts the sanctioned exception %s', async (filePath) => {
    expect(await lintCode(DIRECT_QUERY_SCRIPT, filePath)).toEqual([]);
  });

  it('never lints outside src/ or the globally ignored .cjs extension', async () => {
    expect(await lintCode(DIRECT_QUERY_SCRIPT, 'e2e/probe.ts')).toEqual([]);
    expect(await eslint.isPathIgnored('src/lib/utils/probe.cjs')).toBe(true);
  });
});
