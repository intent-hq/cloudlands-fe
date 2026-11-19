#!/usr/bin/env node
// Type-checks unit test files against a per-file error baseline that may only shrink.
//
// No other tsconfig covers unit tests: tsconfig.json and tsconfig.main.json both exclude
// `**/*.test.ts` and `__tests__`. When cloudlands-fe#4751 narrowed getLocalPref /
// setLocalPref to a key union, src/main/__tests__/local-prefs.test.ts kept passing ~17
// unregistered keys and nothing reported it; the same PR had to build a TypeScript
// program inside a test because an `@ts-expect-error` in a test file was never checked.
// With this gate a mistyped test fails before merge, and a type-level rule is tested
// with a plain `// @ts-expect-error` line (an unused one is error TS2578).
//
// Each project's errors are counted per file and compared with the checked-in baseline,
// one file per source file under `scripts/test-type-baselines/<project>/<source>.json`
// (`{ "count": N }`), so parallel fix PRs touch different files. The run fails when a
// file has more errors than its entry allows, and also when it has fewer, so every fix
// is locked in. CI also rejects baseline growth against the PR base
// (scripts/check-test-types.test.ts, `LINT_BASELINE_BASE_REF`).
//
// Usage: node scripts/check-test-types.mjs [--update-baseline] [--project <name>]...
//   --update-baseline  Rewrite the selected projects' baselines from the current errors.
//   --project          Check only the named projects (default: all of PROJECTS).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASELINES_DIR = 'scripts/test-type-baselines';
export const INCIDENTS = Object.freeze(['https://github.com/intent-hq/cloudlands-fe/pull/4751']);

/** Test programs, keyed by the baseline directory name. Renderer tests are next. */
export const PROJECTS = Object.freeze({
  main: Object.freeze({
    tsconfig: 'tsconfig.main-tests.json',
    label: 'main-process unit tests (src/main, src/features/*/main)',
  }),
});

// Measured at ~3.5 GB for the main-test program; the CI job caps every step at 4 GB
// through NODE_OPTIONS, and a command-line flag overrides it for this child.
const TSC_HEAP_MB = 8192;
const UPDATE_COMMAND = 'pnpm run lint:test-types -- --update-baseline';
const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_DIAGNOSTIC_RE = /^error (TS\d+): (.*)$/;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const normalize = (value) => value.split(path.sep).join('/');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Files whose change can alter this gate's result besides the tests themselves. */
export function isTestTypeCheckInput(file) {
  return (
    file === 'scripts/check-test-types.mjs' ||
    file.startsWith(`${BASELINES_DIR}/`) ||
    Object.values(PROJECTS).some(({ tsconfig }) => file === tsconfig)
  );
}

/**
 * tsc `--pretty false` output → `{ byFile: Map<file, diagnostic[]>, global: string[] }`.
 * Continuation lines (indented message chains) attach to the preceding diagnostic.
 */
export function parseDiagnostics(output, root = ROOT) {
  const byFile = new Map();
  const global = [];
  let last = null;
  for (const line of output.split(/\r?\n/)) {
    const located = DIAGNOSTIC_RE.exec(line);
    if (located) {
      const [, rawFile, lineNo, column, code, message] = located;
      const file = normalize(path.relative(root, path.resolve(root, rawFile)));
      last = { file, line: Number(lineNo), column: Number(column), code, message };
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(last);
      continue;
    }
    const unlocated = GLOBAL_DIAGNOSTIC_RE.exec(line);
    if (unlocated) {
      global.push(`${unlocated[1]}: ${unlocated[2]}`);
      last = null;
    } else if (last && /^\s+\S/.test(line)) {
      last.message += `\n${line}`;
    }
  }
  return { byFile, global };
}

/** `Map<file, count>` from parsed diagnostics. */
export function countByFile(byFile) {
  return new Map([...byFile].map(([file, diagnostics]) => [file, diagnostics.length]));
}

/** The baseline tree for `project` under `root` as `Map<source file, count>`. */
export function loadBaseline(root, project) {
  const dir = path.join(root, BASELINES_DIR, project);
  if (!fs.existsSync(dir)) return new Map();
  const entries = fs
    .readdirSync(dir, { recursive: true })
    .map(normalize)
    .filter((relative) => fs.statSync(path.join(dir, relative)).isFile())
    .map((relative) => [relative, fs.readFileSync(path.join(dir, relative), 'utf8')]);
  return parseBaselineEntries(entries, `${BASELINES_DIR}/${project}`);
}

/** `[path relative to the project dir, JSON text]` pairs → `Map<source file, count>`. */
export function parseBaselineEntries(entries, label) {
  const baseline = new Map();
  for (const [relative, contents] of entries) {
    if (!relative.endsWith('.json')) {
      throw new Error(`${label}/${relative}: expected <source path>.json`);
    }
    let entry;
    try {
      entry = JSON.parse(contents);
    } catch (error) {
      throw new Error(`${label}/${relative}: ${error.message}`, { cause: error });
    }
    const keys = entry && typeof entry === 'object' ? Object.keys(entry) : [];
    if (keys.length !== 1 || !Number.isInteger(entry.count) || entry.count < 1) {
      throw new Error(`${label}/${relative}: expected { "count": <integer >= 1> }`);
    }
    baseline.set(relative.slice(0, -'.json'.length), entry.count);
  }
  return baseline;
}

