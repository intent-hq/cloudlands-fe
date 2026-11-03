// @vitest-environment node
// Real-repository checks below pin discovery to Vitest's own inventory and the
// cloudlands-fe#4034 selection; rerun them when the config or those files move.
// @verify-changed-triggers: vitest.config.ts, .gitignore, scripts/gitignore-dir-excludes.mjs,
//   scripts/verify-unit-selection.mjs, scripts/build-i18n-bundle.mjs,
//   tests/unit/vite-production-i18n.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createVerificationPlan } from './verify-changed.mjs';
import { listDeclaredSuites, selectDeclaredSuites } from './verify-changed-triggers.mjs';
import { collectTestFiles } from './vitest-suite-files.mjs';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vitest-suite-files-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const CONFIG = [
  "import { defineConfig } from 'vitest/config';",
  'export default defineConfig({',
  "  test: { exclude: ['**/node_modules/**', 'test/**', 'tests/integration/**', '**/*.visual.spec.ts'] },",
  '});',
  '',
].join('\n');

const diskReader = [
  "import { readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const source = readFileSync(join(process.cwd(), 'scripts/build.mjs'), 'utf8');",
  '',
].join('\n');

describe('collectTestFiles', () => {
  it('finds every suite Vitest runs, not only scripts/ and src/, minus config excludes', () => {
    const root = fixture({
      'vitest.config.ts': CONFIG,
      'src/a.test.ts': '',
      'scripts/b.test.ts': '',
      'tests/unit/c.test.mjs': '',
      'tests/d.test.ts': '',
      'eslint-rules/e.test.js': '',
      'playwright/f.test.ts': '',
      'g.test.ts': '',
      '.github/h.test.ts': '',
      'tests/integration/excluded.test.ts': '',
      'test/excluded.spec.ts': '',
      'node_modules/pkg/excluded.test.ts': '',
      'src/excluded.visual.spec.ts': '',
      'src/excluded.ct.spec.ts': '',
    });
    expect(collectTestFiles(root).map((file) => file.path)).toEqual([
      '.github/h.test.ts',
      'eslint-rules/e.test.js',
      'g.test.ts',
      'playwright/f.test.ts',
      'scripts/b.test.ts',
      'src/a.test.ts',
      'tests/d.test.ts',
      'tests/unit/c.test.mjs',
    ]);
  });

  it('applies the .gitignore directory excludes the config spreads in', () => {
    const root = fixture({
      'vitest.config.ts': [
        "import path from 'path';",
        "import { defineConfig } from 'vitest/config';",
        "import { gitignoreDirExcludes } from './scripts/gitignore-dir-excludes.mjs';",
        'export default defineConfig({',
        "  test: { exclude: ['**/node_modules/**', ...gitignoreDirExcludes(path.join(__dirname, '.gitignore'))] },",
        '});',
        '',
      ].join('\n'),
      '.gitignore': '.wt-*/\nscratch/\n',
      'tests/unit/kept.test.ts': '',
      '.wt-probe/tests/unit/copy.test.ts': '',
      'scratch/probe.test.ts': '',
    });
    expect(collectTestFiles(root).map((file) => file.path)).toEqual(['tests/unit/kept.test.ts']);
  });

  it('lets the trigger index select and audit suites under tests/unit', () => {
    const root = fixture({
      'vitest.config.ts': CONFIG,
      'tests/unit/declared.test.mjs': `// @verify-changed-triggers: scripts/build.mjs\n${diskReader}`,
      'tests/unit/undeclared.test.ts': diskReader,
    });
    const { suites, violations } = listDeclaredSuites(root);
    expect(selectDeclaredSuites(suites, ['scripts/build.mjs'])).toEqual([
      'tests/unit/declared.test.mjs',
    ]);
    expect(violations.map((entry) => entry.path)).toEqual(['tests/unit/undeclared.test.ts']);
  });
});

describe('real repository', () => {
  // cloudlands-fe#4034: editing the bundle script passed verify:changed locally
  // without this suite, then the suite failed in CI.
  it('selects the tests/unit i18n production suite when scripts/build-i18n-bundle.mjs changes', () => {
    const plan = createVerificationPlan(['scripts/build-i18n-bundle.mjs']);
    const declared = plan.checks.find((check) => check.id === 'vitest-declared');
    expect(declared?.args).toContain('tests/unit/vite-production-i18n.test.mjs');
  });

  // The scan reads vitest.config.ts statically; resolve the inventory with the
  // installed runner so a config shape the reader misses cannot drift silently.
  it('audits exactly the files Vitest resolves for the unit config', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'vitest-suite-inventory-'));
    try {
      const output = path.join(directory, 'files.json');
      const result = spawnSync(
        process.execPath,
        ['scripts/verify-unit-selection.mjs', output, 'run', '--config', 'vitest.config.ts'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 150_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const resolved: string[] = JSON.parse(readFileSync(output, 'utf8'));
      const audited = collectTestFiles(process.cwd()).map((file) => file.path);
      const auditedSet = new Set(audited);
      const resolvedSet = new Set(resolved);
      expect({
        runByVitestButNotAudited: resolved.filter((file) => !auditedSet.has(file)).sort(),
        auditedButNotRunByVitest: audited.filter((file) => !resolvedSet.has(file)),
      }).toEqual({ runByVitestButNotAudited: [], auditedButNotRunByVitest: [] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
