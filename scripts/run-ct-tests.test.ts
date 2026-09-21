import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CT_HTML_REPORT_ENV,
  OPEN_REPORT_FLAG,
  PRINT_OS_DEPS_FLAG,
  assertNoCoreDumps,
  acquireCtPortLock,
  buildChildEnv,
  collectNonFontOsDeps,
  exitCodeFromChild,
  forwardSignalsToChild,
  parseLauncherArgs,
  resolveHtmlReportOpen,
  runPlaywright,
  usage,
} from './run-ct-tests.mjs';
import { HELD_LOCK_ENV, acquireVerificationLock, lockOwner } from './verification-lock.mjs';

const baseEnv = { PATH: '/usr/bin' };

describe('parseLauncherArgs', () => {
  it('drops the pnpm `--` separator and forwards the rest', () => {
    expect(parseLauncherArgs(['--', 'src/a.ct.spec.ts', '--grep', 'x'])).toEqual({
      forwarded: ['src/a.ct.spec.ts', '--grep', 'x'],
      openReport: false,
      help: false,
    });
  });

  it(`strips ${OPEN_REPORT_FLAG} from the forwarded args`, () => {
    expect(parseLauncherArgs([OPEN_REPORT_FLAG, 'src/a.ct.spec.ts'])).toMatchObject({
      forwarded: ['src/a.ct.spec.ts'],
      openReport: true,
    });
  });

  it('recognizes --help', () => {
    expect(parseLauncherArgs(['--help']).help).toBe(true);
    expect(parseLauncherArgs(['-h']).help).toBe(true);
  });
});

