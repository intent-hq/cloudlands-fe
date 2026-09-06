// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const playwright = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: playwright.launch } }));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { buildSandboxUrl, parseSandboxArgs, runSandbox } from './runner.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const shotCli = path.join(repoRoot, 'scripts', 'sandbox', 'shot.mjs');

function runShot(outputPath: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [shotCli, 'button', '--state', 'default', '--out', outputPath],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', rejectPromise);
    child.on('exit', (code) => resolvePromise({ code, output }));
  });
}

beforeEach(() => vi.clearAllMocks());

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
  it('captures from two concurrent runners on distinct resolved URLs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sandbox-concurrent-'));
    const outputPaths = [path.join(directory, 'first.png'), path.join(directory, 'second.png')];

    try {
      const results = await Promise.all(outputPaths.map(runShot));
      for (const result of results) {
        expect(result.code, result.output).toBe(0);
      }
      const captures = await Promise.all(outputPaths.map((outputPath) => readFile(outputPath)));
      expect(captures.every((capture) => capture.toString('ascii', 1, 4) === 'PNG')).toBe(true);

      const urls = results.map(({ output }) => output.match(/https?:\/\/[^\s]+/)?.[0]);
      expect(urls.every(Boolean)).toBe(true);
      expect(new Set(urls).size).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
