// @verify-changed-triggers: scripts/run-ct-tests.mjs, playwright-ct.config.ts,
//   src/lib/components/chat/__tests__/chat-message-navigator.ct.spec.ts,
//   src/lib/components/chat/__tests__/ChatMessageNavigatorIntegrationHost.svelte,
//   src/lib/components/chat/__tests__/ChatMessageNavigatorHost.svelte

import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');
const launcher = path.join(repoRoot, 'scripts', 'run-ct-tests.mjs');
const navigatorTestDir = path.join(repoRoot, 'src/lib/components/chat/__tests__');

// Importing the navigator spec under vitest walks its real import graph. The CT
// harness is replaced by an inert stub (every `test.*` call is a no-op) and the
// production integration fixture by a factory that records the import, so the
// spec proves which host it mounts without its source being read as text.
const fixtureImports = vi.hoisted(() => ({ integrationHost: false }));

vi.mock('../src/test/ct-test', () => {
  const inert: unknown = new Proxy(() => inert, { get: () => inert });
  return { test: inert, expect: inert };
});
vi.mock('../src/lib/components/chat/__tests__/ChatMessageNavigatorIntegrationHost.svelte', () => {
  fixtureImports.integrationHost = true;
  return { default: {} };
});

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
    expect(output).toContain('chat-message-navigator.ct.spec.ts');
    expect(output).toContain('chat message navigator production path');
    // First run compiles the CT transform and is slow; be generous.
  }, 120_000);

  // The "production path" navigator test listed above must mount the integration
  // host; the legacy standalone host must stay deleted.
  it('keeps navigator discovery on the production integration fixture', async () => {
    await import('../src/lib/components/chat/__tests__/chat-message-navigator.ct.spec.ts');
    expect(fixtureImports.integrationHost).toBe(true);
    expect(existsSync(path.join(navigatorTestDir, 'ChatMessageNavigatorHost.svelte'))).toBe(false);
  });
});
