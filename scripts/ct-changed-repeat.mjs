#!/usr/bin/env node
// Stress-runs the component test specs a branch adds or edits, locally: many
// repetitions with retries off, so a new or edited spec that passes only some
// of the time is caught before it reaches the merge queue. PR CI runs these
// specs once (the `test-ct-affected` job in .github/workflows/intent-pr.yml);
// it no longer repeats them (the 20x `test-ct-changed` job was dropped for
// cost), so this is the way to check a spec for flakiness.
//
// `verify:changed` runs changed specs once with --retries=2, so it cannot show
// that flakiness. Rebuilding the run by hand is easy to get wrong: running the
// specs without the separate bundle build first died with SIGABRT
// ("Ineffective mark-compacts near heap limit"), because the CT bundle must be
// built in its own step under a 12 GiB heap and the tests run under 4 GiB, as
// CI's test-ct-affected job does. scripts/ct-changed-repeat.test.ts checks the
// build step against that job.
//
// Usage: pnpm run test:ct:changed-repeat -- [options] [spec paths...] [-- <playwright args>]
// (`make fe-ct-changed-repeat` from the monorepo root). See usage() below.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CT_SPEC_SUFFIX, isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';
import {
  changedCtSpecs,
  ctChangedRepeatEach,
  listedCtTests,
  playwrightFilter,
} from './ct-changed-specs.mjs';
import { diffBase } from './ct-contract-paths.mjs';
import { removeHeapFlags } from './run-ct-tests.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LAUNCHER = 'scripts/run-ct-tests.mjs';
export const DEFAULT_BASE = 'origin/main';
// The heaps of CI's "Build CT bundle" and test steps (test-ct-affected).
export const CT_BUILD_HEAP_MB = 12288;
export const CT_RUN_HEAP_MB = 4096;
export const CT_CHANGED_WORKERS = 2;
export const CT_CHANGED_JSON_REPORT = 'playwright-report/results.json';
// CI's build step. Playwright CT has no standalone build command: under
// --only-changed the CT plugin builds the whole bundle while tests load,
// before any filter applies, and a clean CI checkout then selects no tests.
export const CT_BUILD_ARGS = ['--only-changed=HEAD', '--pass-with-no-tests', '--reporter=list'];
// A local tree is rarely clean (uncommitted or untracked files count as
// changed), so the local build also filters every test out after the build:
// `(?!)` never matches a title.
export const LOCAL_BUILD_GUARD = ['--grep', '(?!)'];
const QUARANTINE = ['--grep-invert', '@quarantine\\b'];

export function ctChangedListArgs(filters) {
  return [...filters, '--list', ...QUARANTINE, '--reporter=json'];
}

export function ctChangedRunArgs(filters, repeat, workers = CT_CHANGED_WORKERS) {
  return [
    ...filters,
    `--repeat-each=${repeat}`,
    '--retries=0',
    '--fail-on-flaky-tests',
    `--workers=${workers}`,
    ...QUARANTINE,
    '--reporter=list,html,json',
  ];
}

// The caller's NODE_OPTIONS (e.g. a host-injected --require) with CI's heap
// cap for the step in place of any heap flag it already had. The launcher
// owns heap-flag recognition, so every form it accepts is replaced.
export function nodeOptionsWithHeap(existing, megabytes) {
  return [removeHeapFlags(existing), `--max-old-space-size=${megabytes}`].filter(Boolean).join(' ');
}

// Playwright options this script owns; passing them after `--` would change
// the plan behind the printed repeat count.
const OWNED_OPTION = /^--(?:repeat-each|workers|retries|list|reporter)(?:=|$)|^-j/;

export function usage() {
  return [
    'Usage: pnpm run test:ct:changed-repeat -- [options] [spec paths...] [-- <playwright args>]',
    '',
    'Stress-runs the changed component test specs to catch flakiness before pushing:',
    'build the CT bundle under a 12 GiB heap (as CI does), discover the unquarantined',
    'tests, size the repetitions from their count, then run them with',
    '--retries=0 --fail-on-flaky-tests under a 4 GiB heap.',
    '',
    `With no spec paths it selects the ${CT_SPEC_SUFFIX} files changed since`,
    `\`git merge-base <base> HEAD\`, including uncommitted and untracked ones`,
    '(CI sees only pushed commits; those are marked in the plan).',
    '',
    'Options:',
    `  --base <ref>        Diff base (default ${DEFAULT_BASE}).`,
    `  --workers <n>       Playwright workers (default ${CT_CHANGED_WORKERS}, as a CI shard).`,
    '  --repeat-each <n>   Override the computed repeat count.',
    '  --skip-build        Reuse the cached CT bundle from an earlier run.',
    '  --dry-run           Print the specs, filters and repeat count (runs discovery',
    '                      only: no bundle build, no browser), then exit.',
    '  -- <args>           Extra Playwright args (e.g. --grep "my test"), applied to',
    '                      both discovery and the run, so they also size the repeats.',
  ].join('\n');
}

