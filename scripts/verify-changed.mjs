#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const LINT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx']);
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
const CT_TEST_RE = /\.ct\.(?:test|spec)\.[cm]?[jt]sx?$/;
const FULL_RISK_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'svelte.config.js',
  'vite.config.mjs',
  'vitest.config.ts',
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
  const result = { dryRun: false, help: false, paths: [] };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
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

export function collectChangedFiles(root = REPO_ROOT) {
  const files = [
    ...gitNames(['diff', '--name-only', '-z', '--diff-filter=ACMRTUXBD', 'HEAD', '--'], root),
    ...gitNames(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTUXBD', '--'], root),
    ...gitNames(['ls-files', '--others', '--exclude-standard', '-z'], root),
  ];
  return [...new Set(files)].sort();
}

function listCtTests(root) {
  const files = [];
  walk(resolve(root, 'src'), root, files);
  return files.filter((file) => CT_TEST_RE.test(file));
}

function importTargets(source, testPath, root) {
  const targets = new Set();
  const importRe = /(?:from\s*|import\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    if (!match[1].startsWith('.')) continue;
    const base = resolve(root, dirname(testPath), match[1]);
    for (const suffix of ['', '.svelte', '.ts', '.tsx', '.js', '.mjs']) {
      targets.add(slash(relative(root, `${base}${suffix}`)));
    }
  }
  return targets;
}

export function findRelatedCtTests(files, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const ctTests = options.ctTests ?? listCtTests(root);
  const readText = options.readText ?? ((file) => readFileSync(resolve(root, file), 'utf8'));
  const sourceFiles = files.filter(
    (file) => CODE_EXTENSIONS.has(extname(file)) && !UNIT_TEST_RE.test(file),
  );
  const selected = new Set(files.filter((file) => CT_TEST_RE.test(file)));
  for (const test of ctTests) {
    if (selected.has(test)) continue;
    const targets = importTargets(readText(test), test, root);
    if (sourceFiles.some((file) => targets.has(file))) selected.add(test);
  }
  return [...selected].sort();
}

function isExisting(file, root) {
  return existsSync(resolve(root, file));
}

function isLintable(file) {
  if (!LINT_EXTENSIONS.has(extname(file))) return false;
  return !/^(?:scripts|e2e|test)\//.test(file) && !file.endsWith('.cjs');
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
    executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
    lockKind,
  };
}

