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
  'agent.memoryUsage',
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
          ...(params === undefined ? {} : { params }),
        });
        if (params === undefined) expect(Object.hasOwn(exchange.request, 'params')).toBe(false);
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

// PROTOCOL §5.5: a point-in-time daemon sample, independently checked for
// shape, attribution sums and ordering. A later OS RSS read is not the same sample.
export function assertMemorySample(response) {
  expect(response.error).toBeUndefined();
  const sample = response.result;
  expect(sample).toMatchObject({ agents: expect.any(Array) });
  if (sample.sampledAt === null) {
    expect(sample).toEqual({ sampledAt: null, totalBytes: null, agents: [] });
    return sample;
  }
  expect(sample.sampledAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/);
  expect(Number.isFinite(Date.parse(sample.sampledAt))).toBe(true);
  const integer = (value) => {
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  };
  integer(sample.totalBytes);
  expect(new Set(sample.agents.map((agent) => agent.agentId)).size).toBe(sample.agents.length);
  for (const [index, agent] of sample.agents.entries()) {
    expect(agent).toMatchObject({
      agentId: expect.any(String),
      agentName: expect.any(String),
      workspaceId: expect.any(String),
      provider: expect.any(String),
      processes: expect.any(Array),
    });
    if (Object.hasOwn(agent, 'model')) expect(typeof agent.model).toBe('string');
    integer(agent.rootPid);
    integer(agent.memoryBytes);
    expect(agent.processCount).toBe(agent.processes.length);
    expect(agent.memoryBytes).toBe(
      agent.processes.reduce((sum, proc) => sum + proc.memoryBytes, 0),
    );
    if (index > 0) {
      const previous = sample.agents[index - 1];
      expect(previous.memoryBytes).toBeGreaterThanOrEqual(agent.memoryBytes);
      if (previous.memoryBytes === agent.memoryBytes)
        expect(previous.agentId < agent.agentId).toBe(true);
    }
    expect(new Set(agent.processes.map((proc) => proc.pid)).size).toBe(agent.processes.length);
    for (const [processIndex, proc] of agent.processes.entries()) {
      expect(proc).toMatchObject({ name: expect.any(String), cmdline: expect.any(String) });
      for (const value of [proc.pid, proc.parentPid, proc.memoryBytes]) integer(value);
      if (processIndex > 0)
        expect(agent.processes[processIndex - 1].memoryBytes).toBeGreaterThanOrEqual(
          proc.memoryBytes,
        );
    }
  }
  expect(sample.totalBytes).toBe(sample.agents.reduce((sum, agent) => sum + agent.memoryBytes, 0));
  return sample;
}

// Compare displayed byte quantities numerically at their displayed precision;
// this does not import the app formatter or pin its choice of unit/decimals.
export function assertDisplayedMemory(text, bytes) {
  if (bytes === null) {
    expect(text).toContain('—');
    return;
  }
  const match = text.match(/(\d+(?:\.\d+)?)\s+(MB|GB|TB)/);
  expect(match, 'Rendered memory must include a readable byte quantity').not.toBeNull();
  const scale = { MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[match[2]];
  const precision = (match[1].split('.')[1] || '').length;
  expect(Math.abs(Number(match[1]) - bytes / scale)).toBeLessThanOrEqual(0.5 * 10 ** -precision);
}

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