describe('resolveHtmlReportOpen', () => {
  it('never serves the report on a non-TTY run by default', () => {
    expect(resolveHtmlReportOpen({ env: baseEnv, isTTY: false })).toEqual({ open: 'never' });
  });

  it('never serves the report on a TTY without opt-in', () => {
    expect(resolveHtmlReportOpen({ env: baseEnv, isTTY: true })).toEqual({ open: 'never' });
  });

  it(`opens the report when ${CT_HTML_REPORT_ENV}=open on a TTY`, () => {
    expect(
      resolveHtmlReportOpen({ env: { ...baseEnv, [CT_HTML_REPORT_ENV]: 'open' }, isTTY: true }),
    ).toEqual({ open: 'always' });
    expect(
      resolveHtmlReportOpen({
        env: { ...baseEnv, [CT_HTML_REPORT_ENV]: 'on-failure' },
        isTTY: true,
      }),
    ).toEqual({ open: 'on-failure' });
  });

  it(`opens the report for ${OPEN_REPORT_FLAG} on a TTY`, () => {
    expect(resolveHtmlReportOpen({ env: baseEnv, isTTY: true, openReport: true })).toEqual({
      open: 'always',
    });
  });

  it('refuses an opt-in on a non-TTY run and says why', () => {
    const result = resolveHtmlReportOpen({
      env: { ...baseEnv, [CT_HTML_REPORT_ENV]: 'open' },
      isTTY: false,
    });
    expect(result.open).toBe('never');
    expect(result.notice).toMatch(/not a TTY/);
  });

  it('leaves an explicit PLAYWRIGHT_HTML_OPEN untouched', () => {
    expect(
      resolveHtmlReportOpen({
        env: { ...baseEnv, PLAYWRIGHT_HTML_OPEN: 'always', [CT_HTML_REPORT_ENV]: 'never' },
        isTTY: false,
      }),
    ).toEqual({ open: null });
  });

  it('warns on an unknown value and falls back to never', () => {
    const result = resolveHtmlReportOpen({
      env: { ...baseEnv, [CT_HTML_REPORT_ENV]: 'sometimes' },
      isTTY: true,
    });
    expect(result.open).toBe('never');
    expect(result.notice).toMatch(/ignoring CT_HTML_REPORT=sometimes/);
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'rejects inherited object key %s as a mode value',
    (key) => {
      const result = resolveHtmlReportOpen({
        env: { ...baseEnv, [CT_HTML_REPORT_ENV]: key },
        isTTY: true,
      });
      expect(result.open).toBe('never');
      expect(result.notice).toMatch(new RegExp(`ignoring CT_HTML_REPORT=${key}`));
    },
  );
});

describe('buildChildEnv', () => {
  it('pins PLAYWRIGHT_HTML_OPEN=never and a project-local transform cache for non-TTY runs', () => {
    const { env, notice } = buildChildEnv({ env: baseEnv, isTTY: false, root: '/repo' });
    expect(env.PLAYWRIGHT_HTML_OPEN).toBe('never');
    expect(env.PWTEST_CACHE_DIR).toBe(
      path.join('/repo', 'node_modules', '.cache', 'playwright-transform'),
    );
    expect(env.PATH).toBe(baseEnv.PATH);
    expect(notice).toBeUndefined();
  });

  it('exports the opt-in open mode on a TTY', () => {
    const { env } = buildChildEnv({
      env: { ...baseEnv, [CT_HTML_REPORT_ENV]: 'open' },
      isTTY: true,
      root: '/repo',
    });
    expect(env.PLAYWRIGHT_HTML_OPEN).toBe('always');
  });

  it('keeps an explicit PWTEST_CACHE_DIR and PLAYWRIGHT_HTML_OPEN', () => {
    const { env } = buildChildEnv({
      env: { ...baseEnv, PWTEST_CACHE_DIR: '/cache', PLAYWRIGHT_HTML_OPEN: 'on-failure' },
      isTTY: false,
      root: '/repo',
    });
    expect(env.PWTEST_CACHE_DIR).toBe('/cache');
    expect(env.PLAYWRIGHT_HTML_OPEN).toBe('on-failure');
  });
});

describe('exitCodeFromChild', () => {
  it('passes a numeric exit code through', () => {
    expect(exitCodeFromChild(0, null)).toBe(0);
    expect(exitCodeFromChild(1, null)).toBe(1);
  });

  it('maps a signal to 128 + signal number and a missing code to 1', () => {
    expect(exitCodeFromChild(null, 'SIGTERM')).toBe(128 + 15);
    expect(exitCodeFromChild(null, null)).toBe(1);
  });
});

describe('runPlaywright', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-ct-tests-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const waitForExit = (options: Parameters<typeof runPlaywright>[0]) =>
    new Promise<number>((resolve) => {
      runPlaywright({ ...options, exit: resolve });
    });

  it.each([undefined, '', '  ', '--single-threaded-gc', '  --single-threaded-gc   --no-opt  '])(
    'passes node arguments %s',
    (nodeArgs) => {
      const calls: unknown[][] = [];
      runPlaywright({
        cliPath: '/ct/cli.js',
        args: ['test', '--workers=2'],
        env: { ...baseEnv, CT_NODE_ARGS: nodeArgs },
        spawnImpl: ((...args: unknown[]) => {
          calls.push(args);
          return new EventEmitter();
        }) as never,
      });
      expect(calls[0]?.[0]).toBe(process.execPath);
      expect(calls[0]?.[1]).toEqual([
        ...(nodeArgs?.trim() ? nodeArgs.trim().split(/\s+/) : []),
        '/ct/cli.js',
        'test',
        '--workers=2',
      ]);
    },
  );

  it('propagates a non-zero child exit code as the process exit code', async () => {
    const fakeCli = path.join(dir, 'fake-cli.cjs');
    writeFileSync(fakeCli, 'process.exit(Number(process.argv[2]));\n');
    await expect(
      waitForExit({ cliPath: fakeCli, args: ['3'], cwd: dir, env: baseEnv }),
    ).resolves.toBe(3);
  });

  it('propagates a zero exit code', async () => {
    const fakeCli = path.join(dir, 'fake-cli-ok.cjs');
    writeFileSync(fakeCli, 'process.exit(0);\n');
    await expect(waitForExit({ cliPath: fakeCli, args: [], cwd: dir, env: baseEnv })).resolves.toBe(
      0,
    );
  });

  it.each(['SIGSEGV', 'SIGTERM'])('reports %s and exits non-zero', (signal) => {
    const child = new EventEmitter();
    const errors: string[] = [];
    const exits: number[] = [];
    runPlaywright({
      cliPath: '/ct/cli.js',
      args: [],
      spawnImpl: (() => child) as never,
      printError: (message: string) => errors.push(message),
      exit: (code: number) => exits.push(code),
    });
    child.emit('exit', null, signal);
    expect(errors).toEqual([`playwright died with ${signal}`]);
    expect(exits).toEqual([exitCodeFromChild(null, signal)]);
    expect(exits[0]).toBeGreaterThan(0);
  });

  it('exits 1 when the child cannot be spawned', async () => {
    const child = new EventEmitter();
    const code = await new Promise<number>((resolve) => {
      runPlaywright({
        cliPath: '/nowhere',
        args: [],
        spawnImpl: () => child as never,
        exit: resolve,
      });
      child.emit('error', new Error('ENOENT'));
    });
    expect(code).toBe(1);
  });

  it('exposes the launcher options in its usage text', () => {
    expect(usage()).toContain(CT_HTML_REPORT_ENV);
    expect(usage()).toContain(OPEN_REPORT_FLAG);
    expect(usage()).toContain(PRINT_OS_DEPS_FLAG);
    expect(usage()).toContain('CT_PORT');
  });
});