export function parseArgs(argv) {
  const args = [...argv];
  if (args[0] === '--') args.shift();
  const result = {
    base: DEFAULT_BASE,
    workers: CT_CHANGED_WORKERS,
    repeatEach: null,
    skipBuild: false,
    dryRun: false,
    help: false,
    specs: [],
    extra: [],
  };
  const positive = (name, value) => {
    if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(`${name} needs a positive integer`);
    return Number(value);
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const valueOf = (name) => {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      const value = args[(index += 1)];
      if (!value || value.startsWith('-')) throw new Error(`missing value for ${name}`);
      return value;
    };
    if (arg === '--') {
      result.extra = args.slice(index + 1);
      break;
    } else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--skip-build') result.skipBuild = true;
    else if (arg === '--base' || arg.startsWith('--base=')) result.base = valueOf('--base');
    else if (arg === '--workers' || arg.startsWith('--workers='))
      result.workers = positive('--workers', valueOf('--workers'));
    else if (arg === '--repeat-each' || arg.startsWith('--repeat-each='))
      result.repeatEach = positive('--repeat-each', valueOf('--repeat-each'));
    else if (arg.startsWith('-'))
      throw new Error(`unknown option ${arg} (Playwright args go after --)`);
    else if (!isCtSpec(arg)) throw new Error(`not a component test spec under src/: ${arg}`);
    else result.specs.push(normalizeCtPath(arg));
  }
  const owned = result.extra.find((arg) => OWNED_OPTION.test(arg));
  if (owned) {
    throw new Error(
      `${owned} is set by this script; use --workers or --repeat-each instead of passing it after --`,
    );
  }
  return result;
}

function git(args, cwd) {
  return execGit(args, cwd).split('\0').filter(Boolean);
}

function execGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

// The specs to run: CI's selection for the pushed branch (the same three-dot
// diff as the release-fast-path step) plus uncommitted and untracked ones,
// minus any deleted from the working tree. `local` marks the specs whose
// working-tree copy differs from HEAD, i.e. the version CI does not see yet.
export function localChangedSpecs(base, { cwd = repoRoot } = {}) {
  try {
    execGit(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd);
  } catch {
    throw new Error(`cannot resolve --base ${base} (fetch it, or pass --base <ref>)`);
  }
  const mergeBase = diffBase(base, 'HEAD', { cwd });
  const diff = (...refs) =>
    git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACM', ...refs], cwd);
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'], cwd);
  const committed = diff(mergeBase, 'HEAD');
  const uncommitted = changedCtSpecs([...diff('HEAD'), ...untracked]);
  const specs = changedCtSpecs([...committed, ...uncommitted]).filter((spec) =>
    existsSync(path.join(cwd, spec)),
  );
  const changedLocally = new Set(uncommitted);
  return { mergeBase, specs, local: specs.filter((spec) => changedLocally.has(spec)) };
}

function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function commandLine(heapMb, args) {
  return `NODE_OPTIONS=--max-old-space-size=${heapMb} node ${LAUNCHER} ${args.map(quote).join(' ')}`;
}

