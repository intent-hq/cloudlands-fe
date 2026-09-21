// @verify-changed-triggers: .github/workflows/*.{yml,yaml}, package.json, **/*.config.*, scripts/**
// @vitest-environment node

/**
 * Every test-runner suite must be reached by CI.
 *
 * A suite is a Vitest or Playwright config file anywhere in the package: a
 * `vitest*.config.*` / `playwright*.config.*` by name, or any other
 * `*.config.{ts,js,...}` whose source imports a runner (`@playwright/test`,
 * `@playwright/experimental-ct-*`, `vitest`, `vitest/config`) — an import
 * statement or `require`, so a runner named only in a comment or a string is
 * not one (`eslint.config.js` quotes `@playwright/experimental-ct-svelte` in a
 * lint message). It is covered when some
 * workflow `run:` step reaches it — directly, or through the `package.json`
 * scripts graph (`pnpm run <s> [args]`, `pnpm <s> [args]`,
 * `node scripts/pnpm-run.mjs <s> [args]`, expanded transitively with the
 * forwarded args appended, as pnpm does) — by naming the config (`--config=X`,
 * `--config X`, `-c X`), by running the runner on its default config (`vitest`
 * → `vitest.config.*`, `playwright test` → `playwright.config.*`), or by
 * launching a local script (`node|tsx scripts/<file>`) whose source names the
 * config by path or basename. Only the word in executable position counts — past leading
 * `VAR=value`s and wrappers such as `cross-env` / `xvfb-run`, unwrapped from
 * `pnpm exec` / `npx` — so a script or runner named inside a quoted string or a
 * shell comment (`echo "run pnpm run test:x later"`) is data, not a command;
 * the quoted arguments of `sh -c`, `bash -c` and `concurrently` are the one
 * exception, parsed as command lines of their own. Folded (`>`) bodies and `\`
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
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const THIS_FILE = 'scripts/check-test-suite-ci-coverage.test.ts';
const WORKFLOWS_DIR = '.github/workflows';
const PACKAGE_JSON_PATH = 'package.json';
const SUITE_CONFIG = /(?:^|\/)(vitest|playwright)[^/]*\.config\.[^/]+$/;
const CONFIG_FILE = /\.config\.[cm]?[jt]s$/;
/** Module specifiers whose import makes a config file a test-runner suite. */
const RUNNER_MODULE = /^(?:@playwright\/(?:test|experimental-ct-[\w-]+)|vitest(?:\/config)?)$/;
const PNPM_RUN_WRAPPER = 'scripts/pnpm-run.mjs';
const RUN_STEP = /^(\s*)(?:-\s+)?run:(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^([|>])[-+0-9]*\s*(?:#.*)?$/;
const LINE_CONTINUATION = /\s*\\\n\s*/g;
const FOLDED_NEWLINE = /([^\n])\n(?=[^\n])/g;
const SCRIPT_NAME = /^[\w:.-]+$/;
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const LAUNCHER = /^scripts\/[\w./-]+$/;
const RUNNERS = ['vitest', 'playwright'] as const;
/** Commands that run the rest of their line as the command. */
const WRAPPERS = new Set(['cross-env', 'env', 'xvfb-run', 'corepack']);
/** Commands that run the bins named after them. */
const BIN_HOSTS = new Set(['pnpm', 'npx', 'pnpx']);
/** Shells whose `-c` operand is a command line; `concurrently` runs each quoted argument as one. */
const SHELLS = new Set(['sh', 'bash']);
/** A word the tokenizer would read back unchanged without quoting. */
const PLAIN_WORD = /^[\w@%+=:,./-]+$/;
const MAX_SCRIPT_HOPS = 16;

type Runner = (typeof RUNNERS)[number];
type Scripts = Record<string, string>;
type Reader = (path: string) => string | undefined;
/** One package-script call with the args pnpm forwards to it. */
interface Invocation {
  name: string;
  args: string[];
}
/** One shell word; `quoted` when any part of it was quoted. */
interface Word {
  text: string;
  quoted: boolean;
}

/** Uncovered suites with a reason they have no CI job: path → one-line justification. */
const ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  'src/lib/components/ui/card/operate-patterns.playwright.config.ts':
    '2026-09-21: manual macOS visual harness whose spec hardcodes a system Chrome path; no CI runner can host it',
  'e2e/build-smoke.config.ts':
    '2026-09-21, provisional: needs a packaged app; the follow-up PR "Run the build-smoke suite from a nightly/dispatch Linux workflow" wires it and removes this entry',
});

