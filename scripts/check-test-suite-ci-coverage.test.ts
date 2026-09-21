// @verify-changed-triggers: .github/workflows/*.yml, package.json, **/vitest*.config.*,
//   **/playwright*.config.*, scripts/*.mjs, scripts/*.ts
// @vitest-environment node

/**
 * Every test-runner suite must be reached by CI.
 *
 * A suite is a Vitest or Playwright config file (`vitest*.config.*`,
 * `playwright*.config.*`) anywhere in the package. It is covered when some
 * workflow `run:` step reaches it — directly, or through the `package.json`
 * scripts graph (`pnpm run <s>`, `pnpm <s>`, `node scripts/pnpm-run.mjs <s>`,
 * expanded transitively) — by naming the config (`--config=X`, `--config X`,
 * `-c X`), by running the runner on its default config (`vitest` →
 * `vitest.config.*`, `playwright test` → `playwright.config.*`), or by
 * launching a local script (`node|tsx scripts/<file>`) whose source names the
 * config basename. Anything else needs an `ALLOWLIST` entry with a reason, and
 * a stale entry fails too.
 *
 * The root Playwright suite sat behind `test:playwright` with no workflow step
 * for months and rotted unobserved: cloudlands-fe#2709 re-wired it and found 11
 * stale expectations across 7 specs plus one escaped layout bug. Deriving the
 * suite set from disk and the reach set from the workflows makes an unwired
 * suite fail here instead.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const THIS_FILE = 'scripts/check-test-suite-ci-coverage.test.ts';
const WORKFLOWS_DIR = '.github/workflows';
const PACKAGE_JSON_PATH = 'package.json';
const SUITE_CONFIG = /(?:^|\/)(vitest|playwright)[^/]*\.config\.[^/]+$/;
const PNPM_RUN_WRAPPER = 'scripts/pnpm-run.mjs';
const RUN_STEP = /^(\s*)(?:-\s+)?run:(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*\s*(?:#.*)?$/;
const SCRIPT_NAME = /^[\w:.-]+$/;
const SHELL_CHAIN = /\s*(?:&&|\|\||;|\n)\s*/;
const LAUNCHER = /^scripts\/[\w./-]+$/;
const RUNNERS = ['vitest', 'playwright'] as const;

type Runner = (typeof RUNNERS)[number];
type Scripts = Record<string, string>;
type Reader = (path: string) => string | undefined;

/** Uncovered suites with a reason they have no CI job: path → one-line justification. */
const ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  'e2e/playwright.config.e2e.ts':
    'Electron E2E suite needs a packaged app build and a display; test:e2e:ci is referenced by no workflow',
});

const normalizePath = (value: string) => posix.normalize(value.replaceAll('\\', '/'));

const isSuiteConfig = (path: string) => SUITE_CONFIG.test(normalizePath(path));

/** Tracked and untracked (non-ignored) suite config files, repo-relative and sorted. */
function listSuiteConfigs(root = process.cwd()): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  return output.split('\0').filter(isSuiteConfig).sort();
}

