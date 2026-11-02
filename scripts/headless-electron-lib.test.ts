import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE,
  DEFAULT_SETTLE_MS,
  DEFAULT_TIMEOUT_MS,
  UsageError,
  XVFB_MARKER,
  defaultScreenshotPath,
  electronLaunchOptions,
  needsVirtualDisplay,
  parseHeadlessArgs,
  routeSlug,
  routeUrl,
  xvfbCommand,
} from './headless-electron-lib.mjs';

describe('parseHeadlessArgs', () => {
  it('defaults to the home route with no overrides', () => {
    expect(parseHeadlessArgs([])).toEqual({
      route: DEFAULT_ROUTE,
      out: null,
      socket: null,
      waitFor: null,
      settleMs: DEFAULT_SETTLE_MS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      check: null,
      keepProfile: false,
      help: false,
    });
  });

  it('reads spaced and = forms and skips a forwarded -- separator', () => {
    const options = parseHeadlessArgs([
      '--',
      '--route',
      '/settings?tab=devices',
      '--out=shot.png',
      '--socket',
      '/tmp/d.sock',
      '--wait-for',
      '[data-testid="devices"]',
      '--settle-ms=0',
      '--timeout-ms',
      '5000',
      '--check',
      'check.mjs',
      '--keep-profile',
    ]);
    expect(options).toMatchObject({
      route: '/settings?tab=devices',
      out: 'shot.png',
      socket: '/tmp/d.sock',
      waitFor: '[data-testid="devices"]',
      settleMs: 0,
      timeoutMs: 5000,
      check: 'check.mjs',
      keepProfile: true,
    });
  });

  it('keeps a route whose query contains =', () => {
    expect(parseHeadlessArgs(['--route=/settings?tab=devices']).route).toBe(
      '/settings?tab=devices',
    );
  });

  it.each([
    [['--bogus'], /Unknown argument/],
    [['--route'], /requires a value/],
    [['--route', '--out', 'x.png'], /requires a value/],
    [['--route', 'settings'], /must start with "\/"/],
    [['--settle-ms', '-1'], /non-negative integer/],
    [['--timeout-ms', 'soon'], /non-negative integer/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseHeadlessArgs(argv)).toThrow(UsageError);
    expect(() => parseHeadlessArgs(argv)).toThrow(message);
  });

  it('flags --help', () => {
    expect(parseHeadlessArgs(['-h']).help).toBe(true);
  });
});

describe('routes and output paths', () => {
  it('maps a route onto the production app:// origin', () => {
    expect(routeUrl('/settings?tab=devices')).toBe('app://workspaces/settings?tab=devices');
  });

  it('slugs routes for file names', () => {
    expect(routeSlug('/settings?tab=devices')).toBe('settings-tab-devices');
    expect(routeSlug('/')).toBe('home');
  });

  it('writes default screenshots under e2e-reports/headless-electron', () => {
    const file = defaultScreenshotPath(
      '/repo',
      '/settings?tab=devices',
      new Date('2026-11-02T10:00:00.000Z'),
    );
    expect(file).toBe(
      path.resolve(
        '/repo/e2e-reports/headless-electron/settings-tab-devices-2026-11-02T10-00-00-000Z.png',
      ),
    );
  });
});

describe('needsVirtualDisplay', () => {
  it('wraps only Linux without X11 or Wayland', () => {
    expect(needsVirtualDisplay('linux', {})).toBe(true);
    expect(needsVirtualDisplay('linux', { DISPLAY: ':0' })).toBe(false);
    expect(needsVirtualDisplay('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
    expect(needsVirtualDisplay('darwin', {})).toBe(false);
    expect(needsVirtualDisplay('win32', {})).toBe(false);
  });

  it('never re-wraps the xvfb-run child', () => {
    expect(needsVirtualDisplay('linux', { [XVFB_MARKER]: '1' })).toBe(false);
  });

  it('re-runs the same node script and arguments under xvfb-run -a', () => {
    expect(xvfbCommand('/usr/bin/node', '/s.mjs', ['--route', '/x'])).toEqual({
      command: 'xvfb-run',
      args: [
        '-a',
        '--server-args=-screen 0 1440x900x24',
        '/usr/bin/node',
        '/s.mjs',
        '--route',
        '/x',
      ],
    });
  });
});

describe('electronLaunchOptions', () => {
  const base = { appDir: '/repo', userDataDir: '/tmp/profile', socket: '/tmp/d.sock' };

  it('isolates the profile, disables the sandbox and connects to the given socket', () => {
    const options = electronLaunchOptions({ ...base, env: { PATH: '/bin' } });
    expect(options).toEqual({
      args: ['.', '--user-data-dir=/tmp/profile', '--no-sandbox'],
      cwd: '/repo',
      env: { PATH: '/bin', NODE_ENV: 'production', INTENTD_SOCKET: '/tmp/d.sock' },
    });
  });

  it('drops variables that would redirect the app or its backend', () => {
    const { env } = electronLaunchOptions({
      ...base,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DEV_PORT: '5190',
        ENABLE_CDP_DEBUG: 'true',
        INTENTD_BIN: '/bin/intentd',
        INTENTD_DATA_DIR: '/data',
        INTENTD_WS_URL: 'ws://x',
        INTENTD_TCP: '1',
        INTENTD_SOCKET: '/other.sock',
        NODE_ENV: 'development',
      },
    });
    expect(env).toEqual({ NODE_ENV: 'production', INTENTD_SOCKET: '/tmp/d.sock' });
  });

  it('refuses a relative profile path, which the app rejects at startup', () => {
    expect(() => electronLaunchOptions({ ...base, userDataDir: 'profile' })).toThrow(/absolute/);
  });
});
