#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escape as escapeGlob, globSync } from 'glob';
import {
  CT_TEST_DIR,
  ctGeometryScene,
  hasCtSpecSuffix,
  isCtSpec,
} from '../playwright/ct-spec-pattern.mjs';
import { isIgnoredRootSpec, isRootSpec, ROOT_TEST_DIR } from '../playwright/root-spec-pattern.mjs';
import { checkDepsFresh, checkNodeSupport, ensureI18nFresh } from './check-deps-fresh.mjs';
import { isCtContractPath } from './ct-contract-paths.mjs';
import { gitignoreDirExcludes } from './gitignore-dir-excludes.mjs';
import { pnpmInvocation } from './pnpm-launcher.mjs';
import {
  acquireVerificationLock,
  ctLockKey,
  defaultLockPath,
  HELD_LOCK_ENV,
  lockTimeout,
} from './verification-lock.mjs';
import {
  listDeclaredSuites,
  selectDeclaredSuites,
  TRIGGER_MARKER,
} from './verify-changed-triggers.mjs';

export { acquireVerificationLock, defaultLockPath, lockTimeout };

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_PREFIX = 'packages/cloudlands-fe/';
const SKIP_DIRS = new Set([
  '.demo-artifacts',
  '.git',
  '.playwright-cli',
  '.svelte-kit',
  'build',
  'dist',
  'node_modules',
  'playwright-report',
  'test-reports',
]);
const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx']);
const LINT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx']);
const FORMAT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.scss',
  '.svelte',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const UNIT_TEST_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// Mirrors the runner-owned excludes in vitest.config.ts /
// tests/integration/vitest.integration.config.ts. Neither Playwright pattern is
// mirrored: `isCtSpec` and playwright-ct.config.ts both read
// playwright/ct-spec-pattern.mjs; `isRootSpec` / `isIgnoredRootSpec` and
// playwright.config.ts both read playwright/root-spec-pattern.mjs.
const VISUAL_TEST_RE = /\.visual\.spec\.ts$/;
const INTEGRATION_TEST_RE = /^tests\/integration\/.*\.test\.ts$/;
const VITEST_EXCLUDED_RE = /(?:^|\/)remote-(?:env|git)\.test\.ts$/;
const FULL_RISK_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'svelte.config.js',
  'vite.config.mjs',
  'vitest.config.ts',
]);
// Files that decide which root specs playwright.config.ts runs: the config and the
// modules it reads its testDir/testMatch/testIgnore from (root-spec-pattern.mjs
// builds on ct-spec-pattern.mjs's matchers). The pull_request workflow's root
// relevance step names the same set (`Evaluate root Playwright relevance`).
const ROOT_PLAYWRIGHT_CONFIG_FILES = new Set([
  'playwright.config.ts',
  'playwright/root-spec-pattern.mjs',
  'playwright/ct-spec-pattern.mjs',
]);

function slash(path) {
  return path.split(sep).join('/');
}

