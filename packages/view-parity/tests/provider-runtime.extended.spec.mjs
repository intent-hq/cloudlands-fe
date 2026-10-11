import {
  test,
  expect,
  openProviderRuntime,
  runtimeSnapshot,
  rpc,
  assertAdmission,
  modelIntent,
  assertModelOutcome,
} from '../lib/provider-runtime.mjs';
import { observeErrors } from '../lib/browser.mjs';

// Optional real service checks. The integration coordinator supplies the clean
// isolated checkout, frozen dependencies, actual daemon bridge and exact SHA.
// These exercise canonical service/actions; the full picker UI is not ported.
test.describe('provider runtime', () => {
  test.setTimeout(90_000);
  test.skip(
    process.env.PARITY_PROVIDER_RUNTIME !== '1',
    'Requires an approved frozen real-daemon candidate',
  );

  test('browser identity and event lease admit the actual principal and host', async ({
    page,
    providerWire,
  }, testInfo) => {
    const state = await openProviderRuntime(page);
    expect(state.principal.principal).toEqual(await rpc(page, 'principal.me', {}));
    if (state.principal.capabilities.hostMembership && ['owner', 'member'].includes(state.role)) {
      const host = await rpc(page, 'host.executionContext', {});
      await expect.poll(async () => (await runtimeSnapshot(page)).host).toEqual(host);
    }
    const connection = providerWire.sockets.at(-1).connection;
    const subscriptionId = assertAdmission(providerWire, connection);
    await testInfo.attach('admission.json', {
      body: JSON.stringify(
        {
          evidenceLevel: 'real browser bootstrap and canonical service state; no picker UI claim',
          backendId: state.backendId,
          connection,
          subscriptionId,
          role: state.role,
          principalContext: state.principalContext,
          hostMembership: state.principal.capabilities.hostMembership,
          unrun: ['other real identities', 'revocation', 'Electron connection registry'],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('owner settings values and revision agree with independent daemon reads', async ({
    page,
    providerWire,
  }, testInfo) => {
    const state = await openProviderRuntime(page);
    test.skip(state.role !== 'owner', 'Owner settings cannot be probed with this real identity');
    const before = await rpc(page, 'settings.list');
    expect(Number.isSafeInteger(before.revision)).toBe(true);
    expect(before.revision).toBeGreaterThanOrEqual(0);
    expect(before.settings).toBeInstanceOf(Array);
    const paths = [
      'model.defaultProvider',
      'model.providerDefaults',
      'model.defaultReasoningEffort',
      'providers.enabled',
    ];
    const readback = await page.evaluate(async (paths) => {
      const { settingsClient } = await import(
        new URL('/src/features/settings/settings-client.ts', location.href).href
      );
      const snapshot = await settingsClient.listSnapshot();
      const entries = await Promise.all(paths.map((path) => settingsClient.get(path)));
      return { snapshot, entries };
    }, paths);
    expect(readback.snapshot).toEqual(before);
    for (const [index, path] of paths.entries()) {
      const wire = await rpc(page, 'settings.get', { path });
      const listed = before.settings.find((entry) => entry.path === path);
      expect(listed, `The real settings catalog must contain ${path}`).toBeTruthy();
      expect(wire.definition.path).toBe(path);
      expect(readback.entries[index].path).toBe(path);
      expect(readback.entries[index].value).toEqual(wire.value);
      expect(listed.value).toEqual(wire.value);
      if (wire.revision !== undefined) expect(wire.revision).toBe(before.revision);
    }
    const after = await rpc(page, 'settings.list');
    expect(after.revision, 'An external settings change invalidates this comparison').toBe(
      before.revision,
    );
    assertAdmission(providerWire, providerWire.sockets.at(-1).connection);
    await testInfo.attach('settings-readback.json', {
      body: JSON.stringify(
        {
          paths,
          revision: after.revision,
          evidenceLevel:
            'real client list and cached get compared with independent RPC list/get; no mutation',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('catalog and sampled readiness retain daemon provider provenance', async ({
    page,
    providerWire,
  }, testInfo) => {
    const initial = await openProviderRuntime(page);
    test.skip(!['owner', 'member'].includes(initial.role), 'Requires an admitted owner/member');
    const catalog = await rpc(page, 'providers.catalog', {});
    await expect
      .poll(async () => (await runtimeSnapshot(page)).providers)
      .toEqual(catalog.providers);
    await expect
      .poll(async () => (await runtimeSnapshot(page)).readinessPending, { timeout: 25_000 })
      .toBe(false);
    const state = await runtimeSnapshot(page);
    expect(state.discoveryError).toBeNull();
    const discovery = await rpc(page, 'host.providerDiscovery', {});
    expect(discovery.providers).toBeInstanceOf(Array);
    const sampled = [];
    // These independent wire contracts cover binary-derived readiness. Other
    // provider-specific adapter/fallback rules are not silently inferred.
    for (const id of ['codex', 'opencode', 'pi', 'droid', 'grok']) {
      if (!catalog.providers.some((row) => row.id === id)) continue;
      expect(
        state.readiness[id],
        `No completed readiness for registry provider ${id}`,
      ).toBeTruthy();
      if (state.role === 'owner') {
        const found = await rpc(page, 'host.findBinary', { name: id });
        expect(state.readiness[id].available).toBe(found.available === true);
      } else {
        const row = discovery.providers.find((row) => row.id === id);
        expect(state.readiness[id].available).toBe(Boolean(row?.installed && !row.gatedOff));
      }
      if (state.readiness[id].available) {
        const auth = await rpc(page, 'host.providerAuthStatus', { providerId: id });
        const verdict = auth.providers.find((row) => row.id === id);
        expect(verdict).toBeTruthy();
        expect(state.readiness[id].authenticated).toBe(verdict.authenticated ?? undefined);
      }
      sampled.push(id);
    }
    expect(
      sampled.length,
      'This environment lacks providers covered by the readiness oracle',
    ).toBeGreaterThan(0);
    assertAdmission(providerWire, providerWire.sockets.at(-1).connection);
    await testInfo.attach('readiness-coverage.json', {
      body: JSON.stringify(
        {
          sampled,
          role: state.role,
          unrun: [
            'installation/login/preparation',
            'other provider-specific readiness branches',
            'manufactured auth failures',
          ],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('two observers share a real forced model read and release their ownership', async ({
    page,
    providerWire,
  }, testInfo) => {
    const initial = await openProviderRuntime(page);
    test.skip(!['owner', 'member'].includes(initial.role), 'Requires an admitted owner/member');
    await expect.poll(async () => (await runtimeSnapshot(page)).catalogLoaded).toBe(true);
    const state = await runtimeSnapshot(page);
    const providerId = state.defaultProviderId;
    test.skip(
      !providerId,
      'No real default provider is configured; verification must not configure one',
    );
    expect(state.providers.some((row) => row.id === providerId)).toBe(true);
    const ids = ['parity-provider-first', 'parity-provider-second'];
    const baselineObservers = state.observerIds;
    try {
      for (const id of ids) await modelIntent(page, 'observe', { id, providerId });
      await expect
        .poll(async () => (await runtimeSnapshot(page, providerId)).request?.status, {
          timeout: 25_000,
        })
        .toMatch(/^(success|error)$/);
      const start = providerWire.exchanges.length;
      const prior = (await runtimeSnapshot(page, providerId)).request?.requestId;
      await modelIntent(page, 'refresh-pair', { providerId });
      await expect
        .poll(
          async () => {
            const current = await runtimeSnapshot(page, providerId);
            return (
              current.request?.requestId !== prior &&
              ['success', 'error'].includes(current.request?.status)
            );
          },
          { timeout: 25_000 },
        )
        .toBe(true);
      const reads = providerWire.exchanges
        .slice(start)
        .filter(
          (entry) =>
            entry.request.method === 'models.list' &&
            entry.request.params?.providerId === providerId &&
            entry.request.params?.forceRefresh === true,
        );
      expect(reads, 'Repeated refresh intents must join the real forced probe').toHaveLength(1);
      expect(reads[0].request.params).toEqual({ providerId, forceRefresh: true });
      expect(reads[0].response).toBeTruthy();
      const settled = await runtimeSnapshot(page, providerId);
      const outcome = assertModelOutcome(settled, reads[0], providerId);
      if (!reads[0].response.error) {
        const independent = await rpc(page, 'models.list', { providerId });
        assertModelOutcome(
          settled,
          { request: { params: { providerId } }, response: { result: independent } },
          providerId,
        );
      }
      await modelIntent(page, 'release', { id: ids[0] });
      expect((await runtimeSnapshot(page)).observerIds).toContain(ids[1]);
      await modelIntent(page, 'release', { id: ids[1] });
      await expect
        .poll(async () => (await runtimeSnapshot(page)).observerIds)
        .toEqual(baselineObservers);
      expect((await runtimeSnapshot(page, providerId)).cache).toEqual(settled.cache);
      assertAdmission(providerWire, providerWire.sockets.at(-1).connection);
      await testInfo.attach('model-read-coverage.json', {
        body: JSON.stringify(
          {
            providerId,
            outcome,
            epoch: settled.epoch,
            evidenceLevel:
              'canonical observe/refresh/release actions; session cache survives release',
            unrun: ['empty', 'error', 'warning', 'stale', 'models'].filter(
              (kind) => kind !== outcome,
            ),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      for (const id of ids) await modelIntent(page, 'release', { id });
    }
  });

  test('a new browser page obtains a new lease and reads after the prior page closes', async ({
    page,
    context,
    browserErrors,
    providerWire,
  }, testInfo) => {
    const before = await openProviderRuntime(page);
    const oldSockets = [...providerWire.sockets];
    const oldLease = assertAdmission(providerWire, oldSockets.at(-1).connection);
    await page.close();
    const boundary = providerWire.exchanges.length;
    const reopened = await context.newPage();
    const reopenedErrors = await observeErrors(reopened);
    providerWire.observePage(reopened);
    try {
      const after = await openProviderRuntime(reopened);
      const newSocket = providerWire.sockets.at(-1);
      expect(oldSockets.some((socket) => socket.connection === newSocket.connection)).toBe(false);
      const newLease = assertAdmission(providerWire, newSocket.connection);
      expect(newLease).not.toBe(oldLease);
      expect(after.principal.principal).toEqual(await rpc(reopened, 'principal.me', {}));
      expect(
        providerWire.exchanges
          .slice(boundary)
          .some((entry) => oldSockets.some((socket) => socket.connection === entry.connection)),
      ).toBe(false);
      await testInfo.attach('browser-lifecycle.json', {
        body: JSON.stringify(
          {
            oldLease,
            newLease,
            roles: [before.role, after.role],
            socketCloseEventsObserved: oldSockets.map((socket) => socket.closed),
            evidenceLevel: 'native page close/new page and real transport re-admission only',
            unrun: [
              'in-page root disposer/HMR',
              'same-document transport reconnect',
              'late lease response race',
              'server-side lease enumeration',
              'old socket retirement when browser target teardown emits no close event',
            ],
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      await reopened.close();
      browserErrors.push(...reopenedErrors);
    }
  });

  test.skip('root cancellation and late publication fencing', () => {
    // UNRUN: the actual disposer is privately owned by client HMR. No test-only
    // export, duplicate start, fake notifications or injected state is allowed.
  });
  test.skip('member and revoked identity transitions', () => {
    // UNRUN: requires real separately admitted identities and real revocation.
    // Current-identity reads above do not establish the transition contract.
  });
});
