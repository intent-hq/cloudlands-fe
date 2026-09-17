// paraglide-inputs-hash.mjs — content fingerprint for the generated Paraglide output.
//
// No shebang: vite.config.mjs imports this module, and Vite's config loader
// bundles it with esbuild, which rejects a shebang in an imported file.
//
// `paraglide-js compile` leaves output files whose content did not change
// untouched, so output mtimes cannot tell whether src/shared/paraglide matches
// the current messages/*.json + project.inlang/settings.json. Instead, the
// generation step records a sha256 over those inputs in a sidecar next to the
// outputs, and the UI-preview Vite config reuses the outputs only while the
// recorded hash matches the inputs on disk.
//
// The digest is taken BEFORE compiling and persisted only if the inputs still
// hash the same afterwards: an edit that lands while the compiler runs may or
// may not be reflected in the outputs, so such a run leaves no sidecar and the
// next generation (or the preview's unplugin fallback) picks the edit up.
//
// Run directly (`pnpm run generate:i18n`), it compiles the project with the
// options the Vite integration uses (`locale-modules`, Vite's `isServer`);
// `--if-stale` skips the compile while the recorded hash still matches, so
// gates that merely need the outputs on disk (knip) stay cheap. The same
// if-stale step runs from check-deps-fresh.mjs (first command of lint, check,
// format:check, test:unit) and from verify:changed, so a fresh clone never has
// to run generate:i18n by hand before a gate.
//
// Those gates run concurrently (several worktrees, `verify:changed` next to
// `test:unit`), so generation is single-writer and published atomically
// (intent-hq/intent#4565): compile + publish hold one host-wide lock per outdir
// (`acquireVerificationLock`, keyed by the outdir's absolute path), an
// `--if-stale` caller re-checks the sidecar once it holds the lock, and the
// compiler writes into a fresh staging directory next to the outdir whose files
// are then renamed into place one by one — each module after the modules it
// imports, stale outputs pruned, sidecar last — so a reader never sees a
// missing or half-written output, and one that loads the module graph
// mid-publish gets at worst an older complete snapshot (old `messages/_index.js`
// over new locale modules), never a new index calling into an old locale module.
//
// This module is the only writer of the outdir. vitest.config.ts and
// vite.config.mjs run `ensureRepoParaglide({ ifStale: true })` from `buildStart`
// instead of upstream's `paraglideVitePlugin`, which rewrites changed outputs in
// place with a plain writeFile and unlinks files it did not emit (the sidecar).
// For that to hold everywhere the default compile below must produce exactly
// what upstream's Vite hook would: same `outputStructure` and the Vite
// `isServer` expression (`PARAGLIDE_IS_SERVER`) — a CLI output with the
// compiler's default `isServer` differs in runtime.js, so upstream would rewrite
// it on every startup and prune the sidecar, and the next gate would compile
// again.
//
// Known limitation: per-file rename cannot make additions and removals both
// coherent. Dependency-first order covers additions; when a message is
// *removed*, the old `messages/_index.js` briefly sits over a new locale module
// that no longer exports it. Only a reader whose source still calls the removed
// message (a stale checkout mid-switch) can hit that window, and it self-heals
// on the next import.
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireVerificationLock, defaultLockPath } from './verification-lock.mjs';

export const PARAGLIDE_INPUTS_HASH_FILE = '.inputs.sha256';
export const PARAGLIDE_OUTPUT_STRUCTURE = 'locale-modules';
/** What upstream's Vite `config` hook passes as `isServer`; CLI output must match it byte for byte. */
export const PARAGLIDE_IS_SERVER = "import.meta.env?.SSR ?? typeof window === 'undefined'";
const GENERATED_OUTPUTS = ['messages.js', 'runtime.js'];
const MAX_GENERATE_ATTEMPTS = 3;
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 50;
const RELATIVE_IMPORT_RE = /\b(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

export function paraglideInputFiles({ projectDir, messagesDir }) {
  const catalogs = readdirSync(messagesDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => join(messagesDir, file));
  return [join(projectDir, 'settings.json'), ...catalogs];
}

export function hashParaglideInputs({ projectDir, messagesDir }) {
  const hash = createHash('sha256');
  for (const file of paraglideInputFiles({ projectDir, messagesDir })) {
    hash.update(basename(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The host-wide lock serializing generators of `outdir`. */
export function paraglideLockPath(outdir) {
  return defaultLockPath(`paraglide:${resolve(outdir)}`);
}

async function withParaglideLock(outdir, run) {
  const release = await acquireVerificationLock({
    lockPath: paraglideLockPath(outdir),
    timeoutMs: LOCK_TIMEOUT_MS,
    pollMs: LOCK_POLL_MS,
  });
  try {
    return await run();
  } finally {
    release();
  }
}

function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function removeEmptyDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    removeEmptyDirs(child);
    if (readdirSync(child).length === 0) rmSync(child, { recursive: true, force: true });
  }
}

/**
 * Order `files` (posix paths relative to one root) so every module comes after
 * the modules it imports relatively, per `readSource(file)`. Publishing in this
 * order means a reader that loads the graph while it is being published pairs
 * an old dependent with new leaves at worst — a consistent, merely older
 * snapshot — instead of a new `messages/_index.js` calling a message that its
 * still-old `messages/<locale>.js` does not export yet. Import cycles keep the
 * sorted path order among their members.
 */
export function publishOrder(files, readSource) {
  const set = new Set(files);
  const imports = (file) => {
    if (!file.endsWith('.js')) return [];
    const dir = dirname(file);
    const found = [];
    for (const match of readSource(file).matchAll(RELATIVE_IMPORT_RE)) {
      const target = posix.normalize(posix.join(dir === '.' ? '' : dir, match[1]));
      if (set.has(target)) found.push(target);
    }
    return found;
  };
  const ordered = [];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const dep of imports(file)) visit(dep);
    ordered.push(file);
  };
  for (const file of [...files].sort()) visit(file);
  return ordered;
}

/**
 * Move the staged outputs into `outdir` one rename at a time, dependencies
 * first: every path is either its previous complete version or its new one,
 * never absent or partial. Outputs the new set no longer contains are pruned,
 * then the sidecar is renamed into place last so it only ever vouches for a
 * complete set.
 */
function publishStagedOutputs({ staging, outdir, digest }) {
  const staged = publishOrder(listFiles(staging), (file) =>
    readFileSync(join(staging, file), 'utf8'),
  );
  mkdirSync(outdir, { recursive: true });
  for (const relative of staged) {
    const target = join(outdir, relative);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(staging, relative), target);
  }
  const keep = new Set([...staged, PARAGLIDE_INPUTS_HASH_FILE]);
  for (const relative of listFiles(outdir)) {
    if (!keep.has(relative)) rmSync(join(outdir, relative), { force: true });
  }
  removeEmptyDirs(outdir);
  const stagedSidecar = join(staging, PARAGLIDE_INPUTS_HASH_FILE);
  writeFileSync(stagedSidecar, `${digest}\n`);
  renameSync(stagedSidecar, join(outdir, PARAGLIDE_INPUTS_HASH_FILE));
}

