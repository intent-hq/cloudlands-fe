// @vitest-environment node
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playwright = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: playwright.launch } }));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  buildSandboxUrl,
  classifyModuleResponse,
  classifyServerLog,
  createReadinessWatch,
  describeReadinessFailure,
  parseSandboxArgs,
  runSandbox,
  sandboxProcessEnvironment,
  startSandboxServer,
} from './runner.mjs';
import { VITE_HARNESS_CACHE_ROOT, viteHarnessCacheDir } from '../../test/vite-harness-cache.mjs';

beforeEach(() => vi.clearAllMocks());

function mockPage(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    listeners,
    page: {
      goto: vi.fn(),
      waitForFunction: vi.fn(),
      evaluate: vi.fn().mockResolvedValue(['default']),
      locator: vi.fn(() => ({ waitFor: vi.fn() })),
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener);
      }),
      viewportSize: vi.fn(() => ({ width: 720, height: 900 })),
      waitForTimeout: vi.fn(),
      ...overrides,
    },
  };
}

function mockBrowser(page: unknown) {
  const context = { newPage: vi.fn().mockResolvedValue(page) };
  return { newContext: vi.fn().mockResolvedValue(context), close: vi.fn() };
}

describe('sandbox runner arguments', () => {
  it('applies deterministic capture defaults', () => {
    expect(parseSandboxArgs(['button', '--state', 'loading'])).toEqual({
      scene: 'button',
      state: 'loading',
      theme: 'light',
      motion: 'reduced',
      width: 720,
      scale: 1,
      timeout: 30_000,
      allowConsoleErrors: false,
    });
  });

  it('parses all supported overrides', () => {
    expect(
      parseSandboxArgs([
        'button',
        '--state',
        'loading',
        '--theme',
        'system',
        '--width',
        '420',
        '--motion',
        'full',
        '--scale',
        '2',
        '--base-url',
        'http://127.0.0.1:5173',
        '--out',
        'capture.png',
        '--timeout',
        '5000',
        '--allow-console-errors',
      ]),
    ).toMatchObject({
      scene: 'button',
      state: 'loading',
      theme: 'system',
      width: 420,
      motion: 'full',
      scale: 2,
      baseUrl: 'http://127.0.0.1:5173/',
      out: 'capture.png',
      timeout: 5000,
      allowConsoleErrors: true,
    });
  });

  it.each([
    { args: [], message: /scene is required/ },
    { args: ['button'], message: /--state is required/ },
    { args: ['button', '--state', 'loading', '--width', '200'], message: /240 to 1600/ },
    { args: ['button', '--state', 'loading', '--scale', '3'], message: /1 to 2/ },
    { args: ['button', '--state', 'loading', '--theme', 'sepia'], message: /light, dark/ },
    { args: ['button', '--state', 'loading', '--wat'], message: /Unknown option/ },
  ])('rejects invalid input: $args', ({ args, message }) => {
    expect(() => parseSandboxArgs(args)).toThrow(message);
  });
});

describe('buildSandboxUrl', () => {
  it('builds the component-fit preview URL under a base path', () => {
    const options = parseSandboxArgs(['workspace card', '--state', 'wide', '--width', '720']);
    expect(buildSandboxUrl('http://localhost:5173/root', options)).toBe(
      'http://localhost:5173/root/sandbox/workspace%20card?state=wide&theme=light&width=720&motion=reduced&fit=component',
    );
  });
});

describe('vite harness cache directories', () => {
  it('isolates each harness under node_modules/.vite-harness in the root', () => {
    const root = path.resolve('/repo/fe');
    expect(viteHarnessCacheDir('agent-avatar', { root })).toBe(
      path.join(root, VITE_HARNESS_CACHE_ROOT, 'agent-avatar'),
    );
    expect(viteHarnessCacheDir('agent-avatar', { root })).not.toBe(
      viteHarnessCacheDir('panel-open-mode', { root }),
    );
  });

  it('prefers an explicit override such as the legacy env knobs', () => {
    const root = path.resolve('/repo/fe');
    expect(viteHarnessCacheDir('agent-avatar', { root, override: '/tmp/avatar-cache' })).toBe(
      path.resolve('/tmp/avatar-cache'),
    );
    expect(viteHarnessCacheDir('agent-avatar', { root, override: '.cache/avatar' })).toBe(
      path.join(root, '.cache/avatar'),
    );
    expect(viteHarnessCacheDir('agent-avatar', { root, override: undefined })).toBe(
      path.join(root, VITE_HARNESS_CACHE_ROOT, 'agent-avatar'),
    );
  });

  it.each(['', '../escape', 'with space', 'bad/slash'])('rejects harness name %j', (name) => {
    expect(() => viteHarnessCacheDir(name)).toThrow(/harness name/);
  });
});

