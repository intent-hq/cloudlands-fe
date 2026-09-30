import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ getProviderSettings: vi.fn(), update: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveModelsClient } = await import('$lib/client/live/live-models-client');
  const { LiveProvidersClient } = await import('$lib/client/live/live-providers-client');
  return {
    appClient: { models: new LiveModelsClient(), providers: new LiveProvidersClient(), settings },
  };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { m } from '$shared/paraglide/messages.js';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectAvailableModels } from '../model-selectors';
import { reloadModelsForProvider, selectModel } from '../model-slice';
import { modelBootSaga } from './model-boot-saga';
import { modelReloadSaga } from './model-reload-saga';
import { modelSelectionSaga } from './model-selection-saga';
import { providerSettingsSaga } from '../../provider-settings/sagas/provider-settings-saga';

type PendingCatalog = {
  providerId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
const pending: PendingCatalog[] = [];
const handlers: Array<(value: unknown) => void> = [];
const cancellations: Array<() => void> = [];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const wire = (providerId: string, id: string) => ({
  providerId,
  source: 'static',
  models: [{ id, name: id, effortLevels: ['low', 'medium', 'high'] }],
});
let dispose: () => void;

function seed() {
  admitLegacyPrincipal();
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'codex' },
    { path: 'model.providerDefaults', value: { codex: 'initial', 'claude-code': 'picked' } },
    { path: 'model.defaultReasoningEffort', value: 'high' },
  ]);
}

async function start() {
  for (const saga of [modelSelectionSaga, providerSettingsSaga, modelReloadSaga, modelBootSaga]) {
    cancellations.push(store.runSaga(saga));
  }
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending[0].resolve(wire('codex', 'initial'));
  await vi.waitFor(() =>
    expect(selectAvailableModels.select(store.state)[0]?.value).toBe('initial'),
  );
}

async function switchProvider() {
  store.dispatch(selectModel('picked', 'claude-code'));
  await vi.waitFor(() =>
    expect(pending.some(({ providerId }) => providerId === 'claude-code')).toBe(true),
  );
  await settle();
  return pending.filter(({ providerId }) => providerId === 'claude-code');
}

function finish(request: PendingCatalog, outcome: 'success' | 'error', id: string) {
  if (outcome === 'success') request.resolve(wire(request.providerId, id));
  else request.reject(new Error(`catalog transport failure: ${id}`));
}

function expectCurrent(outcome: 'success' | 'error', id: string) {
  expect(store.state.model.loadingState['claude-code']).toMatchObject(
    outcome === 'success'
      ? { status: 'success', retryAttempt: 0 }
      : {
          status: 'error',
          error: m.settings_models_noneAvailable({ providerId: 'claude-code' }),
        },
  );
  expect(selectAvailableModels.select(store.state).map(({ value }) => value)).toEqual(
    outcome === 'success' ? [id] : [],
  );
  expect(store.state.model.providerModels['claude-code']).toBe('picked');
  expect(store.state.model.defaultReasoningEffort).toBe('high');
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.length = 0;
  handlers.length = 0;
  dispose = store.init();
  window.electronAPI = {
    on: vi.fn((_channel, handler) => {
      handlers.push(handler);
      return 'composed-catalog-status';
    }),
    offById: vi.fn(),
  } as unknown as typeof window.electronAPI;
  settings.getProviderSettings.mockResolvedValue(null);
  settings.update.mockImplementation(async (changes) => changes);
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    if (method !== 'models.list') throw new Error(`Unexpected composition request ${method}`);
    return new Promise((resolve, reject) => {
      pending.push({ providerId: (params as { providerId: string }).providerId, resolve, reject });
    });
  });
  seed();
});

afterEach(() => {
  cancellations.splice(0).forEach((cancel) => cancel());
  dispose();
});

describe('catalog ownership across the real selection, provider, boot and reload sagas', () => {
  it('coalesces one model-provider selection into one catalog read and preserves saved effort', async () => {
    await start();
    const requests = await switchProvider();
    expect(requests).toHaveLength(1);
    requests[0].resolve(wire('claude-code', 'picked'));
    await vi.waitFor(() => expectCurrent('success', 'picked'));
    expect(settings.update).toHaveBeenCalledWith([
      { path: 'model.defaultProvider', value: 'claude-code' },
      { path: 'model.providerDefaults', value: { codex: 'initial', 'claude-code': 'picked' } },
    ]);
    expect(store.state.userPreferences.labsMultiplayerEnabled).toBe(false);
  });

  it.each([
    ['success', 'old-first'],
    ['success', 'new-first'],
    ['error', 'old-first'],
    ['error', 'new-first'],
  ] as const)(
    'keeps the latest explicit %s outcome when the readiness reply arrives %s',
    async (outcome, order) => {
      await start();
      const [old] = await switchProvider();
      const count = pending.length;
      store.dispatch(reloadModelsForProvider());
      await vi.waitFor(() => expect(pending).toHaveLength(count + 1));
      const latest = pending.at(-1)!;
      if (order === 'old-first') {
        finish(old, outcome === 'success' ? 'error' : 'success', 'obsolete');
        await settle();
        expect(store.state.model.loadingState['claude-code'].status).toBe('loading');
        expect(selectAvailableModels.select(store.state)).toEqual([]);
      }
      finish(latest, outcome, 'current');
      await vi.waitFor(() => expectCurrent(outcome, 'current'));
      if (order === 'new-first') {
        finish(old, outcome === 'success' ? 'error' : 'success', 'obsolete');
        await settle();
        expectCurrent(outcome, 'current');
      }
    },
  );

  it.each([
    ['success', 'old-first'],
    ['success', 'new-first'],
    ['error', 'old-first'],
    ['error', 'new-first'],
  ] as const)(
    'keeps a reconnect-owned %s outcome when an explicit reply arrives %s',
    async (outcome, order) => {
      await start();
      for (const request of await switchProvider()) request.resolve(wire('claude-code', 'picked'));
      await vi.waitFor(() => expectCurrent('success', 'picked'));
      const count = pending.length;
      store.dispatch(reloadModelsForProvider());
      await vi.waitFor(() => expect(pending).toHaveLength(count + 1));
      const old = pending.at(-1)!;
      handlers.forEach((handler) => handler({ status: 'connected', reconnected: true }));
      await vi.waitFor(() => expect(pending).toHaveLength(count + 2));
      const latest = pending.at(-1)!;
      if (order === 'old-first') {
        finish(old, outcome === 'success' ? 'error' : 'success', 'obsolete');
        await settle();
        expect(store.state.model.loadingState['claude-code'].status).toBe('loading');
        expect(selectAvailableModels.select(store.state)).toEqual([]);
      }
      finish(latest, outcome, 'reconnected');
      await vi.waitFor(() => expectCurrent(outcome, 'reconnected'));
      if (order === 'new-first') {
        finish(old, outcome === 'success' ? 'error' : 'success', 'obsolete');
        await settle();
        expectCurrent(outcome, 'reconnected');
      }
    },
  );

  it('does not let a held explicit or readiness reply publish after demotion', async () => {
    await start();
    const requests = await switchProvider();
    admitLegacyPrincipal('guest');
    const model = store.state.model;
    requests.forEach((request) => request.resolve(wire('claude-code', 'obsolete')));
    await settle();
    expect(store.state.model).toBe(model);
  });
});
