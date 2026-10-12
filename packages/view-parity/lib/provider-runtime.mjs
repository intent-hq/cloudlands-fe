import { realpathSync } from 'node:fs';
import path from 'node:path';
import { test as base } from './live-backend.mjs';
import { expect } from './functional.mjs';
import { candidateProvenance } from './provenance.mjs';
import { repoRoot } from './manifest.mjs';

const readMethods = new Set([
  'system.status',
  'principal.me',
  'host.executionContext',
  'providers.catalog',
  'settings.list',
  'settings.get',
  'models.list',
  'host.providerDiscovery',
  'host.providerAuthStatus',
  'host.findBinary',
  'host.checkAuggie',
]);
const prohibited =
  /^(settings\.(update|reset)|agent\.(create|update|setModel|delete)|host\.prepareProviderAdapters|providers?\..*(install|login|prepare))/i;

function browserSourceRoot() {
  const mapped = process.env.PARITY_PROVIDER_BROWSER_SOURCE_ROOT;
  if (!mapped) return process.env.PARITY_CANDIDATE_ROOT;
  // The audited private frontend mounts the host-fingerprinted checkout here.
  // This affects only the action import URL, never the provenance/dependency root.
  if (mapped !== '/candidate' || process.env.PARITY_PROVIDER_PRIVATE_EMPTY !== '1')
    throw new Error('Browser source-root mapping requires the audited private-empty namespace');
  return mapped;
}

