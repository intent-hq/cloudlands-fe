import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('generate-release-notes CLI', () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'release-notes-test-'));
    originalFetch = globalThis.fetch;
    originalArgv = process.argv;
    originalEnv = process.env;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  it('generates markdown and manifest with mocked GitHub API', async () => {
    // Mock fetch to return fake GitHub API responses
    const fetchCalls: string[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);

      // Mock compare endpoint for cloudlands-fe
      if (urlStr.includes('/repos/intent-hq/cloudlands-fe/compare/')) {
        return Response.json({
          commits: [
            { commit: { message: 'feat: add feature (#1)' }, sha: 'abc123' },
            { commit: { message: 'fix: fix bug (#2)' }, sha: 'def456' },
            { commit: { message: 'chore: bump version to 1.0.0' }, sha: 'ignored' },
          ],
        });
      }

      // Mock compare endpoint for intentd
      if (urlStr.includes('/repos/intent-hq/intentd/compare/')) {
        return Response.json({
          commits: [
            { commit: { message: 'perf: improve performance (#10)' }, sha: 'ghi789' },
          ],
        });
      }

      // Mock commits endpoint for SHA resolution
      if (urlStr.includes('/commits/v1.0.0')) {
        return Response.json({ sha: 'fe-resolved-sha' });
      }
      if (urlStr.includes('/commits/intentd-head')) {
        return Response.json({ sha: 'intentd-resolved-sha' });
      }

      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const outFile = join(tempDir, 'notes.md');
    const manifestFile = join(tempDir, 'manifest.json');

    // Set up CLI args and environment
    process.argv = [
      'node',
      'generate-release-notes.mjs',
      '--version', '1.0.0',
      '--fe-base', 'v0.9.0',
      '--fe-head', 'v1.0.0',
      '--intentd-base', 'intentd-base',
      '--intentd-head', 'intentd-head',
      '--out', outFile,
      '--manifest-out', manifestFile,
    ];
    process.env.GITHUB_TOKEN = 'fake-token';

    // Dynamically import and run the script
    const scriptModule = await import('./generate-release-notes.mjs?t=' + Date.now());

    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify markdown output
    const markdown = readFileSync(outFile, 'utf8');
    expect(markdown).toContain('Intent v1.0.0');
    expect(markdown).toContain('## Desktop app (cloudlands-fe)');
    expect(markdown).toContain('## Backend daemon (intentd)');
    expect(markdown).toContain('### Features');
    expect(markdown).toContain('add feature');
    expect(markdown).toContain('[#1](https://github.com/intent-hq/cloudlands-fe/pull/1)');
    expect(markdown).toContain('### Bug Fixes');
    expect(markdown).toContain('fix bug');
    expect(markdown).toContain('[#2](https://github.com/intent-hq/cloudlands-fe/pull/2)');
    expect(markdown).toContain('### Performance');
    expect(markdown).toContain('improve performance');
    expect(markdown).toContain('[#10](https://github.com/intent-hq/intentd/pull/10)');
    expect(markdown).not.toContain('bump version');

    // Verify manifest output
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.feTag).toBe('v1.0.0');
    expect(manifest.feSha).toBe('fe-resolved-sha');
    expect(manifest.intentdSha).toBe('intentd-resolved-sha');
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Verify GitHub API calls were made
    expect(fetchCalls.some(url => url.includes('/repos/intent-hq/cloudlands-fe/compare/'))).toBe(true);
    expect(fetchCalls.some(url => url.includes('/repos/intent-hq/intentd/compare/'))).toBe(true);
    expect(fetchCalls.some(url => url.includes('/commits/v1.0.0'))).toBe(true);
    expect(fetchCalls.some(url => url.includes('/commits/intentd-head'))).toBe(true);

    // Verify correct headers were used (Bearer token, API version)
    expect(mockFetch).toHaveBeenCalled();
    const firstCall = mockFetch.mock.calls[0];
    if (firstCall && firstCall.length > 1) {
      const headers = (firstCall[1] as RequestInit)?.headers as Record<string, string>;
      expect(headers?.['Authorization']).toBe('Bearer fake-token');
      expect(headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    }
  });

  it('uses per-repo tokens (FE_TOKEN / INTENTD_TOKEN) when provided', async () => {
    // Track the Authorization header used for each URL
    const authByUrl: Array<{ url: string; auth: string | undefined }> = [];
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = init?.headers as Record<string, string> | undefined;
      authByUrl.push({ url: urlStr, auth: headers?.['Authorization'] });

      if (urlStr.includes('/repos/intent-hq/cloudlands-fe/compare/')) {
        return Response.json({ commits: [{ commit: { message: 'feat: fe feature (#1)' }, sha: 'abc123' }] });
      }
      if (urlStr.includes('/repos/intent-hq/intentd/compare/')) {
        return Response.json({ commits: [{ commit: { message: 'fix: intentd fix (#10)' }, sha: 'ghi789' }] });
      }
      if (urlStr.includes('/repos/intent-hq/cloudlands-fe/commits/')) {
        return Response.json({ sha: 'fe-resolved-sha' });
      }
      if (urlStr.includes('/repos/intent-hq/intentd/commits/')) {
        return Response.json({ sha: 'intentd-resolved-sha' });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const outFile = join(tempDir, 'notes.md');
    const manifestFile = join(tempDir, 'manifest.json');

    process.argv = [
      'node',
      'generate-release-notes.mjs',
      '--version', '1.0.0',
      '--fe-base', 'v0.9.0',
      '--fe-head', 'fe-head-sha',
      '--intentd-base', 'intentd-base',
      '--intentd-head', 'intentd-head',
      '--out', outFile,
      '--manifest-out', manifestFile,
    ];
    const savedGithubToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    process.env.FE_TOKEN = 'fe-token';
    process.env.INTENTD_TOKEN = 'intentd-token';

    try {
      vi.resetModules();
      await import('./generate-release-notes.mjs?t=' + Date.now());
      await new Promise(resolve => setTimeout(resolve, 100));

      // Every cloudlands-fe API call used FE_TOKEN; every intentd call used INTENTD_TOKEN
      const feCalls = authByUrl.filter(c => c.url.includes('/repos/intent-hq/cloudlands-fe/'));
      const intentdCalls = authByUrl.filter(c => c.url.includes('/repos/intent-hq/intentd/'));
      expect(feCalls.length).toBeGreaterThanOrEqual(2); // compare + manifest SHA resolution
      expect(intentdCalls.length).toBeGreaterThanOrEqual(2);
      expect(feCalls.every(c => c.auth === 'Bearer fe-token')).toBe(true);
      expect(intentdCalls.every(c => c.auth === 'Bearer intentd-token')).toBe(true);

      // Output still generated end-to-end
      const markdown = readFileSync(outFile, 'utf8');
      expect(markdown).toContain('fe feature');
      expect(markdown).toContain('intentd fix');
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      expect(manifest.feSha).toBe('fe-resolved-sha');
      expect(manifest.intentdSha).toBe('intentd-resolved-sha');
    } finally {
      delete process.env.FE_TOKEN;
      delete process.env.INTENTD_TOKEN;
      if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken;
    }
  });
});