describe('acquireCtPortLock', () => {
  const lockRoot = mkdtempSync(path.join(tmpdir(), 'run-ct-tests-lock-'));
  afterAll(() => rmSync(lockRoot, { recursive: true, force: true }));

  const lockPath = (key: string) => path.join(lockRoot, key);
  const acquireLock = (options: Record<string, unknown>) =>
    acquireVerificationLock({ ...options, pollMs: 5 });
  const settled = <T>(promise: Promise<T>) => {
    let done = false;
    const tracked = promise.then((value) => {
      done = true;
      return value;
    });
    return { tracked, isDone: () => done };
  };

  it('keys the lock on CT_PORT and records the caller as owner', async () => {
    const cwd = '/worktree/a';
    const release = await acquireCtPortLock({
      env: { CT_PORT: '3300' },
      cwd,
      acquireLock,
      lockPath,
      log() {},
    });
    expect(lockOwner(path.join(lockRoot, 'ct-3300'))).toMatchObject({ pid: process.pid, cwd });
    release();
    expect(existsSync(path.join(lockRoot, 'ct-3300'))).toBe(false);
  });

  it('makes a second run on the same port wait until the first releases', async () => {
    const options = { env: { CT_PORT: '3301' }, acquireLock, lockPath, log() {} };
    const first = await acquireCtPortLock({ ...options, cwd: '/worktree/a' });
    const second = settled(acquireCtPortLock({ ...options, cwd: '/worktree/b' }));
    await new Promise((done) => setTimeout(done, 25));
    expect(second.isDone()).toBe(false);
    first();
    const release = await second.tracked;
    expect(lockOwner(path.join(lockRoot, 'ct-3301')).cwd).toBe('/worktree/b');
    release();
  });

  it('fails with the owner named when the wait runs out', async () => {
    const options = { env: { CT_PORT: '3302' }, acquireLock, lockPath, log() {} };
    const release = await acquireCtPortLock({ ...options, cwd: '/worktree/a' });
    await expect(
      acquireCtPortLock({
        ...options,
        env: { CT_PORT: '3302', VERIFY_CHANGED_LOCK_TIMEOUT_MS: '20' },
        cwd: '/worktree/b',
      }),
    ).rejects.toThrow(new RegExp(`ct-3302: owner pid ${process.pid} cwd /worktree/a`));
    release();
  });

  it('lets runs on different ports proceed concurrently', async () => {
    const options = { acquireLock, lockPath, log() {} };
    const [a, b] = await Promise.all([
      acquireCtPortLock({ ...options, env: { CT_PORT: '3303' } }),
      acquireCtPortLock({ ...options, env: { CT_PORT: '3304' } }),
    ]);
    a();
    b();
  });

  it('skips acquisition when the parent verify:changed already holds this port', async () => {
    const options = { acquireLock, lockPath, log() {} };
    const parent = await acquireCtPortLock({ ...options, env: { CT_PORT: '3305' } });
    const nested = settled(
      acquireCtPortLock({
        ...options,
        env: { CT_PORT: '3305', [HELD_LOCK_ENV]: 'ct-3305' },
      }),
    );
    await new Promise((done) => setTimeout(done, 10));
    expect(nested.isDone()).toBe(true);
    (await nested.tracked)();
    expect(existsSync(path.join(lockRoot, 'ct-3305'))).toBe(true);
    parent();
  });

  it('does not treat a held lock for another port as its own', async () => {
    const options = { acquireLock, lockPath, log() {} };
    const other = await acquireCtPortLock({ ...options, env: { CT_PORT: '3306' } });
    await expect(
      acquireCtPortLock({
        ...options,
        env: {
          CT_PORT: '3306',
          [HELD_LOCK_ENV]: 'ct-3100',
          VERIFY_CHANGED_LOCK_TIMEOUT_MS: '20',
        },
      }),
    ).rejects.toThrow(/ct-3306/);
    other();
  });

  it('keeps the lock from a contender until the signalled child has exited', async () => {
    const options = { acquireLock, lockPath, log() {} };
    const release = await acquireCtPortLock({ ...options, env: { CT_PORT: '3307' }, cwd: '/a' });
    const child = Object.assign(new EventEmitter(), { kill: () => true });
    const proc = new EventEmitter();
    const exitCodes: number[] = [];
    const exit = (code: number) => {
      release();
      exitCodes.push(code);
    };
    child.on('exit', (code, signal) => exit(exitCodeFromChild(code, signal)));
    forwardSignalsToChild({ child, proc, log() {} });

    proc.emit('SIGINT', 'SIGINT');
    await expect(
      acquireCtPortLock({
        ...options,
        env: { CT_PORT: '3307', VERIFY_CHANGED_LOCK_TIMEOUT_MS: '20' },
        cwd: '/b',
      }),
    ).rejects.toThrow(/ct-3307: owner pid \d+ cwd \/a/);
    expect(exitCodes).toEqual([]);

    child.emit('exit', null, 'SIGINT');
    expect(exitCodes).toEqual([130]);
    const contender = await acquireCtPortLock({ ...options, env: { CT_PORT: '3307' }, cwd: '/b' });
    expect(lockOwner(path.join(lockRoot, 'ct-3307')).cwd).toBe('/b');
    contender();
  });
});

