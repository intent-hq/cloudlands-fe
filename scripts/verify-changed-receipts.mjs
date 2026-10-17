// Attempt receipts for `verify:changed`: identities and append-only outcomes.
//
// Every recorded run creates `.dev/verify-changed/attempts/<id>/` holding
// `run.json` (written once), `results.jsonl` (append-only outcomes) and, when the
// run ends, `coverage.json`. Source trees are content-addressed under `trees/` so
// attempts on the same tree share one map. Later runs never rewrite an attempt.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_SCHEMA = 1;
export const RECEIPTS_DIR = '.dev/verify-changed';
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const RESULTS_ENV = 'VERIFY_CHANGED_RESULTS';
export const LANE_ENV = 'VERIFY_CHANGED_LANE';
export const INVOCATION_ENV = 'VERIFY_CHANGED_INVOCATION';
export const CONFIG_ENV = 'VERIFY_CHANGED_UNIT_CONFIG';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
// The runner modules that decide selection, invalidation and recording. Their
// local import closure is part of the configuration identity.
const RUNNER_ENTRIES = [
  'verify-changed.mjs',
  'verify-changed-receipts.mjs',
  'verify-changed-coverage.mjs',
  'verify-changed-receipt-reporter.mjs',
  'verify-changed-run-files.mjs',
];
// Files whose change can alter any test or check outcome without appearing in a
// test's import graph. Missing files are recorded as absent.
const CONFIG_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'svelte.config.js',
  'vite.config.mjs',
  'vitest.config.ts',
  'tests/integration/vitest.integration.config.ts',
  'playwright.config.ts',
  'playwright-ct.config.ts',
  'knip.jsonc',
  'eslint.config.js',
  '.prettierrc',
  '.prettierignore',
  // Generated from gitignored environment input; tests import it directly.
  'src/main/build-config.generated.ts',
];
const CONFIG_PATTERN = /^tsconfig[^/]*\.json$/;
const VITEST_CONFIGS = ['vitest.config.ts', 'tests/integration/vitest.integration.config.ts'];
const ENVIRONMENT_KEYS = ['CI', 'LANG', 'LC_ALL', 'NODE_ENV', 'NODE_OPTIONS', 'TZ'];
const IMPORT_SUFFIXES = ['', '.ts', '.js', '.mjs', '.cjs', '.svelte', '/index.ts', '/index.js'];
const ALIASES = {
  '$features/': 'src/features/',
  '$lib/': 'src/lib/',
  '$shared/': 'src/shared/',
  '$store/': 'src/store/',
};

function slash(path) {
  return path.split(sep).join('/');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function digest(value) {
  return sha256(stableJson(value));
}

export function receiptsRoot(root) {
  return resolve(root, RECEIPTS_DIR);
}

/**
 * Content identity of every tracked or untracked, non-ignored file in the
 * package, keyed by package-relative path. Receipt storage is always excluded.
 */
export function sourceIdentity(root) {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--full-name', '.'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const paths = [
    ...new Set(
      listed
        .map((path) => (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path))
        .filter((path) => !path.startsWith(`${RECEIPTS_DIR}/`) && !path.includes('\n')),
    ),
  ].sort();
  const regular = [];
  const links = {};
  for (const path of paths) {
    const stat = lstatSync(resolve(root, path), { throwIfNoEntry: false });
    // Like git, a symlink is identified by its target, not by what it points to.
    if (stat?.isSymbolicLink()) links[path] = `link:${sha256(readlinkSync(resolve(root, path)))}`;
    else if (stat?.isFile()) regular.push(path);
  }
  const hashes = regular.length
    ? execFileSync('git', ['hash-object', '--stdin-paths'], {
        cwd: root,
        encoding: 'utf8',
        input: `${regular.join('\n')}\n`,
        maxBuffer: 256 * 1024 * 1024,
      })
        .trim()
        .split('\n')
    : [];
  if (hashes.length !== regular.length)
    throw new Error('git hash-object returned a partial result');
  const hashed = { ...links };
  regular.forEach((path, index) => {
    hashed[path] = hashes[index];
  });
  const files = Object.fromEntries(
    Object.keys(hashed)
      .sort()
      .map((path) => [path, hashed[path]]),
  );
  return { digest: digest(files), files };
}

