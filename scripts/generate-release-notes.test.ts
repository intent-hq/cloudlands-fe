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

      // Mock commits endpoint for SHA resolution
      if (urlStr.includes('/commits/v1.0.0')) {
        return Response.json({ sha: 'fe-resolved-sha' });
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
      '--intentd-version', '0.9.0',
      '--out', outFile,
      '--manifest-out', manifestFile,
    ];
    process.env.GITHUB_TOKEN = 'fake-token';

    // Dynamically import and run the script
    await import('./generate-release-notes.mjs?t=' + Date.now());

    // Poll for the output files instead of a fixed sleep to avoid CI flakiness
    await vi.waitFor(() => {
      readFileSync(outFile, 'utf8');
      readFileSync(manifestFile, 'utf8');
    }, { timeout: 5000 });

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
    // intentd section references the pinned release instead of a commit range
    expect(markdown).toContain(
      '[intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0)',
    );
    expect(markdown).not.toContain('bump version');

    // Verify manifest output
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.feTag).toBe('v1.0.0');
    expect(manifest.feSha).toBe('fe-resolved-sha');
    expect(manifest.intentdVersion).toBe('0.9.0');
    expect(manifest.intentdSha).toBeUndefined();
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Verify GitHub API calls were made — fe only, no intentd API traffic
    expect(fetchCalls.some(url => url.includes('/repos/intent-hq/cloudlands-fe/compare/'))).toBe(true);
    expect(fetchCalls.some(url => url.includes('/commits/v1.0.0'))).toBe(true);
    expect(fetchCalls.some(url => url.includes('/repos/intent-hq/intentd/'))).toBe(false);

    // Verify correct headers were used (Bearer token, API version)
    expect(mockFetch).toHaveBeenCalled();
    const firstCall = mockFetch.mock.calls[0];
    if (firstCall && firstCall.length > 1) {
      const headers = (firstCall[1] as RequestInit)?.headers as Record<string, string>;
      expect(headers?.['Authorization']).toBe('Bearer fake-token');
      expect(headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    }
  });

  it('normalizes a v-prefixed --intentd-version and uses FE_TOKEN when provided', async () => {
    // Track the Authorization header used for each URL
    const authByUrl: Array<{ url: string; auth: string | undefined }> = [];
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = init?.headers as Record<string, string> | undefined;
      authByUrl.push({ url: urlStr, auth: headers?.['Authorization'] });

      if (urlStr.includes('/repos/intent-hq/cloudlands-fe/compare/')) {
        return Response.json({ commits: [{ commit: { message: 'feat: fe feature (#1)' }, sha: 'abc123' }] });
      }
      if (urlStr.includes('/repos/intent-hq/cloudlands-fe/commits/')) {
        return Response.json({ sha: 'fe-resolved-sha' });
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
      '--intentd-version', 'v0.9.0',
      '--out', outFile,
      '--manifest-out', manifestFile,
    ];
    const savedGithubToken = process.env.GITHUB_TOKEN;
    const savedFeToken = process.env.FE_TOKEN;
    delete process.env.GITHUB_TOKEN;
    process.env.FE_TOKEN = 'fe-token';

    try {
      vi.resetModules();
      await import('./generate-release-notes.mjs?t=' + Date.now());
      // Poll for the output files instead of a fixed sleep to avoid CI flakiness
      await vi.waitFor(() => {
        readFileSync(outFile, 'utf8');
        readFileSync(manifestFile, 'utf8');
      }, { timeout: 5000 });

      // Every cloudlands-fe API call used FE_TOKEN; no intentd API calls were made
      const feCalls = authByUrl.filter(c => c.url.includes('/repos/intent-hq/cloudlands-fe/'));
      const intentdCalls = authByUrl.filter(c => c.url.includes('/repos/intent-hq/intentd/'));
      expect(feCalls.length).toBeGreaterThanOrEqual(2); // compare + manifest SHA resolution
      expect(intentdCalls.length).toBe(0);
      expect(feCalls.every(c => c.auth === 'Bearer fe-token')).toBe(true);

      // Output still generated end-to-end; leading `v` is stripped from the pin
      const markdown = readFileSync(outFile, 'utf8');
      expect(markdown).toContain('fe feature');
      expect(markdown).toContain(
        '[intentd v0.9.0](https://github.com/intent-hq/intentd/releases/tag/v0.9.0)',
      );
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      // feTag is derived from --version even when --fe-head is a raw SHA
      expect(manifest.feTag).toBe('v1.0.0');
      expect(manifest.feSha).toBe('fe-resolved-sha');
      expect(manifest.intentdVersion).toBe('0.9.0');
    } finally {
      if (savedFeToken !== undefined) process.env.FE_TOKEN = savedFeToken;
      else delete process.env.FE_TOKEN;
      if (savedGithubToken !== undefined) process.env.GITHUB_TOKEN = savedGithubToken;
    }
  });
});
