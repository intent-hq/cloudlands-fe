// @vitest-environment node
// @verify-changed-triggers: ./vite-build.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(childSource: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vite-build-test-'));
  fixtures.push(dir);
  const wrapper = path.join(dir, 'vite-build.mjs');
  // Run the production wrapper unchanged, with only its Vite package replaced.
  copyFileSync(fileURLToPath(new URL('./vite-build.mjs', import.meta.url)), wrapper);
  const viteDir = path.join(dir, 'node_modules', 'vite');
  mkdirSync(viteDir, { recursive: true });
  writeFileSync(
    path.join(viteDir, 'package.json'),
    JSON.stringify({ name: 'vite', bin: { vite: 'cli.mjs' } }),
  );
  const child = path.join(viteDir, 'cli.mjs');
  writeFileSync(child, childSource);
  return { wrapper, child };
}

function run(script: string, args: string[] = [], nodeOptions?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_TEST_SECRET: 'private-test-value' };
  // Make heap-policy cases independent of host preloaders and heap overrides.
  delete env.NODE_OPTIONS;
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  const result = spawnSync(process.execPath, [script, ...args], {
    env,
    input: 'build input\n',
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('vite-build child termination', () => {
  // Windows emulates process.kill rather than reporting POSIX child signals.
  it.skipIf(process.platform === 'win32').each(['SIGTERM', 'SIGKILL'])(
    'reports an actual child %s while retaining wrapper exit 1',
    (signal) => {
      const { wrapper, child } = fixture(`process.kill(process.pid, ${JSON.stringify(signal)});`);
      const direct = run(child);
      expect(direct.status).toBeNull();
      expect(direct.signal).toBe(signal);

      const wrapped = run(wrapper);
      expect(wrapped.status).toBe(1);
      expect(wrapped.signal).toBeNull();
      expect(wrapped.stderr).toContain(signal);
      expect(wrapped.stderr).toMatch(/vite/i);
      expect(wrapped.stderr).not.toMatch(/private-test-value|NODE_OPTIONS|out of memory|OOM/i);
      expect(wrapped.stdout).toBe('');
    },
  );

  it.each([0, 1, 7])(
    'preserves exit %i and inherited input/output without a signal warning',
    (code) => {
      const { wrapper } = fixture(`
      import { readFileSync, writeSync } from 'node:fs';
      writeSync(1, readFileSync(0));
      writeSync(2, 'child diagnostic\\n');
      process.exit(${code});
    `);
      const result = run(wrapper);
      expect(result.status).toBe(code);
      expect(result.signal).toBeNull();
      expect(result.stdout).toBe('build input\n');
      expect(result.stderr).toBe('child diagnostic\n');
    },
  );

  it.each([
    [undefined, '--max-old-space-size=4608'],
    ['', '--max-old-space-size=4608'],
    ['--no-warnings', '--no-warnings --max-old-space-size=4608'],
    ['--no-warnings --max-old-space-size=512', '--no-warnings --max-old-space-size=512'],
    ['--max_old_space_size=512 --no-warnings', '--max_old_space_size=512 --no-warnings'],
  ])('preserves arguments and heap policy for NODE_OPTIONS=%s', (inherited, expected) => {
    const { wrapper } = fixture(`
      import { writeSync } from 'node:fs';
      writeSync(1, JSON.stringify({ args: process.argv.slice(2), options: process.env.NODE_OPTIONS }));
    `);
    const result = run(wrapper, ['--mode', 'test mode', '--emptyOutDir'], inherited);
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      args: ['build', '--mode', 'test mode', '--emptyOutDir'],
      options: expected,
    });
  });
});