function defaultLaunch(args, { env, quietStdout = false } = {}) {
  const result = spawnSync(process.execPath, [LAUNCHER, ...args], {
    cwd: repoRoot,
    env,
    stdio: ['inherit', quietStdout ? 'ignore' : 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`ct-changed-repeat: ${LAUNCHER} was killed by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

export function main(
  argv,
  {
    selectSpecs = localChangedSpecs,
    launch = defaultLaunch,
    readReport = (file) => readFileSync(file, 'utf8'),
    makeTempDir = () => mkdtempSync(path.join(tmpdir(), 'ct-changed-repeat-')),
    env = process.env,
    log = console.log,
    warn = console.error,
  } = {},
) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    warn(`ct-changed-repeat: ${error.message}\n\n${usage()}`);
    return 2;
  }
  if (options.help) {
    log(usage());
    return 0;
  }

  let specs = options.specs;
  if (!specs.length) {
    let selection;
    try {
      selection = selectSpecs(options.base);
    } catch (error) {
      warn(`ct-changed-repeat: ${error instanceof Error ? error.message : error}`);
      return 2;
    }
    specs = selection.specs;
    log(
      `Changed component test specs since ${options.base} (merge-base ${selection.mergeBase.slice(0, 12)}):`,
    );
    const local = new Set(selection.local);
    for (const spec of specs)
      log(`  ${spec}${local.has(spec) ? '  (local changes: CI does not see them yet)' : ''}`);
    if (!specs.length) {
      log('  (none) — CI skips the repeated job for this diff; nothing to run.');
      return 0;
    }
  } else {
    log('Component test specs (given on the command line):');
    for (const spec of specs) log(`  ${spec}`);
  }

  const filters = specs.map(playwrightFilter);
  log('Playwright filters:');
  for (const filter of filters) log(`  ${filter}`);

  const runEnv = { ...env, NODE_OPTIONS: nodeOptionsWithHeap(env.NODE_OPTIONS, CT_RUN_HEAP_MB) };
  const listArgs = [...ctChangedListArgs(filters), ...options.extra];
  const dir = makeTempDir();
  const listFile = path.join(dir, 'ct-changed-list.json');
  let repeat;
  try {
    log(`\nDiscovering tests: ${commandLine(CT_RUN_HEAP_MB, listArgs)}`);
    const listExit = launch(listArgs, {
      env: { ...runEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: listFile },
      quietStdout: true,
    });
    if (listExit !== 0) {
      warn(`ct-changed-repeat: test discovery exited ${listExit}`);
      return listExit;
    }
    const { total, files } = listedCtTests(JSON.parse(readReport(listFile)));
    const computed = ctChangedRepeatEach(total);
    for (const { file, tests } of files) log(`  ${file}: ${tests} test${tests === 1 ? '' : 's'}`);
    repeat = options.repeatEach ?? computed;
    log(
      `Discovered ${total} test${total === 1 ? '' : 's'} in ${files.length} spec file${files.length === 1 ? '' : 's'}; ` +
        (options.extra.length
          ? `repeating each ${computed} times with the extra Playwright args (CI counts without them)`
          : `CI repeats each ${computed} times`) +
        (options.repeatEach ? `; --repeat-each overrides it to ${repeat}` : '') +
        ` (${total * repeat} runs).`,
    );
  } catch (error) {
    warn(`ct-changed-repeat: ${error instanceof Error ? error.message : error}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const buildArgs = [...CT_BUILD_ARGS, ...LOCAL_BUILD_GUARD];
  const runArgs = [...ctChangedRunArgs(filters, repeat, options.workers), ...options.extra];
  log(`repeat-each: ${repeat}`);
  log(
    `Build: ${options.skipBuild ? '(skipped: --skip-build)' : commandLine(CT_BUILD_HEAP_MB, buildArgs)}`,
  );
  log(`Run:   ${commandLine(CT_RUN_HEAP_MB, runArgs)}`);
  if (options.dryRun) {
    log('\nDry run: discovery only; the bundle build and the tests did not run.');
    return 0;
  }

  if (!options.skipBuild) {
    log('\nBuilding the CT bundle (no tests run in this step)...');
    const buildExit = launch(buildArgs, {
      env: { ...env, NODE_OPTIONS: nodeOptionsWithHeap(env.NODE_OPTIONS, CT_BUILD_HEAP_MB) },
    });
    if (buildExit !== 0) {
      warn(`ct-changed-repeat: the CT bundle build exited ${buildExit}`);
      return buildExit;
    }
  }
  log('\nRepeating the changed component tests...');
  const runExit = launch(runArgs, {
    env: { ...runEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: CT_CHANGED_JSON_REPORT },
  });
  log(
    runExit === 0
      ? `\nPassed: every repetition of ${specs.length} spec${specs.length === 1 ? '' : 's'}.`
      : `\nFailed (exit ${runExit}): report in playwright-report/ (pnpm exec playwright show-report).`,
  );
  return runExit;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) process.exitCode = main(process.argv.slice(2));