function canonicalExistingPath(path) {
  let candidate = path;
  while (true) {
    try {
      return realpathSync(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

function assertCanonicalPathInsideRoot(path, root, displayPath) {
  const canonicalRoot = realpathSync(root);
  const canonicalPath = canonicalExistingPath(path);
  const rel = relative(canonicalRoot, canonicalPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path is outside the frontend package: ${displayPath}`);
  }
}

export function parseArgs(argv) {
  const result = { base: null, dryRun: false, help: false, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--base' || arg.startsWith('--base=')) {
      const value = arg === '--base' ? argv[(index += 1)] : arg.slice('--base='.length);
      if (!value || value.startsWith('-')) throw new Error('missing value for option: --base');
      result.base = value;
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else result.paths.push(arg);
  }
  return result;
}

export function normalizeInputPath(input, root = REPO_ROOT) {
  let candidate = input.replaceAll('\\', '/').replace(/^\.\//, '');
  if (candidate.startsWith(FRONTEND_PREFIX)) candidate = candidate.slice(FRONTEND_PREFIX.length);
  const absolute = resolve(root, candidate);
  const rel = slash(relative(root, absolute));
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`path is outside the frontend package: ${input}`);
  }
  assertCanonicalPathInsideRoot(absolute, root, input);
  return rel || '.';
}

function walk(directory, root, files) {
  assertCanonicalPathInsideRoot(directory, root, slash(relative(root, directory)) || '.');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, root, files);
    else if (entry.isFile()) {
      assertCanonicalPathInsideRoot(absolute, root, slash(relative(root, absolute)));
      files.push(slash(relative(root, absolute)));
    }
  }
}

export function expandInputPaths(inputs, root = REPO_ROOT) {
  const files = [];
  for (const input of inputs) {
    const rel = normalizeInputPath(input, root);
    const absolute = resolve(root, rel);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) walk(absolute, root, files);
    else files.push(rel);
  }
  return [...new Set(files)].sort();
}

function gitNames(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((file) => slash(file));
}

const DEFAULT_BASE = 'origin/main';

function gitRevision(args, root) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function mergeBase(ref, root) {
  try {
    return gitRevision(['merge-base', ref, 'HEAD'], root);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(`cannot resolve --base ${ref}: ${detail}`, { cause: error });
  }
}

// True when HEAD has commits that `ref` does not; false when `ref` cannot be
// resolved (no remote-tracking ref, detached fixture), so the caller can fall
// back to the plain "nothing to verify" exit instead of throwing.
function isAheadOf(ref, root) {
  try {
    return mergeBase(ref, root) !== gitRevision(['rev-parse', 'HEAD'], root);
  } catch {
    return false;
  }
}

export function collectChangedFiles(root = REPO_ROOT, options = {}) {
  const files = [
    ...gitNames(['diff', '--name-only', '-z', '--diff-filter=ACMRTUXBD', 'HEAD', '--'], root),
    ...gitNames(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTUXBD', '--'], root),
    ...gitNames(['ls-files', '--others', '--exclude-standard', '-z'], root),
  ];
  if (options.base) {
    const base = mergeBase(options.base, root);
    files.push(
      ...gitNames(
        ['diff', '--name-only', '-z', '--diff-filter=ACMRTUXBD', base, 'HEAD', '--'],
        root,
      ),
    );
  }
  return [...new Set(files)].sort();
}

function listCtTests(root) {
  const files = [];
  walk(resolve(root, CT_TEST_DIR), root, files);
  return files.filter(isCtSpec);
}

function importTargets(source, testPath, root) {
  const targets = new Set();
  const importRe = /(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const aliases = {
      '$features/': 'src/features/',
      '$lib/': 'src/lib/',
      '$shared/': 'src/shared/',
      '$store/': 'src/store/',
    };
    const alias = Object.entries(aliases).find(([prefix]) => match[1].startsWith(prefix));
    if (!match[1].startsWith('.') && !alias) continue;
    const base = alias
      ? resolve(root, alias[1], match[1].slice(alias[0].length))
      : resolve(root, dirname(testPath), match[1]);
    for (const suffix of ['', '.svelte', '.ts', '.tsx', '.js', '.mjs']) {
      targets.add(slash(relative(root, `${base}${suffix}`)));
    }
  }
  return targets;
}

function geometrySnapshotTargets(testPath, root, readText) {
  const geometry = ctGeometryScene(testPath);
  if (!geometry) return new Set();
  const { directory, scene } = geometry;
  const targets = new Set([
    `${directory}__geometry__/${scene}.geometry.json`,
    ...['svelte', 'ts', 'tsx', 'js', 'mjs'].map(
      (extension) => `${directory}${scene}.preview.${extension}`,
    ),
    ...['svelte', 'ts', 'tsx', 'js', 'mjs'].map(
      (extension) => `${directory}${scene}.preview-fixtures.${extension}`,
    ),
  ]);

  for (const previewPath of [...targets].filter((path) => /\.preview\.[^.]+$/.test(path))) {
    if (!existsSync(resolve(root, previewPath))) continue;
    for (const imported of importTargets(readText(previewPath), previewPath, root)) {
      if (imported.endsWith('.svelte')) targets.add(imported);
    }
  }
  return targets;
}

// A CT spec usually mounts a host/harness `.svelte` that composes the component
// under test, so follow one hop through each directly imported `.svelte` file
// and add the `.svelte` files it imports (mirrors `geometrySnapshotTargets`).
function hostComponentTargets(targets, root, readText) {
  const hosted = new Set();
  for (const host of [...targets].filter((target) => target.endsWith('.svelte'))) {
    if (!existsSync(resolve(root, host))) continue;
    for (const imported of importTargets(readText(host), host, root)) {
      if (imported.endsWith('.svelte')) hosted.add(imported);
    }
  }
  return hosted;
}

export function findRelatedCtTests(files, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const ctTests = options.ctTests ?? listCtTests(root);
  const readText = options.readText ?? ((file) => readFileSync(resolve(root, file), 'utf8'));
  const sourceFiles = files.filter(
    (file) => CODE_EXTENSIONS.has(extname(file)) && !UNIT_TEST_RE.test(file),
  );
  const selected = new Set(
    files.filter((file) => testRunner(file) === 'ct' && existsSync(resolve(root, file))),
  );
  for (const test of ctTests) {
    if (selected.has(test)) continue;
    const targets = importTargets(readText(test), test, root);
    for (const hosted of hostComponentTargets(targets, root, readText)) targets.add(hosted);
    const geometryTargets = geometrySnapshotTargets(test, root, readText);
    if (files.some((file) => geometryTargets.has(file))) selected.add(test);
    else if (sourceFiles.some((file) => targets.has(file))) selected.add(test);
  }
  return [...selected].sort();
}

function isExisting(file, root) {
  return existsSync(resolve(root, file));
}

export function testRunner(file) {
  // Before UNIT_TEST_RE: Playwright discovers specs case-insensitively, so a
  // `.CT.SPEC.TS` under src/ or a `.SPEC.ts` under test/ is a Playwright spec
  // although no unit-test pattern sees it.
  if (isCtSpec(file)) return 'ct';
  if (isRootSpec(file)) return 'playwright';
  if (isIgnoredRootSpec(file)) return 'manual';
  if (!UNIT_TEST_RE.test(file)) return null;
  if (file.startsWith(`${ROOT_TEST_DIR}/`)) return 'manual';
  if (file.startsWith('tests/integration/')) {
    return INTEGRATION_TEST_RE.test(file) ? 'integration' : 'manual';
  }
  if (hasCtSpecSuffix(file)) return 'manual';
  if (VISUAL_TEST_RE.test(file) || VITEST_EXCLUDED_RE.test(file)) return 'manual';
  return 'vitest';
}

// Vitest's default `test.include`; vitest.config.ts does not override it.
const VITEST_INCLUDE_GLOB = '**/*.{test,spec}.?(c|m)[jt]s?(x)';

export function vitestExcludePatterns(root = REPO_ROOT, config = 'vitest.config.ts') {
  const configPath = resolve(root, config);
  if (!existsSync(configPath)) return [];
  const block = /\bexclude:\s*\[([\s\S]*?)\]/.exec(readFileSync(configPath, 'utf8'))?.[1] ?? '';
  const code = block
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return [...code.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function snapshotOwner(file, root) {
  // Vitest's default external snapshot path preserves the complete test basename.
  // Do not guess custom layouts or search for similarly named tests.
  if (basename(dirname(file)) !== '__snapshots__') return null;
  const owner = slash(join(dirname(dirname(file)), basename(file, '.snap')));
  const runner = testRunner(owner);
  if (!runner || runner === 'manual' || !CODE_EXTENSIONS.has(extname(owner))) return null;
  try {
    assertCanonicalPathInsideRoot(resolve(root, owner), root, owner);
    if (!statSync(resolve(root, owner), { throwIfNoEntry: false })?.isFile()) return null;
  } catch {
    return null;
  }

  const exclude =
    runner === 'vitest'
      ? vitestExcludePatterns(root)
      : runner === 'integration'
        ? vitestExcludePatterns(root, 'tests/integration/vitest.integration.config.ts')
        : ['**/node_modules/**'];
  const gitignore = resolve(root, '.gitignore');
  // Only the unit config derives exclusions from .gitignore. The integration
  // config has its own excludes; both Playwright configs set an explicit testDir.
  if (runner === 'vitest' && existsSync(gitignore)) {
    exclude.push(...gitignoreDirExcludes(gitignore));
  }
  const matches = globSync(escapeGlob(owner, { windowsPathsNoEscape: true }), {
    cwd: root,
    ignore: exclude,
    nodir: true,
    dot: true,
    posix: true,
  });
  return matches.includes(owner) ? owner : null;
}

function hasRunnableUnitTests(directory, root, exclude) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return false;
  const literalDirectory = escapeGlob(directory, { windowsPathsNoEscape: true });
  return globSync(`${literalDirectory}/${VITEST_INCLUDE_GLOB}`, {
    cwd: root,
    ignore: exclude,
    nodir: true,
    posix: true,
  }).some((file) => testRunner(file) === 'vitest');
}

function survivingUnitTestDirectory(file, root, exclude) {
  const directory = dirname(file);
  return directory !== '.' && hasRunnableUnitTests(directory, root, exclude) ? directory : null;
}

function isLintable(file) {
  if (!LINT_EXTENSIONS.has(extname(file))) return false;
  return !/^(?:e2e|test)\//.test(file);
}

function isKnownNonCode(file) {
  return (
    file === 'AGENTS.md' ||
    file.startsWith('docs/') ||
    file.startsWith('messages/') ||
    file.startsWith('static/') ||
    ['.css', '.html', '.json', '.md', '.scss', '.svg', '.yaml', '.yml'].includes(extname(file))
  );
}

function isArchitectureSource(file) {
  return (
    (file.startsWith('src/') && CODE_EXTENSIONS.has(extname(file))) ||
    /^scripts\/check-[^/]+\.mjs$/.test(file) ||
    file === 'scripts/type-check.ts' ||
    basename(file) === 'AGENTS.md'
  );
}

function isRendererSource(file) {
  return (
    file.startsWith('src/') &&
    !file.startsWith('src/main/') &&
    !file.startsWith('src/preload/') &&
    !/^src\/features\/[^/]+\/main\//.test(file) &&
    (CODE_EXTENSIONS.has(extname(file)) || extname(file) === '.css') &&
    !UNIT_TEST_RE.test(file)
  );
}

function addBoundary(boundaries, file) {
  if (!file.startsWith('src/')) return;
  if (file.startsWith('src/shared/')) {
    boundaries.add('renderer');
    boundaries.add('main');
    boundaries.add('preload');
  } else if (file.startsWith('src/preload/')) boundaries.add('preload');
  else if (file.startsWith('src/main/') || /^src\/features\/[^/]+\/main\//.test(file)) {
    boundaries.add('main');
  } else boundaries.add('renderer');
}

function command(id, label, args, lockKind = null) {
  return {
    id,
    label,
    executable: 'pnpm',
    args,
    lockKind,
  };
}

export function createVerificationPlan(files, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const declared = options.declaredSuites
    ? { suites: options.declaredSuites, violations: [] }
    : listDeclaredSuites(root);
  const existing = files.filter((file) => isExisting(file, root));
  const formatFiles = existing.filter((file) => FORMAT_EXTENSIONS.has(extname(file)));
  const lintFiles = existing.filter(isLintable);
  const snapshots = new Map(
    files
      .filter((file) => extname(file) === '.snap')
      .map((file) => [file, snapshotOwner(file, root)]),
  );
  const testFiles = [...new Set([...existing, ...[...snapshots.values()].filter(Boolean)])];
  const directTests = (runner) => testFiles.filter((file) => testRunner(file) === runner);
  const directCt = directTests('ct');
  const directIntegration = directTests('integration');
  const directPlaywright = directTests('playwright');
  const deletedUnitTests = files.filter(
    (file) => testRunner(file) === 'vitest' && !isExisting(file, root),
  );
  const vitestExclude = deletedUnitTests.length ? vitestExcludePatterns(root) : [];
  const deletedUnitDirectories = deletedUnitTests
    .map((file) => survivingUnitTestDirectory(file, root, vitestExclude))
    .filter(Boolean);
  const directUnit = [...new Set([...directTests('vitest'), ...deletedUnitDirectories])];
  const relatedSources = existing.filter(
    (file) =>
      /^(?:src|scripts|playwright)\//.test(file) &&
      CODE_EXTENSIONS.has(extname(file)) &&
      !UNIT_TEST_RE.test(file),
  );
  const uiInvariants = files.some(isRendererSource);
  const declaredUnit = selectDeclaredSuites(declared.suites, files).filter(
    (suite) => !directUnit.includes(suite),
  );
  let architecture = files.some(isArchitectureSource);
  const typeCheckWrapper = files.includes('scripts/type-check.ts');
  const deadCode = files.some(
    (file) =>
      CODE_EXTENSIONS.has(extname(file)) ||
      file === 'knip.jsonc' ||
      file === 'package.json' ||
      /^tsconfig[^/]*\.json$/.test(file),
  );
  const boundaries = new Set();
  let svelteCheck = false;
  let fullUnit = false;
  let fullCt = false;
  let fullPlaywright = false;
  const fallbackReasons = [];

  for (const file of files) {
    // A resolved snapshot selects its runner above; it did not change source or types.
    if (snapshots.get(file)) continue;
    addBoundary(boundaries, file);
    if (file.endsWith('.svelte')) svelteCheck = true;
    if (file === 'tsconfig.json') boundaries.add('renderer');
    else if (file === 'tsconfig.main.json') boundaries.add('main');
    else if (file === 'tsconfig.preload.json') boundaries.add('preload');
    else if (ROOT_PLAYWRIGHT_CONFIG_FILES.has(file)) fullPlaywright = true;
    else if (file === 'vitest.config.ts') fullUnit = true;
    // Shared with the pull_request workflow's test-ct relevance step.
    if (isCtContractPath(file)) fullCt = true;

    const known =
      CODE_EXTENSIONS.has(extname(file)) ||
      isKnownNonCode(file) ||
      file === 'knip.jsonc' ||
      /^(?:scripts|tests\/integration)\//.test(file) ||
      /^(?:eslint|playwright|postcss|prettier|svelte|tailwind|tsconfig|vite|vitest)[^/]*\./.test(
        file,
      );
    if (snapshots.has(file) || FULL_RISK_FILES.has(file) || !known) {
      fallbackReasons.push(file);
      architecture = true;
      fullUnit = true;
      boundaries.add('renderer');
      boundaries.add('main');
      boundaries.add('preload');
      svelteCheck = true;
    }
  }

  const checks = [];
  if (formatFiles.length)
    checks.push(
      command('prettier', 'Prettier (changed files)', [
        'exec',
        'prettier',
        '--check',
        ...formatFiles,
      ]),
    );
  if (lintFiles.length)
    checks.push(command('eslint', 'ESLint (changed files)', ['exec', 'eslint', ...lintFiles]));
  if (architecture)
    checks.push(
      command('architecture', 'Architecture gates (repo-wide static scans)', [
        'run',
        'lint:architecture',
      ]),
    );
  if (typeCheckWrapper)
    checks.push(
      command('type-check-validate', 'Type check (validate wrapper)', [
        'run',
        'type-check:validate',
      ]),
    );
  if (deadCode)
    checks.push(command('knip', 'Dead code (knip, repo-wide)', ['run', 'lint:dead-code']));
  if (fullUnit)
    checks.push(
      command(
        'vitest-full',
        'Vitest unit suite (safe fallback)',
        ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', '--maxWorkers=1'],
        'vitest-full',
      ),
    );
  else {
    if (directUnit.length) {
      checks.push(
        command('vitest-direct', 'Vitest (changed tests)', [
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.config.ts',
          ...directUnit,
        ]),
      );
    }
  }
  // The unit fallback excludes integration tests, so it cannot replace this lane.
  if (directIntegration.length) {
    checks.push(
      command('vitest-integration', 'Vitest integration (changed tests)', [
        'exec',
        'vitest',
        'run',
        '--config',
        'tests/integration/vitest.integration.config.ts',
        ...directIntegration,
      ]),
    );
  }
  if (!fullUnit) {
    if (relatedSources.length) {
      checks.push(
        command('vitest-related', 'Vitest (tests related to changed sources)', [
          'exec',
          'vitest',
          'related',
          '--run',
          '--config',
          'vitest.config.ts',
          ...relatedSources,
        ]),
      );
    }
    if (declaredUnit.length) {
      checks.push(
        command('vitest-declared', 'Vitest (suites declaring changed paths as triggers)', [
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.config.ts',
          ...declaredUnit,
        ]),
      );
    }
    if (uiInvariants) {
      checks.push(
        command('vitest-ui-invariants', 'Vitest UI invariants (repo-wide ratchets)', [
          'run',
          'test:ui-invariants',
        ]),
      );
    }
  }

  const relatedCt = fullCt
    ? []
    : findRelatedCtTests([...files, ...directCt], {
        root,
        ctTests: options.ctTests,
        readText: options.readText,
      });
  if (fullCt)
    checks.push(
      command('ct-full', 'Playwright component suite (safe fallback)', ['run', 'test:ct'], 'ct'),
    );
  else if (relatedCt.length) {
    checks.push(
      command(
        'ct-related',
        'Playwright component tests (colocated imports)',
        ['run', 'test:ct', '--', ...relatedCt],
        'ct',
      ),
    );
  }
  if (fullPlaywright)
    checks.push(
      command('playwright-full', 'Playwright browser suite (config changed)', [
        'run',
        'test:playwright',
      ]),
    );
  else if (directPlaywright.length) {
    checks.push(
      command('playwright-direct', 'Playwright browser tests (changed specs)', [
        'exec',
        'playwright',
        'test',
        ...directPlaywright,
      ]),
    );
  }
  if (svelteCheck) checks.push(command('svelte-check', 'Svelte check', ['run', 'check']));
  if (boundaries.has('renderer')) {
    checks.push(
      command('tsc-renderer', 'TypeScript (renderer)', [
        'exec',
        'tsc',
        '-p',
        'tsconfig.json',
        '--noEmit',
      ]),
    );
  }
  if (boundaries.has('main')) {
    checks.push(
      command('generate-build-config', 'Generate main build config (if missing)', [
        'run',
        'generate:build-config',
        '--',
        '--if-missing',
      ]),
      command('tsc-main', 'TypeScript (main)', [
        'exec',
        'tsc',
        '-p',
        'tsconfig.main.json',
        '--noEmit',
      ]),
    );
  }
  if (boundaries.has('preload')) {
    checks.push(
      command('generate-ipc-channels', 'Generate preload IPC channels', [
        'run',
        'generate:ipc-channels',
      ]),
      command('tsc-preload', 'TypeScript (preload)', [
        'exec',
        'tsc',
        '-p',
        'tsconfig.preload.json',
        '--noEmit',
      ]),
    );
  }
  return {
    files,
    checks,
    fallbackReasons: [...new Set(fallbackReasons)].sort(),
    triggerViolations: declared.violations.map((entry) => entry.path),
  };
}

export function verificationLockKey(check, env = process.env) {
  if (check.lockKind === 'vitest-full') return 'vitest-full';
  if (check.lockKind === 'ct') return ctLockKey(env);
  return null;
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

export function printPlan(plan, dryRun, log = console.log) {
  log(`verify:changed: ${plan.files.length} file(s)`);
  for (const file of plan.files) log(`  - ${file}`);
  if (plan.fallbackReasons.length) {
    log(`verify:changed: safe fallback for ${plan.fallbackReasons.join(', ')}`);
  }
  if (plan.triggerViolations?.length) {
    log(
      `verify:changed: warning: ${plan.triggerViolations.length} vitest suite(s) read the tree from disk without a ${TRIGGER_MARKER} header and are never selected here; see pnpm run lint:verify-changed-triggers`,
    );
  }
  log(`verify:changed: ${plan.checks.length} check(s)`);
  for (const check of plan.checks) {
    log(`  - ${check.label}: ${[check.executable, ...check.args].map(shellQuote).join(' ')}`);
  }
  if (dryRun) log('verify:changed: dry-run; no commands were run');
}

async function runCheck(check, root, { heldLock = null } = {}) {
  console.log(`\n[verify:changed] ${check.label}`);
  const launcher = pnpmInvocation(check.args);
  // A locked check spawns the CT launcher, which takes the same `ct-<port>`
  // lock for direct runs; tell it the lock is already held so it does not
  // wait on its own parent.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (heldLock) env[HELD_LOCK_ENV] = heldLock;
  await new Promise((resolveRun, reject) => {
    const child = spawn(launcher.executable, launcher.args, {
      cwd: root,
      stdio: 'inherit',
      shell: launcher.shell,
      env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        reject(
          new Error(
            `${check.label} failed${signal ? ` with ${signal}` : ` with exit code ${code ?? 1}`}`,
          ),
        );
    });
  });
}

export async function runVerificationPlan(plan, root, options = {}) {
  const env = options.env ?? process.env;
  const run = options.runCheck ?? runCheck;
  const acquireLock = options.acquireLock ?? acquireVerificationLock;
  const lockPath = options.lockPath ?? defaultLockPath;
  const log = options.log ?? console.log;

  for (const check of plan.checks) {
    const lockKey = verificationLockKey(check, env);
    if (!lockKey) {
      await run(check, root);
      continue;
    }

    const timeoutMs = lockTimeout(lockKey, env.VERIFY_CHANGED_LOCK_TIMEOUT_MS);
    log(`\n[verify:changed] waiting up to ${timeoutMs}ms for ${lockKey} lock`);
    const releaseLock = await acquireLock({
      lockPath: lockPath(lockKey),
      timeoutMs,
      cwd: root,
    });
    try {
      await run(check, root, { heldLock: lockKey });
    } finally {
      releaseLock();
    }
  }
}

export async function runCli(argv = process.argv.slice(2), root = REPO_ROOT, options = {}) {
  const log = options.log ?? console.log;
  const checkNode = options.checkNode ?? checkNodeSupport;
  const checkDeps = options.checkDeps ?? checkDepsFresh;
  const ensureI18n = options.ensureI18n ?? ensureI18nFresh;
  const runPlan = options.runPlan ?? runVerificationPlan;
  const args = parseArgs(argv);
  if (args.help) {
    log('Usage: pnpm run verify:changed -- [--dry-run] [--base <ref>] [paths...]');
    log(
      `  With no paths: verifies the working-tree changes; when the worktree is clean and HEAD is ahead of ${DEFAULT_BASE}, defaults to --base ${DEFAULT_BASE}.`,
    );
    return 0;
  }
  let base = args.base;
  let files = args.paths.length
    ? expandInputPaths(args.paths, root)
    : collectChangedFiles(root, { base });
  if (!args.paths.length && !base && files.length === 0 && isAheadOf(DEFAULT_BASE, root)) {
    base = DEFAULT_BASE;
    log(`verify:changed: worktree clean; verifying commits since merge-base with ${base}`);
    files = collectChangedFiles(root, { base });
  }
  if (!args.paths.length && files.length === 0) {
    const hint = base
      ? ` and no files changed relative to the merge-base with ${base}`
      : `; pass --base ${DEFAULT_BASE} to verify this branch's commits against main`;
    log(`verify:changed: nothing to verify — the worktree is clean${hint}`);
    return 2;
  }
  const plan = createVerificationPlan(files, { root });
  printPlan(plan, args.dryRun, log);
  if (args.dryRun || plan.checks.length === 0) return 0;

  const node = checkNode({ root });
  if (!node.ok) throw new Error(node.reason);
  const deps = checkDeps(root);
  if (!deps.ok) throw new Error(deps.reason);
  const i18n = await ensureI18n(root);
  if (!i18n.ok) throw new Error(i18n.reason);
  await runPlan(plan, root);
  return 0;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[verify:changed] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}
