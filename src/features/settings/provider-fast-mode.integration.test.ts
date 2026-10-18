import { flushSync } from 'svelte';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  error: vi.fn(),
  listeners: new Set<(notification: { method: string; params?: unknown }) => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  backendSubscribe: async () => ({ subscriptionId: 'fast-mode-test' }),
  backendUnsubscribe: async () => {},
  onBackendNotification: (
    listener: (notification: { method: string; params?: unknown }) => void,
  ) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
  onBackendReconnected: () => () => {},
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: async () => ({
    success: true,
    data: { providers: {}, paths: {}, secondaryPaths: {}, hiddenProviders: [] },
  }),
  shell: { open: vi.fn() },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.error, success: vi.fn() },
}));
import { store as appStore } from '$store/renderer/store';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { settingsHydrationSaga } from '$store/renderer/slices/settings-events/sagas/settings-hydration-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { providerFastModeSaga } from '$store/renderer/slices/provider-settings/sagas/provider-fast-mode-saga';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectCanAdministerHost } from '$store/renderer/slices/principal/principal-selectors';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { checkSingleProviderSuccess } from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { selectProviderFastModeValues } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { MOCK_PROVIDER_CATALOG } from '../../test/fixtures/provider-catalog.fixture';
import { setProviderFastMode } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { selectFastModeSupportedProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

let saved: Record<string, boolean>;
let revision: number;
let supported: boolean;
let stops: Array<() => void>;
let stopHydration: () => void;
const values = () => selectProviderFastModeValues.select(appStore.state);
const writes = () => mocks.request.mock.calls.filter(([method]) => method === 'settings.update');
function setting(path: string, value: unknown) {
  return {
    path,
    value,
    label: path,
    description: '',
    type: 'object',
    category: 'providers',
    origin: 'file',
  };
}
function emit(value: Record<string, boolean>, rev: number) {
  for (const listener of mocks.listeners)
    listener({
      method: 'events.event',
      params: {
        subscriptionId: 'fast-mode-test',
        event: {
          id: `fast-mode-${rev}`,
          type: 'settings:changed',
          timestamp: '2026-09-28T00:00:00Z',
          data: { changes: [{ path: 'providers.fastMode', value }], revision: rev },
        },
      },
    });
}
async function settle() {
  await vi.advanceTimersByTimeAsync(150);
  flushSync();
}
async function start() {
  stops.push(appStore.runSaga(daemonEventsSaga));
  await settle();
  admitLegacyPrincipal();
  stops.push(appStore.runSaga(providerFastModeSaga));
  stopHydration = appStore.runSaga(settingsHydrationSaga);
  stops.push(() => stopHydration());
  await settle();
  expect(appStore.state.providerSettings.fastMode.supported).toBe(supported);
}
async function readmitAfterReconnect() {
  const reads = () => mocks.request.mock.calls.filter(([method]) => method === 'settings.list');
  const previousReads = reads().length;
  appStore.dispatch(backendReconnected());
  await settle();
  expect(selectCanAdministerHost.select(appStore.state)).toBe(false);
  expect(reads()).toHaveLength(previousReads);
  admitLegacyPrincipal();
  await settle();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetSettingsReadCacheForTests();
  saved = { 'claude-code': false, codex: true };
  revision = 10;
  supported = true;
  stops = [appStore.init()];
  appStore.dispatch(
    providerCatalogLoaded({
      providers: MOCK_PROVIDER_CATALOG.providers.map((p) => ({
        ...p,
        supportsFastMode: ['claude-code', 'codex'].includes(p.id),
      })),
    }),
  );
  for (const id of ['claude-code', 'codex', 'auggie'])
    appStore.dispatch(checkSingleProviderSuccess(id, { available: true, authenticated: true }));
  mocks.request.mockImplementation(
    async (
      method: string,
      params?: { path: string; changes: Array<{ path: string; value: Record<string, boolean> }> },
    ) => {
      if (method === 'settings.list')
        return {
          settings: [
            setting('providers.paths', {}),
            ...(supported ? [setting('providers.fastMode', saved)] : []),
          ],
          revision,
        };
      if (method === 'settings.get') {
        const { value, origin, ...definition } = setting(params!.path, {});
        return { definition, value, origin, revision };
      }
      if (method === 'settings.update') {
        saved = params!.changes[0].value;
        revision++;
        return { applied: params!.changes, revision };
      }
      throw new Error(`Unexpected RPC ${method}`);
    },
  );
});
afterEach(async () => {
  stops.reverse().forEach((stop) => stop());
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('Provider Fast mode through live settings client and hydration', () => {
  it('saves Fast then Standard from an absent Codex preference using only the boolean contract', async () => {
    saved = {};
    await start();
    appStore.dispatch(setProviderFastMode('codex', true));
    await settle();
    expect(saved).toEqual({ codex: true });
    appStore.dispatch(setProviderFastMode('codex', false));
    await settle();
    expect(writes()).toEqual([
      ['settings.update', { changes: [{ path: 'providers.fastMode', value: { codex: true } }] }],
      ['settings.update', { changes: [{ path: 'providers.fastMode', value: { codex: false } }] }],
    ]);
    stopHydration();
    stopHydration = appStore.runSaga(settingsHydrationSaga);
    await settle();
    expect(values()).toEqual({ codex: false });
    expect(writes()).toHaveLength(2);
  });
  it('persists independent preferences in both directions and reloads saved state', async () => {
    await start();
    expect(values()).toEqual({ 'claude-code': false, codex: true });
    appStore.dispatch(setProviderFastMode('claude-code', true));
    await settle();
    expect(saved).toEqual({ 'claude-code': true, codex: true });
    appStore.dispatch(setProviderFastMode('codex', false));
    await settle();
    expect(saved).toEqual({ 'claude-code': true, codex: false });
    stopHydration();
    stopHydration = appStore.runSaga(settingsHydrationSaga);
    await settle();
    expect(values()).toEqual(saved);
    expect(writes()).toHaveLength(2);
  });
  it('reflects daemon events, reset, and reconnect snapshots without echo writes', async () => {
    await start();
    emit({ codex: false }, 11);
    await settle();
    expect(values()).toEqual({ codex: false });
    emit({}, 12);
    await settle();
    expect(values()).toEqual({});
    saved = { codex: true };
    revision = 1;
    await readmitAfterReconnect();
    expect(values()).toEqual({ codex: true });
    expect(writes()).toHaveLength(0);
  });
  it('restores confirmed values and reports rejected writes', async () => {
    await start();
    mocks.request.mockRejectedValueOnce(new Error('Daemon rejected settings.update'));
    appStore.dispatch(setProviderFastMode('codex', false));
    await settle();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(values().codex).toBe(true);
    expect(saved.codex).toBe(true);
    emit({ codex: false }, 11);
    await settle();
    expect(values().codex).toBe(false);
  });
  it('requires both a settings-list definition and a supported provider catalog row', async () => {
    await start();
    expect(selectFastModeSupportedProviders.select(appStore.state)).toEqual([
      'claude-code',
      'codex',
    ]);
    appStore.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    expect(selectFastModeSupportedProviders.select(appStore.state)).toEqual([]);
    appStore.dispatch(
      providerCatalogLoaded({
        providers: MOCK_PROVIDER_CATALOG.providers.map((p) => ({ ...p, supportsFastMode: true })),
      }),
    );
    expect(selectFastModeSupportedProviders.select(appStore.state)).toEqual([
      'claude-code',
      'codex',
    ]);
    supported = false;
    await readmitAfterReconnect();
    expect(selectFastModeSupportedProviders.select(appStore.state)).toEqual([]);
    appStore.dispatch(setProviderFastMode('codex', true));
    await settle();
    expect(writes()).toHaveLength(0);
  });
});