/** Paths whose content differs between two source maps (added, changed, deleted). */
export function diffSources(previous, current) {
  const changed = [];
  for (const [path, hash] of Object.entries(current))
    if (previous[path] !== hash) changed.push(path);
  for (const path of Object.keys(previous)) if (!(path in current)) changed.push(path);
  return [...new Set(changed)].sort();
}

function readIfFile(path) {
  try {
    return statSync(path).isFile() ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

function localImports(path, root) {
  if (!['.ts', '.js', '.mjs', '.cjs', '.mts', '.cts', '.svelte'].includes(extname(path))) return [];
  const source = readIfFile(resolve(root, path))?.toString('utf8') ?? '';
  const targets = [];
  // `vi.mock` targets are replaced by their factories, so they are not followed;
  // `vi.importActual` loads the real module, so it is.
  const importRe =
    /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*|importActual(?:<[^>]*>)?\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(importRe)) {
    const specifier = match[1];
    const alias = Object.entries(ALIASES).find(([key]) => specifier.startsWith(key));
    if (!specifier.startsWith('.') && !alias) continue;
    const base = alias
      ? resolve(root, alias[1], specifier.slice(alias[0].length))
      : resolve(root, dirname(path), specifier);
    for (const suffix of IMPORT_SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (readIfFile(candidate) !== null) {
        const rel = slash(relative(root, candidate));
        if (!rel.startsWith('..')) targets.push(rel);
        break;
      }
    }
  }
  return targets;
}

/** Static local import closure (relative and `$alias/` specifiers only). */
export function importClosure(entries, root) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...localImports(file, root));
  }
  return [...seen].sort();
}

/** Setup and global-setup modules named as string literals in a Vitest config. */
export function vitestSetupFiles(root, configFile) {
  const source = readIfFile(resolve(root, configFile))?.toString('utf8');
  if (!source) return [];
  const files = [];
  for (const match of source.matchAll(/(?:setupFiles|globalSetup)\s*:\s*\[([^\]]*)\]/g)) {
    for (const literal of match[1].matchAll(/["']([^"']+)["']/g)) {
      files.push(slash(relative(root, resolve(root, dirname(configFile), literal[1]))));
    }
  }
  return files;
}

/**
 * Everything outside the source map that can change an outcome, plus inputs
 * that change globally but are invisible to any test's import graph (configs,
 * setup modules and the runner itself).
 */
export function configurationIdentity(root, options = {}) {
  const env = options.env ?? process.env;
  const runnerRoot = options.runnerRoot ?? SCRIPTS_DIR;
  const configFiles = [
    ...CONFIG_FILES,
    ...readdirSync(root).filter((file) => CONFIG_PATTERN.test(file)),
  ];
  const graphEntries = [
    ...VITEST_CONFIGS,
    ...VITEST_CONFIGS.flatMap((config) => vitestSetupFiles(root, config)),
  ].filter((file) => readIfFile(resolve(root, file)) !== null);
  const files = {};
  for (const file of new Set([...configFiles, ...importClosure(graphEntries, root)])) {
    const content = readIfFile(resolve(root, file));
    files[file] = content ? sha256(content) : null;
  }
  const runnerFiles = importClosure(RUNNER_ENTRIES, runnerRoot);
  const runner = Object.fromEntries(
    runnerFiles.map((file) => {
      const content = readIfFile(resolve(runnerRoot, file));
      return [file, content ? sha256(content) : null];
    }),
  );
  const parts = {
    schema: RECEIPT_SCHEMA,
    node: options.nodeVersion ?? process.version,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    environment: Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, env[key] ?? null])),
    files,
    runner,
  };
  return { digest: digest(parts), parts };
}

export function commandIdentity(check) {
  return digest({ id: check.id, executable: check.executable, args: check.args });
}

function writeOnce(path, content) {
  writeFileSync(path, content, { flag: 'wx' });
}