describe('sandboxProcessEnvironment', () => {
  it('exports nothing extra by default', () => {
    expect(sandboxProcessEnvironment({})).toEqual({});
    expect(sandboxProcessEnvironment({ SANDBOX_GOMAXPROCS: '' })).toEqual({});
  });

  it('passes SANDBOX_GOMAXPROCS through as GOMAXPROCS', () => {
    expect(sandboxProcessEnvironment({ SANDBOX_GOMAXPROCS: '2' })).toEqual({ GOMAXPROCS: '2' });
  });

  it.each(['0', '-1', 'two', '1.5'])('rejects SANDBOX_GOMAXPROCS=%s', (value) => {
    expect(() => sandboxProcessEnvironment({ SANDBOX_GOMAXPROCS: value })).toThrow(
      /positive integer/,
    );
  });
});

describe('readiness failure classification', () => {
  const moduleUrl = 'http://127.0.0.1:5173/node_modules/.vite-harness/sandbox/deps/svelte.js';

  it('flags 504 Outdated Optimize Dep responses with the offending module', () => {
    expect(
      classifyModuleResponse({ url: moduleUrl, status: 504, statusText: 'Outdated Optimize Dep' }),
    ).toEqual({ kind: 'outdated-optimize-dep', url: moduleUrl });
    expect(
      classifyModuleResponse({
        url: moduleUrl,
        status: 504,
        statusText: 'Optimize Deps Processing Error',
      }),
    ).toEqual({ kind: 'optimize-deps-processing-error', url: moduleUrl });
  });

  it.each([
    { status: 200, statusText: 'OK' },
    { status: 404, statusText: 'Not Found' },
    { status: 504, statusText: 'Outdated Request' },
    { status: 504, statusText: 'Gateway Timeout' },
  ])('ignores $status $statusText', (response) => {
    expect(classifyModuleResponse({ url: moduleUrl, ...response })).toBeNull();
  });

  it('flags esbuild dependency-scan failures in the server log without ANSI colour', () => {
    const message =
      '\u001b[31m  Failed to scan for dependencies from entries:\n  /repo/src/app.html\n\n  \u001b[39m✘ [ERROR] Expected ";" but found "x"';
    expect(classifyServerLog(message)).toEqual({
      kind: 'dependency-scan-failed',
      message:
        'Failed to scan for dependencies from entries:\n  /repo/src/app.html\n\n  ✘ [ERROR] Expected ";" but found "x"',
    });
  });

  it.each([
    {
      message: 'error while updating dependencies:\nError: Build failed with 1 error',
      kind: 'dependency-optimize-failed',
    },
    {
      message: 'panic: runtime error: invalid memory address\n\ngoroutine 1 [running]:',
      kind: 'esbuild-crashed',
    },
    { message: 'Error: The service was stopped', kind: 'esbuild-crashed' },
    { message: 'Error: spawn esbuild ENOSPC', kind: 'esbuild-crashed' },
  ])('flags $kind from the server log', ({ message, kind }) => {
    expect(classifyServerLog(message)).toEqual({ kind, message });
  });

  it.each(['Pre-transform error (src/x.ts): boom', 'ws error: ECONNRESET', ''])(
    'ignores unrelated log %j',
    (message) => {
      expect(classifyServerLog(message)).toBeNull();
    },
  );

  it('describes every failure kind with its module or message', () => {
    expect(describeReadinessFailure({ kind: 'outdated-optimize-dep', url: moduleUrl })).toMatch(
      new RegExp(`504 Outdated Optimize Dep for ${moduleUrl}`),
    );
    expect(
      describeReadinessFailure({ kind: 'dependency-scan-failed', message: 'scan boom' }),
    ).toMatch(/dependency scan failed:\nscan boom/);
    expect(
      describeReadinessFailure({ kind: 'dependency-optimize-failed', message: 'opt boom' }),
    ).toMatch(/optimizer failed:\nopt boom/);
    expect(describeReadinessFailure({ kind: 'esbuild-crashed', message: 'panic: x' })).toMatch(
      /esbuild crashed[^\n]*\npanic: x/,
    );
  });

  it('rejects racing waits once a failure is recorded and keeps the first cause', async () => {
    const watch = createReadinessWatch();
    watch.record(null);
    await expect(watch.race(Promise.resolve('ok'))).resolves.toBe('ok');
    expect(watch.error()).toBeUndefined();

    watch.record({ kind: 'outdated-optimize-dep', url: moduleUrl });
    watch.record({ kind: 'dependency-scan-failed', message: 'later' });
    await expect(watch.race(new Promise(() => {}))).rejects.toThrow(
      /Sandbox readiness failed: Vite answered 504 Outdated Optimize Dep/,
    );
    expect(watch.error()?.message).toMatch(/Outdated Optimize Dep/);
    expect(watch.failures).toHaveLength(2);
  });
});

