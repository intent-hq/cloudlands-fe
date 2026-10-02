// @verify-changed-triggers: package.json, scripts/run-unit-tests.mjs
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pnpmInvocation } from './pnpm-launcher.mjs';

const repo = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(realVitest = false) {
  const root = mkdtempSync(join(tmpdir(), 'test-unit-args-'));
  roots.push(root);
  const write = (file: string, content: string, mode?: number) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content, { mode });
  };
  write(
    'package.json',
    JSON.stringify({
      type: 'module',
      packageManager: manifest.packageManager,
      scripts: { 'test:unit': manifest.scripts['test:unit'] },
    }),
  );
  write(
    'scripts/check-deps-fresh.mjs',
    `import { appendFileSync } from 'node:fs';
appendFileSync('children.jsonl', JSON.stringify({ child: 'prepare', args: process.argv.slice(2) }) + '\\n');
if (process.env.PREP_SIGNAL) process.kill(process.pid, process.env.PREP_SIGNAL);
else process.exitCode = Number(process.env.PREP_EXIT || 0);
`,
  );
  const launcher = join(repo, 'scripts/run-unit-tests.mjs');
  copyFileSync(launcher, join(root, 'scripts/run-unit-tests.mjs'));
  if (realVitest) {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(repo, 'node_modules/vitest'), join(root, 'node_modules/vitest'), 'junction');
    write('vitest.config.ts', "export default { test: { environment: 'node' } };\n");
    write(
      'selected file.test.js',
      `import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
it('selected name with spaces', () => { writeFileSync('selected-ran', 'yes'); expect(1 + 1).toBe(2); });
it('unselected name', () => { throw new Error('name filter was lost'); });
`,
    );
    write(
      'unselected.test.js',
      "import { it } from 'vitest'; it('selected name with spaces', () => { throw new Error('file filter was lost'); });\n",
    );
  } else {
    write(
      'node_modules/vitest/vitest.mjs',
      `import { appendFileSync } from 'node:fs';
appendFileSync('children.jsonl', JSON.stringify({ child: 'vitest', args: process.argv.slice(2) }) + '\\n');
if (process.env.TEST_SIGNAL) process.kill(process.pid, process.env.TEST_SIGNAL);
else process.exitCode = Number(process.env.TEST_EXIT || 0);
`,
    );
  }
  // Also intercept the old shell command, so a regression never starts the real suite.
  write(
    'node_modules/.bin/vitest',
    '#!/bin/sh\nexec node node_modules/vitest/vitest.mjs "$@"\n',
    0o755,
  );
  write('node_modules/.bin/vitest.cmd', '@node node_modules/vitest/vitest.mjs %*\r\n');
  return { root, write };
}

function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  // Use the installed pnpm even when a direct Vitest invocation inherited npm's npm_execpath.
  const invocation = pnpmInvocation(['run', 'test:unit', ...args], { env: {} });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: root,
    env: { ...process.env, NODE_COMPILE_CACHE: join(root, 'node-compile-cache'), ...env },
    encoding: 'utf8',
    timeout: 20_000,
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.shell,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const log = join(root, 'children.jsonl');
  const children = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { ...result, output: result.stdout + result.stderr, children };
}

describe('test:unit package-script boundary', () => {
  it('rejects a leading literal separator before starting either child', () => {
    const { root } = fixture();
    const result = run(root, [
      '--',
      'selected.test.ts',
      '-t',
      'name with spaces',
      '--maxWorkers=1',
    ]);
    expect(result.children).toEqual([]);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/pnpm run test:unit <file> -t "<name>" --maxWorkers=1/);
  });

  it('rejects a separator even when dependencies are missing', () => {
    const { root } = fixture();
    rmSync(join(root, 'node_modules'), { recursive: true });
    rmSync(join(root, 'scripts/check-deps-fresh.mjs'));
    const result = run(root, ['--']);
    expect(result.status).not.toBe(0);
    expect(result.children).toEqual([]);
    expect(result.output).toContain('pnpm run test:unit <file>');
    expect(result.output).not.toContain('MODULE_NOT_FOUND');
  });

  it('preserves files, spaced name filters, worker options, and shell metacharacters', () => {
    const { root } = fixture();
    const args = [
      'selected file.test.ts',
      'another.test.ts',
      '-t',
      'name with spaces & $x',
      '--maxWorkers=1',
    ];
    const result = run(root, args);
    expect(result.status, result.output).toBe(0);
    expect(result.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts', ...args] },
    ]);
  });

  it('retains intentional no-argument full-suite execution', () => {
    const { root } = fixture();
    const result = run(root, []);
    expect(result.status, result.output).toBe(0);
    expect(result.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts'] },
    ]);
  });

  it('preserves a non-leading separator used as a name-filter value', () => {
    const { root } = fixture();
    const result = run(root, ['selected.test.ts', '-t', '--']);
    expect(result.status, result.output).toBe(0);
    expect(result.children[1].args).toEqual([
      'run',
      '--config',
      'vitest.config.ts',
      'selected.test.ts',
      '-t',
      '--',
    ]);
  });

  it('stops before Vitest when preparation fails and retains the failure code', () => {
    const { root } = fixture();
    const result = run(root, [], { PREP_EXIT: '7' });
    expect(result.status).toBe(7);
    expect(result.children).toEqual([{ child: 'prepare', args: [] }]);
  });

  it('retains the Vitest failure code', () => {
    const { root } = fixture();
    const result = run(root, [], { TEST_EXIT: '9' });
    expect(result.status).toBe(9);
    expect(result.children.map((child) => child.child)).toEqual(['prepare', 'vitest']);
  });

  it.each(['PREP_SIGNAL', 'TEST_SIGNAL'])(
    'does not turn a child signal into success (%s)',
    (key) => {
      const { root } = fixture();
      const result = run(root, [], { [key]: 'SIGTERM' });
      expect(result.status).not.toBe(0);
      expect(result.children.map((child) => child.child)).toEqual(
        key === 'PREP_SIGNAL' ? ['prepare'] : ['prepare', 'vitest'],
      );
    },
  );

  it('runs only the selected file and name in a tiny real Vitest suite', () => {
    const { root } = fixture(true);
    const result = run(root, [
      'selected file.test.js',
      '-t',
      'selected name with spaces',
      '--maxWorkers=1',
    ]);
    expect(result.status, result.output).toBe(0);
    expect(readFileSync(join(root, 'selected-ran'), 'utf8')).toBe('yes');
    expect(result.children).toEqual([{ child: 'prepare', args: [] }]);
  });
});