export function createVerificationPlan(files, options = {}) {
  const root = options.root ?? REPO_ROOT;
  const existing = files.filter((file) => isExisting(file, root));
  const formatFiles = existing.filter((file) => FORMAT_EXTENSIONS.has(extname(file)));
  const lintFiles = existing.filter(isLintable);
  const directCt = files.filter((file) => CT_TEST_RE.test(file));
  const directIntegration = files.filter(
    (file) =>
      file.startsWith('tests/integration/') && UNIT_TEST_RE.test(file) && !CT_TEST_RE.test(file),
  );
  const directUnit = files.filter(
    (file) =>
      UNIT_TEST_RE.test(file) && !CT_TEST_RE.test(file) && !file.startsWith('tests/integration/'),
  );
  const relatedSources = existing.filter(
    (file) =>
      /^(?:src|scripts)\//.test(file) &&
      CODE_EXTENSIONS.has(extname(file)) &&
      !UNIT_TEST_RE.test(file),
  );
  const boundaries = new Set();
  let svelteCheck = false;
  let fullUnit = false;
  let fullCt = false;
  const fallbackReasons = [];

  for (const file of files) {
    addBoundary(boundaries, file);
    if (file.endsWith('.svelte')) svelteCheck = true;
    if (file === 'tsconfig.json') boundaries.add('renderer');
    else if (file === 'tsconfig.main.json') boundaries.add('main');
    else if (file === 'tsconfig.preload.json') boundaries.add('preload');
    else if (file === 'playwright-ct.config.ts' || file.startsWith('playwright/')) fullCt = true;
    else if (file === 'vitest.config.ts') fullUnit = true;

    const known =
      CODE_EXTENSIONS.has(extname(file)) ||
      isKnownNonCode(file) ||
      /^(?:scripts|tests\/integration)\//.test(file) ||
      /^(?:eslint|playwright|postcss|prettier|svelte|tailwind|tsconfig|vite|vitest)[^/]*\./.test(
        file,
      );
    if (FULL_RISK_FILES.has(file) || !known) {
      fallbackReasons.push(file);
      fullUnit = true;
      boundaries.add('renderer');
      boundaries.add('main');
      boundaries.add('preload');
      svelteCheck = true;
      if (file === 'package.json' || file === 'pnpm-lock.yaml') fullCt = true;
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
  if (fullUnit)
    checks.push(
      command(
        'vitest-full',
        'Vitest unit suite (safe fallback)',
        ['run', 'test:unit'],
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
      command('tsc-preload', 'TypeScript (preload)', [
        'exec',
        'tsc',
        '-p',
        'tsconfig.preload.json',
        '--noEmit',
      ]),
    );
  }
  return { files, checks, fallbackReasons: [...new Set(fallbackReasons)].sort() };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function verificationLockKey(check, env = process.env) {
  if (check.lockKind === 'vitest-full') return 'vitest-full';
  if (check.lockKind === 'ct') return `ct-${env.CT_PORT ? Number(env.CT_PORT) : 3100}`;
  return null;
}

export function defaultLockPath(lockKey) {
  const key = createHash('sha256')
    .update(`cloudlands-fe-verification:${lockKey}`)
    .digest('hex')
    .slice(0, 12);
  return join(tmpdir(), `intent-${key}.lock`);
}

export async function acquireVerificationLock(options = {}) {
  const lockPath = options.lockPath ?? defaultLockPath();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 250;
  const statLock = options.statLock ?? statSync;
  const token = randomUUID();
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, cwd: options.cwd ?? process.cwd(), token }),
      );
      return () => {
        try {
          const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
          if (owner.token === token) rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // A missing or replaced lock is not ours to remove.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale;
      let owner;
      try {
        owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
        stale = !processIsAlive(owner.pid);
      } catch {
        try {
          stale = Date.now() - statLock(lockPath).mtimeMs > 4 * 60 * 60 * 1000;
        } catch (statError) {
          if (statError?.code === 'ENOENT') continue;
          throw statError;
        }
      }
      if (stale) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        const waitedMs = Date.now() - started;
        const ownerDetails = owner
          ? `owner pid ${owner.pid} cwd ${owner.cwd ?? '<unknown>'}`
          : 'owner metadata unavailable';
        throw new Error(`verification lock ${lockPath}: ${ownerDetails}; waited ${waitedMs}ms`, {
          cause: error,
        });
      }
      await new Promise((done) => setTimeout(done, pollMs));
    }
  }
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
  log(`verify:changed: ${plan.checks.length} check(s)`);
  for (const check of plan.checks) {
    log(`  - ${check.label}: ${[check.executable, ...check.args].map(shellQuote).join(' ')}`);
  }
  if (dryRun) log('verify:changed: dry-run; no commands were run');
}

async function runCheck(check, root) {
  console.log(`\n[verify:changed] ${check.label}`);
  await new Promise((resolveRun, reject) => {
    const child = spawn(check.executable, check.args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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

export function lockTimeout(lockKey, envValue) {
  const value = Number(envValue);
  const defaultMs = lockKey.startsWith('ct-') ? 240_000 : 120_000;
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 300_000) : defaultMs;
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
      await run(check, root);
    } finally {
      releaseLock();
    }
  }
}

export async function runCli(argv = process.argv.slice(2), root = REPO_ROOT) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: pnpm run verify:changed -- [--dry-run] [paths...]');
    return;
  }
  const files = args.paths.length ? expandInputPaths(args.paths, root) : collectChangedFiles(root);
  const plan = createVerificationPlan(files, { root });
  printPlan(plan, args.dryRun);
  if (args.dryRun || plan.checks.length === 0) return;

  await runVerificationPlan(plan, root);
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) {
  runCli().catch((error) => {
    console.error(`[verify:changed] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
