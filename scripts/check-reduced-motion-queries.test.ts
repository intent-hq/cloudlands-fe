// @vitest-environment node
// @verify-changed-triggers: src/**/*.css, src/**/*.html, eslint-rules/no-direct-reduced-motion-query.js
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_CSS,
  MOTION_REDUCE_CONTAINER_QUERY,
  PROBE_CANDIDATES,
  auditCompiledMotionReduce,
  collectSourceFiles,
  compileMotionReduceProbe,
  findDirectQueryHits,
  isScannedPath,
} from './check-reduced-motion-queries.mjs';

const CUSTOM_VARIANT_LINE =
  '@custom-variant motion-reduce (@container style(--motion-reduced: 1));';
const directQueryCss =
  '.spin { animation: spin 1s; }\n@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }\n';

describe('reduced-motion query scan', () => {
  const fixtureRoots: string[] = [];
  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('collects css/html from every src/ directory, including generated/build/dist/paraglide', () => {
    const root = mkdtempSync(join(tmpdir(), 'reduced-motion-scan-'));
    fixtureRoots.push(root);
    const directories = ['ordinary', 'generated', 'build', 'dist', 'paraglide'];
    for (const directory of directories) {
      mkdirSync(join(root, 'src', directory), { recursive: true });
      writeFileSync(join(root, 'src', directory, 'probe.css'), directQueryCss);
    }
    mkdirSync(join(root, 'src', 'ordinary', '__tests__'), { recursive: true });
    writeFileSync(join(root, 'src', 'ordinary', '__tests__', 'probe.css'), directQueryCss);
    writeFileSync(join(root, 'src', 'ordinary', 'probe.test.css'), directQueryCss);

    const expected = directories.map((directory) => `src/${directory}/probe.css`).sort();
    const files = collectSourceFiles(root);
    expect(files.map((file) => file.path).sort()).toEqual(expected);
    expect(
      findDirectQueryHits(files)
        .map((hit) => hit.path)
        .sort(),
    ).toEqual(expected);
  });

  it('scans css and html under src/, skipping tests and the source-of-truth files', () => {
    expect(isScannedPath('src/lib/styles/chat-messages.css')).toBe(true);
    expect(isScannedPath('src/features/hud/hud.html')).toBe(true);
    expect(isScannedPath('src/shared/generated/theme.generated.css')).toBe(true);
    expect(isScannedPath('src/shared/paraglide/runtime.css')).toBe(true);
    expect(isScannedPath('src/lib/styles/tokens.css')).toBe(false);
    expect(isScannedPath('src/app.html')).toBe(false);
    expect(isScannedPath('src/lib/styles/__tests__/fixture.css')).toBe(false);
    expect(isScannedPath('src/lib/styles/probe.test.css')).toBe(false);
    expect(isScannedPath('src/lib/utils/reduced-motion.ts')).toBe(false);
    expect(isScannedPath('test/harness.html')).toBe(false);
  });

  it('reports each line spelling the direct query with its location', () => {
    const hits = findDirectQueryHits([
      { path: 'src/lib/styles/probe.css', content: directQueryCss },
      {
        path: 'src/other.html',
        content: '<style>\n  @media (prefers-reduced-motion) {}\n</style>',
      },
    ]);
    expect(hits).toEqual([
      {
        path: 'src/lib/styles/probe.css',
        line: 2,
        text: '@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }',
      },
      { path: 'src/other.html', line: 2, text: '@media (prefers-reduced-motion) {}' },
    ]);
  });

  it('accepts the container-query route', () => {
    expect(
      findDirectQueryHits([
        {
          path: 'src/lib/styles/probe.css',
          content: '@container style(--motion-reduced: 1) { .spin { animation: none; } }',
        },
      ]),
    ).toEqual([]);
  });

  it('passes on the migrated tree', () => {
    const files = collectSourceFiles(process.cwd());
    expect(files.length).toBeGreaterThan(0);
    expect(findDirectQueryHits(files)).toEqual([]);
  });
});

describe('compiled motion-reduce variant audit', () => {
  it('flags a utility emitted under the bare OS media query', () => {
    const { motionReduceRules, violations } = auditCompiledMotionReduce(
      '@media (prefers-reduced-motion: reduce) { .motion-reduce\\:transition-none { transition-property: none; } }',
    );
    expect(motionReduceRules).toBe(1);
    expect(violations).toEqual([
      {
        selector: '.motion-reduce\\:transition-none',
        wrapper: '@media (prefers-reduced-motion: reduce)',
      },
    ]);
  });

  it('flags a utility with no container-query wrapper', () => {
    const { violations } = auditCompiledMotionReduce(
      '@layer utilities { .motion-reduce\\:animate-none { animation: none; } }',
    );
    expect(violations.map((v) => v.wrapper)).toEqual(['no `@container` wrapper']);
  });

  it('accepts a utility nested under the --motion-reduced container query', () => {
    const { motionReduceRules, violations } = auditCompiledMotionReduce(
      `@layer utilities { @container ${MOTION_REDUCE_CONTAINER_QUERY} { .motion-reduce\\:animate-none { animation: none; } } }`,
    );
    expect(motionReduceRules).toBe(1);
    expect(violations).toEqual([]);
  });

  it('compiles the production stylesheet with every probe under the container query', async () => {
    const { motionReduceRules, violations } = auditCompiledMotionReduce(
      await compileMotionReduceProbe(),
    );
    expect(motionReduceRules).toBe(PROBE_CANDIDATES.length);
    expect(violations).toEqual([]);
  });

  it('fails when the @custom-variant override is dropped from app.css', async () => {
    const source = readFileSync(join(process.cwd(), APP_CSS), 'utf8');
    expect(source).toContain(CUSTOM_VARIANT_LINE);
    const { motionReduceRules, violations } = auditCompiledMotionReduce(
      await compileMotionReduceProbe({ source: source.replace(CUSTOM_VARIANT_LINE, '') }),
    );
    expect(motionReduceRules).toBe(PROBE_CANDIDATES.length);
    expect(violations.map((v) => v.wrapper)).toEqual(
      PROBE_CANDIDATES.map(() => '@media (prefers-reduced-motion: reduce)'),
    );
  });
});
