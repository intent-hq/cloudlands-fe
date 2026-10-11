import { realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect } from './functional.mjs';
import { candidateProvenance } from './provenance.mjs';
import { repoRoot } from './manifest.mjs';
import { openProviderRuntime } from './provider-runtime.mjs';

const readMethods = new Set(['workspace.get', 'agent.list', 'agent.get', 'system.status']);

// Observe actual traffic; never replace transport, responses, timers or Store state.
export const test = base.extend({
  metadataWire: async ({ page }, use, testInfo) => {
    const root = process.env.PARITY_CANDIDATE_ROOT;
    const sha = process.env.PARITY_AGENT_COMMIT;
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
    let sequence = 0;
    let connection = 0;
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
      const agentLeases = new Set(
        exchanges
          .filter((e) => e.request.method === 'agent.subscribe')
          .map((e) => e.response?.result?.subscriptionId),
      );
      await testInfo.attach('agent-metadata-wire.json', {
        body: JSON.stringify(
          {
            parseErrors,
            exchanges: exchanges.map((e) => ({
              connection: e.connection,
              sent: e.sent,
              received: e.received,
              method: e.request.method,
              params: [
                'workspace.get',
                'agent.list',
                'agent.get',
                'agent.subscribe',
                'events.unsubscribe',
              ].includes(e.request.method)
                ? e.request.params
                : undefined,
              error: e.response?.error,
              result:
                e.request.method === 'agent.get'
                  ? summarize(e.response?.result?.agent)
                  : e.request.method === 'agent.subscribe' ||
                      e.request.method === 'events.unsubscribe'
                    ? e.response?.result
                    : undefined,
            })),
            pushes: pushes
              .filter((p) => agentLeases.has(p.subscriptionId))
              .map((p) => ({
                ...p,
                snapshot: p.snapshot?.map(summarize),
                delta: p.delta
                  ? {
                      added: p.delta.added?.map(summarize),
                      updated: p.delta.updated?.map(summarize),
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
          (e) =>
            /^(agent\.|settings\.(update|reset)|workspace\.(create|update|delete)|host\.prepareProviderAdapters)/.test(
              e.request.method,
            ) && !['agent.list', 'agent.get', 'agent.subscribe'].includes(e.request.method),
        ),
        'The metadata journey must remain read-only',
      ).toEqual([]);
      for (const e of exchanges.filter((e) => e.request.method === 'agent.list')) {
        expect(e.request.params.workspaceId).toBeTruthy();
        expect(e.request.params.scope).toBe('topLevel');
      }
      for (const e of exchanges.filter((e) => e.request.method === 'agent.subscribe'))
        expect(e.request.params).toEqual({ workspaceId: expect.any(String) });
      const after = candidateProvenance(root);
      expect(after.commit).toBe(before.commit);
      expect(after.sourceTreeSha256).toBe(before.sourceTreeSha256);
      expect(after.dirty).toBe(false);
    }
  },
});
export { expect };

function summarize(row) {
  if (!row) return row;
  return Object.fromEntries(
    [
      'id',
      'workspaceId',
      'status',
      'provider',
      'model',
      'reasoningEffort',
      'pendingDeleteAt',
      'retiredAt',
    ]
      .filter((k) => Object.hasOwn(row, k))
      .map((k) => [k, row[k]]),
  );
}

export async function rpc(page, method, params) {
  if (!readMethods.has(method)) throw new Error(`Unapproved metadata RPC: ${method}`);
  if (method === 'agent.list' && (!params?.workspaceId || params.scope !== 'topLevel'))
    throw new Error('Agent discovery requires one workspace and topLevel scope');
  return page.evaluate(
    async ({ method, params }) => {
      const { backendRequest } = await import(
        new URL('/src/features/backend/backend-transport.ts', location.href).href
      );
      return backendRequest(method, params);
    },
    { method, params },
  );
}

export async function openMetadata(page, workspaceId = process.env.PARITY_AGENT_WORKSPACE_ID) {
  expect(workspaceId, 'Supply an existing workspace ID; the test creates nothing').toBeTruthy();
  await openProviderRuntime(page);
  const result = await rpc(page, 'workspace.get', { workspaceId });
  expect(result.workspace.id).toBe(workspaceId);
  return workspaceId;
}

export async function existingAgent(page, workspaceId) {
  const result = await rpc(page, 'agent.list', { workspaceId, scope: 'topLevel' });
  expect(result.agents).toBeInstanceOf(Array);
  const eligible = result.agents.filter((a) => !a.pendingDeleteAt && !a.retiredAt);
  const requested = process.env.PARITY_AGENT_ID;
  const selected = requested
    ? eligible.find((a) => a.id === requested)
    : (eligible.find((a) => a.status === 'idle') ?? eligible[0]);
  expect(
    selected,
    'Need an actual non-deleting top-level agent in the chosen workspace',
  ).toBeTruthy();
  expect(selected.workspaceId).toBe(workspaceId);
  return selected.id;
}

export async function acquire(page, workspaceId, agentId, count = 1) {
  return page.evaluateHandle(
    async ({ workspaceId, agentId, count }) => {
      const { acquireAgentMetadata } = await import(
        new URL('/src/features/agent/agent-metadata.ts', location.href).href
      );
      return Array.from({ length: count }, () => acquireAgentMetadata(workspaceId, agentId));
    },
    { workspaceId, agentId, count },
  );
}

export async function release(handle, index) {
  await handle.evaluate((releases, index) => {
    for (const dispose of index === undefined ? releases : [releases[index]]) {
      dispose();
      dispose(); // Exercise the public idempotent disposer, not only one release.
    }
  }, index);
}

export async function snapshot(page, workspaceId, agentId) {
  return page.evaluate(
    async ({ workspaceId, agentId }) => {
      const [{ store }, selectors] = await Promise.all([
        import(new URL('/src/store/index.ts', location.href).href),
        import(new URL('/src/store/agent-session/agent-session-selectors.ts', location.href).href),
      ]);
      const state = store.state;
      return {
        session: selectors.selectAgentSession.select(state, agentId),
        hydrated: selectors.selectAgentDetailHydrated.select(state, agentId),
        workspaceId: agentId
          ? selectors.selectAgentSessionWorkspaceId.select(state, agentId)
          : undefined,
        effort: agentId ? selectors.selectAgentReasoningEffort.select(state, agentId) : undefined,
        sessionIds: state.agentSessions.agentIdsByWorkspace[workspaceId] ?? [],
        workspace: state.workspaceAgents.byWorkspaceId[workspaceId],
        rows: Object.values(state.agentSessions.byAgentId)
          .filter((row) => row.workspaceId === workspaceId)
          .map((row) => ({ id: row.id, workspaceId: row.workspaceId })),
      };
    },
    { workspaceId, agentId },
  );
}

export function requests(wire, method, after = 0) {
  return wire.exchanges.slice(after).filter((e) => e.request.method === method);
}

export async function lease(wire, workspaceId, after = 0) {
  const find = () =>
    requests(wire, 'agent.subscribe', after).find(
      (e) => e.request.params?.workspaceId === workspaceId && e.response,
    );
  await expect.poll(() => Boolean(find()), { timeout: 15_000 }).toBe(true);
  const entry = find();
  expect(entry.request.params).toEqual({ workspaceId });
  expect(entry.response.error).toBeUndefined();
  expect(entry.response.result.subscriptionId).toEqual(expect.any(String));
  const id = entry.response.result.subscriptionId;
  await expect
    .poll(() => wire.pushes.some((p) => p.subscriptionId === id && p.kind === 'snapshot'), {
      timeout: 15_000,
    })
    .toBe(true);
  return id;
}

export async function unsubscribed(wire, subscriptionId) {
  const find = () =>
    requests(wire, 'events.unsubscribe').filter(
      (e) => e.request.params?.subscriptionId === subscriptionId,
    );
  await expect.poll(() => find().filter((e) => e.response).length, { timeout: 15_000 }).toBe(1);
  expect(find()).toHaveLength(1);
  expect(find()[0].request.params).toEqual({ subscriptionId });
  expect(find()[0].response.error).toBeUndefined();
  expect(find()[0].response.result).toEqual({ success: true });
  return find()[0].response.result;
}

// Independent oracle over actual wire events, following the documented snapshot/delta contract.
export function wireIds(wire, subscriptionId) {
  const rows = new Map();
  for (const push of wire.pushes.filter((p) => p.subscriptionId === subscriptionId)) {
    if (push.kind === 'snapshot') {
      rows.clear();
      for (const row of push.snapshot) rows.set(row.id, row);
    } else {
      for (const row of [...(push.delta.added ?? []), ...(push.delta.updated ?? [])])
        rows.set(row.id, row);
      for (const id of push.delta.removedIds ?? []) rows.delete(id);
    }
  }
  return [...rows.values()]
    .filter((row) => !row.pendingDeleteAt)
    .map((row) => row.id)
    .sort();
}

// Assertions use the daemon projection, not the production normalizer or reducer.
export function assertNormalized(session, raw) {
  expect(raw.id).toEqual(expect.any(String));
  expect(raw.workspaceId).toEqual(expect.any(String));
  for (const key of [
    'id',
    'workspaceId',
    'name',
    'status',
    'createdAt',
    'updatedAt',
    'provider',
    'model',
    'reasoningEffort',
    'parentAgentId',
    'retiredAt',
    'effortLevels',
  ])
    expect(session[key]).toEqual(raw[key]);
  expect(session.backendSessionId).toBe(raw.acpSessionId || null);
  expect(session.messages).toEqual([]); // AgentLite carries counts, not transcript hydration.
  if (typeof raw.isBackground === 'boolean')
    expect(session.metadata.isBackground).toBe(raw.isBackground);
}