const normalizePath = (value: string) => posix.normalize(value.replaceAll('\\', '/'));

/** A reader of repo-relative paths under `root`: the file text, or `undefined` when absent. */
const fileReader =
  (root: string): Reader =>
  (path) => {
    const resolved = join(root, path);
    return existsSync(resolved) ? readFileSync(resolved, 'utf-8') : undefined;
  };

/** Whether `source` imports (or `require`s) a test runner; comments and strings do not count. */
const importsRunner = (source: string) =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.some(({ fileName }) => RUNNER_MODULE.test(fileName));

/**
 * A suite config: `vitest*.config.*` / `playwright*.config.*` by name (the
 * fast path, no read), or any other `*.config.{ts,js,...}` whose source
 * imports a runner.
 */
const isSuiteConfig = (path: string, readSource: Reader) => {
  const normalized = normalizePath(path);
  if (SUITE_CONFIG.test(normalized)) return true;
  if (!CONFIG_FILE.test(normalized)) return false;
  const source = readSource(normalized);
  return source !== undefined && importsRunner(source);
};

/** Tracked and untracked (non-ignored) suite config files, repo-relative and sorted. */
function listSuiteConfigs(root = process.cwd()): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  const readSource = fileReader(root);
  return output
    .split('\0')
    .filter((path) => isSuiteConfig(path, readSource))
    .sort();
}

const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, '$2');

/**
 * The `run:` step bodies of a workflow file: a folded (`>`) body joined on
 * spaces, `\` line continuations joined. Shell comments stay in the text and
 * are dropped by `commandSegments`, where quoting is known.
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
      steps.push(unquote(value));
      continue;
    }
    const keyColumn = line.indexOf('run:');
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      const indent = next.length - next.trimStart().length;
      if (next.trim() !== '' && indent <= keyColumn) break;
      index += 1;
      body.push(next.trim());
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

/**
 * A command line as the words of each simple command it runs. Splits on `&&`,
 * `||`, `|`, `;`, `&` and newlines outside quotes (`2>&1` stays a word), drops
 * quotes, treats a word-initial `#` as a comment to end of line, and appends
 * the command lines a nested runner executes — the `-c` operand of `sh`/`bash`,
 * each quoted argument of `concurrently` — parsed as command lines of their
 * own. Any other quoted string is one word of data.
 */
function commandSegments(text: string): string[][] {
  const segments: Word[][] = [];
  let words: Word[] = [];
  let current = '';
  let quoted = false;
  let open: string | undefined;
  const endWord = () => {
    if (current !== '' || quoted) words.push({ text: current, quoted });
    current = '';
    quoted = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (open) {
      if (char === open) open = undefined;
      else if (char === '\\' && open === '"' && next !== undefined) current += text[(index += 1)];
      else current += char;
    } else if (char === '"' || char === "'") {
      open = char;
      quoted = true;
    } else if (char === '\\' && next !== undefined) {
      current += text[(index += 1)];
    } else if (char === '#' && current === '' && !quoted) {
      while (index < text.length && text[index] !== '\n') index += 1;
      endSegment();
    } else if (char === '\n' || char === ';') {
      endSegment();
    } else if (char === '&' && next !== '&' && (text[index - 1] === '>' || next === '>')) {
      current += char;
    } else if (char === '&' || char === '|') {
      if (next === char || (char === '|' && next === '&')) index += 1;
      endSegment();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      current += char;
    }
  }
  endSegment();
  return segments.flatMap(expandNestedRunner);
}

function expandNestedRunner(words: Word[]): string[][] {
  const texts = words.map((word) => word.text);
  const at = commandIndex(texts);
  return [texts, ...nestedCommandLines(words, at).flatMap(commandSegments)];
}

/** The command lines a nested runner in executable position `at` executes. */
function nestedCommandLines(words: Word[], at: number): string[] {
  const program = basename(words[at]?.text ?? '');
  if (program === 'concurrently') {
    return words
      .slice(at + 1)
      .filter((word) => word.quoted)
      .map((word) => word.text);
  }
  if (!SHELLS.has(program)) return [];
  for (let index = at + 1; index < words.length; index += 1) {
    const option = words[index].text;
    if (!option.startsWith('-')) break;
    if (option.startsWith('--')) continue;
    if (option.includes('c')) return words[index + 1] ? [words[index + 1].text] : [];
    if (option.includes('o')) index += 1;
  }
  return [];
}

