// @verify-changed-triggers: .github/workflows/*.{yml,yaml}, package.json, **/vitest*.config.*,
//   **/playwright*.config.*, scripts/**
// @vitest-environment node

/**
 * Every test-runner suite must be reached by CI.
 *
 * A suite is a Vitest or Playwright config file (`vitest*.config.*`,
 * `playwright*.config.*`) anywhere in the package. It is covered when some
 * workflow `run:` step reaches it — directly, or through the `package.json`
 * scripts graph (`pnpm run <s> [args]`, `pnpm <s> [args]`,
 * `node scripts/pnpm-run.mjs <s> [args]`, expanded transitively with the
 * forwarded args appended, as pnpm does) — by naming the config (`--config=X`,
 * `--config X`, `-c X`), by running the runner on its default config (`vitest`
 * → `vitest.config.*`, `playwright test` → `playwright.config.*`), or by
 * launching a local script (`node|tsx scripts/<file>`) whose source names the
 * config basename. Shell comments never count; folded (`>`) bodies and `\`
 * line continuations are joined before matching. Anything else needs an
 * `ALLOWLIST` entry with a reason, and a stale entry fails too.
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
const BLOCK_SCALAR = /^([|>])[-+0-9]*\s*(?:#.*)?$/;
const SHELL_COMMENT = /(^|\s)#.*$/;
const LINE_CONTINUATION = /\s*\\\n\s*/g;
const FOLDED_NEWLINE = /([^\n])\n(?=[^\n])/g;
const SCRIPT_NAME = /^[\w:.-]+$/;
const SHELL_CHAIN = /\s*(?:&&|\|\||;|\n)\s*/;
const LAUNCHER = /^scripts\/[\w./-]+$/;
const RUNNERS = ['vitest', 'playwright'] as const;
const MAX_SCRIPT_HOPS = 16;

type Runner = (typeof RUNNERS)[number];
type Scripts = Record<string, string>;
type Reader = (path: string) => string | undefined;
/** One package-script call with the args pnpm forwards to it. */
interface Invocation {
  name: string;
  args: string[];
}

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

const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, '$2');

/** A shell line without its trailing `# comment`; `''` for a comment-only line. */
const stripComment = (line: string) => line.replace(SHELL_COMMENT, '').trim();

/**
 * The `run:` step bodies of a workflow file. Comments are dropped, a folded
 * (`>`) body is joined on spaces, and `\` line continuations are joined.
 */
function workflowRunSteps(workflow: string): string[] {
  const lines = workflow.split('\n');
  const steps: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('#')) continue;
    const match = RUN_STEP.exec(line);
    if (!match) continue;
    const value = (match[2] ?? '').trim();
    const block = BLOCK_SCALAR.exec(value);
    if (!block) {
      steps.push(stripComment(unquote(value)));
      continue;
    }
    const keyColumn = line.indexOf('run:');
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      const indent = next.length - next.trimStart().length;
      if (next.trim() !== '' && indent <= keyColumn) break;
      index += 1;
      const text = stripComment(next);
      if (text !== '' || next.trim() === '') body.push(text);
    }
    const joined = body.join('\n');
    steps.push(
      (block[1] === '>' ? joined.replace(FOLDED_NEWLINE, '$1 ') : joined).replace(
        LINE_CONTINUATION,
        ' ',
      ),
    );
  }
  return steps;
}

const commandSegments = (text: string) =>
  text
    .split(SHELL_CHAIN)
    .map((segment) => segment.trim())
    .filter(Boolean);

const tokens = (segment: string) => segment.split(/\s+/).map(unquote);

/**
 * Package scripts a command invokes — `pnpm run <s>`, `pnpm <s>`,
 * `node scripts/pnpm-run.mjs <s>` — each with the trailing args pnpm forwards
 * to the script (a separating `--` dropped).
 */
function invokedScripts(command: string, scripts: Scripts): Invocation[] {
  const invocations: Invocation[] = [];
  for (const segment of commandSegments(command)) {
    const words = tokens(segment);
    for (let index = 0; index < words.length - 1; index += 1) {
      const word = words[index];
      const next = words[index + 1];
      if (word === 'pnpm' || word.endsWith(`/${PNPM_RUN_WRAPPER}`) || word === PNPM_RUN_WRAPPER) {
        const at = next === 'run' && word === 'pnpm' ? index + 2 : index + 1;
        const target = words[at];
        if (target && SCRIPT_NAME.test(target) && target in scripts) {
          const args = words.slice(at + 1);
          invocations.push({ name: target, args: args[0] === '--' ? args.slice(1) : args });
        }
      }
    }
  }
  return invocations;
}

