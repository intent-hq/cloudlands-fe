// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-contract-paths.mjs,
//   playwright/ct-spec-pattern.mjs
// @vitest-environment node

/**
 * CI wiring of the CT-contract path list (`scripts/ct-contract-paths.mjs`).
 *
 * `verify:changed` consumes the list locally; the PR workflow must consume the
 * same module so `test-ct` runs on `pull_request` when the diff touches a
 * CT-contract path (cloudlands-fe#2441 was ejected from the merge queue with 40
 * CT failures after green PR CI) or a CT spec / geometry golden
 * (cloudlands-fe#2533 changed 22 specs and 1 golden with CT skipped on the PR and
 * was ejected three times). The step script and the gate script are
 * extracted from the workflow and executed under bash across a scenario table,
 * and the `test-ct` `if:` expression is evaluated the same way, so the
 * assertions hold against runtime behaviour rather than source spelling.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/intent-pr.yml';
const MODULE_PATH = 'scripts/ct-contract-paths.mjs';
// The module's one local import; the workflow runs in a full checkout.
const SPEC_PATTERN_PATH = 'playwright/ct-spec-pattern.mjs';
const CLI_INVOCATION = `${MODULE_PATH} --diff`;
const CT_OUTPUT = 'needs.release-fast-path.outputs.ct_required';
const ROOT_PLAYWRIGHT_OUTPUT = 'needs.release-fast-path.outputs.root_playwright_required';
const FAST_PATH_OUTPUT = 'needs.release-fast-path.outputs.fast_path';

const workflow = readFileSync(resolve(WORKFLOW_PATH), 'utf-8');
const workflowLines = workflow.split('\n');

const isComment = (text: string) => text.trim().startsWith('#');

// Top-level job blocks live at a two-space indent under `jobs:`.
function jobLines(name: string): string[] {
  const start = workflowLines.indexOf(`  ${name}:`);
  if (start === -1) throw new Error(`job ${name} not found in ${WORKFLOW_PATH}`);
  const rest = workflowLines.slice(start + 1);
  const end = rest.findIndex((text) => /^ {2}[\w-]+:/.test(text));
  return rest.slice(0, end === -1 ? rest.length : end);
}

function jobField(lines: string[], key: string): string {
  const line = lines.find((text) => text.startsWith(`    ${key}:`));
  if (!line) throw new Error(`field ${key} not found`);
  return line.slice(`    ${key}:`.length).trim();
}

// Body of a `run: |` block for the named step, dedented to column 0.
function stepRunBlock(lines: string[], stepName: string): string {
  const step = lines.indexOf(`      - name: ${stepName}`);
  if (step === -1) throw new Error(`step ${stepName} not found`);
  const run = lines.findIndex((text, index) => index > step && text === '        run: |');
  if (run === -1) throw new Error(`step ${stepName} has no run block`);
  const body: string[] = [];
  for (const text of lines.slice(run + 1)) {
    if (text.trim() !== '' && !text.startsWith('          ')) break;
    body.push(text.slice(10));
  }
  return body.join('\n');
}

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryPaths.push(root);
  return root;
}

function bash(script: string, env: Record<string, string>, cwd: string) {
  const result = spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: cwd, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(root: string, file: string, content: string) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', `add ${file}`);
}

// A checkout shaped like the release-fast-path job: the real module under
// scripts/ (plus the shared spec-pattern module it imports) committed in the
// base, and one head commit on top of it. Extra `headFiles` land in the same
// head commit (`git diff --name-only` lists the commit's paths in sorted
// order), so the base..head diff names exactly the head files.
function checkoutWith(headFile: string, moduleSource?: string, headFiles: string[] = []) {
  const root = temporaryDirectory('ct-contract-paths-ci-');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'ct-contract-paths-ci test');
  git(root, 'config', 'user.email', 'ct-contract-paths-ci@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'playwright'), { recursive: true });
  copyFileSync(resolve(SPEC_PATTERN_PATH), join(root, SPEC_PATTERN_PATH));
  if (moduleSource === undefined) copyFileSync(resolve(MODULE_PATH), join(root, MODULE_PATH));
  else writeFileSync(join(root, MODULE_PATH), moduleSource);
  git(root, 'add', MODULE_PATH, SPEC_PATTERN_PATH);
  commitFile(root, 'src/base.ts', '');
  const base = git(root, 'rev-parse', 'HEAD');
  for (const file of headFiles) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '// head');
  }
  if (headFiles.length > 0) git(root, 'add', '--all');
  commitFile(root, headFile, '// head');
  return { root, base };
}

// Enough paths that the diff listing exceeds the pipe buffer (64 KiB on
// Linux): the relevance step pipes it through grep, and a grep that stops
// reading at the first match leaves the writer with SIGPIPE under pipefail.
const LARGE_DIFF_FILLER = Array.from(
  { length: 2000 },
  (_, i) => `src/features/example/long/component-${String(i).padStart(5, '0')}.svelte`,
);

// Deletes `file` (committed by the base) in a head commit on top of it.
function checkoutDeleting(file: string) {
  const root = temporaryDirectory('ct-contract-paths-ci-');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'ct-contract-paths-ci test');
  git(root, 'config', 'user.email', 'ct-contract-paths-ci@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  commitFile(root, file, '// base');
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'rm', '-q', file);
  git(root, 'commit', '-q', '-m', `delete ${file}`);
  return { root, base };
}

// The `outputs:` block of a job, one line per output.
function jobOutputs(lines: string[]): string[] {
  const outputs = lines.indexOf('    outputs:');
  expect(outputs).toBeGreaterThan(-1);
  return lines
    .slice(outputs + 1)
    .filter((text, index, rest) => rest.slice(0, index + 1).every((t) => t.startsWith('      ')));
}

const releaseFastPath = jobLines('release-fast-path');
const testCt = jobLines('test-ct');
const testPlaywright = jobLines('test-playwright');
const gate = jobLines('gate');

describe(`${WORKFLOW_PATH} consumes ${MODULE_PATH}`, () => {
  const invocations = workflowLines
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => !isComment(text) && text.includes(CLI_INVOCATION));

  it('invokes the module exactly once, from the release-fast-path job', () => {
    expect(invocations.map(({ line }) => line)).toHaveLength(1);
    expect(releaseFastPath.some((text) => !isComment(text) && text.includes(CLI_INVOCATION))).toBe(
      true,
    );
  });

  it('exposes the step result as the ct_required job output', () => {
    const output = jobOutputs(releaseFastPath).find((text) =>
      text.trim().startsWith('ct_required:'),
    );
    expect(output).toBeDefined();
    const stepId = /steps\.([\w-]+)\.outputs\.ct_required/.exec(output!)?.[1];
    expect(stepId).toBeDefined();
    expect(releaseFastPath).toContain(`        id: ${stepId}`);
  });

  describe('Evaluate CT relevance step', () => {
    const script = stepRunBlock(releaseFastPath, 'Evaluate CT relevance');

    const runStep = (root: string, base: string) => {
      const output = join(root, 'github-output');
      writeFileSync(output, '');
      const result = bash(script, { BASE_SHA: base, GITHUB_OUTPUT: output }, root);
      return { ...result, output: readFileSync(output, 'utf8').trim() };
    };

    it.each([
      ['a CT-contract path', 'src/lib/styles/tokens.css'],
      ['a CT spec', 'src/lib/components/ui/button/button.geometry.ct.spec.ts'],
      [
        'a geometry golden',
        'src/lib/components/workspace/__geometry__/workspace-hover-card.geometry.json',
      ],
    ])('writes ct_required=true when the diff touches %s', (_name, file) => {
      const { root, base } = checkoutWith(file);
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('ct_required=true');
    });

    it.each([
      ['a .svelte component only', 'src/features/agent/view.svelte'],
      ['a CT spec outside src/', 'test/added.ct.spec.ts'],
    ])('writes ct_required=false when the diff touches %s', (_name, file) => {
      const { root, base } = checkoutWith(file);
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('ct_required=false');
    });

    it('requires CT when the module exits non-zero (fail-safe)', () => {
      const { root, base } = checkoutWith('src/features/agent/view.svelte', 'process.exit(2);\n');
      const result = runStep(root, base);
      expect(result.status).toBe(0);
      expect(result.output).toBe('ct_required=true');
    });

    it('requires CT when the module prints no ct_required line (fail-safe)', () => {
      const { root, base } = checkoutWith('src/features/agent/view.svelte', 'console.log("");\n');
      const result = runStep(root, base);
      expect(result.status).toBe(0);
      expect(result.output).toBe('ct_required=true');
    });
  });
});

describe(`${WORKFLOW_PATH} computes root Playwright relevance in release-fast-path`, () => {
  const STEP_NAME = 'Evaluate root Playwright relevance';

  it('exposes the step result as the root_playwright_required job output', () => {
    const output = jobOutputs(releaseFastPath).find((text) =>
      text.trim().startsWith('root_playwright_required:'),
    );
    expect(output).toBeDefined();
    const stepId = /steps\.([\w-]+)\.outputs\.root_playwright_required/.exec(output!)?.[1];
    expect(stepId).toBeDefined();
    const step = releaseFastPath.indexOf(`      - name: ${STEP_NAME}`);
    expect(step).toBeGreaterThan(-1);
    expect(releaseFastPath[step + 1]).toBe(`        id: ${stepId}`);
  });

  describe(`${STEP_NAME} step`, () => {
    const script = stepRunBlock(releaseFastPath, STEP_NAME);

    const runStep = (root: string, base: string) => {
      const output = join(root, 'github-output');
      writeFileSync(output, '');
      const result = bash(script, { BASE_SHA: base, GITHUB_OUTPUT: output }, root);
      return { ...result, output: readFileSync(output, 'utf8').trim() };
    };

    it.each([
      ['a root spec', 'test/agent-avatar.spec.ts'],
      ['a root snapshot', 'test/agent-avatar.spec.ts-snapshots/stack-light-chromium-linux.png'],
      ['a root harness helper', 'test/helpers/harness.ts'],
      ['a nested root fixture', 'test/fixtures/nested/data.json'],
      ['the root Playwright config', 'playwright.config.ts'],
      ['the root spec pattern module', 'playwright/root-spec-pattern.mjs'],
      ['the CT spec pattern module the root one builds on', 'playwright/ct-spec-pattern.mjs'],
    ])('writes root_playwright_required=true when the diff adds %s', (_name, file) => {
      const { root, base } = checkoutWith(file);
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('root_playwright_required=true');
    });

    it('writes root_playwright_required=true when the diff deletes a root spec', () => {
      const { root, base } = checkoutDeleting('test/removed.spec.ts');
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('root_playwright_required=true');
    });

    // Regression: playwright.config.ts sorts before src/, so it is the first
    // line grep sees; the step used to report false on this diff under
    // pipefail whenever printf was still writing when grep -q exited.
    it('writes root_playwright_required=true when the config leads a diff larger than the pipe buffer', () => {
      const { root, base } = checkoutWith('playwright.config.ts', undefined, LARGE_DIFF_FILLER);
      const listing = git(root, 'diff', '--name-only', base, 'HEAD');
      expect(listing.split('\n')[0]).toBe('playwright.config.ts');
      expect(Buffer.byteLength(listing)).toBeGreaterThan(65536);
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = runStep(root, base);
        expect(result.status, result.stderr).toBe(0);
        expect(result.output, `attempt ${attempt}`).toBe('root_playwright_required=true');
      }
    });

    it('writes root_playwright_required=false on a diff larger than the pipe buffer with no root path', () => {
      const { root, base } = checkoutWith(
        'src/features/agent/view.svelte',
        undefined,
        LARGE_DIFF_FILLER,
      );
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('root_playwright_required=false');
    });

    it.each([
      ['a .svelte component only', 'src/features/agent/view.svelte'],
      ['a CT spec under src/', 'src/lib/components/ui/button/button.geometry.ct.spec.ts'],
      ['a src/ path containing test/', 'src/test/helpers.ts'],
      ['a test-prefixed sibling directory', 'test-results/last-run.json'],
      ['the CT Playwright config', 'playwright-ct.config.ts'],
      ['a file merely named like the config', 'playwright.config.ts.bak'],
      ['another playwright/ source', 'playwright/ct-port.ts'],
      ['a spec pattern module test', 'playwright/root-spec-pattern.test.ts'],
      ['a CT-contract path', 'src/lib/styles/tokens.css'],
    ])('writes root_playwright_required=false when the diff touches %s', (_name, file) => {
      const { root, base } = checkoutWith(file);
      const result = runStep(root, base);
      expect(result.status, result.stderr).toBe(0);
      expect(result.output).toBe('root_playwright_required=false');
    });

    it('requires the suite when git diff fails (fail-safe)', () => {
      const { root } = checkoutWith('src/features/agent/view.svelte');
      const result = runStep(root, '0000000000000000000000000000000000000000');
      expect(result.status).toBe(0);
      expect(result.output).toBe('root_playwright_required=true');
    });
  });
});

type Context = {
  event: string;
  ctRequired: string;
  rootPlaywrightRequired: string;
  fastPath: string;
  route: string;
  linuxBurst?: string;
  cancelled?: boolean;
  failed?: boolean;
};

// Evaluates a workflow `if:` expression built from `!cancelled()`, context
// lookups, string literals, ==/!=, &&, ||, and parentheses — the only forms the
// test-ct / test-playwright conditions may use — against a substituted context.
function evaluateCondition(expression: string, context: Context): boolean {
  const lookups: Record<string, string> = {
    'github.event_name': context.event,
    [CT_OUTPUT]: context.ctRequired,
    [ROOT_PLAYWRIGHT_OUTPUT]: context.rootPlaywrightRequired,
    [FAST_PATH_OUTPUT]: context.fastPath,
    'needs.route.result': context.route,
    'needs.route.outputs.linux_burst': context.linuxBurst ?? 'false',
  };
  let source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  source = source
    .replaceAll('cancelled()', String(context.cancelled ?? false))
    .replaceAll('failure()', String(context.failed ?? false));
  for (const [name, value] of Object.entries(lookups)) {
    source = source.replaceAll(name, JSON.stringify(value));
  }
  source = source.replaceAll('!=', ' NE ').replaceAll('==', '===').replaceAll(' NE ', '!==');
  const residue = source.replace(/"[^"]*"|'[^']*'|true|false|===|!==|&&|\|\||[!()\s]/g, '');
  if (residue !== '') throw new Error(`unsupported token(s) in if: expression: ${residue}`);
  return Boolean(new Function(`return (${source});`)());
}

describe('test-ct runs on pull_request when ct_required is true', () => {
  const condition = jobField(testCt, 'if');

  it('depends on release-fast-path and route', () => {
    const needs = jobField(testCt, 'needs');
    expect(needs).toContain('release-fast-path');
    expect(needs).toContain('route');
  });

  const ok: Context = {
    event: 'pull_request',
    ctRequired: 'true',
    rootPlaywrightRequired: 'false',
    fastPath: 'false',
    route: 'success',
  };
  it.each<[string, Partial<Context>, boolean]>([
    ['CT-relevant PR (contract path, spec, or golden)', {}, true],
    ['ordinary PR', { ctRequired: 'false' }, false],
    ['release-shaped PR touching package.json', { fastPath: 'true' }, false],
    ['PR whose relevance output is empty (fork / failed job)', { ctRequired: '' }, false],
    ['PR whose route failed', { route: 'failure' }, false],
    ['cancelled PR', { cancelled: true }, false],
    [
      'merge_group with empty outputs',
      { event: 'merge_group', ctRequired: '', fastPath: '' },
      true,
    ],
    [
      'merge_group whose route failed',
      { event: 'merge_group', ctRequired: '', fastPath: '', route: 'failure' },
      false,
    ],
    [
      'release-shaped merge_group entry',
      { event: 'merge_group', ctRequired: 'true', fastPath: 'true' },
      false,
    ],
    [
      'non-release merge_group entry with computed outputs',
      { event: 'merge_group', ctRequired: 'false', fastPath: 'false' },
      true,
    ],
  ])('%s → runs=%s', (_name, overrides, expected) => {
    expect(evaluateCondition(condition, { ...ok, ...overrides })).toBe(expected);
  });
});

describe('test-playwright runs on pull_request when root_playwright_required is true', () => {
  const condition = jobField(testPlaywright, 'if');

  it('depends on release-fast-path and route', () => {
    const needs = jobField(testPlaywright, 'needs');
    expect(needs).toContain('release-fast-path');
    expect(needs).toContain('route');
  });

  it('is keyed on root_playwright_required, not ct_required', () => {
    expect(condition).toContain(ROOT_PLAYWRIGHT_OUTPUT);
    expect(condition).not.toContain(CT_OUTPUT);
  });

  const ok: Context = {
    event: 'pull_request',
    ctRequired: 'false',
    rootPlaywrightRequired: 'true',
    fastPath: 'false',
    route: 'success',
  };
  it.each<[string, Partial<Context>, boolean]>([
    ['root-relevant PR (test/** or playwright.config.ts)', {}, true],
    ['ordinary PR', { rootPlaywrightRequired: 'false' }, false],
    [
      'CT-relevant PR that touches no root path',
      { ctRequired: 'true', rootPlaywrightRequired: 'false' },
      false,
    ],
    ['release-shaped PR touching package.json', { fastPath: 'true' }, false],
    [
      'PR whose relevance output is empty (fork / failed job)',
      { rootPlaywrightRequired: '' },
      false,
    ],
    ['PR whose route failed', { route: 'failure' }, false],
    ['fork PR whose route is skipped', { route: 'skipped' }, false],
    ['cancelled PR', { cancelled: true }, false],
    [
      'merge_group with empty outputs',
      { event: 'merge_group', rootPlaywrightRequired: '', fastPath: '' },
      true,
    ],
    [
      'merge_group whose route failed',
      { event: 'merge_group', rootPlaywrightRequired: '', fastPath: '', route: 'failure' },
      false,
    ],
    [
      'release-shaped merge_group entry',
      { event: 'merge_group', rootPlaywrightRequired: 'true', fastPath: 'true' },
      false,
    ],
    [
      'non-release merge_group entry with computed outputs',
      { event: 'merge_group', rootPlaywrightRequired: 'false', fastPath: 'false' },
      true,
    ],
  ])('%s → runs=%s', (_name, overrides, expected) => {
    expect(evaluateCondition(condition, { ...ok, ...overrides })).toBe(expected);
  });
});

describe('root Playwright hosted shards', () => {
  function step(name: string): string[] {
    const start = testPlaywright.indexOf(`      - name: ${name}`);
    if (start === -1) throw new Error(`root step ${name} not found`);
    const rest = testPlaywright.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith('      - '));
    return rest.slice(0, end === -1 ? rest.length : end);
  }

  function field(lines: string[], key: string): string {
    const line = lines.find((value) => value.trimStart().startsWith(`${key}:`));
    if (!line) throw new Error(`root field ${key} not found`);
    return line
      .trim()
      .slice(key.length + 1)
      .trim();
  }

  const expandShard = (value: string, shard: number) =>
    value.replaceAll('${{ matrix.shard }}', String(shard));
  const ok: Context = {
    event: 'pull_request',
    ctRequired: 'false',
    rootPlaywrightRequired: 'true',
    fastPath: 'false',
    route: 'success',
  };

  it('schedules both shards independently within the existing worker and memory budgets', () => {
    const shards: number[] = JSON.parse(field(testPlaywright, 'shard'));
    expect(shards).toEqual([1, 2]);
    expect(field(testPlaywright, 'fail-fast')).toBe('false');
    expect(
      new Set(shards.map((shard) => expandShard(jobField(testPlaywright, 'name'), shard))).size,
    ).toBe(shards.length);
    expect(jobField(testPlaywright, 'timeout-minutes')).toBe('45');
    expect(field(testPlaywright, 'NODE_OPTIONS').replaceAll("'", '')).toBe(
      '--max-old-space-size=4096',
    );
    expect(testPlaywright.some((line) => line.trimStart().startsWith('continue-on-error:'))).toBe(
      false,
    );
  });

  it.each([
    ['pull_request', 'false'],
    ['pull_request', 'true'],
    ['merge_group', 'false'],
    ['merge_group', 'true'],
  ])('provisions hosted runners on %s with linux_burst=%s', (event, linuxBurst) => {
    const context = { ...ok, event, linuxBurst };
    expect(evaluateCondition(jobField(testPlaywright, 'if'), context)).toBe(true);
    expect(jobField(testPlaywright, 'runs-on')).toBe('gh-linux-8x');
    expect(field(step('Setup Node.js'), 'cache').replaceAll("'", '')).toBe('pnpm');
    for (const name of ['Cache Playwright browsers', 'Install Playwright browsers']) {
      const condition = step(name).find((line) => line.trimStart().startsWith('if:'));
      expect(evaluateCondition(condition?.trim().slice(3).trim() ?? 'true', context)).toBe(true);
    }
    expect(field(step('Install Playwright browsers'), 'timeout-minutes')).toBe('8');
    expect(
      testPlaywright.some((line) => line.startsWith('      - name:') && line.includes('(tinybox)')),
    ).toBe(false);
  });

  it.each([1, 2])(
    'passes the complete selection for shard %i and preserves a failed exit',
    (shard) => {
      const root = temporaryDirectory('root-playwright-shard-');
      writeFileSync(join(root, 'pnpm'), '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "$TEST_EXIT"\n', {
        mode: 0o755,
      });
      const command = expandShard(field(step('Root Playwright tests'), 'run'), shard);
      for (const status of [0, 7]) {
        const result = bash(
          command,
          { PATH: `${root}:${process.env.PATH}`, TEST_EXIT: String(status) },
          root,
        );
        expect(result.status, result.stderr).toBe(status);
        expect(result.stdout.trim().split('\n')).toEqual([
          'run',
          'test:playwright',
          '--project=chromium',
          '--workers=1',
          `--shard=${shard}/2`,
          '--reporter=list,html',
        ]);
      }
      const install = bash(
        field(step('Install Playwright browsers'), 'run'),
        {
          PATH: `${root}:${process.env.PATH}`,
          TEST_EXIT: '7',
        },
        root,
      );
      expect(install.status).toBe(7);
      expect(install.stdout.trim().split('\n')).toEqual([
        'exec',
        'playwright',
        'install',
        'chromium',
      ]);
    },
  );

  it('retains separate reports for either failed or cancelled shards', () => {
    const upload = step('Upload playwright report');
    const name = field(upload, 'name');
    expect(new Set([expandShard(name, 1), expandShard(name, 2)]).size).toBe(2);
    expect(field(upload, 'retention-days')).toBe('7');
    expect(upload.filter((line) => /^ {12}\S/.test(line)).map((line) => line.trim())).toEqual([
      'playwright-report/',
      'test-results/',
    ]);
    for (const context of [{ failed: true }, { cancelled: true }, {}]) {
      expect(evaluateCondition(field(upload, 'if'), { ...ok, ...context })).toBe(
        'failed' in context || 'cancelled' in context,
      );
    }
  });
});

describe('CI Gate accepts a test-ct skip only through an output', () => {
  const script = stepRunBlock(gate, 'Check results')
    .replaceAll('${{ github.event_name }}', '"$EVENT_NAME"')
    .replace(
      /\$\{\{ needs\.([\w-]+)\.result \}\}/g,
      (_match, job: string) => `"$RESULT_${job.replaceAll('-', '_')}"`,
    );

  it('leaves no unsubstituted workflow expression', () => {
    expect(script).not.toContain('${{');
  });

  it('reads ct_required from the release-fast-path output', () => {
    const step = gate.indexOf('      - name: Check results');
    const env = gate.slice(step).find((text) => text.trim().startsWith('CT_REQUIRED:'));
    expect(env).toBe(`          CT_REQUIRED: \${{ ${CT_OUTPUT} }}`);
  });

  it('depends on route', () => {
    const start = gate.indexOf('    needs:');
    expect(start).toBeGreaterThan(-1);
    const end = gate.findIndex((text, index) => index > start && text.trim() === ']');
    expect(gate.slice(start, end).some((text) => text.trim() === 'route,')).toBe(true);
  });

  // test-playwright (the root Playwright suite) mirrors test-ct's gating
  // shape, so the CT scenarios drive both jobs with the same result and
  // relevance output; the root-specific rows below vary them independently.
  const results = (ct: string, event = 'pull_request') => ({
    EVENT_NAME: event,
    RESULT_route: 'success',
    RESULT_pr_title: event === 'merge_group' ? 'skipped' : 'success',
    RESULT_conflict_markers: event === 'merge_group' ? 'skipped' : 'success',
    RESULT_checks: 'success',
    RESULT_build_web: 'success',
    RESULT_test: 'success',
    RESULT_test_integration: event === 'merge_group' ? 'success' : 'skipped',
    RESULT_test_ct: ct,
    RESULT_test_playwright: ct,
    RESULT_monorepo_consumer_checks: 'success',
  });

  // What a route failure (or fork-PR skip) leaves behind: every job that
  // runs on route's runners is skipped, so its result is 'skipped'.
  const heavySkipped = {
    RESULT_checks: 'skipped',
    RESULT_build_web: 'skipped',
    RESULT_test: 'skipped',
    RESULT_test_integration: 'skipped',
  };

  const runGate = (env: Record<string, string>) =>
    bash(script, { ROOT_PLAYWRIGHT_REQUIRED: env.CT_REQUIRED ?? '', ...env }, tmpdir());

  it('waits for the root matrix and runs even when a shard fails or is cancelled', () => {
    const start = gate.indexOf('    needs:');
    const end = gate.findIndex((line, index) => index > start && line.trim() === ']');
    expect(gate.slice(start, end).some((line) => line.trim() === 'test-playwright,')).toBe(true);
    expect(jobField(gate, 'if')).toBe('always()');
  });

  it.each(['pull_request', 'merge_group'])('requires a successful root matrix on %s', (event) => {
    // GitHub supplies one aggregate result for a matrix in needs. With no
    // continue-on-error, any failed/cancelled leg must keep this gate red.
    for (const [aggregate, expected] of [
      ['success', 0],
      ['failure', 1],
      ['cancelled', 1],
      ['skipped', 1],
      ['', 1],
    ] as const) {
      const result = runGate({
        ...results('success', event),
        RESULT_test_playwright: aggregate,
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: 'true',
      });
      expect(result.status, `${aggregate}: ${result.stdout}${result.stderr}`).toBe(expected);
    }
  });

  it.each<[string, Record<string, string>, number]>([
    [
      'PR, no contract path, CT skipped',
      { ...results('skipped'), FAST_PATH: 'false', CT_REQUIRED: 'false' },
      0,
    ],
    [
      'PR, contract path, CT passed',
      { ...results('success'), FAST_PATH: 'false', CT_REQUIRED: 'true' },
      0,
    ],
    [
      'PR, contract path, CT failed',
      { ...results('failure'), FAST_PATH: 'false', CT_REQUIRED: 'true' },
      1,
    ],
    [
      'PR, contract path, CT skipped (route failure)',
      { ...results('skipped'), FAST_PATH: 'false', CT_REQUIRED: 'true' },
      1,
    ],
    [
      'PR, relevance output empty, CT skipped',
      { ...results('skipped'), FAST_PATH: 'false', CT_REQUIRED: '' },
      1,
    ],
    [
      'PR, release fast path, CT skipped',
      { ...results('skipped'), FAST_PATH: 'true', CT_REQUIRED: 'true' },
      0,
    ],
    [
      'PR, no contract path, CT cancelled',
      { ...results('cancelled'), FAST_PATH: 'false', CT_REQUIRED: 'false' },
      1,
    ],
    [
      'PR, release fast path, route failed, heavy jobs skipped',
      { ...results('skipped'), ...heavySkipped, RESULT_route: 'failure', FAST_PATH: 'true' },
      1,
    ],
    [
      'merge_group, release fast path, route failed, heavy jobs skipped',
      {
        ...results('skipped', 'merge_group'),
        ...heavySkipped,
        RESULT_route: 'failure',
        FAST_PATH: 'true',
        CT_REQUIRED: 'true',
      },
      1,
    ],
    [
      'fork PR, route skipped, heavy jobs skipped',
      { ...results('skipped'), ...heavySkipped, RESULT_route: 'skipped', FAST_PATH: '' },
      1,
    ],
    [
      'PR, release fast path, route cancelled, heavy jobs skipped',
      { ...results('skipped'), ...heavySkipped, RESULT_route: 'cancelled', FAST_PATH: 'true' },
      1,
    ],
    [
      'merge_group, CT passed',
      { ...results('success', 'merge_group'), FAST_PATH: '', CT_REQUIRED: '' },
      0,
    ],
    [
      'merge_group, CT skipped',
      { ...results('skipped', 'merge_group'), FAST_PATH: '', CT_REQUIRED: '' },
      1,
    ],
    [
      'merge_group, CT failed',
      { ...results('failure', 'merge_group'), FAST_PATH: '', CT_REQUIRED: '' },
      1,
    ],
    [
      'merge_group, release fast path, CT and heavy jobs skipped',
      {
        ...results('skipped', 'merge_group'),
        RESULT_checks: 'skipped',
        RESULT_build_web: 'skipped',
        RESULT_test: 'skipped',
        RESULT_test_integration: 'skipped',
        FAST_PATH: 'true',
        CT_REQUIRED: 'true',
      },
      0,
    ],
    [
      'merge_group, fast path false, CT skipped',
      { ...results('skipped', 'merge_group'), FAST_PATH: 'false', CT_REQUIRED: 'false' },
      1,
    ],
    [
      'merge_group, fast path false, integration skipped',
      {
        ...results('success', 'merge_group'),
        RESULT_test_integration: 'skipped',
        FAST_PATH: 'false',
        CT_REQUIRED: 'false',
      },
      1,
    ],
    [
      'merge_group, release fast path, CT failed',
      { ...results('failure', 'merge_group'), FAST_PATH: 'true', CT_REQUIRED: 'true' },
      1,
    ],
    [
      'PR, release fast path, monorepo consumer checks failed',
      {
        ...results('skipped'),
        RESULT_monorepo_consumer_checks: 'failure',
        FAST_PATH: 'true',
        CT_REQUIRED: 'true',
      },
      1,
    ],
    [
      'merge_group, monorepo consumer checks skipped',
      {
        ...results('success', 'merge_group'),
        RESULT_monorepo_consumer_checks: 'skipped',
        FAST_PATH: '',
        CT_REQUIRED: '',
      },
      1,
    ],
    [
      'PR, CT passed, no test/ path, root Playwright skipped',
      {
        ...results('success'),
        RESULT_test_playwright: 'skipped',
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: 'false',
      },
      0,
    ],
    [
      'PR, test/ path, root Playwright passed, CT skipped',
      {
        ...results('skipped'),
        RESULT_test_playwright: 'success',
        FAST_PATH: 'false',
        CT_REQUIRED: 'false',
        ROOT_PLAYWRIGHT_REQUIRED: 'true',
      },
      0,
    ],
    [
      'PR, test/ path, root Playwright failed',
      {
        ...results('success'),
        RESULT_test_playwright: 'failure',
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: 'true',
      },
      1,
    ],
    [
      'PR, test/ path, root Playwright skipped (route failure)',
      {
        ...results('success'),
        RESULT_test_playwright: 'skipped',
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: 'true',
      },
      1,
    ],
    [
      'PR, root relevance output empty, root Playwright skipped',
      {
        ...results('success'),
        RESULT_test_playwright: 'skipped',
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: '',
      },
      1,
    ],
    [
      'merge_group, fast path false, root Playwright skipped',
      {
        ...results('success', 'merge_group'),
        RESULT_test_playwright: 'skipped',
        FAST_PATH: 'false',
        CT_REQUIRED: 'true',
        ROOT_PLAYWRIGHT_REQUIRED: 'false',
      },
      1,
    ],
  ])('%s → exit %i', (_name, env, expected) => {
    const result = runGate(env);
    expect(result.status, result.stdout + result.stderr).toBe(expected);
  });

  it.each(['pull_request', 'merge_group'])(
    'on %s a route failure is rejected by the route check, not by a heavy-job fall-through',
    (event) => {
      const result = runGate({
        ...results('skipped', event),
        ...heavySkipped,
        RESULT_route: 'failure',
        FAST_PATH: 'true',
        CT_REQUIRED: 'true',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/^route result 'failure' not acceptable/m);
    },
  );
});
