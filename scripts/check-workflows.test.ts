// @verify-changed-exempt: runs actionlint only over temporary repositories created by the suite

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  ACTIONLINT_SHA256,
  ACTIONLINT_VERSION,
  archiveName,
  binaryVersion,
  DOWNLOAD_WORST_CASE_MS,
  DownloadError,
  fetchReleaseAsset,
  fetchWithRetry,
  transientStatus,
  installFromArchive,
  main,
  platformKey,
  resolveActionlint,
  resolveShellcheck,
  runActionlint,
  verifyChecksum,
} from './check-workflows.mjs';

const temps: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

const servers: Server[] = [];

afterEach(async () => {
  delete process.env.ACTIONLINT_SHELLCHECK;
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoWithWorkflow = (name: string, content: string) => {
  const root = tempDir('check-workflows-repo-');
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', name), content);
  return root;
};

const BROKEN_WORKFLOW = [
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: echo $UNQUOTED_VALUE',
  '      - run: echo done',
  '        if: ${{ github.nonexistent_property }}',
  '',
].join('\n');

const CLEAN_WORKFLOW = [
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: echo "$GITHUB_SHA"',
  '',
].join('\n');

describe('check-workflows pinned download', () => {
  it('maps supported hosts to a pinned release archive', () => {
    expect(platformKey('linux', 'x64')).toBe('linux-amd64');
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(archiveName('linux-arm64')).toBe(`actionlint_${ACTIONLINT_VERSION}_linux_arm64.tar.gz`);
    expect(() => platformKey('win32', 'x64')).toThrow(/no pinned release/);
  });

  it('rejects an archive whose checksum does not match the pin', () => {
    const tampered = Buffer.from('not the actionlint release');
    expect(() => verifyChecksum(tampered, ACTIONLINT_SHA256['linux-amd64'], 'archive')).toThrow(
      /SHA-256 mismatch/,
    );
    const cacheDir = tempDir('check-workflows-cache-');
    expect(() => installFromArchive(tampered, { key: 'linux-amd64', cacheDir })).toThrow(
      /SHA-256 mismatch/,
    );
    expect(existsSync(join(cacheDir, ACTIONLINT_VERSION, 'actionlint'))).toBe(false);
  });

  it('reads release and go-install version banners, and null for a broken binary', () => {
    const dir = tempDir('check-workflows-bin-');
    const fake = (name: string, body: string) => {
      const file = join(dir, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return file;
    };
    expect(binaryVersion(fake('release', 'printf "1.7.12\\ninstalled by downloading\\n"'))).toBe(
      '1.7.12',
    );
    expect(binaryVersion(fake('go-install', 'echo v1.7.12'))).toBe('1.7.12');
    expect(binaryVersion(fake('broken', 'exit 1'))).toBeNull();
    expect(binaryVersion(join(dir, 'missing'))).toBeNull();
  });

  it('accepts a buffer whose digest matches', () => {
    const buffer = Buffer.from('payload');
    const digest = createHash('sha256').update(buffer).digest('hex');
    expect(() => verifyChecksum(buffer, digest, 'payload')).not.toThrow();
  });
});

type Route = (req: { url: string; headers: Record<string, unknown> }) => {
  status: number;
  body?: string | Buffer;
  location?: string;
};

// A local stand-in for github.com and api.github.com that records every request.
const stubGitHub = async (route: Route) => {
  const requests: { url: string; headers: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    const request = { url: req.url ?? '', headers: req.headers };
    requests.push(request);
    const { status, body = '', location } = route(request);
    res.writeHead(status, location ? { location } : {});
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, requests };
};

const NAME = 'actionlint_test.tar.gz';
const DIRECT = `/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${NAME}`;
const RELEASE = `/repos/rhysd/actionlint/releases/tags/v${ACTIONLINT_VERSION}`;
const ASSET = '/repos/rhysd/actionlint/releases/assets/42';
const noWait = { delays: [1, 1, 1], sleep: async () => {}, log: () => {} };
const fromStub = (base: string, token?: string) => ({
  downloadBase: base,
  apiBase: base,
  token,
  ...noWait,
});

describe('check-workflows release download', () => {
  it('retries a transient 5xx and returns the archive', async () => {
    let calls = 0;
    const { base, requests } = await stubGitHub(() =>
      ++calls < 3 ? { status: 504 } : { status: 200, body: 'archive' },
    );
    const buffer = await fetchReleaseAsset(NAME, fromStub(base));
    expect(buffer.toString()).toBe('archive');
    expect(requests.map((r) => r.url)).toEqual([DIRECT, DIRECT, DIRECT]);
  });

  it('fails a 4xx at once without retrying the same URL', async () => {
    const { base } = await stubGitHub(() => ({ status: 404 }));
    const error = await fetchWithRetry(`${base}/missing`, noWait).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).transient).toBe(false);
    expect((error as Error).message).toMatch(/HTTP 404/);
  });

  it('treats an exhausted rate limit as transient and other 403s as permanent', () => {
    const response = (status: number, headers: Record<string, string> = {}) =>
      new Response(null, { status, headers });
    expect(transientStatus(response(503))).toBe(true);
    expect(transientStatus(response(429))).toBe(true);
    expect(transientStatus(response(403, { 'x-ratelimit-remaining': '0' }))).toBe(true);
    expect(transientStatus(response(403, { 'retry-after': '60' }))).toBe(true);
    expect(transientStatus(response(403, { 'x-ratelimit-remaining': '12' }))).toBe(false);
    expect(transientStatus(response(404))).toBe(false);
  });

  it('retries network errors', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response('ok');
    };
    const buffer = await fetchWithRetry('https://example.invalid/x', { ...noWait, fetchImpl });
    expect(buffer.toString()).toBe('ok');
    expect(calls).toBe(2);
  });

  it('falls back to the API asset endpoint when the release download keeps failing', async () => {
    const { base, requests } = await stubGitHub(({ url }) => {
      if (url === RELEASE) {
        return { status: 200, body: JSON.stringify({ assets: [{ id: 42, name: NAME }] }) };
      }
      if (url === ASSET) return { status: 200, body: 'archive via api' };
      return { status: 504 };
    });
    const buffer = await fetchReleaseAsset(NAME, fromStub(base, 'secret-token'));
    expect(buffer.toString()).toBe('archive via api');
    expect(requests.map((r) => r.url)).toEqual([DIRECT, DIRECT, DIRECT, DIRECT, RELEASE, ASSET]);
    const asset = requests.at(-1)!;
    expect(asset.headers.accept).toBe('application/octet-stream');
    expect(asset.headers.authorization).toBe('Bearer secret-token');
    // The token goes only to the API, never to the release download host.
    expect(requests.filter((r) => r.url === DIRECT).every((r) => !r.headers.authorization)).toBe(
      true,
    );
  });

  it('drops the token when the API redirects the asset to another origin', async () => {
    const storage = await stubGitHub(() => ({ status: 200, body: 'archive via storage' }));
    const { base } = await stubGitHub(({ url }) => {
      if (url === RELEASE) {
        return { status: 200, body: JSON.stringify({ assets: [{ id: 42, name: NAME }] }) };
      }
      if (url === ASSET) return { status: 302, location: `${storage.base}/signed-asset` };
      return { status: 504 };
    });
    const buffer = await fetchReleaseAsset(NAME, fromStub(base, 'secret-token'));
    expect(buffer.toString()).toBe('archive via storage');
    expect(storage.requests.map((r) => r.url)).toEqual(['/signed-asset']);
    expect(storage.requests[0].headers.authorization).toBeUndefined();
  });

  it('reports a transient failure only when both sources failed transiently', async () => {
    const { base } = await stubGitHub(() => ({ status: 503 }));
    const outage = await fetchReleaseAsset(NAME, fromStub(base)).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(DownloadError);
    expect((outage as DownloadError).transient).toBe(true);
    expect((outage as Error).message).toMatch(/HTTP 503.*API fallback: .*HTTP 503/);

    const { base: noAsset } = await stubGitHub(({ url }) =>
      url === RELEASE ? { status: 200, body: JSON.stringify({ assets: [] }) } : { status: 504 },
    );
    const missing = await fetchReleaseAsset(NAME, fromStub(noAsset)).catch((e: unknown) => e);
    expect((missing as DownloadError).transient).toBe(false);
    expect((missing as Error).message).toMatch(/has no asset/);
  });

  it('budgets the worst-case stall from the timeout and backoff constants', () => {
    // 3 retried fetches x (4 attempts x 30 s + 2 s + 5 s + 15 s backoff).
    expect(DOWNLOAD_WORST_CASE_MS).toBe(3 * (4 * 30_000 + 22_000));
  });

  it('keeps the checksum pin fail-closed for an archive from either source', async () => {
    const cacheDir = tempDir('check-workflows-cache-');
    const { base } = await stubGitHub(({ url }) => {
      if (url === RELEASE) {
        return { status: 200, body: JSON.stringify({ assets: [{ id: 42, name: NAME }] }) };
      }
      if (url === ASSET) return { status: 200, body: 'tampered archive' };
      return { status: 504 };
    });
    const buffer = await fetchReleaseAsset(NAME, fromStub(base));
    expect(() => installFromArchive(buffer, { key: 'linux-amd64', cacheDir })).toThrow(
      /SHA-256 mismatch/,
    );
    expect(existsSync(join(cacheDir, ACTIONLINT_VERSION, 'actionlint'))).toBe(false);
  });
});