function storeTree(root, source) {
  const trees = join(receiptsRoot(root), 'trees');
  mkdirSync(trees, { recursive: true });
  const path = join(trees, `${source.digest}.json`);
  if (!existsSync(path)) {
    try {
      writeOnce(path, JSON.stringify(source.files));
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}

export function loadTree(root, treeDigest) {
  try {
    const files = JSON.parse(
      readFileSync(join(receiptsRoot(root), 'trees', `${treeDigest}.json`), 'utf8'),
    );
    return digest(files) === treeDigest ? files : null;
  } catch {
    return null;
  }
}

function lastActivity(directory) {
  let latest = 0;
  for (const name of ['run.json', 'results.jsonl', 'coverage.json']) {
    const stat = statSync(join(directory, name), { throwIfNoEntry: false });
    if (stat) latest = Math.max(latest, stat.mtimeMs);
  }
  return latest || statSync(directory).mtimeMs;
}

/** Removes whole attempts untouched for the retention window, then orphaned trees. */
export function pruneAttempts(root, now = Date.now(), retentionMs = RETENTION_MS) {
  const attempts = join(receiptsRoot(root), 'attempts');
  const kept = new Set();
  if (existsSync(attempts)) {
    for (const name of readdirSync(attempts)) {
      const directory = join(attempts, name);
      try {
        if (now - lastActivity(directory) > retentionMs) {
          rmSync(directory, { recursive: true, force: true });
          continue;
        }
        const run = JSON.parse(readFileSync(join(directory, 'run.json'), 'utf8'));
        if (run?.identities?.source?.digest) kept.add(run.identities.source.digest);
      } catch {
        // Unreadable attempts are retained until they age out; they never earn credit.
      }
    }
  }
  const trees = join(receiptsRoot(root), 'trees');
  if (!existsSync(trees)) return;
  for (const name of readdirSync(trees)) {
    const path = join(trees, name);
    if (!kept.has(name.replace(/\.json$/, '')) && now - statSync(path).mtimeMs > retentionMs)
      rmSync(path, { force: true });
  }
}

/**
 * Creates an attempt directory and its immutable `run.json`. The returned
 * recorder only appends to this attempt's own files.
 */
export function createAttempt(root, { argv = [], resume = false, identities }) {
  pruneAttempts(root);
  storeTree(root, identities.source);
  const startedAt = new Date().toISOString();
  const id = `${startedAt.replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(3).toString('hex')}`;
  const directory = join(receiptsRoot(root), 'attempts', id);
  mkdirSync(directory, { recursive: true });
  const run = {
    schema: RECEIPT_SCHEMA,
    id,
    startedAt,
    argv,
    resume,
    identities: {
      source: { digest: identities.source.digest },
      configuration: identities.configuration,
      commands: identities.commands,
      selections: identities.selections,
    },
  };
  writeOnce(join(directory, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  const resultsPath = join(directory, 'results.jsonl');
  writeOnce(resultsPath, '');
  let sequence = 0;
  return {
    id,
    directory,
    resultsPath,
    run,
    path: slash(relative(root, directory)),
    nextInvocation(checkId) {
      sequence += 1;
      return `${checkId}#${sequence}`;
    },
    append(record) {
      appendFileSync(
        resultsPath,
        `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      );
    },
    writeFile(name, content) {
      writeOnce(join(directory, name), content);
      return join(directory, name);
    },
  };
}

export function readResults(path) {
  const results = [];
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && typeof record.type === 'string')
        results.push(record);
    } catch {
      // A torn final line (killed mid-write) is skipped; earlier lines stay valid.
    }
  }
  return results;
}

/** Earlier attempts in start order. Unreadable or foreign-schema attempts are omitted. */
export function loadAttempts(root, { exclude } = {}) {
  const attempts = join(receiptsRoot(root), 'attempts');
  if (!existsSync(attempts)) return [];
  const loaded = [];
  for (const name of readdirSync(attempts)) {
    if (name === exclude) continue;
    try {
      const run = JSON.parse(readFileSync(join(attempts, name, 'run.json'), 'utf8'));
      if (run?.schema !== RECEIPT_SCHEMA || run.id !== name) continue;
      const results = readResults(join(attempts, name, 'results.jsonl'));
      if (!results) continue;
      loaded.push({ id: name, run, results });
    } catch {
      // Missing or corrupt evidence earns no credit.
    }
  }
  return loaded.sort((a, b) =>
    a.run.startedAt === b.run.startedAt
      ? a.id.localeCompare(b.id)
      : a.run.startedAt.localeCompare(b.run.startedAt),
  );
}