/** The `run:` step bodies of a workflow file, shell comment lines dropped. */
function workflowRunSteps(workflow: string): string[] {
  const lines = workflow.split('\n');
  const steps: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('#')) continue;
    const match = RUN_STEP.exec(line);
    if (!match) continue;
    const value = (match[2] ?? '').trim();
    if (!BLOCK_SCALAR.test(value)) {
      steps.push(value.replace(/^(['"])(.*)\1$/, '$2'));
      continue;
    }
    const keyColumn = line.indexOf('run:');
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      const indent = next.length - next.trimStart().length;
      if (next.trim() !== '' && indent <= keyColumn) break;
      index += 1;
      if (!next.trim().startsWith('#')) body.push(next.trim());
    }
    steps.push(body.join('\n'));
  }
  return steps;
}

const commandSegments = (text: string) =>
  text
    .split(SHELL_CHAIN)
    .map((segment) => segment.trim())
    .filter(Boolean);

const tokens = (segment: string) =>
  segment.split(/\s+/).map((token) => token.replace(/^(['"])(.*)\1$/, '$2'));

/** Package scripts a command invokes: `pnpm run <s>`, `pnpm <s>`, `node scripts/pnpm-run.mjs <s>`. */
function invokedScripts(command: string, scripts: Scripts): string[] {
  const names: string[] = [];
  for (const segment of commandSegments(command)) {
    const words = tokens(segment);
    for (let index = 0; index < words.length - 1; index += 1) {
      const word = words[index];
      const next = words[index + 1];
      if (word === 'pnpm' || word.endsWith(`/${PNPM_RUN_WRAPPER}`) || word === PNPM_RUN_WRAPPER) {
        const target = next === 'run' && word === 'pnpm' ? words[index + 2] : next;
        if (target && SCRIPT_NAME.test(target) && target in scripts) names.push(target);
      }
    }
  }
  return names;
}

/** `root` plus every script it reaches transitively through the scripts graph. */
function scriptClosure(scripts: Scripts, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || !(name in scripts)) continue;
    seen.add(name);
    queue.push(...invokedScripts(scripts[name], scripts));
  }
  return seen;
}

const runnerOf = (words: string[]): Runner | undefined => {
  for (let index = 0; index < words.length; index += 1) {
    const word = basename(words[index]);
    if (word === 'vitest') return 'vitest';
    if (word === 'playwright' && words[index + 1] === 'test') return 'playwright';
  }
  return undefined;
};

const explicitConfig = (words: string[]): string | undefined => {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.startsWith('--config=')) return word.slice('--config='.length);
    if (word === '--config' || word === '-c') return words[index + 1];
  }
  return undefined;
};

const defaultConfig = (runner: Runner, suites: readonly string[]) =>
  suites.find((suite) => new RegExp(`^${runner}\\.config\\.[^/]+$`).test(suite)) ??
  `${runner}.config.ts`;

// A basename mention in a launcher's source: the name bounded by non-path
// characters, so `playwright-ct.config.ts` never stands in for `playwright.config.ts`.
const mentionsBasename = (source: string, suite: string) =>
  new RegExp(`(?:^|[^\\w./-])${basename(suite).replace(/[.]/g, '\\.')}(?![\\w.-])`).test(source);

const launcherFiles = (words: string[]): string[] =>
  words
    .filter(
      (word, index) =>
        index > 0 &&
        ['node', 'tsx'].includes(basename(words[index - 1])) &&
        LAUNCHER.test(word) &&
        word !== PNPM_RUN_WRAPPER,
    )
    .map(normalizePath);

/**
 * The suites one command line reaches: the config it names, the runner's
 * default config, or (one hop) the configs a launched `scripts/<file>` names.
 */
function suitesReferencedBy(
  command: string,
  suites: readonly string[],
  readLauncher: Reader,
): Set<string> {
  const reached = new Set<string>();
  const suiteSet = new Set(suites);
  for (const segment of commandSegments(command)) {
    const words = tokens(segment);
    const runner = runnerOf(words);
    if (runner) {
      const explicit = explicitConfig(words);
      const config = explicit ? normalizePath(explicit) : defaultConfig(runner, suites);
      if (suiteSet.has(config)) reached.add(config);
    }
    for (const launcher of launcherFiles(words)) {
      const source = readLauncher(launcher);
      if (source === undefined) continue;
      for (const suite of suites) if (mentionsBasename(source, suite)) reached.add(suite);
    }
  }
  return reached;
}

interface CoverageInput {
  suites: readonly string[];
  workflows: readonly string[];
  scripts: Scripts;
  readLauncher: Reader;
}

/** Suites reached from any workflow `run:` step, directly or via the scripts graph. */
function coveredSuites({ suites, workflows, scripts, readLauncher }: CoverageInput) {
  const steps = workflows.flatMap(workflowRunSteps);
  const roots = steps.flatMap((step) => invokedScripts(step, scripts));
  const commands = [...steps, ...[...scriptClosure(scripts, roots)].map((name) => scripts[name])];
  const covered = new Set<string>();
  for (const command of commands) {
    for (const suite of suitesReferencedBy(command, suites, readLauncher)) covered.add(suite);
  }
  return covered;
}

/** The `test*` scripts whose own command line references the suite. */
function referencingTestScripts(
  suite: string,
  scripts: Scripts,
  suites: readonly string[],
  readLauncher: Reader,
): string[] {
  return Object.keys(scripts)
    .filter((name) => name.startsWith('test'))
    .filter((name) => suitesReferencedBy(scripts[name], suites, readLauncher).has(suite))
    .sort();
}

interface CoverageReport {
  uncovered: string[];
  stale: string[];
}

function auditCoverage(
  input: CoverageInput,
  allowlist: Readonly<Record<string, string>> = ALLOWLIST,
): CoverageReport {
  const covered = coveredSuites(input);
  const uncovered = input.suites.filter((suite) => !covered.has(suite) && !(suite in allowlist));
  const stale = Object.keys(allowlist).filter(
    (suite) => !input.suites.includes(suite) || covered.has(suite),
  );
  return { uncovered, stale };
}

function describeUncovered(suites: string[], input: CoverageInput): string {
  return suites
    .map((suite) => {
      const scripts = referencingTestScripts(
        suite,
        input.scripts,
        input.suites,
        input.readLauncher,
      );
      const via = scripts.length
        ? `referenced by package scripts: ${scripts.join(', ')}`
        : 'referenced by no test* package script';
      return `  ${suite}\n    ${via}\n    fix: add a workflow run: step in ${WORKFLOWS_DIR}/ that reaches it (directly or through one of those scripts), or add an ALLOWLIST entry in ${THIS_FILE} with a one-line justification`;
    })
    .join('\n');
}

const readRepoFile: Reader = (path) => {
  const resolved = join(process.cwd(), path);
  return existsSync(resolved) ? readFileSync(resolved, 'utf-8') : undefined;
};

function readWorkflows(): string[] {
  const dir = join(process.cwd(), WORKFLOWS_DIR);
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf-8'));
}

describe('test-suite CI coverage detector', () => {
  const steps = (...runs: string[]) =>
    `jobs:\n  job:\n    steps:\n${runs
      .map((run) => `      - name: step\n        run: ${run}`)
      .join('\n')}\n`;
  const suites = [
    'e2e/playwright.config.e2e.ts',
    'playwright-ct.config.ts',
    'playwright.config.ts',
    'playwright.manual.config.ts',
    'tests/integration/vitest.integration.config.ts',
    'vitest.config.ts',
  ];
  const scripts: Scripts = {
    'test:unit': 'node scripts/check-deps-fresh.mjs && vitest run --config vitest.config.ts',
    'test:ui-invariants':
      'node scripts/check-deps-fresh.mjs && node scripts/ui-invariant-suites.mjs',
    'test:playwright': 'playwright test',
    'test:playwright:manual:browser-lifetime':
      'playwright test --config=playwright.manual.config.ts test/lifetime.spec.ts',
    'test:ct': 'node scripts/run-ct-tests.mjs',
    'test:integration': 'vitest run --config tests/integration/vitest.integration.config.ts',
    'test:integration:verbose':
      'VERBOSE=true vitest run --config tests/integration/vitest.integration.config.ts',
    'test:e2e:ci':
      'node scripts/pnpm-run.mjs build && playwright test --config=e2e/playwright.config.e2e.ts',
    'validate:architecture':
      'node scripts/pnpm-run.mjs lint:architecture && node scripts/pnpm-run.mjs test:ui-invariants',
    'lint:architecture': 'node scripts/check-saga-watcher-ownership.mjs',
    build: 'vite build',
  };
  const launchers: Record<string, string> = {
    'scripts/run-ct-tests.mjs': "args = ['test', '-c', 'playwright-ct.config.ts', ...forwarded];",
    'scripts/ui-invariant-suites.mjs': "[vitestBin, 'run', '--config', 'vitest.config.ts']",
    'scripts/check-deps-fresh.mjs': 'export {};',
  };
  const readLauncher: Reader = (path) => launchers[path];
  const input = (...workflows: string[]): CoverageInput => ({
    suites,
    workflows,
    scripts,
    readLauncher,
  });

  it('recognises suite config files by basename anywhere in the tree', () => {
    expect(suites.every(isSuiteConfig)).toBe(true);
    expect(isSuiteConfig('vitest.config.mts')).toBe(true);
    expect(isSuiteConfig('src/lib/card/operate-patterns.playwright.config.ts')).toBe(false);
    expect(isSuiteConfig('scripts/vitest-suite-files.mjs')).toBe(false);
    expect(isSuiteConfig('vite.config.mjs')).toBe(false);
  });

  it('extracts inline and block-scalar run: steps, dropping comment lines', () => {
    const workflow = [
      'steps:',
      '  - name: inline',
      '    run: pnpm run lint',
      '  - run: "pnpm run check"',
      '  # run: pnpm run test:playwright',
      '  - name: block',
      '    run: |',
      '      # shell comment naming pnpm run test:ct',
      '      pnpm install --frozen-lockfile',
      '',
      '      pnpm run test:unit --shard=1/2',
      '  - name: folded',
      '    run: >',
      '      pnpm run dist:linux',
      '      --flag',
      '  - name: after',
      '    uses: actions/upload-artifact@v4',
    ].join('\n');
    expect(workflowRunSteps(workflow)).toEqual([
      'pnpm run lint',
      'pnpm run check',
      'pnpm install --frozen-lockfile\n\npnpm run test:unit --shard=1/2',
      'pnpm run dist:linux\n--flag',
    ]);
  });

  it('extracts package-script invocations through env and wrapper prefixes and trailing args', () => {
    expect(
      invokedScripts(
        'xvfb-run -a pnpm run test:playwright:manual:browser-lifetime --workers=1 --reporter=list',
        scripts,
      ),
    ).toEqual(['test:playwright:manual:browser-lifetime']);
    expect(invokedScripts('CI=true corepack pnpm test:ct --grep x', scripts)).toEqual(['test:ct']);
    expect(invokedScripts('node scripts/pnpm-run.mjs test:unit; pnpm run build', scripts)).toEqual([
      'test:unit',
      'build',
    ]);
    expect(
      invokedScripts('pnpm install --frozen-lockfile && pnpm exec playwright install', scripts),
    ).toEqual([]);
  });

  it('expands the scripts graph transitively', () => {
    expect([...scriptClosure(scripts, ['validate:architecture'])].sort()).toEqual([
      'lint:architecture',
      'test:ui-invariants',
      'validate:architecture',
    ]);
  });

  it('resolves explicit, default, and launcher-named configs from one command line', () => {
    const reached = (command: string) => [...suitesReferencedBy(command, suites, readLauncher)];
    expect(reached('vitest run --config tests/integration/vitest.integration.config.ts')).toEqual([
      'tests/integration/vitest.integration.config.ts',
    ]);
    expect(reached('playwright test --config=e2e/playwright.config.e2e.ts --project=x')).toEqual([
      'e2e/playwright.config.e2e.ts',
    ]);
    expect(reached('playwright test -c playwright-ct.config.ts')).toEqual([
      'playwright-ct.config.ts',
    ]);
    expect(reached('vitest run src/a.test.ts')).toEqual(['vitest.config.ts']);
    expect(reached('playwright test --project=chromium')).toEqual(['playwright.config.ts']);
    expect(reached('node scripts/run-ct-tests.mjs --only-changed')).toEqual([
      'playwright-ct.config.ts',
    ]);
    expect(reached('node scripts/ui-invariant-suites.mjs')).toEqual(['vitest.config.ts']);
    expect(reached('node scripts/check-deps-fresh.mjs && playwright install chromium')).toEqual([]);
    expect(reached('pnpm exec playwright install chromium')).toEqual([]);
  });

  it('does not let a launcher mention of a similar basename stand in for the root config', () => {
    const reached = suitesReferencedBy('node scripts/run-ct-tests.mjs', suites, readLauncher);
    expect(reached.has('playwright.config.ts')).toBe(false);
  });

  it('covers every suite a workflow reaches directly or through the scripts graph', () => {
    const workflow = steps(
      'pnpm run test:unit --shard=${{ matrix.shard }}/2',
      'pnpm run test:integration',
      'pnpm run test:playwright --project=chromium --workers=1',
      'xvfb-run -a pnpm run test:playwright:manual:browser-lifetime --workers=1',
      'pnpm run test:ct --only-changed=HEAD',
    );
    expect(auditCoverage(input(workflow), {})).toEqual({
      uncovered: ['e2e/playwright.config.e2e.ts'],
      stale: [],
    });
    const allowlist = { 'e2e/playwright.config.e2e.ts': 'needs a packaged build' };
    expect(auditCoverage(input(workflow), allowlist)).toEqual({ uncovered: [], stale: [] });
  });

  it('reaches the default vitest config through validate:architecture → test:ui-invariants', () => {
    expect([...coveredSuites(input(steps('pnpm run validate:architecture')))]).toEqual([
      'vitest.config.ts',
    ]);
  });

  it('reports an unwired suite with the test* scripts that reference it', () => {
    const report = auditCoverage(input(steps('pnpm run test:unit', 'pnpm run test:ct')), {});
    expect(report.uncovered).toEqual([
      'e2e/playwright.config.e2e.ts',
      'playwright.config.ts',
      'playwright.manual.config.ts',
      'tests/integration/vitest.integration.config.ts',
    ]);
    const message = describeUncovered(['playwright.config.ts'], input());
    expect(message).toContain('playwright.config.ts');
    expect(message).toContain('referenced by package scripts: test:playwright');
    expect(message).toContain('add a workflow run: step');
    expect(message).toContain('ALLOWLIST');
  });

  it('flags allowlist entries whose suite is missing or now covered as stale', () => {
    const workflow = steps('pnpm run test:playwright');
    const allowlist = {
      'playwright.config.ts': 'covered now',
      'gone/vitest.config.ts': 'no such file',
    };
    expect(auditCoverage(input(workflow), allowlist).stale).toEqual([
      'playwright.config.ts',
      'gone/vitest.config.ts',
    ]);
  });
});

describe(`${WORKFLOWS_DIR} reaches every test-runner suite`, () => {
  const scripts: Scripts = JSON.parse(
    readFileSync(join(process.cwd(), PACKAGE_JSON_PATH), 'utf-8'),
  ).scripts;
  const suites = listSuiteConfigs();
  const input: CoverageInput = {
    suites,
    workflows: readWorkflows(),
    scripts,
    readLauncher: readRepoFile,
  };
  const report = auditCoverage(input);

  it('enumerates at least the root vitest and playwright configs', () => {
    expect(suites).toContain('vitest.config.ts');
    expect(suites).toContain('playwright.config.ts');
  });

  it('every suite is reached by a workflow run: step or allowlisted with a reason', () => {
    expect(
      report.uncovered,
      `test-runner suites no workflow step reaches:\n${describeUncovered(report.uncovered, input)}`,
    ).toEqual([]);
  });

  it('has no stale ALLOWLIST entry (suite missing, or reached by a workflow now)', () => {
    expect(
      report.stale,
      `stale ALLOWLIST entries in ${THIS_FILE} (remove them): ${report.stale.join(', ')}`,
    ).toEqual([]);
  });

  it('every ALLOWLIST entry carries a justification', () => {
    for (const [suite, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.trim(), `ALLOWLIST['${suite}'] needs a one-line justification`).not.toBe('');
    }
  });
});