describe('check-workflows shellcheck requirement', () => {
  it('fails instead of letting actionlint skip the shell pass', async () => {
    expect(() => resolveShellcheck('/nonexistent/shellcheck')).toThrow(/would skip every run/);
    process.env.ACTIONLINT_SHELLCHECK = '/nonexistent/shellcheck';
    await expect(
      main({
        cwd: repoWithWorkflow('ok.yml', CLEAN_WORKFLOW),
        cacheDir: tempDir('check-workflows-cache-'),
      }),
    ).resolves.toBe(2);
  });
});

// These run the real pinned binary, which a cold cache downloads from GitHub.
// When every attempt on both sources failed transiently (a GitHub outage) the
// test is skipped with the reason; any other failure (a 4xx, a checksum or
// version mismatch) still fails. The `lint:workflows` gate itself never
// skips, so a real workflow finding cannot pass because of this.
// Resolved once for both tests, so a stalled download costs one worst case,
// and the second test reuses the outcome instead of waiting again.
let resolution: ReturnType<typeof resolveActionlint> | undefined;
const actionlintOrSkip = async (ctx: TestContext) => {
  try {
    return await (resolution ??= resolveActionlint());
  } catch (error) {
    if (error instanceof DownloadError && error.transient) {
      ctx.skip(`actionlint ${ACTIONLINT_VERSION} is unavailable from GitHub: ${error.message}`);
    }
    throw error;
  }
};
// The worst-case download (every attempt on both sources stalling to its
// timeout) plus a minute for extraction and the actionlint run itself, so an
// outage ends in the documented skip rather than a vitest timeout.
const ACTIONLINT_RUN_TIMEOUT_MS = DOWNLOAD_WORST_CASE_MS + 60_000;

describe('check-workflows actionlint run', () => {
  it(
    'fails on a broken workflow and reports shellcheck and expression findings',
    async (ctx) => {
      const actionlint = await actionlintOrSkip(ctx);
      const shellcheck = resolveShellcheck();
      const root = repoWithWorkflow('broken.yml', BROKEN_WORKFLOW);
      const result = runActionlint({ actionlint, shellcheck, cwd: root, stdio: 'pipe' });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('SC2086');
      expect(result.stdout).toContain('property "nonexistent_property" is not defined');
    },
    ACTIONLINT_RUN_TIMEOUT_MS,
  );

  it(
    'passes a clean workflow',
    async (ctx) => {
      const actionlint = await actionlintOrSkip(ctx);
      const root = repoWithWorkflow('clean.yml', CLEAN_WORKFLOW);
      const result = runActionlint({
        actionlint,
        shellcheck: resolveShellcheck(),
        cwd: root,
        stdio: 'pipe',
      });
      expect(result.stdout).toBe('');
      expect(result.status).toBe(0);
    },
    ACTIONLINT_RUN_TIMEOUT_MS,
  );
});
