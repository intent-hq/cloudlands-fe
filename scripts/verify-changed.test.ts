import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireVerificationLock,
  createVerificationPlan,
  expandInputPaths,
  findRelatedCtTests,
  lockTimeout,
  parseArgs,
  runVerificationPlan,
  verificationLockKey,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('timed out waiting for test condition');
}

function testCheck(id: string, lockKind: string | null) {
  return { id, label: id, executable: 'noop', args: [], lockKind };
}

function testPlan(...checks: ReturnType<typeof testCheck>[]) {
  return { files: [], checks, fallbackReasons: [] };
}

function runnerOptions(
  lockRoot: string,
  runCheck: (check: ReturnType<typeof testCheck>) => Promise<void>,
  env: Record<string, string> = {},
) {
  return {
    env,
    lockPath: (key: string) => join(lockRoot, key),
    acquireLock: (options: Record<string, unknown>) =>
      acquireVerificationLock({ ...options, pollMs: 5 }),
    runCheck,
    log() {},
  };
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

  it('selects scene geometry for previews, fixtures, snapshots, and imported components', () => {
    const geometryTest = 'src/lib/components/workspace/workspace-hover-card.geometry.ct.spec.ts';
    const root = fixtureRoot({
      [geometryTest]:
        "defineGeometrySnapshotSuite({ preview: () => import('./workspace-hover-card.preview.svelte') });",
      'src/lib/components/workspace/workspace-hover-card.preview.svelte':
        "import WorkspaceHoverCard from './WorkspaceHoverCard.svelte';",
      'src/lib/components/workspace/workspace-hover-card.preview-fixtures.ts': '',
      'src/lib/components/workspace/WorkspaceHoverCard.svelte': '<article />',
      'src/lib/components/workspace/__geometry__/workspace-hover-card.geometry.json': '{}',
    });
    const options = { root, ctTests: [geometryTest] };

    for (const file of [
      'src/lib/components/workspace/workspace-hover-card.preview.svelte',
      'src/lib/components/workspace/workspace-hover-card.preview-fixtures.ts',
      'src/lib/components/workspace/WorkspaceHoverCard.svelte',
      'src/lib/components/workspace/__geometry__/workspace-hover-card.geometry.json',
    ]) {
      expect(findRelatedCtTests([file], options), file).toEqual([geometryTest]);
    }
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
    expect(plan.checks.find((check) => check.id === 'vitest-full')?.lockKind).toBe('vitest-full');
    expect(plan.checks.find((check) => check.id === 'svelte-check')?.lockKind).toBeNull();
    expect(plan.checks.find((check) => check.id === 'tsc-renderer')?.lockKind).toBeNull();
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
    const cwd = '/current/worktree';
    const release = await acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5, cwd });
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'))).toMatchObject({
      pid: process.pid,
      cwd,
    });
    release();
    expect(() => readFileSync(join(lockPath, 'owner.json'), 'utf8')).toThrow();
  });

  it('times out without removing or stopping a live owner', async () => {
    const lockPath = temporaryDirectory();
    const ownerCwd = '/other/worktree';
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, cwd: ownerCwd, token: 'other' }),
    );
    await expect(acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5 })).rejects.toThrow(
      new RegExp(`owner pid ${process.pid} cwd ${ownerCwd}; waited [0-9]+ms`),
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

  it('uses per-kind keys and bounded default waits', () => {
    expect(verificationLockKey(testCheck('ct', 'ct'), {})).toBe('ct-3100');
    expect(verificationLockKey(testCheck('ct', 'ct'), { CT_PORT: '03101' })).toBe('ct-3101');
    expect(verificationLockKey(testCheck('vitest', 'vitest-full'), {})).toBe('vitest-full');
    expect(verificationLockKey(testCheck('tsc', null), {})).toBeNull();
    expect(lockTimeout('ct-3100', undefined)).toBe(240_000);
    expect(lockTimeout('vitest-full', undefined)).toBe(120_000);
    expect(lockTimeout('ct-3100', '999999')).toBe(300_000);
  });

  it('allows unlocked tsc and Svelte runs to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      await gate.promise;
    });

    const runs = [
      runVerificationPlan(testPlan(testCheck('tsc-renderer', null)), lockRoot, options),
      runVerificationPlan(testPlan(testCheck('svelte-check', null)), lockRoot, options),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(['tsc-renderer', 'svelte-check']);
    gate.resolve();
    await Promise.all(runs);
  });

  it('serializes CT runs on the same port', async () => {
    const lockRoot = temporaryDirectory();
    const firstGate = deferred();
    const started: string[] = [];
    const options = runnerOptions(
      lockRoot,
      async (check) => {
        started.push(check.id);
        if (check.id === 'first') await firstGate.promise;
      },
      { CT_PORT: '3200' },
    );

    const first = runVerificationPlan(testPlan(testCheck('first', 'ct')), lockRoot, options);
    await waitUntil(() => started.length === 1);
    const second = runVerificationPlan(testPlan(testCheck('second', 'ct')), lockRoot, options);
    await new Promise((done) => setTimeout(done, 20));
    expect(started).toEqual(['first']);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('releases a CT lock before running the next unlocked check', async () => {
    const lockRoot = temporaryDirectory();
    const cheapGate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      if (check.id === 'cheap') await cheapGate.promise;
    });

    const first = runVerificationPlan(
      testPlan(testCheck('first-ct', 'ct'), testCheck('cheap', null)),
      lockRoot,
      options,
    );
    await waitUntil(() => started.includes('cheap'));
    const second = runVerificationPlan(testPlan(testCheck('second-ct', 'ct')), lockRoot, options);
    await waitUntil(() => started.includes('second-ct'));
    expect(started).toEqual(['first-ct', 'cheap', 'second-ct']);
    cheapGate.resolve();
    await Promise.all([first, second]);
  });

  it('allows CT runs on different ports to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const runCheck = async (check: ReturnType<typeof testCheck>) => {
      started.push(check.id);
      await gate.promise;
    };

    const runs = [
      runVerificationPlan(
        testPlan(testCheck('ct-3200', 'ct')),
        lockRoot,
        runnerOptions(lockRoot, runCheck, { CT_PORT: '3200' }),
      ),
      runVerificationPlan(
        testPlan(testCheck('ct-3201', 'ct')),
        lockRoot,
        runnerOptions(lockRoot, runCheck, { CT_PORT: '3201' }),
      ),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(expect.arrayContaining(['ct-3200', 'ct-3201']));
    gate.resolve();
    await Promise.all(runs);
  });

  it('allows full Vitest and CT to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      await gate.promise;
    });

    const runs = [
      runVerificationPlan(testPlan(testCheck('vitest', 'vitest-full')), lockRoot, options),
      runVerificationPlan(testPlan(testCheck('ct', 'ct')), lockRoot, options),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(expect.arrayContaining(['vitest', 'ct']));
    gate.resolve();
    await Promise.all(runs);
  });
});