/** Write `counts` as the project's baseline tree, removing entries that are gone. */
export function writeBaseline(root, project, counts) {
  const dir = path.join(root, BASELINES_DIR, project);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [file, count] of counts) {
    if (count < 1) continue;
    const target = path.join(dir, `${file}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Prettier's JSON layout, so a rewrite never fails format:check.
    fs.writeFileSync(target, `{ "count": ${count} }\n`);
  }
}

/**
 * Files over (`grown`) or under (`shrunk`) their baseline allowance. A file absent from
 * the baseline allows zero errors; a baseline entry for a clean file counts as shrunk.
 */
export function compareCounts(baseline, counts) {
  const files = [...new Set([...baseline.keys(), ...counts.keys()])].sort(compare);
  const grown = [];
  const shrunk = [];
  for (const file of files) {
    const allowed = baseline.get(file) ?? 0;
    const current = counts.get(file) ?? 0;
    if (current > allowed) grown.push({ file, allowed, current });
    else if (current < allowed) shrunk.push({ file, allowed, current });
  }
  return { grown, shrunk };
}

/**
 * The project's baseline as committed at `ref`, or `null` when the project had no
 * baseline there (a new project may establish its starting debt).
 */
export function readCommittedBaseline(root, project, ref) {
  const dir = `${BASELINES_DIR}/${project}`;
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const listing = git(['ls-tree', '-r', '-z', ref, '--', dir]).split('\0').filter(Boolean);
  if (!listing.length) return null;
  const blobs = listing.map((record) => {
    const tab = record.indexOf('\t');
    return { sha: record.slice(0, tab).split(' ')[2], file: record.slice(tab + 1) };
  });
  return parseBaselineEntries(
    blobs.map(({ sha, file }) => [file.slice(dir.length + 1), git(['cat-file', 'blob', sha])]),
    `${ref}:${dir}`,
  );
}

/** Baseline entries added or raised since `committed`: `[{ file, allowed, current }]`. */
export function findBaselineGrowth(committed, checkedOut) {
  if (committed === null) return [];
  return compareCounts(committed, checkedOut).grown;
}

function runTsc(root, tsconfig) {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const args = [
    `--max-old-space-size=${TSC_HEAP_MB}`,
    tsc,
    '-p',
    tsconfig,
    '--noEmit',
    '--pretty',
    'false',
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ code: 1, output: `${error.message}\n` }));
    child.on('close', (code, signal) =>
      resolve({ code: code ?? 1, output: signal ? `${output}Killed by ${signal}\n` : output }),
    );
  });
}

function formatDiagnostic({ file, line, column, code, message }) {
  return `  ${file}:${line}:${column} ${code} ${message}`;
}

/**
 * Check (or with `update`, rewrite) the baselines of `projects`. Returns
 * `{ ok, lines }`: the report to print and whether the gate passed.
 */
export async function checkTestTypes({
  root = ROOT,
  projects = PROJECTS,
  names = Object.keys(projects),
  update = false,
} = {}) {
  const lines = [];
  let ok = true;
  const results = await Promise.all(
    names.map(async (name) => ({ name, ...(await runTsc(root, projects[name].tsconfig)) })),
  );
  for (const { name, code, output } of results) {
    const { tsconfig, label } = projects[name];
    const { byFile, global } = parseDiagnostics(output, root);
    // Config or environment errors have no file to baseline, and an unparsed failure
    // (crash, out of memory) must never read as "no errors".
    if (global.length || (code !== 0 && byFile.size === 0)) {
      ok = false;
      lines.push(`❌ ${label}: tsc -p ${tsconfig} failed outside any test file:`);
      lines.push(...(global.length ? global.map((d) => `  ${d}`) : [output.trim()]));
      continue;
    }
    const counts = countByFile(byFile);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    if (update) {
      const before = loadBaseline(root, name);
      writeBaseline(root, name, counts);
      const { grown } = compareCounts(before, counts);
      lines.push(
        `📝 ${label}: baseline now ${total} error(s) in ${counts.size} file(s) (${BASELINES_DIR}/${name}/).`,
      );
      // A project's first baseline is its starting debt; afterwards growth is rejected.
      if (!before.size) continue;
      for (const { file, allowed, current } of grown) {
        lines.push(`  ⚠️  ${file}: ${allowed} → ${current}; CI rejects baseline growth.`);
      }
      continue;
    }
    const { grown, shrunk } = compareCounts(loadBaseline(root, name), counts);
    for (const { file, allowed, current } of grown) {
      ok = false;
      lines.push(`❌ ${file}: ${current} type error(s), baseline allows ${allowed}:`);
      lines.push(...byFile.get(file).map(formatDiagnostic));
    }
    if (shrunk.length) {
      ok = false;
      lines.push(`🎉 ${label}: fewer type errors than the baseline records:`);
      for (const { file, allowed, current } of shrunk) {
        lines.push(`  ${file}: ${allowed} → ${current}`);
      }
      lines.push(`Lock in the reduction: ${UPDATE_COMMAND}`);
    }
    if (grown.length) {
      lines.push(
        'Fix the test types (the code under test is the contract), or mark a deliberate',
        'type-level probe with `// @ts-expect-error <why>`. The baseline only records old',
        `debt and may only shrink (${INCIDENTS[0]}).`,
      );
    }
    if (!grown.length && !shrunk.length) {
      lines.push(`✅ ${label}: ${total} known type error(s) in ${counts.size} file(s), none new.`);
    }
  }
  return { ok, lines };
}

function parseArgs(argv) {
  const options = { update: false, names: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--update-baseline') options.update = true;
    else if (arg === '--project') options.names.push(argv[++i] ?? '');
    else if (arg.startsWith('--project=')) options.names.push(arg.slice('--project='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const name of options.names) {
    if (!(name in PROJECTS)) throw new Error(`Unknown project: ${name || '(none)'}`);
  }
  if (!options.names.length) options.names = Object.keys(PROJECTS);
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const { ok, lines } = await checkTestTypes(options);
  (ok ? console.log : console.error)(lines.join('\n'));
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
