import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireVerificationLock,
  createVerificationPlan,
  expandInputPaths,
  findRelatedCtTests,
  parseArgs,
} from './verify-changed.mjs';

const temporaryPaths: string[] = [];

function temporaryDirectory() {
  const path = join(tmpdir(), `verify-changed-test-${process.pid}-${temporaryPaths.length}`);
  mkdirSync(path, { recursive: true });
  temporaryPaths.push(path);
  return path;
}

function fixtureRoot(files: Record<string, string>) {
  const root = temporaryDirectory();
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('verify-changed arguments and paths', () => {
  it('parses explicit paths and dry-run', () => {
    expect(parseArgs(['--dry-run', '--', 'src/a.ts'])).toEqual({
      dryRun: true,
      help: false,
      paths: ['src/a.ts'],
    });
    expect(() => parseArgs(['--wat'])).toThrow('unknown option');
  });

  it('accepts package-prefixed paths and expands directories', () => {
    const root = fixtureRoot({ 'src/a.ts': '', 'src/nested/b.svelte': '' });
    expect(expandInputPaths(['packages/cloudlands-fe/src'], root)).toEqual([
      'src/a.ts',
      'src/nested/b.svelte',
    ]);
    expect(() => expandInputPaths(['../outside.ts'], root)).toThrow('outside');
  });

  it('rejects symlinks outside the package and keeps in-package and missing paths', () => {
    const root = fixtureRoot({ 'src/a.ts': '' });
    const outside = fixtureRoot({ 'outside.ts': '' });
    symlinkSync(outside, join(root, 'external'), 'dir');
    symlinkSync(join(root, 'src'), join(root, 'internal'), 'dir');

    expect(() => expandInputPaths(['external'], root)).toThrow('outside');
    expect(expandInputPaths(['internal'], root)).toEqual(['internal/a.ts']);
    expect(expandInputPaths(['src/deleted.ts'], root)).toEqual(['src/deleted.ts']);
  });
});

describe('verification planning', () => {
  it('selects related Vitest and only the renderer boundary', () => {
    const root = fixtureRoot({ 'src/lib/example.ts': 'export const value = 1;' });
    const plan = createVerificationPlan(['src/lib/example.ts'], { root, ctTests: [] });
    expect(plan.checks.map((check) => check.id)).toEqual([
      'prettier',
      'eslint',
      'vitest-related',
      'tsc-renderer',
    ]);
  });

  it('selects a component test that directly imports a changed Svelte component', () => {
    const root = fixtureRoot({
      'src/lib/Button.svelte': '<button />',
      'src/lib/__tests__/button.ct.spec.ts': "import Button from '../Button.svelte';",
    });
    const ctTests = ['src/lib/__tests__/button.ct.spec.ts'];
    expect(findRelatedCtTests(['src/lib/Button.svelte'], { root, ctTests })).toEqual(ctTests);
    const plan = createVerificationPlan(['src/lib/Button.svelte'], { root, ctTests });
    expect(plan.checks.map((check) => check.id)).toContain('ct-related');
    expect(plan.checks.map((check) => check.id)).toContain('svelte-check');
  });

  it('keeps main and preload type checks scoped to their boundaries', () => {
    const root = fixtureRoot({
      'src/features/system/main/status.ts': '',
      'src/preload/index.ts': '',
    });
    const plan = createVerificationPlan(
      ['src/features/system/main/status.ts', 'src/preload/index.ts'],
      { root, ctTests: [] },
    );
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toContain('tsc-main');
    expect(ids).toContain('tsc-preload');
    expect(ids).not.toContain('tsc-renderer');
  });

  it('checks all process boundaries for shared source', () => {
    const root = fixtureRoot({ 'src/shared/protocol.ts': '' });
    const plan = createVerificationPlan(['src/shared/protocol.ts'], { root, ctTests: [] });
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining(['tsc-renderer', 'tsc-main', 'tsc-preload']));
  });

  it('uses the conservative suite for an unknown high-risk change', () => {
    const root = fixtureRoot({ 'native/tool.bin': 'data' });
    const plan = createVerificationPlan(['native/tool.bin'], { root, ctTests: [] });
    expect(plan.fallbackReasons).toEqual(['native/tool.bin']);
    expect(plan.checks.map((check) => check.id)).toEqual([
      'vitest-full',
      'svelte-check',
      'tsc-renderer',
      'tsc-main',
      'tsc-preload',
    ]);
    expect(plan.checks.find((check) => check.id === 'vitest-full')?.expensive).toBe(true);
  });

  it('runs changed integration tests with their own Vitest config', () => {
    const root = fixtureRoot({ 'tests/integration/example.test.ts': '' });
    const plan = createVerificationPlan(['tests/integration/example.test.ts'], {
      root,
      ctTests: [],
    });
    expect(plan.checks.find((check) => check.id === 'vitest-integration')?.args).toContain(
      'tests/integration/vitest.integration.config.ts',
    );
  });
});

describe('expensive-check coordination', () => {
  it('releases only its own acquired lock', async () => {
    const parent = temporaryDirectory();
    const lockPath = join(parent, 'lock');
    const release = await acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5 });
    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain(String(process.pid));
    release();
    expect(() => readFileSync(join(lockPath, 'owner.json'), 'utf8')).toThrow();
  });

  it('times out without removing or stopping a live owner', async () => {
    const lockPath = temporaryDirectory();
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, token: 'other' }),
    );
    await expect(acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5 })).rejects.toThrow(
      'another expensive frontend verification',
    );
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).token).toBe('other');
  });

  it('retries when the lock disappears before its metadata can be inspected', async () => {
    const parent = temporaryDirectory();
    const lockPath = join(parent, 'lock');
    mkdirSync(lockPath);

    const release = await acquireVerificationLock({
      lockPath,
      timeoutMs: 15,
      pollMs: 5,
      statLock(path: string) {
        rmSync(path, { recursive: true, force: true });
        return statSync(path);
      },
    });

    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain(String(process.pid));
    release();
  });

  it('preserves unexpected lock inspection errors', async () => {
    const lockPath = temporaryDirectory();
    const error = Object.assign(new Error('lock inspection failed'), { code: 'EACCES' });

    await expect(
      acquireVerificationLock({
        lockPath,
        timeoutMs: 15,
        pollMs: 5,
        statLock() {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });
});
