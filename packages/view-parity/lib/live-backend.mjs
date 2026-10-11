import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { test as base, expect } from './functional.mjs';

const liveMethods = new Set([
  'host.listDirectory',
  'host.createDirectory',
  'github.pulls.get',
  'github.issues.get',
]);

// Observe real frames without wrapping WebSocket, intercepting routes or supplying responses.
export const test = base.extend({
  liveTrace: async ({ page }, use, testInfo) => {
    const exchanges = [];
    const pending = new Map();
    const parseErrors = [];
    let socketNumber = 0;
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const connection = ++socketNumber;
      socket.on('framesent', ({ payload }) => {
        try {
          const request = JSON.parse(String(payload));
          if (!liveMethods.has(request.method)) return;
          const exchange = { connection, request };
          exchanges.push(exchange);
          pending.set(`${connection}:${request.id}`, exchange);
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
      socket.on('framereceived', ({ payload }) => {
        try {
          const response = JSON.parse(String(payload));
          const exchange = pending.get(`${connection}:${response.id}`);
          if (exchange) {
            exchange.response = response;
            pending.delete(`${connection}:${response.id}`);
          }
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
    });
    await use({
      exchanges,
      async response(method, params, after = 0) {
        const matches = () =>
          exchanges
            .slice(after)
            .filter(
              (entry) =>
                entry.request.method === method &&
                isDeepStrictEqual(entry.request.params, params) &&
                entry.response,
            );
        await expect
          .poll(() => matches().length, {
            message: `No real response for ${method} ${JSON.stringify(params)}`,
            timeout: 15_000,
          })
          .toBeGreaterThan(0);
        const exchange = matches().at(-1);
        expect(exchange.request).toEqual({
          jsonrpc: '2.0',
          id: expect.any(Number),
          method,
          params,
        });
        expect(exchange.response).toMatchObject({
          jsonrpc: '2.0',
          id: exchange.request.id,
        });
        return exchange.response;
      },
    });
    // Home fallback is a read-only contract check; avoid retaining unrelated home filenames.
    const evidence = exchanges.map((exchange) => {
      if (
        exchange.request.method !== 'host.listDirectory' ||
        Object.keys(exchange.request.params).length !== 0 ||
        !exchange.response?.result
      )
        return exchange;
      const { entries, ...listing } = exchange.response.result;
      return {
        ...exchange,
        response: {
          ...exchange.response,
          result: { ...listing, entries: `[${entries.length} home entries omitted]` },
        },
      };
    });
    await testInfo.attach('live-wire.json', {
      body: JSON.stringify({ exchanges: evidence, parseErrors }, null, 2),
      contentType: 'application/json',
    });
    expect(parseErrors, 'The observed daemon frames must be valid JSON').toEqual([]);
  },
});

// Independent oracle: the actual host filesystem, not the picker helper or reducer.
export async function assertDiskListing(response, directory) {
  expect(response.error).toBeUndefined();
  const listing = response.result;
  expect(listing).toMatchObject({
    path: directory,
    parent: path.dirname(directory),
    home: expect.any(String),
    favorites: expect.any(Array),
    entries: expect.any(Array),
  });
  const entries = await readdir(directory, { withFileTypes: true });
  const disk = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      path: path.join(directory, entry.name),
      isDirectory: entry.isDirectory(),
      isGitRepo:
        entry.isDirectory() &&
        (await stat(path.join(directory, entry.name, '.git')).then(
          () => true,
          () => false,
        )),
    })),
  );
  // Contract order is directories first; compare names separately to avoid OS collation assumptions.
  const byName = (a, b) => a.name.localeCompare(b.name);
  expect([...listing.entries].sort(byName)).toEqual(disk.sort(byName));
  const firstFile = listing.entries.findIndex((entry) => !entry.isDirectory);
  if (firstFile >= 0)
    expect(listing.entries.slice(firstFile).every((entry) => !entry.isDirectory)).toBe(true);
  expect(listing.favorites[0]).toEqual({ id: 'home', path: listing.home });
  return listing;
}

export async function githubOracle(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)\/?$/);
  if (parsed.hostname !== 'github.com' || parsed.protocol !== 'https:' || !match)
    throw new Error(
      'PARITY_LIVE_GITHUB_URL must identify a real https://github.com owner/repo pull or issue.',
    );
  const [, owner, repo, kind, number] = match;
  const { stdout } = await promisify(execFile)(
    'gh',
    [
      'api',
      `repos/${owner}/${repo}/${kind === 'pull' ? 'pulls' : 'issues'}/${number}`,
      '--jq',
      '{number,title,state,html_url,created_at,updated_at,user:{login:.user.login},merged,draft,head:{ref:.head.ref},base:{ref:.base.ref}}',
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  return { owner, repo, kind, number: Number(number), data: JSON.parse(stdout) };
}

export async function screenshotEvidence(page, testInfo, name) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
}
