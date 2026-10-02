import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveModelsClient } = await import('$lib/client/live/live-models-client');
  const { LiveProvidersClient } = await import('$lib/client/live/live-providers-client');
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return {
    appClient: {
      models: new LiveModelsClient(),
      providers: new LiveProvidersClient(),
      settings: new LiveSettingsClient(),
    },
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
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import type { AppSettingChange, SettingsUpdateResult } from '$lib/client/app-client';

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
let persisted: Record<string, unknown>;
let revision: number;
const receipts: SettingsUpdateResult[] = [];
const snapshot = () =>
  Object.entries(persisted).map(([path, value]) => ({ path, value: structuredClone(value) }));

function seed() {
  admitLegacyPrincipal();
  applySettingsChanges(snapshot(), revision);
}

async function start() {
  for (const saga of [
    settingsHydrationSaga,
    modelSelectionSaga,
    providerSettingsSaga,
    modelReloadSaga,
    modelBootSaga,
  ]) {
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
  await vi.waitFor(() => expect(receipts).toHaveLength(1));
  await settle();
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(pending.filter(({ providerId }) => providerId === 'claude-code')).toEqual([]);
  const receipt = receipts.shift()!;
  store.dispatch(settingsChangesReceived(receipt.applied, receipt.revision));
  await vi.waitFor(() =>
    expect(pending.some(({ providerId }) => providerId === 'claude-code')).toBe(true),
  );
  // The receipt starts readiness loading; the first explicit refresh joins that read.
  store.dispatch(reloadModelsForProvider());
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
  receipts.length = 0;
  revision = 0;
  persisted = {
    'model.defaultProvider': 'codex',
    'model.providerDefaults': { codex: 'initial', 'claude-code': 'picked' },
    'model.defaultReasoningEffort': 'high',
    'quickActions.defaultModel': '',
    'quickActions.typeOverrides': { commit: '', fast: '', pr: '', review: '' },
    'quickActions.defaultReasoningEffort': '',
    'quickActions.typeReasoningEffortOverrides': {},
    'quickActions.providerSettings': {},
  };
  dispose = store.init();
  window.electronAPI = {
    on: vi.fn((_channel, handler) => {
      handlers.push(handler);
      return 'composed-catalog-status';
    }),
    offById: vi.fn(),
  } as unknown as typeof window.electronAPI;
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    if (method === 'settings.list') return { settings: snapshot(), revision };
    if (method === 'settings.update') {
      const { changes } = params as { changes: AppSettingChange[] };
      const applied = changes
        .filter(({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value))
        .map((change) => ({ ...structuredClone(change), origin: 'file' as const }));
      for (const { path, value } of applied) persisted[path] = structuredClone(value);
      const result = { applied, revision: ++revision };
      receipts.push(structuredClone(result));
      return result;
    }
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
  it('shares the receipt-triggered catalog read with the first explicit reload and preserves saved effort', async () => {
    await start();
    persisted['model.providerDefaults'] = {
      codex: 'initial',
      'claude-code': 'picked',
      grok: 'external',
    };
    revision += 1;
    expect(store.state.model.providerModels.grok).toBeUndefined();
    const requests = await switchProvider();
    expect(requests).toHaveLength(1);
    requests[0].resolve(wire('claude-code', 'picked'));
    await vi.waitFor(() => expectCurrent('success', 'picked'));
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'settings.list'),
    ).toEqual([['settings.list'], ['settings.list']]);
    expect(
      vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'settings.update'),
    ).toEqual([
      [
        'settings.update',
        {
          changes: [
            { path: 'model.defaultProvider', value: 'claude-code' },
            {
              path: 'model.providerDefaults',
              value: { codex: 'initial', 'claude-code': 'picked', grok: 'external' },
            },
            { path: 'quickActions.defaultModel', value: '' },
            {
              path: 'quickActions.typeOverrides',
              value: { commit: '', fast: '', pr: '', review: '' },
            },
            { path: 'quickActions.defaultReasoningEffort', value: '' },
            { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
            {
              path: 'quickActions.providerSettings',
              value: {
                codex: {
                  defaultModel: '',
                  defaultReasoningEffort: '',
                  typeOverrides: { commit: '', fast: '', pr: '', review: '' },
                  typeReasoningEffortOverrides: {},
                },
              },
            },
          ],
        },
      ],
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
