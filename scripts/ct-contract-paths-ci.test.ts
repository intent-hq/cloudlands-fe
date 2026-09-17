// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/ct-contract-paths.mjs
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
const CLI_INVOCATION = `${MODULE_PATH} --diff`;
const CT_OUTPUT = 'needs.release-fast-path.outputs.ct_required';
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
// scripts/, one base commit and one head commit on top of it.
function checkoutWith(headFile: string, moduleSource?: string) {
  const root = temporaryDirectory('ct-contract-paths-ci-');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'ct-contract-paths-ci test');
  git(root, 'config', 'user.email', 'ct-contract-paths-ci@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  if (moduleSource === undefined) copyFileSync(resolve(MODULE_PATH), join(root, MODULE_PATH));
  else writeFileSync(join(root, MODULE_PATH), moduleSource);
  commitFile(root, 'src/base.ts', '');
  const base = git(root, 'rev-parse', 'HEAD');
  commitFile(root, headFile, '// head');
  return { root, base };
}

const releaseFastPath = jobLines('release-fast-path');
const testCt = jobLines('test-ct');
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
    const outputs = releaseFastPath.indexOf('    outputs:');
    expect(outputs).toBeGreaterThan(-1);
    const block = releaseFastPath
      .slice(outputs + 1)
      .filter((text, index, rest) => rest.slice(0, index + 1).every((t) => t.startsWith('      ')));
    const output = block.find((text) => text.trim().startsWith('ct_required:'));
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

type Context = { event: string; ctRequired: string; fastPath: string; route: string };

// Evaluates a workflow `if:` expression built from `!cancelled()`, context
// lookups, string literals, ==/!=, &&, ||, and parentheses — the only forms the
// test-ct condition may use — against a substituted context.
function evaluateCondition(expression: string, context: Context): boolean {
  const lookups: Record<string, string> = {
    'github.event_name': context.event,
    [CT_OUTPUT]: context.ctRequired,
    [FAST_PATH_OUTPUT]: context.fastPath,
    'needs.route.result': context.route,
  };
  let source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  source = source.replaceAll('!cancelled()', 'true');
  for (const [name, value] of Object.entries(lookups)) {
    source = source.replaceAll(name, JSON.stringify(value));
  }
  source = source.replaceAll('!=', ' NE ').replaceAll('==', '===').replaceAll(' NE ', '!==');
  const residue = source.replace(/"[^"]*"|'[^']*'|true|===|!==|&&|\|\||[()\s]/g, '');
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
    fastPath: 'false',
    route: 'success',
  };
  it.each<[string, Partial<Context>, boolean]>([
    ['CT-relevant PR (contract path, spec, or golden)', {}, true],
    ['ordinary PR', { ctRequired: 'false' }, false],
    ['release-shaped PR touching package.json', { fastPath: 'true' }, false],
    ['PR whose relevance output is empty (fork / failed job)', { ctRequired: '' }, false],
    ['PR whose route failed', { route: 'failure' }, false],
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
  });

  // What a route failure (or fork-PR skip) leaves behind: every job that
  // runs on route's runners is skipped, so its result is 'skipped'.
  const heavySkipped = {
    RESULT_checks: 'skipped',
    RESULT_build_web: 'skipped',
    RESULT_test: 'skipped',
    RESULT_test_integration: 'skipped',
  };

  const runGate = (env: Record<string, string>) => bash(script, env, tmpdir());

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
