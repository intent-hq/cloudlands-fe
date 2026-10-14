import { test as providerTest, expect } from './provider-runtime.mjs';
import { openExample, outputJson } from './functional.mjs';
import { capturePicker } from '../tests/effort-picker.helpers.mjs';

// Source oracle: unchanged ModelPicker.svelte at 003bc52. This suite is only
// for the coordinator-reviewed private daemon with no installed providers.
// The common fixtures retain native errors and immutable-source checks.
const emptyBootMethods = new Set([
  'client.hello',
  'principal.me',
  'events.subscribe',
  'events.unsubscribe',
  'workspace.list',
  'providers.catalog',
  'settings.list',
  'settings.get',
  'host.executionContext',
  'host.checkAuggie',
  'host.toolAvailability',
  'host.providerDiscovery',
  'host.providerAuthStatus',
  'host.findBinary',
]);

export const test = providerTest.extend({
  emptyModelWire: [
    async ({ providerWire }, use, info) => {
      expect(
        process.env.PARITY_MODEL_PICKER_PRIVATE_EMPTY,
        'Run only after the exact private empty-daemon root/URL is approved',
      ).toBe('1');
      try {
        await use(providerWire);
      } finally {
        const unexpected = providerWire.exchanges.filter(
          ({ request }) =>
            !emptyBootMethods.has(request.method) ||
            request.params?.workspaceId !== undefined ||
            request.params?.agentId !== undefined ||
            request.params?.force === true ||
            request.params?.forceRefresh === true,
        );
        await info.attach('model-picker-empty-scope.json', {
          body: JSON.stringify({ allowedMethods: [...emptyBootMethods], unexpected }, null, 2),
          contentType: 'application/json',
        });
        expect(unexpected, 'Unexpected service effects are not empty-catalog acceptance').toEqual(
          [],
        );
        for (const entry of providerWire.exchanges.filter(
          ({ request }) => request.method === 'host.providerDiscovery',
        )) {
          expect(
            entry.response?.error,
            'Actual provider discovery must settle successfully',
          ).toBeUndefined();
          expect(entry.response?.result?.providers).toEqual(expect.any(Array));
          expect(entry.response.result.providers.filter((row) => row.installed)).toEqual([]);
        }
      }
    },
    { auto: true },
  ],
});
export { expect, capturePicker };

const readout = (host, id) => host.getByTestId(`model-picker-${id}`);
export const control = (host, id) => host.getByTestId(`model-picker-${id}`);
export const trigger = (host) =>
  host.getByTestId('model-picker-live-host').getByRole('button').first();
export const settingsAction = (page) =>
  page.getByRole('listbox').getByRole('button', { name: 'Open Settings', exact: true });

export async function expectJson(host, id, expected) {
  await expect.poll(() => outputJson(readout(host, id))).toEqual(expected);
}

// One-shot public Store read only: no dispatch, subscribe, RPC or state injection.
export async function observationSnapshot(page) {
  return page.evaluate(async () => {
    const { store } = await import(new URL('/src/store/index.ts', window.location.href).href);
    const state = store.state;
    return {
      observers: state.providerModels.observers.ids.map(
        (id) => state.providerModels.observers.map[id],
      ),
      checked: state.agentAvailability.hasCheckedOnce,
      discoveryStatus: state.agentAvailability.discoveryStatus,
      loading: Object.values(state.agentAvailability.providerLoadingMap).some(Boolean),
      health: state.daemonHealth.health,
      providerStatus: state.agentAvailability.providerStatusMap,
    };
  });
}

export async function openEmptyModelPicker(page, wire, info) {
  const host = await openExample(page, 'model-picker', 'model-picker-callback');
  // Wait for actual canonical discovery completion, not a fixed delay or a
  // test-only readiness signal that hides component scheduling differences.
  await expectJson(host, 'readiness-loaded', true);
  await expectJson(host, 'daemon-health', 'healthy');
  await expect
    .poll(async () => {
      const snapshot = await observationSnapshot(page);
      return {
        checked: snapshot.checked,
        loading: snapshot.loading,
        discoveryStatus: snapshot.discoveryStatus,
      };
    })
    .toEqual({ checked: true, loading: false, discoveryStatus: 'success' });
  const snapshot = await observationSnapshot(page);
  await info.attach('model-picker-ready.json', {
    body: JSON.stringify(snapshot, null, 2),
    contentType: 'application/json',
  });
  expect(Object.keys(snapshot.providerStatus).length).toBeGreaterThan(0);
  expect(Object.values(snapshot.providerStatus).some((row) => row.available)).toBe(false);
  expect(
    wire.exchanges.some(
      (entry) =>
        entry.request.method === 'host.providerDiscovery' &&
        Array.isArray(entry.response?.result?.providers),
    ),
    'Empty state must be backed by an actual service response',
  ).toBe(true);
  await expectJson(host, 'available-providers', []);
  await expectJson(host, 'selection', null);
  await expectJson(host, 'picks', []);
  await expectJson(host, 'confirmations', []);
  return host;
}

export async function openEmptyPanel(page, host) {
  await trigger(host).press('Enter');
  await expect(settingsAction(page)).toBeVisible();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('searchbox')).toHaveCount(0);
}
