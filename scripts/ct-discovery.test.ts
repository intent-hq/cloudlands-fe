import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const launcher = path.join(repoRoot, 'scripts', 'run-ct-tests.mjs');

function runLauncher(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [launcher, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', rejectPromise);
    child.on('exit', (code) => resolvePromise({ code, output }));
  });
}

describe('playwright component-test discovery (run-ct-tests.mjs)', () => {
  // Regression test for intent-hq/monorepo#1586: running playwright-ct.config.ts
  // with the repo's top-level (newer) playwright runner crashes in ct-core's
  // babel transform before discovery. The launcher pins the runner to the
  // version @playwright/experimental-ct-core depends on; discovery via --list
  // must succeed and find at least one test.
  it('lists at least one CT test with exit code 0', async () => {
    const { code, output } = await runLauncher(['--list', '--reporter=list']);
    expect(code, `launcher output:\n${output}`).toBe(0);

    const totals = output.match(/Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/);
    expect(totals, `expected a "Total: N tests in M files" line in:\n${output}`).not.toBeNull();
    expect(Number(totals![1])).toBeGreaterThanOrEqual(1);
    expect(Number(totals![2])).toBeGreaterThanOrEqual(1);
    // First run compiles the CT transform and is slow; be generous.
  }, 120_000);
});
