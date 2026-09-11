/**
 * CI architecture-gate single-entry-point guard.
 *
 * The PR workflow must reach every repo-wide architecture scanner through
 * `pnpm run validate:architecture` (which chains `lint:architecture`), never
 * by invoking a `scripts/check-*.mjs` scanner as its own workflow step. A scan
 * that exists only as a workflow step is invisible to `verify:changed`, so the
 * local gate passes while CI fails (cloudlands-fe#2315); a scan that exists in
 * both places runs twice and has to be audited for parity by hand
 * (cloudlands-fe#2331). Keeping the workflow to one invocation makes the two
 * unable to drift by construction.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/intent-pr.yml';
const SINGLE_ENTRY_POINT = 'pnpm run validate:architecture';
const DIRECT_SCANNER = /scripts\/check-[\w-]+\.mjs/;

interface WorkflowLine {
  line: number;
  text: string;
}

const codeLines = (workflow: string): WorkflowLine[] =>
  workflow
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => !text.trim().startsWith('#'));

const findDirectScannerInvocations = (workflow: string): WorkflowLine[] =>
  codeLines(workflow).filter(({ text }) => DIRECT_SCANNER.test(text));

const findArchitectureEntryPoints = (workflow: string): WorkflowLine[] =>
  codeLines(workflow).filter(({ text }) => text.includes(SINGLE_ENTRY_POINT));

const describeLines = (lines: WorkflowLine[]) =>
  lines.map(({ line, text }) => `${WORKFLOW_PATH}:${line}: ${text.trim()}`).join('\n');

describe('CI architecture gate detector', () => {
  const steps = (...runs: string[]) =>
    runs.map((run) => `      - name: step\n        run: ${run}`).join('\n');

  it('accepts a workflow whose only architecture step is validate:architecture', () => {
    const workflow = steps('pnpm run lint', SINGLE_ENTRY_POINT, 'pnpm run build:main');
    expect(findDirectScannerInvocations(workflow)).toEqual([]);
    expect(findArchitectureEntryPoints(workflow)).toHaveLength(1);
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

  it('invokes no scripts/check-*.mjs scanner directly', () => {
    const offenders = findDirectScannerInvocations(workflow);
    expect(
      offenders,
      `architecture scanners belong in lint:architecture (package.json), not in workflow steps:\n${describeLines(offenders)}`,
    ).toEqual([]);
  });

  it(`invokes ${SINGLE_ENTRY_POINT} exactly once`, () => {
    const entryPoints = findArchitectureEntryPoints(workflow);
    expect(entryPoints, describeLines(entryPoints)).toHaveLength(1);
  });
});