// The common fixtures own source hashing, native ErrorEvent/unhandled-rejection
// observation and real backend evidence. This adds only provider-domain frames.
export const test = base.extend({
  providerWire: async ({ page }, use, testInfo) => {
    const root = process.env.PARITY_CANDIDATE_ROOT;
    const sha = process.env.PARITY_PROVIDER_COMMIT;
    expect(root, 'Declare the approved isolated candidate checkout').toBeTruthy();
    expect(sha, 'Declare its approved immutable integration SHA').toMatch(/^[a-f0-9]{40}$/);
    const before = candidateProvenance(root);
    expect(before.commit).toBe(sha);
    expect(before.dirty, 'Run only a clean committed candidate').toBe(false);
    expect(realpathSync(root), 'Do not run against the shared working tree').not.toBe(
      realpathSync(repoRoot),
    );
    const dependencies = realpathSync(path.join(root, 'node_modules/.pnpm'));
    expect(path.relative(root, dependencies).startsWith('..')).toBe(false);
    const actionSourceRoot = browserSourceRoot();

    const exchanges = [];
    const sockets = [];
    const pending = new Map();
    const parseErrors = [];
    let sequence = 0;
    const attach = (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const connection = sockets.length + 1;
      const state = { connection, url: socket.url(), closed: false };
      sockets.push(state);
      socket.on('close', () => {
        state.closed = true;
      });
      socket.on('framesent', ({ payload }) => {
        try {
          const request = JSON.parse(String(payload));
          if (!request.method) return;
          const entry = { connection, sent: ++sequence, request };
          exchanges.push(entry);
          pending.set(`${connection}:${request.id}`, entry);
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
      socket.on('framereceived', ({ payload }) => {
        try {
          const response = JSON.parse(String(payload));
          const entry = pending.get(`${connection}:${response.id}`);
          if (entry) {
            entry.received = ++sequence;
            entry.response = response;
            pending.delete(`${connection}:${response.id}`);
          }
        } catch (error) {
          parseErrors.push(error.message);
        }
      });
    };
    const observedPages = new Set();
    const observePage = (target) => {
      if (observedPages.has(target)) return;
      observedPages.add(target);
      target.on('websocket', attach);
    };
    observePage(page);
    try {
      await use({ exchanges, sockets, observePage });
    } finally {
      for (const target of observedPages) target.off('websocket', attach);
      // Keep ordering, wire errors and provider results. Avoid persisting the
      // unrelated settings catalog, workspace listings or hello identity bag.
      await testInfo.attach('provider-wire.json', {
        body: JSON.stringify(
          {
            hostFingerprintRoot: root,
            browserSourceRoot: actionSourceRoot,
            sockets,
            parseErrors,
            exchanges: exchanges.map((entry) => ({
              connection: entry.connection,
              sent: entry.sent,
              received: entry.received,
              method: entry.request.method,
              params: Object.fromEntries(
                Object.entries(entry.request.params ?? {}).filter(([key]) =>
                  [
                    'providerId',
                    'workspaceId',
                    'path',
                    'forceRefresh',
                    'force',
                    'subscriptionId',
                    'name',
                  ].includes(key),
                ),
              ),
              error: entry.response?.error,
              result: ['models.list', 'providers.catalog', 'events.subscribe'].includes(
                entry.request.method,
              )
                ? entry.response?.result
                : undefined,
              revision: entry.response?.result?.revision,
            })),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      expect(parseErrors).toEqual([]);
      expect(
        exchanges.filter(({ request }) => prohibited.test(request.method)),
        'Provider verification must remain read-only',
      ).toEqual([]);
      const after = candidateProvenance(root);
      expect(after.commit).toBe(before.commit);
      expect(after.sourceTreeSha256).toBe(before.sourceTreeSha256);
      expect(after.dirty).toBe(false);
    }
  },
});
export { expect };

export async function rpc(page, method, params) {
  if (!readMethods.has(method)) throw new Error(`Unapproved verification RPC: ${method}`);
  return page.evaluate(
    async ({ method, params }) => {
      const { backendRequest } = await import(
        new URL('/src/features/backend/backend-transport.ts', location.href).href
      );
      return params === undefined ? backendRequest(method) : backendRequest(method, params);
    },
    { method, params },
  );
}

export async function runtimeSnapshot(page, providerId, workspaceId) {
  return page.evaluate(
    async ({ providerId, workspaceId }) => {
      const load = (name) => import(new URL(`/src/${name}.ts`, location.href).href);
      const [{ store }, principal, host, catalog, models] = await Promise.all([
        load('store/index'),
        load('store/principal/principal-selectors'),
        load('store/host-execution/host-execution-selectors'),
        load('store/provider-catalog/provider-catalog-selectors'),
        load('store/provider-models/provider-models-selectors'),
      ]);
      const state = store.state;
      return {
        preload: typeof window.electronAPI !== 'undefined',
        bridge: window.__INTENT_RUNTIME_CONFIG__?.intentdWsUrl,
        backendId: state.connections.windowBackendId,
        identityLoaded: state.connections.hasReceivedList,
        health: state.daemonHealth.health,
        transport: state.daemonHealth.transport,
        generation: state.daemonHealth.connectionGeneration,
        subscriptionGeneration: state.workspaceEvents.subscriptionGeneration,
        subscriptionPending: state.workspaceEvents.subscriptionPending,
        principalContext: principal.selectPrincipalConnectionContext.select(state),
        principal: principal.selectPrincipalSnapshot.select(state),
        role: principal.selectHostRole.select(state),
        host: host.selectHostExecutionContext.select(state),
        catalogLoaded: catalog.selectProviderCatalogLoaded.select(state),
        providers: catalog.selectProviderCatalogEntries.select(state, workspaceId),
        defaultProviderId: catalog.selectEffectiveDefaultProviderId.select(state, workspaceId),
        readiness: state.agentAvailability.providerStatusMap,
        readinessPending: Object.values(state.agentAvailability.providerLoadingMap).some(Boolean),
        discoveryError: state.agentAvailability.discoveryError,
        observed: models.selectObservedModelProviders.select(state),
        observerIds: state.providerModels.observers.ids,
        epoch: models.selectProviderModelsClearEpoch.select(state),
        cache: providerId
          ? models.selectProviderModelsCacheEntry.select(state, providerId, workspaceId)
          : undefined,
        request: providerId
          ? models.selectProviderModelsRequests.select(state, workspaceId)[providerId]
          : undefined,
      };
    },
    { providerId, workspaceId },
  );
}

export async function openProviderRuntime(page) {
  const response = await page.goto(
    new URL('/sandbox/button?theme=light&motion=reduced', process.env.PARITY_CANDIDATE_URL).href,
    { waitUntil: 'domcontentloaded' },
  );
  expect(response?.ok()).toBe(true);
  // The catalog installs this API in its real React effect, after client.tsx
  // initializes the Store. A loaded document alone is not hydrated startup.
  await page.waitForFunction(() => Boolean(window.__INTENT_PREVIEW__), undefined, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await runtimeSnapshot(page)).principal !== null, { timeout: 20_000 })
    .toBe(true);
  const state = await runtimeSnapshot(page);
  expect(state.preload).toBe(false);
  expect(state.bridge).toBe('/intentd/ws');
  expect(state.identityLoaded).toBe(true);
  expect(state.backendId).toBe('browser-websocket');
  expect(state.health).toBe('healthy');
  expect(state.subscriptionPending).toBe(false);
  expect(state.subscriptionGeneration).toBeGreaterThan(0);
  expect(state.principalContext).toBeTruthy();
  expect((await rpc(page, 'system.status')).running).toBe(true);
  return state;
}

export function assertAdmission(wire, connection) {
  const frames = wire.exchanges.filter((entry) => entry.connection === connection);
  const hello = frames.find(
    (entry) => entry.request.method === 'client.hello' && entry.response?.result?.server,
  );
  expect(hello, 'The real transport must complete its daemon handshake').toBeTruthy();
  const lease = frames.find(
    (entry) =>
      entry.request.method === 'events.subscribe' && entry.response?.result?.subscriptionId,
  );
  expect(lease, 'The daemon must issue a real event lease').toBeTruthy();
  expect(lease.sent).toBeGreaterThan(hello.received);
  const principal = frames.find(
    (entry) => entry.request.method === 'principal.me' && entry.response?.result?.id,
  );
  expect(principal).toBeTruthy();
  expect(principal.sent).toBeGreaterThan(lease.received);
  for (const entry of frames.filter((entry) =>
    ['providers.catalog', 'models.list', 'settings.list', 'settings.get'].includes(
      entry.request.method,
    ),
  )) {
    expect(entry.sent, `${entry.request.method} precedes event admission`).toBeGreaterThan(
      lease.received,
    );
    // Static registry metadata intentionally precedes role admission in Svelte.
    if (entry.request.method === 'providers.catalog') continue;
    expect(entry.sent, `${entry.request.method} precedes principal admission`).toBeGreaterThan(
      principal.received,
    );
    if (entry.request.method.startsWith('settings.') && !entry.request.params?.workspaceId)
      expect(principal.response.result.isAdministrator).toBe(true);
    if (principal.response.result.hostRole === 'member' && entry.request.method === 'models.list') {
      const host = frames.find(
        (item) => item.request.method === 'host.executionContext' && item.response?.result,
      );
      expect(host).toBeTruthy();
      expect(entry.sent).toBeGreaterThan(host.received);
    }
  }
  return lease.response.result.subscriptionId;
}

export async function modelIntent(page, kind, { id, providerId, workspaceId }) {
  return page.evaluate(
    async ({ root, kind, id, providerId, workspaceId }) => {
      const { store } = await import(new URL('/src/store/index.ts', location.href).href);
      const actions = await import(
        new URL(
          `/@fs${root}/src/store/renderer/slices/provider-models/provider-models-slice.ts`,
          location.href,
        ).href
      );
      if (kind === 'observe')
        store.dispatch(actions.providerModelsObserved(id, [providerId], workspaceId));
      else if (kind === 'release') store.dispatch(actions.providerModelsReleased(id));
      else if (kind === 'refresh-pair') {
        store.dispatch(actions.providerModelsRequested(providerId, 'refresh', workspaceId));
        store.dispatch(actions.providerModelsRequested(providerId, 'refresh', workspaceId));
      } else throw new Error(`Unknown model intent: ${kind}`);
    },
    { root: browserSourceRoot(), kind, id, providerId, workspaceId },
  );
}

export function assertModelOutcome(state, exchange, providerId) {
  expect(exchange.request.params.providerId).toBe(providerId);
  if (exchange.response.error) {
    expect(state.request.status).toBe('error');
    expect(state.request.error).toBeTruthy();
    return 'error';
  }
  const result = exchange.response.result;
  expect(result.models).toBeInstanceOf(Array);
  if (result.providerId !== undefined) expect(result.providerId).toBe(providerId);
  expect(state.request.status).toBe('success');
  expect(state.cache.models).toHaveLength(result.models.length);
  for (const [index, wire] of result.models.entries()) {
    const row = state.cache.models[index];
    expect(row.value).toBe(wire.id);
    expect(row.label).toBe(wire.name);
    if (wire.provider !== undefined) expect(wire.provider).toBe(providerId);
    for (const key of [
      'description',
      'costTier',
      'effortLevels',
      'badges',
      'priority',
      'modelGroupPriority',
    ])
      expect(row[key]).toEqual(wire[key]);
    for (const key of ['isDefault', 'isLegacyModel'])
      expect(row[key] === true).toBe(wire[key] === true);
  }
  expect(state.cache.warning ?? '').toBe(result.warning ?? '');
  expect(state.cache.stale === true).toBe(result.stale === true);
  return result.models.length === 0
    ? 'empty'
    : result.stale
      ? 'stale'
      : result.warning
        ? 'warning'
        : 'models';
}
