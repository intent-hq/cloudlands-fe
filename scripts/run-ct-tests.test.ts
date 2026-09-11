import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CT_HTML_REPORT_ENV,
  OPEN_REPORT_FLAG,
  buildChildEnv,
  exitCodeFromChild,
  parseLauncherArgs,
  resolveHtmlReportOpen,
  runPlaywright,
  usage,
} from './run-ct-tests.mjs';

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
  });
});