/**
 * The command lines `steps` run, transitively: each step, then every package
 * script it invokes with the forwarded args appended (as pnpm runs it), and so
 * on through the scripts graph.
 */
function expandCommands(scripts: Scripts, steps: readonly string[]): string[] {
  const commands: string[] = [];
  const seen = new Set<string>();
  const queue = steps.map((command) => ({ command, hops: 0 }));
  while (queue.length) {
    const { command, hops } = queue.shift()!;
    if (seen.has(command) || hops > MAX_SCRIPT_HOPS) continue;
    seen.add(command);
    commands.push(command);
    for (const { name, args } of invokedScripts(command, scripts)) {
      queue.push({ command: [scripts[name], ...args].join(' ').trim(), hops: hops + 1 });
    }
  }
  return commands;
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
  const covered = new Set<string>();
  for (const command of expandCommands(scripts, workflows.flatMap(workflowRunSteps))) {
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

  it('extracts inline and block-scalar run: steps, dropping comments and joining folded lines', () => {
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
      '      pnpm run test:unit --shard=1/2  # was: pnpm run test:playwright',
      '  - name: folded',
      '    run: >',
      '      pnpm run dist:linux',
      '      --flag',
      '  - name: continued',
      '    run: |',
      '      pnpm exec playwright test \\',
      '        --config=playwright.manual.config.ts',
      '  - name: after',
      '    uses: actions/upload-artifact@v4',
    ].join('\n');
    expect(workflowRunSteps(workflow)).toEqual([
      'pnpm run lint',
      'pnpm run check',
      'pnpm install --frozen-lockfile\n\npnpm run test:unit --shard=1/2',
      'pnpm run dist:linux --flag',
      'pnpm exec playwright test --config=playwright.manual.config.ts',
    ]);
  });

  it('ignores a script named only in a trailing shell comment', () => {
    const workflow = steps('echo skipped # pnpm run test:playwright');
    expect(workflowRunSteps(workflow)).toEqual(['echo skipped']);
    expect(coveredSuites(input(workflow)).size).toBe(0);
  });

  it('extracts package-script invocations through env and wrapper prefixes with forwarded args', () => {
    expect(
      invokedScripts(
        'xvfb-run -a pnpm run test:playwright:manual:browser-lifetime --workers=1 --reporter=list',
        scripts,
      ),
    ).toEqual([
      { name: 'test:playwright:manual:browser-lifetime', args: ['--workers=1', '--reporter=list'] },
    ]);
    expect(invokedScripts('CI=true corepack pnpm test:ct --grep x', scripts)).toEqual([
      { name: 'test:ct', args: ['--grep', 'x'] },
    ]);
    expect(invokedScripts('node scripts/pnpm-run.mjs test:unit; pnpm run build', scripts)).toEqual([
      { name: 'test:unit', args: [] },
      { name: 'build', args: [] },
    ]);
    expect(invokedScripts('pnpm run test:playwright -- --config x.ts', scripts)).toEqual([
      { name: 'test:playwright', args: ['--config', 'x.ts'] },
    ]);
    expect(
      invokedScripts('pnpm install --frozen-lockfile && pnpm exec playwright install', scripts),
    ).toEqual([]);
  });

  it('expands the scripts graph transitively into the command lines pnpm runs', () => {
    expect(expandCommands(scripts, ['pnpm run validate:architecture'])).toEqual([
      'pnpm run validate:architecture',
      scripts['validate:architecture'],
      scripts['lint:architecture'],
      scripts['test:ui-invariants'],
    ]);
    expect(expandCommands(scripts, ['pnpm run test:playwright --project=chromium'])).toEqual([
      'pnpm run test:playwright --project=chromium',
      'playwright test --project=chromium',
    ]);
    const recursive: Scripts = { loop: 'pnpm run loop --again' };
    expect(expandCommands(recursive, ['pnpm run loop']).length).toBeLessThanOrEqual(
      MAX_SCRIPT_HOPS + 2,
    );
  });

  it('applies a --config forwarded through pnpm run to the script, not its default', () => {
    const forwarded = steps('pnpm run test:playwright --config=playwright.manual.config.ts');
    expect([...coveredSuites(input(forwarded))]).toEqual(['playwright.manual.config.ts']);
    const folded =
      'jobs:\n  job:\n    steps:\n      - run: >\n          pnpm exec playwright test\n          --config=playwright.manual.config.ts\n';
    expect([...coveredSuites(input(folded))]).toEqual(['playwright.manual.config.ts']);
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
