import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('generate-stable-summary CLI', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stable-summary-test-'));
    originalFetch = globalThis.fetch;
    originalArgv = process.argv;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  async function runScript(args: string[]): Promise<string> {
    const outFile = join(tempDir, 'summary.md');
    process.argv = ['node', 'generate-stable-summary.mjs', ...args, '--out', outFile];
    vi.resetModules();
    await import('./generate-stable-summary.mjs?t=' + Date.now());
    await vi.waitFor(() => {
      readFileSync(outFile, 'utf8');
    }, { timeout: 5000 });
    return readFileSync(outFile, 'utf8');
  }

  it('renders the consolidated intentd delta when the pin moved across the stable range', async () => {
    const authByUrl: Array<{ url: string; auth: string | undefined }> = [];
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = init?.headers as Record<string, string> | undefined;
      authByUrl.push({ url: urlStr, auth: headers?.['Authorization'] });

      if (urlStr.includes('/repos/intent-hq/intentd/compare/v0.8.0...v0.9.0')) {
        return Response.json({
          commits: [
            { commit: { message: 'feat: add daemon feature (#10)' }, sha: 'd1' },
            { commit: { message: 'fix: fix daemon bug (#11)' }, sha: 'd2' },
            { commit: { message: 'chore(release): release v0.9.0 (#12)' }, sha: 'd3' },
          ],
        });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    delete process.env.GITHUB_TOKEN;
    process.env.INTENTD_TOKEN = 'intentd-token';

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', '2.0.7',
      '--intentd-version', '0.9.0',
      '--intentd-base', '0.8.0',
    ]);

    // Leading summary lines
    expect(markdown).toContain('# Intent v2.1.0 — stable promotion');
    expect(markdown).toContain('- Promoted version: v2.1.0');
    expect(markdown).toContain('- Previous stable: v2.0.7');
    expect(markdown).toContain('- Backend daemon (intentd): v0.8.0 → v0.9.0');

    // Consolidated intentd section with the rendered commit delta
    expect(markdown).toContain('## Backend daemon (intentd)');
    expect(markdown).toContain(
      'Bundles [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) (previously v0.8.0)',
    );
    expect(markdown).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(markdown).toContain('### Features');
    expect(markdown).toContain('- add daemon feature ([#10](https://github.com/intent-hq/intentd/pull/10))');
    expect(markdown).toContain('### Bug Fixes');
    expect(markdown).toContain('- fix daemon bug ([#11](https://github.com/intent-hq/intentd/pull/11))');
    // chore(release) commits are skipped
    expect(markdown).not.toContain('release v0.9.0');

    // intentd API calls use INTENTD_TOKEN and the pinned API version header
    const intentdCalls = authByUrl.filter(c => c.url.includes('/repos/intent-hq/intentd/'));
    expect(intentdCalls.length).toBeGreaterThanOrEqual(1);
    expect(intentdCalls.every(c => c.auth === 'Bearer intentd-token')).toBe(true);
    const firstCall = mockFetch.mock.calls[0];
    const headers = (firstCall?.[1] as RequestInit)?.headers as Record<string, string>;
    expect(headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('renders an unchanged line without intentd traffic when the pin did not move', async () => {
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    process.env.GITHUB_TOKEN = 'fake-token';

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', '2.0.7',
      '--intentd-version', '0.9.0',
      '--intentd-base', '0.9.0',
    ]);

    expect(markdown).toContain('- Backend daemon (intentd): v0.9.0 (unchanged)');
    expect(markdown).toContain(
      'intentd unchanged ([v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0)).',
    );
    expect(fetchCalls.length).toBe(0);
  });

  it('degrades to the plain pin line when the previous pin is unrecoverable', async () => {
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    process.env.GITHUB_TOKEN = 'fake-token';

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', '2.0.7',
      '--intentd-version', '0.9.0',
    ]);

    expect(markdown).toContain('- Backend daemon (intentd): v0.9.0');
    expect(markdown).toContain(
      'Bundles the pinned [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) release.',
    );
    expect(markdown).not.toContain('previously');
    expect(fetchCalls.length).toBe(0);
  });

  it('handles a first promotion with no previous stable and no pins', async () => {
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const markdown = await runScript(['--version', '2.1.0']);

    expect(markdown).toContain('# Intent v2.1.0 — stable promotion');
    expect(markdown).toContain('- Previous stable: none (first promotion)');
    expect(markdown).not.toContain('## Backend daemon (intentd)');
    expect(fetchCalls.length).toBe(0);
  });

  it('falls back to the pin line + compare link when the intentd compare fetch fails', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/repos/intent-hq/intentd/compare/')) {
        return new Response('server error', { status: 500, statusText: 'Internal Server Error' });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    process.env.GITHUB_TOKEN = 'fake-token';

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', '2.0.7',
      '--intentd-version', '0.9.0',
      '--intentd-base', '0.8.0',
    ]);

    // Fail-soft: the summary is still written with the pin line + compare
    // link, without a commit list or a misleading "No changes." claim
    expect(markdown).toContain('- Backend daemon (intentd): v0.8.0 → v0.9.0');
    expect(markdown).toContain(
      'Bundles [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) (previously v0.8.0)',
    );
    expect(markdown).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(markdown).not.toContain('No changes.');
    expect(markdown).not.toContain('https://github.com/intent-hq/intentd/pull/');
  });

  it('skips the intentd delta fetch when no intentd-capable token is available', async () => {
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    delete process.env.GITHUB_TOKEN;
    delete process.env.INTENTD_TOKEN;

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', '2.0.7',
      '--intentd-version', '0.9.0',
      '--intentd-base', '0.8.0',
    ]);

    expect(fetchCalls.length).toBe(0);
    expect(markdown).toContain(
      'Bundles [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) (previously v0.8.0)',
    );
    expect(markdown).toContain('https://github.com/intent-hq/intentd/compare/v0.8.0...v0.9.0');
    expect(markdown).not.toContain('No changes.');
  });

  it('ignores invalid optional versions and keeps the plain pin line', async () => {
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(url.toString());
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    process.env.GITHUB_TOKEN = 'fake-token';

    const markdown = await runScript([
      '--version', '2.1.0',
      '--prev-stable', 'garbage',
      '--intentd-version', '0.9.0',
      '--intentd-base', 'garbage',
    ]);

    expect(fetchCalls.length).toBe(0);
    // An invalid --prev-stable is a data problem, not a first promotion
    expect(markdown).toContain('- Previous stable: unknown');
    expect(markdown).not.toContain('first promotion');
    expect(markdown).toContain(
      'Bundles the pinned [intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0) release.',
    );
    expect(markdown).not.toContain('previously');
  });

  it('fails fast with a clear error when required arguments are missing', () => {
    // Run as a child process because the script exits via process.exit
    const outFile = join(tempDir, 'summary.md');
    const script = join(__dirname, 'generate-stable-summary.mjs');

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [script, '--out', outFile], {
        env: { ...process.env },
        encoding: 'utf8',
      });
    } catch (error) {
      const e = error as { status?: number; stderr?: string };
      exitCode = e.status ?? 0;
      stderr = e.stderr ?? '';
    }

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Missing required argument: --version');
    expect(existsSync(outFile)).toBe(false);
  });
});