describe('forwardSignalsToChild', () => {
  const setup = (graceMs?: number) => {
    const kills: string[] = [];
    const child = Object.assign(new EventEmitter(), {
      kill: (signal: string) => {
        kills.push(signal);
        return true;
      },
    });
    const proc = new EventEmitter();
    forwardSignalsToChild({ child, proc, graceMs, log() {} });
    return { kills, child, proc };
  };

  it('forwards the signal to the child instead of exiting the launcher', () => {
    const { kills, proc } = setup();
    proc.emit('SIGTERM', 'SIGTERM');
    expect(kills).toEqual(['SIGTERM']);
  });

  it('escalates to SIGKILL on a repeated signal', () => {
    const { kills, proc } = setup();
    proc.emit('SIGINT', 'SIGINT');
    proc.emit('SIGINT', 'SIGINT');
    expect(kills).toEqual(['SIGINT', 'SIGKILL']);
  });

  it('escalates to SIGKILL when the child outlives the grace period', async () => {
    const { kills, proc } = setup(10);
    proc.emit('SIGINT', 'SIGINT');
    await new Promise((done) => setTimeout(done, 30));
    expect(kills).toEqual(['SIGINT', 'SIGKILL']);
  });

  it('stops listening once the child has exited', async () => {
    const { kills, child, proc } = setup(10);
    proc.emit('SIGINT', 'SIGINT');
    child.emit('exit', 130, null);
    await new Promise((done) => setTimeout(done, 30));
    proc.emit('SIGINT', 'SIGINT');
    expect(kills).toEqual(['SIGINT']);
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });
});

describe('collectNonFontOsDeps', () => {
  const dryRunLine =
    'sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libnss3 fonts-liberation xvfb"\n';

  it('runs install-deps --dry-run with the CT-aligned CLI and returns the non-font packages', () => {
    const calls: unknown[][] = [];
    const { dryRun, packages } = collectNonFontOsDeps({
      cliPath: '/ct/cli.js',
      browsers: ['chromium'],
      cwd: '/repo',
      spawnSyncImpl: ((...args: unknown[]) => {
        calls.push(args);
        return { status: 0, stdout: dryRunLine };
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual(['/ct/cli.js', 'install-deps', '--dry-run', 'chromium']);
    expect(calls[0]?.[2]).toMatchObject({ cwd: '/repo' });
    expect(dryRun).toBe(dryRunLine);
    expect(packages).toEqual(['libnss3', 'xvfb']);
  });

  it('throws when the dry run exits non-zero', () => {
    expect(() =>
      collectNonFontOsDeps({
        cliPath: '/ct/cli.js',
        browsers: ['chromium'],
        spawnSyncImpl: (() => ({ status: 2, stdout: '' })) as never,
      }),
    ).toThrow(/install-deps --dry-run failed: exit 2/);
  });

  it('propagates the strict-parse failure for a partial multiline package list', () => {
    expect(() =>
      collectNonFontOsDeps({
        cliPath: '/ct/cli.js',
        browsers: ['chromium'],
        spawnSyncImpl: (() => ({
          status: 0,
          stdout: 'apt-get install -y --no-install-recommends libc6\nlibmissing\n',
        })) as never,
      }),
    ).toThrow(/unexpected extra install-deps/);
  });
});

describe('assertNoCoreDumps', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ct-core-guard-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('allows ordinary files and directories with core-like names', () => {
    writeFileSync(path.join(root, 'core.ts'), 'source');
    writeFileSync(path.join(root, 'core.123.txt'), 'source');
    mkdirSync(path.join(root, 'core.456'));
    expect(() => assertNoCoreDumps({ root, env: {} })).not.toThrow();
  });

  it('refuses dumps with their names and byte sizes unless explicitly overridden', () => {
    writeFileSync(path.join(root, 'core'), Buffer.alloc(1024));
    writeFileSync(path.join(root, 'core.123'), Buffer.alloc(2048));
    for (const env of [{}, { CT_ALLOW_CORE: '0' }, { CT_ALLOW_CORE: 'true' }]) {
      expect(() => assertNoCoreDumps({ root, env })).toThrow(/core \(1024 bytes\)/);
      expect(() => assertNoCoreDumps({ root, env })).toThrow(/core\.123 \(2048 bytes\)/);
    }
    expect(() => assertNoCoreDumps({ root, env: { CT_ALLOW_CORE: '1' } })).not.toThrow();
  });
});