async function compileAndPublish({ projectDir, messagesDir, outdir, compile }) {
  const staging = join(dirname(outdir), `.paraglide-staging-${process.pid}-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  try {
    const digest = hashParaglideInputs({ projectDir, messagesDir });
    await compile({ outdir: staging });
    if (hashParaglideInputs({ projectDir, messagesDir }) !== digest) {
      rmSync(join(outdir, PARAGLIDE_INPUTS_HASH_FILE), { force: true });
      return false;
    }
    publishStagedOutputs({ staging, outdir, digest });
    return true;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function retryCompileAndPublish({ maxAttempts = MAX_GENERATE_ATTEMPTS, ...options }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await compileAndPublish(options)) return true;
  }
  return false;
}

/**
 * Run `compile({ outdir })` against a staging directory and publish its
 * outputs plus the inputs' digest into `outdir` under the outdir's lock.
 * Returns false (and publishes nothing but the sidecar's removal) when the
 * inputs changed while compiling.
 */
export function compileWithInputsHash(options) {
  return withParaglideLock(options.outdir, () => compileAndPublish(options));
}

/** `compileWithInputsHash`, retried while edits keep landing mid-compile. */
export function generateParaglide(options) {
  return withParaglideLock(options.outdir, () => retryCompileAndPublish(options));
}

export function canReuseGeneratedParaglide({ projectDir, messagesDir, outdir }) {
  const sidecar = join(outdir, PARAGLIDE_INPUTS_HASH_FILE);
  const outputs = GENERATED_OUTPUTS.map((file) => join(outdir, file));
  if (!existsSync(sidecar) || outputs.some((file) => !existsSync(file))) return false;
  const recorded = readFileSync(sidecar, 'utf8').trim();
  return recorded.length > 0 && recorded === hashParaglideInputs({ projectDir, messagesDir });
}

/**
 * `generateParaglide`, skipped when `ifStale` is set and the outputs are
 * current. The reuse check repeats once the lock is held, so a caller that
 * waited on another generator reuses what it just published.
 */
export async function ensureGeneratedParaglide({ ifStale = false, ...options }) {
  if (ifStale && canReuseGeneratedParaglide(options)) return true;
  return withParaglideLock(options.outdir, () => {
    if (ifStale && canReuseGeneratedParaglide(options)) return true;
    return retryCompileAndPublish(options);
  });
}

export const PARAGLIDE_STALE_MESSAGE =
  'messages kept changing while compiling; rerun generate:i18n';

export function repoParaglidePaths(rootDir) {
  return {
    projectDir: join(rootDir, 'project.inlang'),
    messagesDir: join(rootDir, 'messages'),
    outdir: join(rootDir, 'src/shared/paraglide'),
  };
}

/** `ensureGeneratedParaglide` for the package at `rootDir`, compiling with `@inlang/paraglide-js`. */
export async function ensureRepoParaglide({ rootDir, ifStale = false, compile }) {
  const paths = repoParaglidePaths(rootDir);
  return ensureGeneratedParaglide({
    ifStale,
    ...paths,
    compile:
      compile ??
      (async ({ outdir }) => {
        const { compile: compileProject } = await import('@inlang/paraglide-js');
        return compileProject({
          project: paths.projectDir,
          outdir,
          outputStructure: PARAGLIDE_OUTPUT_STRUCTURE,
          cleanOutdir: false,
          isServer: PARAGLIDE_IS_SERVER,
        });
      }),
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const ok = await ensureRepoParaglide({
    rootDir: join(dirname(fileURLToPath(import.meta.url)), '..'),
    ifStale: process.argv.includes('--if-stale'),
  });
  if (!ok) {
    console.error(`[generate:i18n] ${PARAGLIDE_STALE_MESSAGE}`);
    process.exit(1);
  }
}
