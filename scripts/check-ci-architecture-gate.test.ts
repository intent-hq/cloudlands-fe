// @verify-changed-triggers: .github/workflows/intent-pr.yml, package.json

/**
 * CI architecture-gate single-entry-point guard.
 *
 * The PR workflow must reach every repo-wide architecture scanner through
 * `pnpm run validate:architecture` (which chains `lint:architecture`), never
 * by invoking a `scripts/check-*.mjs` scanner as its own workflow step and
 * never through another package script that wraps one of those scanners
 * (`lint:dispatch-gate`, `lint:agent-architecture`, …). A scan that exists
 * only as a workflow step is invisible to `verify:changed`, so the local gate
 * passes while CI fails (cloudlands-fe#2315); a scan that exists in both
 * places runs twice and has to be audited for parity by hand
 * (cloudlands-fe#2331). Keeping the workflow to one invocation makes the two
 * unable to drift by construction.
 *
 * The wrapper set is derived from `package.json`, not listed: every scanner
 * reachable from `lint:architecture` is an architecture gate, and every script
 * whose transitive `pnpm run` chain executes one of them is a wrapper.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/intent-pr.yml';
const PACKAGE_JSON_PATH = 'package.json';
const ENTRY_POINT_SCRIPT = 'validate:architecture';
const GATE_SCRIPT = 'lint:architecture';
const SINGLE_ENTRY_POINT = `pnpm run ${ENTRY_POINT_SCRIPT}`;
const DIRECT_SCANNER = /scripts\/check-[\w-]+\.mjs/;
const PNPM_RUN = /pnpm run ([\w:.-]+)/g;

type Scripts = Record<string, string>;

interface WorkflowLine {
  line: number;
  text: string;
}

const codeLines = (workflow: string): WorkflowLine[] =>
  workflow
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => !text.trim().startsWith('#'));

const runTargets = (text: string): string[] => [...text.matchAll(PNPM_RUN)].map(([, name]) => name);

const scriptClosure = (scripts: Scripts, root: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name) || !(name in scripts)) continue;
    seen.add(name);
    queue.push(...runTargets(scripts[name]));
  }
  return seen;
};

const architectureScanners = (scripts: Scripts): Set<string> => {
  const scanners = new Set<string>();
  for (const name of scriptClosure(scripts, GATE_SCRIPT)) {
    for (const [scanner] of scripts[name].matchAll(new RegExp(DIRECT_SCANNER, 'g'))) {
      scanners.add(scanner);
    }
  }
  return scanners;
};

const architectureGateWrappers = (scripts: Scripts): Set<string> => {
  const scanners = architectureScanners(scripts);
  const runsScanner = (name: string) =>
    [...scriptClosure(scripts, name)].some((member) =>
      [...scanners].some((scanner) => scripts[member].includes(scanner)),
    );
  return new Set(Object.keys(scripts).filter(runsScanner));
};

const findDirectScannerInvocations = (workflow: string): WorkflowLine[] =>
  codeLines(workflow).filter(({ text }) => DIRECT_SCANNER.test(text));

const findWrapperInvocations = (workflow: string, scripts: Scripts): WorkflowLine[] => {
  const wrappers = architectureGateWrappers(scripts);
  wrappers.delete(ENTRY_POINT_SCRIPT);
  return codeLines(workflow).filter(({ text }) =>
    runTargets(text).some((name) => wrappers.has(name)),
  );
};

const findArchitectureEntryPoints = (workflow: string): WorkflowLine[] =>
  codeLines(workflow).filter(({ text }) => text.includes(SINGLE_ENTRY_POINT));

const describeLines = (lines: WorkflowLine[]) =>
  lines.map(({ line, text }) => `${WORKFLOW_PATH}:${line}: ${text.trim()}`).join('\n');

describe('CI architecture gate detector', () => {
  const steps = (...runs: string[]) =>
    runs.map((run) => `      - name: step\n        run: ${run}`).join('\n');
  const scripts: Scripts = {
    'validate:architecture': `node scripts/check-deps-fresh.mjs && pnpm run ${GATE_SCRIPT}`,
    'lint:architecture':
      'pnpm run lint:agent-dispatchers && node scripts/check-saga-watcher-ownership.mjs',
    'lint:agent-dispatchers':
      'node scripts/check-workspace-event-dispatchers.mjs src/features/agent',
    'lint:dispatch-gate': 'node scripts/check-workspace-event-dispatchers.mjs',
    'verify:agent-operability': 'pnpm run lint:dispatch-gate && pnpm run lint',
    lint: 'node scripts/check-deps-fresh.mjs && eslint . && pnpm run lint:i18n-strings',
    'lint:i18n-strings': 'node scripts/check-hardcoded-strings.mjs',
    'test:unit': 'node scripts/check-deps-fresh.mjs && vitest run',
  };

  it('accepts a workflow whose only architecture step is validate:architecture', () => {
    const workflow = steps('pnpm run lint', SINGLE_ENTRY_POINT, 'pnpm run build:main');
    expect(findDirectScannerInvocations(workflow)).toEqual([]);
    expect(findWrapperInvocations(workflow, scripts)).toEqual([]);
    expect(findArchitectureEntryPoints(workflow)).toHaveLength(1);
  });

  it('derives the wrapper set from lint:architecture, not from script names', () => {
    expect([...architectureScanners(scripts)].sort()).toEqual([
      'scripts/check-saga-watcher-ownership.mjs',
      'scripts/check-workspace-event-dispatchers.mjs',
    ]);
    expect([...architectureGateWrappers(scripts)].sort()).toEqual([
      'lint:agent-dispatchers',
      'lint:architecture',
      'lint:dispatch-gate',
      'validate:architecture',
      'verify:agent-operability',
    ]);
  });

  it('flags a package-script wrapper around an architecture scanner with its line', () => {
    const workflow = steps(
      'pnpm run lint',
      'pnpm run lint:dispatch-gate',
      SINGLE_ENTRY_POINT,
      'pnpm run verify:agent-operability',
    );
    expect(findWrapperInvocations(workflow, scripts).map(({ line }) => line)).toEqual([4, 8]);
  });

  it('does not flag scripts that run only non-architecture scanners', () => {
    const workflow = steps('pnpm run lint', 'pnpm run test:unit', SINGLE_ENTRY_POINT);
    expect(findWrapperInvocations(workflow, scripts)).toEqual([]);
  });

  it('flags a scanner invoked as its own workflow step with its line', () => {
    const workflow = steps(
      'bash scripts/check-accessibility.sh',
      'node scripts/check-workspace-event-dispatchers.mjs',
      SINGLE_ENTRY_POINT,
    );
    expect(findDirectScannerInvocations(workflow)).toEqual([
      { line: 4, text: '        run: node scripts/check-workspace-event-dispatchers.mjs' },
    ]);
  });

  it('flags a scanner buried inside a multi-line run block', () => {
    const workflow = `      - name: step\n        run: |\n          pnpm run lint\n          node scripts/check-saga-watcher-ownership.mjs\n`;
    expect(findDirectScannerInvocations(workflow).map(({ line }) => line)).toEqual([4]);
  });

  it('ignores comments that mention a scanner path', () => {
    const workflow = `      # see scripts/check-deps-fresh.mjs\n${steps(SINGLE_ENTRY_POINT)}`;
    expect(findDirectScannerInvocations(workflow)).toEqual([]);
  });

  it('counts every validate:architecture invocation', () => {
    const workflow = steps(SINGLE_ENTRY_POINT, SINGLE_ENTRY_POINT);
    expect(findArchitectureEntryPoints(workflow)).toHaveLength(2);
  });
});

describe(WORKFLOW_PATH, () => {
  const workflow = readFileSync(join(process.cwd(), WORKFLOW_PATH), 'utf-8');
  const scripts: Scripts = JSON.parse(
    readFileSync(join(process.cwd(), PACKAGE_JSON_PATH), 'utf-8'),
  ).scripts;

  it(`${ENTRY_POINT_SCRIPT} chains ${GATE_SCRIPT}`, () => {
    expect([...scriptClosure(scripts, ENTRY_POINT_SCRIPT)]).toContain(GATE_SCRIPT);
    expect(architectureScanners(scripts).size).toBeGreaterThan(0);
  });

  it('invokes no scripts/check-*.mjs scanner directly', () => {
    const offenders = findDirectScannerInvocations(workflow);
    expect(
      offenders,
      `architecture scanners belong in lint:architecture (package.json), not in workflow steps:\n${describeLines(offenders)}`,
    ).toEqual([]);
  });

  it(`invokes no package script that wraps an architecture scanner other than ${ENTRY_POINT_SCRIPT}`, () => {
    const offenders = findWrapperInvocations(workflow, scripts);
    expect(
      offenders,
      `architecture gates reach CI only through ${SINGLE_ENTRY_POINT}; fold the gate into lint:architecture instead:\n${describeLines(offenders)}`,
    ).toEqual([]);
  });

  it(`invokes ${SINGLE_ENTRY_POINT} exactly once`, () => {
    const entryPoints = findArchitectureEntryPoints(workflow);
    expect(entryPoints, describeLines(entryPoints)).toHaveLength(1);
  });
});