describe('runSandbox readiness failures', () => {
  it('fails fast on a 504 Outdated Optimize Dep instead of waiting for the ready marker', async () => {
    const { page, listeners } = mockPage({
      goto: vi.fn(async () => {
        listeners.get('response')?.({
          url: () => 'http://localhost:5173/node_modules/.vite-harness/sandbox/deps/bits-ui.js',
          status: () => 504,
          statusText: () => 'Outdated Optimize Dep',
        });
      }),
      waitForFunction: vi.fn(() => new Promise(() => {})),
    });
    const browser = mockBrowser(page);
    playwright.launch.mockResolvedValue(browser);

    await expect(
      runSandbox(
        parseSandboxArgs(['button', '--state', 'default', '--base-url', 'http://localhost:5173']),
        () => 'unreachable',
      ),
    ).rejects.toThrow(
      /Sandbox readiness failed: Vite answered 504 Outdated Optimize Dep for http:\/\/localhost:5173\/node_modules\/\.vite-harness\/sandbox\/deps\/bits-ui\.js/,
    );
    expect(browser.close).toHaveBeenCalled();
  });

  it('names the readiness failure when the ready marker wait times out afterwards', async () => {
    const { page, listeners } = mockPage({
      locator: vi.fn(() => ({
        waitFor: vi.fn(async () => {
          listeners.get('response')?.({
            url: () => 'http://localhost:5173/@fs/dep.js',
            status: () => 504,
            statusText: () => 'Optimize Deps Processing Error',
          });
          throw new Error('Timeout 30000ms exceeded');
        }),
      })),
    });
    playwright.launch.mockResolvedValue(mockBrowser(page));

    await expect(
      runSandbox(
        parseSandboxArgs(['button', '--state', 'default', '--base-url', 'http://localhost:5173']),
        () => 'unreachable',
      ),
    ).rejects.toThrow(
      /504 Optimize Deps Processing Error for http:\/\/localhost:5173\/@fs\/dep\.js/,
    );
  });

  it('still reports a plain timeout when no readiness failure was observed', async () => {
    const { page } = mockPage({
      locator: vi.fn(() => ({
        waitFor: vi.fn().mockRejectedValue(new Error('Timeout 30000ms exceeded')),
      })),
    });
    playwright.launch.mockResolvedValue(mockBrowser(page));

    await expect(
      runSandbox(
        parseSandboxArgs(['button', '--state', 'default', '--base-url', 'http://localhost:5173']),
        () => 'unreachable',
      ),
    ).rejects.toThrow(/Timed out after 30000ms waiting for scene “button” state “default”/);
  });
});

describe('runSandbox viewport', () => {
  it('keeps a 420px request below the responsive 640px breakpoint', async () => {
    let viewport = { width: 0, height: 0 };
    const page = {
      goto: vi.fn(),
      waitForFunction: vi.fn(),
      evaluate: vi.fn().mockResolvedValueOnce(['landscape-narrow']),
      locator: vi.fn(() => ({ waitFor: vi.fn() })),
      on: vi.fn(),
      viewportSize: vi.fn(() => viewport),
      waitForTimeout: vi.fn(),
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const browser = {
      newContext: vi.fn(async ({ viewport: nextViewport }) => {
        viewport = nextViewport;
        return context;
      }),
      close: vi.fn(),
    };
    playwright.launch.mockResolvedValue(browser);

    const isNarrow = await runSandbox(
      parseSandboxArgs([
        'workspace-hover-card',
        '--state',
        'landscape-narrow',
        '--width',
        '420',
        '--base-url',
        'http://localhost:5173',
      ]),
      ({ page: responsivePage }) => responsivePage.viewportSize().width < 640,
    );

    expect(isNarrow).toBe(true);
    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 420, height: 900 },
      deviceScaleFactor: 1,
    });
  });
});

describe('default sandbox server', () => {
  const previousGoMaxProcs = process.env.SANDBOX_GOMAXPROCS;
  afterEach(() => {
    if (previousGoMaxProcs === undefined) delete process.env.SANDBOX_GOMAXPROCS;
    else process.env.SANDBOX_GOMAXPROCS = previousGoMaxProcs;
  });

  it('rejects an invalid SANDBOX_GOMAXPROCS before touching Vite', async () => {
    process.env.SANDBOX_GOMAXPROCS = 'many';
    await expect(startSandboxServer()).rejects.toThrow(/SANDBOX_GOMAXPROCS/);
  });

  it('serves two concurrent runners on distinct resolved URLs from an isolated cacheDir', async () => {
    const servers = await Promise.all([startSandboxServer(), startSandboxServer()]);

    try {
      expect(servers[0].baseUrl).not.toBe(servers[1].baseUrl);
      expect(servers[0].cacheDir).toBe(viteHarnessCacheDir('sandbox'));
      expect(servers[0].cacheDir).not.toBe(path.join(process.cwd(), 'node_modules', '.vite'));
      const responses = await Promise.all(
        servers.map(({ baseUrl }) => fetch(new URL('sandbox/button?state=default', baseUrl))),
      );
      await Promise.all(responses.map((response) => response.text()));
      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    } finally {
      await servers[1].close();
      await servers[0].close();
    }
  });
});
