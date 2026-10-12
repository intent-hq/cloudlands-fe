#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CT_TEST_DIR, isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

// The one list of repo-relative paths whose change requires the full Playwright
// component suite: the stylesheet/token contract that `playwright/index.ts`
// mounts (`src/app.css` imports `$lib/styles/*.css`), the CT harness itself, and
// the mount-harness helpers `playwright/index.ts` imports directly (the rest of
// `src/lib/component-catalog/` is ordinary component code), and the dependency
// manifests (a Playwright/Svelte/Tailwind bump is a CT-contract change).
// `scripts/verify-changed.mjs` selects the local `ct-full` check from it
// and the `pull_request` workflow decides whether to run `test-ct` from the same
// list, via `node scripts/ct-contract-paths.mjs --diff <base> <head>`.
// cloudlands-fe#2441 rewrote `tokens.css`, `app.css` and `run-ct-tests.mjs` with
// no CT run and was ejected from the merge queue with 40 CT failures.
//
// The workflow's `ct_required` additionally covers the CT test artifacts
// themselves — the specs `playwright-ct.config.ts` discovers and the geometry
// goldens `src/**/__geometry__/*.geometry.json` (`isCtTestArtifact`) — so a PR that
// edits specs or baselines gets CT signal on pull_request. Those are NOT contract
// paths: `verify:changed` keeps selecting the narrower `ct-related` lane for
// them locally. cloudlands-fe#2533 changed 22 specs and 1 golden with CT skipped
// on the PR and was ejected from the merge queue three times.
// Hosted selection also covers direct local imports from discovered CT specs
// (see ctSpecDependencies below). Keep those out of the global contract list:
// a fixture edit should still select only related tests in verify:changed.
export const CT_CONTRACT_FILES = Object.freeze([
  'src/app.css',
  'playwright-ct.config.ts',
  'scripts/run-ct-tests.mjs',
  'scripts/ct-browser.mjs',
  'scripts/playwright-os-deps-lib.mjs',
  'patches/playwright-core@1.58.2.patch',
  'src/test/ct-test.ts',
  'src/lib/component-catalog/capture-stability.ts',
  'src/lib/component-catalog/geometry-probe.ts',
  'src/lib/component-catalog/preview-definition.ts',
  'package.json',
  'pnpm-lock.yaml',
]);
export const CT_CONTRACT_DIRECTORIES = Object.freeze(['src/lib/styles/', 'playwright/']);
export const CT_CONTRACT_PATHS = Object.freeze([
  ...CT_CONTRACT_FILES,
  ...CT_CONTRACT_DIRECTORIES.map((directory) => `${directory}**`),
]);

// The spec half is `isCtSpec` — exactly what `playwright-ct.config.ts` discovers,
// since both read `playwright/ct-spec-pattern.mjs` (a broader pattern would
// require CT for files the matrix never loads); the golden half is the path
// `geometrySnapshotTargets` in `scripts/verify-changed.mjs` derives (matched
// relative to `CT_TEST_DIR/`; dot-prefixed segments are accepted).
const CT_GEOMETRY_GOLDEN_RE = /^(?:.*\/)?__geometry__\/[^/]+\.geometry\.json$/;

const OUTPUT_KEY = 'ct_required';

export function isCtContractPath(file) {
  const path = normalizeCtPath(file);
  return (
    CT_CONTRACT_FILES.includes(path) ||
    CT_CONTRACT_DIRECTORIES.some((directory) => path.startsWith(directory))
  );
}

function isCtGeometryGolden(file) {
  const path = normalizeCtPath(file);
  const prefix = `${CT_TEST_DIR}/`;
  return path.startsWith(prefix) && CT_GEOMETRY_GOLDEN_RE.test(path.slice(prefix.length));
}

export function isCtTestArtifact(file) {
  return isCtSpec(file) || isCtGeometryGolden(file);
}

export function ctRequired(files, dependencies = new Set()) {
  return files.some(
    (file) =>
      isCtContractPath(file) || isCtTestArtifact(file) || dependencies.has(normalizeCtPath(file)),
  );
}

