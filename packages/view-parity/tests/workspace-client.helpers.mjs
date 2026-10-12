import { realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '../lib/functional.mjs';
import { candidateProvenance } from '../lib/provenance.mjs';
import { repoRoot } from '../lib/manifest.mjs';
import { openProviderRuntime } from '../lib/provider-runtime.mjs';

const workspaceMethods = new Set([
  'workspace.list',
  'workspace.get',
  'workspace.getContext',
  'workspace.getTokenUsage',
  'workspace.getBrowserClient',
  'workspace.subscribe',
  'workspace.unsubscribe',
]);

// Existing fixtures own fatal native errors and source provenance. The private
// observer adds workspace replies/pushes, absent from the provider/live observers.
export const test = base.extend({
  workspaceWire: async ({ page }, use, testInfo) => {
    const root = process.env.PARITY_CANDIDATE_ROOT;
    const sha = process.env.PARITY_WORKSPACE_COMMIT;
    expect(sha, 'Supply the coordinator-approved immutable SHA').toMatch(/^[a-f0-9]{40}$/);
    expect(root).toBeTruthy();
    expect(realpathSync(root)).not.toBe(realpathSync(repoRoot));
    const before = candidateProvenance(root);
    expect(before.commit).toBe(sha);
    expect(before.dirty).toBe(false);
    expect(
      path
        .relative(realpathSync(root), realpathSync(path.join(root, 'node_modules/.pnpm')))
        .startsWith('..'),
    ).toBe(false);
    const exchanges = [];
    const pushes = [];
    const pending = new Map();
    const parseErrors = [];
    let connection = 0;
    let sequence = 0;
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const socketId = ++connection;
      socket.on('framesent', ({ payload }) => {
        try {
          const request = JSON.parse(String(payload));
          if (!request.method) return;
          const entry = { connection: socketId, sent: ++sequence, request };
          exchanges.push(entry);
          pending.set(`${socketId}:${request.id}`, entry);
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
      socket.on('framereceived', ({ payload }) => {
        try {
          const response = JSON.parse(String(payload));
          const entry = pending.get(`${socketId}:${response.id}`);
          if (entry) {
            entry.received = ++sequence;
            entry.response = response;
            pending.delete(`${socketId}:${response.id}`);
          } else if (response.method === 'subscription.push') {
            pushes.push({ connection: socketId, received: ++sequence, ...response.params });
          }
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
    });
    try {
      await use({ exchanges, pushes });
    } finally {
      const leaseIds = new Set(
        requests({ exchanges }, 'workspace.subscribe').map(
          (e) => e.response?.result?.subscriptionId,
        ),
      );
      await testInfo.attach('workspace-wire.json', {
        body: JSON.stringify(
          {
            parseErrors,
            exchanges: exchanges.map((e) => ({
              connection: e.connection,
              sent: e.sent,
              received: e.received,
              method: e.request.method,
              params: workspaceMethods.has(e.request.method) ? e.request.params : undefined,
              error: e.response?.error,
              result: receipt(e.request.method, e.response?.result),
            })),
            pushes: pushes
              .filter((p) => leaseIds.has(p.subscriptionId))
              .map((p) => ({
                connection: p.connection,
                received: p.received,
                subscriptionId: p.subscriptionId,
                kind: p.kind,
                seq: p.seq,
                snapshotIds: p.snapshot?.map((row) => row.id),
                deltaIds: p.delta
                  ? {
                      added: p.delta.added?.map((row) => row.id),
                      updated: p.delta.updated?.map((row) => row.id),
                      removedIds: p.delta.removedIds,
                    }
                  : undefined,
              })),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      expect(parseErrors).toEqual([]);
      expect(
        exchanges.filter(
          ({ request: r }) =>
            (r.method.startsWith('workspace.') && !workspaceMethods.has(r.method)) ||
            /^(agent\.|settings\.(update|reset)|host\.prepareProviderAdapters|git\.|repository\.)/.test(
              r.method,
            ),
        ),
        'No workspace, agent, settings or repository mutations/preparation',
      ).toEqual([]);
      const after = candidateProvenance(root);
      expect(after.commit).toBe(before.commit);
      expect(after.sourceTreeSha256).toBe(before.sourceTreeSha256);
      expect(after.dirty).toBe(false);
    }
  },
});
export { expect };

function receipt(method, result) {
  if (!result) return result;
  if (method === 'workspace.list') return { ids: result.workspaces?.map((w) => w.id) };
  if (method === 'workspace.get') return { id: result.workspace?.id };
  if (method === 'workspace.getContext')
    return { items: result.items?.map(({ id, type }) => ({ id, type })) };
  if (method === 'workspace.getTokenUsage')
    return { available: result.tokenUsage !== null, lastScanAt: result.tokenUsage?.lastScanAt };
  if (
    ['workspace.subscribe', 'workspace.unsubscribe', 'workspace.getBrowserClient'].includes(method)
  )
    return result;
  if (method === 'system.status')
    return { running: result.running, version: result.version, buildCommit: result.buildCommit };
  return undefined;
}

export function requests(wire, method, start = 0) {
  return wire.exchanges.slice(start).filter((e) => e.request.method === method);
}

export async function reply(wire, method, params, start = 0) {
  const entries = () => requests(wire, method, start);
  await expect.poll(() => entries().filter((e) => e.response).length, { timeout: 15_000 }).toBe(1);
  expect(entries()).toHaveLength(1);
  const entry = entries()[0];
  expect(entry.request).toEqual({
    jsonrpc: '2.0',
    id: expect.any(Number),
    method,
    ...(params === undefined ? {} : { params }),
  });
  expect(entry.response).toMatchObject({ jsonrpc: '2.0', id: entry.request.id });
  expect(entry.response.error).toBeUndefined();
  return entry;
}

export async function openWorkspaceClient(page) {
  const workspaceId = process.env.PARITY_WORKSPACE_ID;
  expect(
    workspaceId,
    'Supply the actual existing workspace ID; no resources are created',
  ).toBeTruthy();
  await openProviderRuntime(page);
  return workspaceId;
}

// Invoke only the real exported singleton; no transport, Store or factory replacement.
export async function read(page, method, args = []) {
  if (!['list', 'get', 'open', 'getContext', 'getTokenUsage', 'getBrowserClient'].includes(method))
    throw new Error(`Unapproved workspace read: ${method}`);
  return page.evaluate(
    async ({ method, args }) => {
      const { workspaceClient } = await import(
        new URL('/src/features/workspace/workspace-client.ts', location.href).href
      );
      return workspaceClient[method](...args);
    },
    { method, args },
  );
}

// Independent oracle over the received record; preserve all wire fields and
// check only the legacy client additions applicable to a real returned row.
export function assertRow(row, raw) {
  expect(raw.id).toEqual(expect.any(String));
  expect(raw.title).toEqual(expect.any(String));
  expect(raw.createdAt).toEqual(expect.any(String));
  expect(raw.updatedAt).toEqual(expect.any(String));
  const statuses = {
    active: 'Active',
    inactive: 'Inactive',
    archived: 'Archived',
    deleted: 'Deleted',
  };
  expect(Object.hasOwn(statuses, raw.status.toLowerCase())).toBe(true);
  for (const [key, value] of Object.entries(raw))
    if (key !== 'status') expect(row[key], `Wire field ${key}`).toEqual(value);
  expect(row.status).toBe(statuses[raw.status.toLowerCase()]);
  for (const key of ['changesets', 'timeline', 'conversationInfo'])
    expect(row[key]).toEqual(raw[key] ?? []);
  expect(row.branch).toBe(raw.branch ?? '');
}

export async function subscribe(page) {
  return page.evaluateHandle(async () => {
    const { workspaceClient } = await import(
      new URL('/src/features/workspace/workspace-client.ts', location.href).href
    );
    const snapshots = [];
    const dispose = workspaceClient.subscribe((rows) => snapshots.push(structuredClone(rows)));
    return { snapshots, dispose };
  });
}

export async function release(handle) {
  await handle.evaluate(({ dispose }) => {
    dispose();
    dispose();
  });
}

export async function unsubscribeReply(wire, subscriptionId) {
  const entries = () =>
    requests(wire, 'workspace.unsubscribe').filter(
      (e) => e.request.params?.subscriptionId === subscriptionId,
    );
  await expect.poll(() => entries().filter((e) => e.response).length, { timeout: 15_000 }).toBe(1);
  expect(entries()).toHaveLength(1);
  expect(entries()[0].request.params).toEqual({ subscriptionId });
  expect(entries()[0].response.error).toBeUndefined();
  expect(entries()[0].response.result).toEqual({ success: true });
  return entries()[0];
}