/** `word` quoted so the tokenizer reads it back as the same single word. */
const shellQuote = (word: string) =>
  PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** Index of the word in executable position: past leading `VAR=value`s, wrappers and their flags. */
function commandIndex(words: string[]): number {
  let index = 0;
  while (index < words.length) {
    if (ENV_ASSIGNMENT.test(words[index])) {
      index += 1;
      continue;
    }
    if (!WRAPPERS.has(basename(words[index]))) break;
    index += 1;
    while (index < words.length && words[index].startsWith('-')) index += 1;
  }
  return index;
}

/**
 * The program a simple command runs, unwrapped from a bin host
 * (`pnpm exec X`, `pnpm X`, `npx X`) and its flags, with the index of its word.
 */
function programOf(words: string[]): { index: number; name: string } {
  let index = commandIndex(words);
  const host = basename(words[index] ?? '');
  if (BIN_HOSTS.has(host)) {
    index += 1;
    while (index < words.length && words[index].startsWith('-')) index += 1;
    if (host === 'pnpm' && ['exec', 'dlx'].includes(words[index])) index += 1;
  }
  return { index, name: basename(words[index] ?? '') };
}

const isPnpmRunWrapper = (word: string | undefined) =>
  word === PNPM_RUN_WRAPPER || (word?.endsWith(`/${PNPM_RUN_WRAPPER}`) ?? false);

/**
 * Package scripts a command invokes in executable position — `pnpm run <s>`,
 * `pnpm <s>`, `node scripts/pnpm-run.mjs <s>` — each with the trailing args
 * pnpm forwards to the script (a separating `--` dropped).
 */
function invokedScripts(command: string, scripts: Scripts): Invocation[] {
  const invocations: Invocation[] = [];
  for (const words of commandSegments(command)) {
    const index = commandIndex(words);
    const word = words[index] ?? '';
    let at = -1;
    if (word === 'pnpm') at = words[index + 1] === 'run' ? index + 2 : index + 1;
    else if (isPnpmRunWrapper(word)) at = index + 1;
    else if (['node', 'tsx'].includes(basename(word)) && isPnpmRunWrapper(words[index + 1]))
      at = index + 2;
    const target = at < 0 ? undefined : words[at];
    if (target && SCRIPT_NAME.test(target) && target in scripts) {
      const args = words.slice(at + 1);
      invocations.push({ name: target, args: args[0] === '--' ? args.slice(1) : args });
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
      queue.push({
        command: [scripts[name], ...args.map(shellQuote)].join(' ').trim(),
        hops: hops + 1,
      });
    }
  }
  return commands;
}