// Deliberately bounded to ONE import edge from each CT spec. This covers hosts,
// previews and data/helpers regardless of their naming/location, including
// production modules imported directly, without walking the application graph.
// Like local findRelatedCtTests, scan literal import/from specifiers (including
// side-effect imports, re-exports and literal dynamic imports). Relative paths
// and the four frontend aliases support explicit paths, extensionless modules
// and directory indexes. Candidate paths are conservative, not a Vite resolver:
// comments/type imports can over-select. Computed imports, globs, require calls
// and unknown $ aliases or escaped literals fail safe. Query/fragment suffixes
// are ignored for path matching; transitive dependencies are outside this rule.
// Match comment trivia at token boundaries instead of deleting comments from
// source: comment markers and the opposite quote are valid inside module strings.
const IMPORT_TRIVIA = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\r\n\u2028\u2029]*)*`;
const IMPORT_LITERAL = String.raw`(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')`;
const IMPORT_RE = new RegExp(
  String.raw`(?:\bfrom${IMPORT_TRIVIA}|\bimport${IMPORT_TRIVIA}(?:\(${IMPORT_TRIVIA})?)(${IMPORT_LITERAL})`,
  'g',
);
const DYNAMIC_IMPORT_RE = new RegExp(String.raw`\bimport${IMPORT_TRIVIA}\(`, 'g');
const LITERAL_DYNAMIC_IMPORT_RE = new RegExp(
  String.raw`^import${IMPORT_TRIVIA}\(${IMPORT_TRIVIA}${IMPORT_LITERAL}${IMPORT_TRIVIA}(?:\)|,)`,
);
const UNSUPPORTED_IMPORT_RE = new RegExp(
  String.raw`\brequire${IMPORT_TRIVIA}\(|\bimport${IMPORT_TRIVIA}\.${IMPORT_TRIVIA}meta${IMPORT_TRIVIA}\.${IMPORT_TRIVIA}glob`,
);
const IMPORT_ALIASES = {
  '$features/': 'src/features/',
  '$lib/': 'src/lib/',
  '$shared/': 'src/shared/',
  '$store/': 'src/store/',
};
const IMPORT_EXTENSIONS = ['.svelte', '.ts', '.tsx', '.js', '.mjs'];

function ctSpecDependencies(base, head) {
  const gitOptions = { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };
  const specs = new Map();
  // Read the requested Git trees, never the checkout: deleted/renamed fixtures
  // must remain visible, and callers need not have either revision checked out.
  for (const ref of new Set([base, head])) {
    const tree = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', CT_TEST_DIR], {
      ...gitOptions,
      encoding: 'utf8',
    });
    for (const entry of tree.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const file = entry.slice(tab + 1);
      if (!isCtSpec(file)) continue;
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      if (type !== 'blob' || !mode.startsWith('100')) {
        throw new Error(`cannot read CT spec ${ref}:${file}`);
      }
      specs.set(`${oid}:${file}`, { oid, file });
    }
  }
  if (!specs.size) return new Set();

  // One batch avoids spawning a process per spec. Use byte lengths from Git's
  // headers so Unicode source and embedded newlines cannot corrupt framing.
  const oids = [...new Set([...specs.values()].map(({ oid }) => oid))];
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    ...gitOptions,
    input: `${oids.join('\n')}\n`,
  });
  const sources = new Map();
  let offset = 0;
  for (const oid of oids) {
    const newline = batch.indexOf(10, offset);
    const header = batch.subarray(offset, newline).toString('utf8').split(' ');
    const size = Number(header[2]);
    if (
      newline < offset ||
      header[0] !== oid ||
      header[1] !== 'blob' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      batch[newline + 1 + size] !== 10
    )
      throw new Error(`cannot read CT spec blob ${oid}`);
    offset = newline + 1;
    sources.set(oid, batch.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }

  const dependencies = new Set();
  for (const { oid, file } of specs.values()) {
    const source = sources.get(oid);
    // The workflow runs before dependency installation, so there is no TS/Vite
    // parser here. Reject forms this literal scan cannot resolve rather than
    // treating an incomplete dependency set as evidence to skip CT.
    if (
      UNSUPPORTED_IMPORT_RE.test(source) ||
      [...source.matchAll(DYNAMIC_IMPORT_RE)].some(
        (match) => !LITERAL_DYNAMIC_IMPORT_RE.test(source.slice(match.index)),
      )
    )
      throw new Error(`unsupported CT dependency syntax in ${file}`);
    for (const [, literal] of source.matchAll(IMPORT_RE)) {
      // Do not silently treat an encoded JS string as a literal filesystem path.
      // Resolving escapes needs a JS string decoder; fail safe until supported.
      if (literal.includes('\\')) {
        throw new Error(`unsupported CT dependency escape in ${file}: ${literal}`);
      }
      // Vite's ?raw/?inline (and other query/fragment forms) read the same file.
      const specifier = literal.slice(1, -1).split(/[?#]/, 1)[0];
      const alias = Object.entries(IMPORT_ALIASES).find(([prefix]) => specifier.startsWith(prefix));
      if (specifier.startsWith('$') && !alias) {
        throw new Error(`unsupported CT dependency alias in ${file}: ${specifier}`);
      }
      if (!specifier.startsWith('.') && !alias) continue;
      const target = alias
        ? posix.join(alias[1], specifier.slice(alias[0].length))
        : posix.join(posix.dirname(file), specifier);
      if (target.startsWith('../')) continue;
      dependencies.add(target);
      if (!IMPORT_EXTENSIONS.includes(posix.extname(target))) {
        for (const extension of IMPORT_EXTENSIONS) {
          dependencies.add(`${target}${extension}`);
          dependencies.add(`${target}/index${extension}`);
        }
      }
    }
  }
  return dependencies;
}

// `-z` keeps paths verbatim (no `core.quotePath` escaping of non-ASCII names) and
// `--no-renames` reports a rename as delete + add, so a contract file moved out of
// the list still surfaces on its old path.
export function changedFiles(base, head, { cwd = process.cwd() } = {}) {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMD', base, head],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

export function parseArgs(argv) {
  if (argv[0] !== '--diff') throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  const [base, head, ...rest] = argv.slice(1);
  if (!base || !head || rest.length)
    throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  return { base, head };
}

// Prints exactly one `ct_required=true|false` line and always exits 0: a failure
// to compute relevance must run CT, never skip it.
export function main(
  argv,
  {
    diff = changedFiles,
    dependencies = ctSpecDependencies,
    log = console.log,
    warn = console.error,
  } = {},
) {
  let required = true;
  try {
    const { base, head } = parseArgs(argv);
    const files = diff(base, head);
    required =
      ctRequired(files) || (files.length > 0 && ctRequired(files, dependencies(base, head)));
  } catch (error) {
    warn(
      `ct-contract-paths: ${error instanceof Error ? error.message : error}; requiring CT (fail-safe)`,
    );
  }
  log(`${OUTPUT_KEY}=${required}`);
  return 0;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) process.exitCode = main(process.argv.slice(2));