const runnerOf = (words: string[]): Runner | undefined => {
  const { index, name } = programOf(words);
  if (name === 'vitest') return 'vitest';
  if (name === 'playwright' && words[index + 1] === 'test') return 'playwright';
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

// A mention of the suite in a launcher's source — its repo path or bare
// basename — bounded by non-path characters, so `playwright-ct.config.ts` never
// stands in for `playwright.config.ts` and `other/vitest.config.ts` never for
// the root one.
const mentionsSuite = (source: string, suite: string) => {
  const names = [...new Set([suite, basename(suite)])].map((name) => name.replaceAll('.', '\\.'));
  return new RegExp(`(?:^|[^\\w./-])(?:${names.join('|')})(?![\\w.-])`).test(source);
};

/** The `scripts/<file>` a `node|tsx [flags] <file>` command launches. */
const launcherFile = (words: string[]): string | undefined => {
  const { index, name } = programOf(words);
  if (!['node', 'tsx'].includes(name)) return undefined;
  let at = index + 1;
  while (at < words.length && words[at].startsWith('-')) at += 1;
  const file = words[at];
  return file && LAUNCHER.test(file) && file !== PNPM_RUN_WRAPPER ? normalizePath(file) : undefined;
};

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
  for (const words of commandSegments(command)) {
    const runner = runnerOf(words);
    if (runner) {
      const explicit = explicitConfig(words);
      const config = explicit ? normalizePath(explicit) : defaultConfig(runner, suites);
      if (suiteSet.has(config)) reached.add(config);
    }
    const launcher = launcherFile(words);
    const source = launcher === undefined ? undefined : readLauncher(launcher);
    if (source === undefined) continue;
    for (const suite of suites) if (mentionsSuite(source, suite)) reached.add(suite);
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
    'e2e/build-smoke.config.ts',
    'e2e/playwright.config.e2e.ts',
    'playwright-ct.config.ts',
    'playwright.config.ts',
    'playwright.manual.config.ts',
    'tests/integration/vitest.integration.config.ts',
    'vitest.config.ts',
  ];
  const scripts: Scripts = {
    'test:unit': 'node scripts/check-deps-fresh.mjs && vitest run --config vitest.config.ts',
    'test:build-smoke': 'tsx scripts/run-build-smoke-if-packaged.ts',
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
    'scripts/run-build-smoke-if-packaged.ts':
      "pnpmInvocation(['exec', 'playwright', 'test', '--config=e2e/build-smoke.config.ts']);",
    'scripts/check-deps-fresh.mjs': 'export {};',
  };
  const readLauncher: Reader = (path) => launchers[path];
  const input = (...workflows: string[]): CoverageInput => ({
    suites,
    workflows,
    scripts,
    readLauncher,
  });
  const configSources: Record<string, string> = {
    'e2e/build-smoke.config.ts':
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({});",
    'src/lib/card/operate-patterns.playwright.config.ts':
      "import { defineConfig, devices } from '@playwright/test';\n\nexport default defineConfig({ projects: [{ use: devices['Desktop Chrome'] }] });",
    'bench/perf.config.mts':
      "import { defineConfig } from 'vitest/config'\nexport default defineConfig({})",
    'src/ct-harness.config.ts':
      "import type { PlaywrightTestConfig } from '@playwright/experimental-ct-svelte';\nconst config: PlaywrightTestConfig = {};\nexport default config;",
    'legacy/vitest-runner.config.cjs':
      "module.exports = require('vitest/config').defineConfig({});",
    'foo.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});",
    'eslint.config.js':
      "// migrated off @playwright/test; see `import { test } from 'vitest'`\nexport default [{ rules: { 'no-restricted-imports': ['error', { name: '@playwright/experimental-ct-svelte' }] } }];",
    'scripts/vitest-suite-files.mjs': "import { defineConfig } from 'vitest/config';",
    'src/lib/runner.config.ts': 'export const doc = \'from "vitest/config"\';',
  };
  const readConfig: Reader = (path) => configSources[path];

  it('recognises suite config files by basename anywhere in the tree without reading them', () => {
    const unreadable: Reader = () => {
      throw new Error('read');
    };
    const byName = suites.filter((suite) => !(suite in configSources));
    expect(byName).toHaveLength(6);
    expect(byName.every((suite) => isSuiteConfig(suite, unreadable))).toBe(true);
    expect(isSuiteConfig('vitest.config.mts', unreadable)).toBe(true);
    expect(isSuiteConfig('scripts/vitest-suite-files.mjs', readConfig)).toBe(false);
    expect(isSuiteConfig('vite.config.mjs', readConfig)).toBe(false);
  });

  it('recognises any *.config.* whose source imports a test runner', () => {
    // Not `playwright*.config.*` by name: only the `@playwright/test` import makes it a suite.
    expect(isSuiteConfig('src/lib/card/operate-patterns.playwright.config.ts', readConfig)).toBe(
      true,
    );
    expect(isSuiteConfig('e2e/build-smoke.config.ts', readConfig)).toBe(true);
    expect(isSuiteConfig('bench/perf.config.mts', readConfig)).toBe(true);
    expect(isSuiteConfig('src/ct-harness.config.ts', readConfig)).toBe(true);
    expect(isSuiteConfig('legacy/vitest-runner.config.cjs', readConfig)).toBe(true);
    expect(isSuiteConfig('foo.config.ts', readConfig)).toBe(false);
    expect(isSuiteConfig('missing.config.ts', readConfig)).toBe(false);
  });

  it('ignores a runner named only in a comment or a string', () => {
    expect(isSuiteConfig('eslint.config.js', readConfig)).toBe(false);
    expect(isSuiteConfig('src/lib/runner.config.ts', readConfig)).toBe(false);
  });

  it('extracts inline and block-scalar run: steps, joining folded and continued lines', () => {
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
      '# shell comment naming pnpm run test:ct\npnpm install --frozen-lockfile\n\npnpm run test:unit --shard=1/2  # was: pnpm run test:playwright',
      'pnpm run dist:linux --flag',
      'pnpm exec playwright test --config=playwright.manual.config.ts',
    ]);
    expect(coveredSuites(input(workflow))).toEqual(
      new Set(['vitest.config.ts', 'playwright.manual.config.ts']),
    );
  });

  it('splits a command line into simple commands, quote-aware, dropping shell comments', () => {
    expect(commandSegments('echo skipped # pnpm run test:playwright')).toEqual([
      ['echo', 'skipped'],
    ]);
    expect(
      commandSegments('# pnpm run test:ct\npnpm run lint;pnpm run check&&echo "a && b" || echo c'),
    ).toEqual([
      ['pnpm', 'run', 'lint'],
      ['pnpm', 'run', 'check'],
      ['echo', 'a && b'],
      ['echo', 'c'],
    ]);
    expect(commandSegments('pnpm run test:unit 2>&1 | tee out.log &')).toEqual([
      ['pnpm', 'run', 'test:unit', '2>&1'],
      ['tee', 'out.log'],
    ]);
    expect(commandSegments(`echo "it's #1" 'say "hi"' --config="x y.ts" \\#tag`)).toEqual([
      ['echo', "it's #1", 'say "hi"', '--config=x y.ts', '#tag'],
    ]);
  });

  it('parses the -c operand of sh/bash and the quoted arguments of concurrently as command lines', () => {
    expect(commandSegments('concurrently -k "pnpm run test:unit" "pnpm run test:ct"')).toEqual([
      ['concurrently', '-k', 'pnpm run test:unit', 'pnpm run test:ct'],
      ['pnpm', 'run', 'test:unit'],
      ['pnpm', 'run', 'test:ct'],
    ]);
    expect(commandSegments(`bash -c 'echo "pnpm run test:ct" && pnpm run lint'`)).toEqual([
      ['bash', '-c', 'echo "pnpm run test:ct" && pnpm run lint'],
      ['echo', 'pnpm run test:ct'],
      ['pnpm', 'run', 'lint'],
    ]);
    expect(commandSegments("bash --noprofile -eo pipefail -xc 'pnpm run lint'")).toEqual([
      ['bash', '--noprofile', '-eo', 'pipefail', '-xc', 'pnpm run lint'],
      ['pnpm', 'run', 'lint'],
    ]);
    const nested = steps('sh -c "pnpm run test:playwright 2>&1 | tee out.log"');
    expect([...coveredSuites(input(nested))]).toEqual(['playwright.config.ts']);
  });

  it('treats only the -c operand as shell code: later operands are $0 and positional data', () => {
    expect(commandSegments("bash -c 'echo skipped' 'pnpm run test:playwright'")).toEqual([
      ['bash', '-c', 'echo skipped', 'pnpm run test:playwright'],
      ['echo', 'skipped'],
    ]);
    expect(commandSegments("sh 'pnpm run test:playwright'")).toEqual([
      ['sh', 'pnpm run test:playwright'],
    ]);
    expect(commandSegments("sh run.sh 'pnpm run test:playwright'")).toEqual([
      ['sh', 'run.sh', 'pnpm run test:playwright'],
    ]);
    for (const run of [
      "bash -c 'echo skipped' 'pnpm run test:playwright'",
      "sh -e 'pnpm run test:playwright'",
      "bash -c 'echo skipped' -- 'pnpm run test:playwright'",
    ]) {
      expect(coveredSuites(input(steps(run))).size, run).toBe(0);
    }
  });

  it('keeps forwarded argument boundaries when re-parsing the expanded script', () => {
    const grep =
      'pnpm run test:playwright:manual:browser-lifetime --grep "nothing; pnpm run test:playwright"';
    expect(expandCommands(scripts, [grep])).toEqual([
      grep,
      `${scripts['test:playwright:manual:browser-lifetime']} --grep 'nothing; pnpm run test:playwright'`,
    ]);
    expect([...coveredSuites(input(steps(grep)))]).toEqual(['playwright.manual.config.ts']);
    for (const run of [
      `pnpm run test:playwright:manual:browser-lifetime --grep "a && pnpm run test:playwright"`,
      `pnpm run test:playwright:manual:browser-lifetime --grep 'x | pnpm run test:playwright'`,
      `pnpm run test:playwright:manual:browser-lifetime --grep "it's #1 ; pnpm run test:playwright"`,
      `pnpm run test:playwright:manual:browser-lifetime --grep "$(pnpm run test:playwright)"`,
    ]) {
      expect([...coveredSuites(input(steps(run)))], run).toEqual(['playwright.manual.config.ts']);
    }
    expect(shellQuote('--project=chromium')).toBe('--project=chromium');
    expect(shellQuote("it's; x")).toBe(String.raw`'it'\''s; x'`);
    expect(commandSegments(`echo ${shellQuote("it's; x")}`)).toEqual([['echo', "it's; x"]]);
  });

  it('finds the program in executable position past env assignments, wrappers and bin hosts', () => {
    expect(runnerOf(['REMOTE_ENV_PROFILE=standard', 'vitest', 'run'])).toBe('vitest');
    expect(
      runnerOf(['cross-env', 'CI=1', 'xvfb-run', '-a', 'pnpm', 'exec', 'playwright', 'test']),
    ).toBe('playwright');
    expect(runnerOf(['npx', '--no-install', 'vitest'])).toBe('vitest');
    expect(runnerOf(['pnpm', 'playwright', 'install'])).toBeUndefined();
    expect(runnerOf(['echo', 'vitest'])).toBeUndefined();
    expect(runnerOf(['ls', 'node_modules/.bin/playwright', 'test'])).toBeUndefined();
    expect(launcherFile(['node', '--max-old-space-size=4096', 'scripts/run-ct-tests.mjs'])).toBe(
      'scripts/run-ct-tests.mjs',
    );
    expect(launcherFile(['cat', 'scripts/run-ct-tests.mjs'])).toBeUndefined();
    expect(launcherFile(['node', 'scripts/pnpm-run.mjs', 'test:ct'])).toBeUndefined();
  });

  it('never counts a script or runner named as data: quoted, echoed, or commented', () => {
    for (const run of [
      'echo "use pnpm run test:playwright later"',
      "echo 'pnpm run test:playwright' 'playwright test'",
      'echo skipped # pnpm run test:playwright',
      'echo playwright test --config=playwright.manual.config.ts',
      'echo vitest run',
      'ls vitest.config.ts playwright.config.ts',
      'cat scripts/run-ct-tests.mjs scripts/ui-invariant-suites.mjs',
      'node scripts/dev-stack.mjs --build "pnpm run test:unit"',
      'echo skip && echo "pnpm run test:ct" | grep vitest',
    ]) {
      expect(coveredSuites(input(steps(run))).size, run).toBe(0);
      expect(invokedScripts(run, scripts), run).toEqual([]);
    }
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
    expect(reached('tsx scripts/run-build-smoke-if-packaged.ts')).toEqual([
      'e2e/build-smoke.config.ts',
    ]);
    expect(reached('node scripts/check-deps-fresh.mjs && playwright install chromium')).toEqual([]);
    expect(reached('pnpm exec playwright install chromium')).toEqual([]);
  });

  it('reaches a content-detected suite through the package script that launches it', () => {
    const workflow = steps(
      'PACKAGED_APP_PATH=dist-electron/linux-unpacked/intent pnpm run test:build-smoke',
    );
    expect([...coveredSuites(input(workflow))]).toEqual(['e2e/build-smoke.config.ts']);
  });

  it('does not let a launcher mention of a similar basename stand in for the root config', () => {
    const reached = suitesReferencedBy('node scripts/run-ct-tests.mjs', suites, readLauncher);
    expect(reached.has('playwright.config.ts')).toBe(false);
    const nested: Reader = () => "['--config', 'other/vitest.config.ts']";
    expect(suitesReferencedBy('node scripts/x.mjs', suites, nested).has('vitest.config.ts')).toBe(
      false,
    );
  });

  it('covers every suite a workflow reaches directly or through the scripts graph', () => {
    const workflow = steps(
      'pnpm run test:unit --shard=${{ matrix.shard }}/2',
      'pnpm run test:integration',
      'pnpm run test:playwright --project=chromium --workers=1',
      'xvfb-run -a pnpm run test:playwright:manual:browser-lifetime --workers=1',
      'pnpm run test:ct --only-changed=HEAD',
      'pnpm run test:build-smoke',
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
      'e2e/build-smoke.config.ts',
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
    readLauncher: fileReader(process.cwd()),
  };
  const report = auditCoverage(input);

  it('enumerates at least the root vitest and playwright configs', () => {
    expect(suites).toContain('vitest.config.ts');
    expect(suites).toContain('playwright.config.ts');
  });

  it('enumerates the content-detected suites, not a config that only quotes a runner', () => {
    expect(suites).toContain('e2e/build-smoke.config.ts');
    expect(suites).toContain('src/lib/components/ui/card/operate-patterns.playwright.config.ts');
    expect(suites).not.toContain('eslint.config.js');
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
