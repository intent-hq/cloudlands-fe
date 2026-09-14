import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveModelsClient } = await import('$lib/client/live/live-models-client');
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { models: new LiveModelsClient(), settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { checkSingleProviderSuccess } from '../../agent-availability/agent-availability-slice';
import { providerModelsLoaded } from '../../provider-models/provider-models-slice';
import { selectModel } from '../model-slice';
import { selectSelectedModel } from '../model-selectors';
import { modelSelectionSaga } from './model-selection-saga';
import { modelReloadSaga } from './model-reload-saga';
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { hydrateSettingsOnceSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { loadModelsOnBootWorker } from './model-boot-saga';
import type { AppSettingChange } from '$lib/client/app-client';

const request = vi.mocked(backendRequest);
let dispose: (() => void) | undefined;
const tasks: Task[] = [];
const cancelSagas: (() => void)[] = [];
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  for (const cancel of cancelSagas.splice(0)) cancel();
  cleanup();
  dispose?.();
  vi.resetAllMocks();
});

const providerCatalogs = {
  codex: {
    providerId: 'codex',
    source: 'static',
    models: [{ id: 'gpt-6-astra', name: 'Codex Astra', isDefault: true }],
  },
  grok: {
    providerId: 'grok',
    source: 'grok',
    models: [{ id: 'grok4.5', name: 'Grok 4.5', isDefault: true }],
  },
};

function catalogReply(params: unknown) {
  const providerId = (params as { providerId?: keyof typeof providerCatalogs } | undefined)
    ?.providerId;
  return providerId ? providerCatalogs[providerId] : auggieCatalog;
}

const auggieCatalog = {
  source: 'auggie',
  models: [{ id: 'gpt6-astra', name: 'GPT 6 Astra', isDefault: true }],
};

for (const legacyEmptyKey of [true, false]) {
  describe(`default model durability, empty provider key ${legacyEmptyKey}`, () => {
    it('keeps the selected model after a delayed cross-provider catalog reload and settings hydration', async () => {
      dispose = store.init();
      store.dispatch(
        providerCatalogLoaded({
          providers: ['auggie', 'codex', 'grok', 'opencode', 'pi'].map((id) => ({
            id,
            displayName: id,
            shortName: id,
            command: id,
            visible: true,
            canBeDisabled: true,
          })),
        }),
      );
      const persisted: Record<string, unknown> = {
        'model.default': 'gpt-5.6-sol',
        'model.defaultProvider': 'codex',
        'model.providerDefaults': {
          ...(legacyEmptyKey ? { '': 'grok4.5' } : {}),
          auggie: 'gpt6-astra',
          codex: 'gpt-6-astra',
        },
        'providers.enabled': { auggie: false, codex: true, grok: true, opencode: true, pi: true },
      };
      const snapshot = () => Object.entries(persisted).map(([path, value]) => ({ path, value }));
      const initialSnapshot = structuredClone(snapshot());
      applySettingsChanges(initialSnapshot);
      const channel = stdChannel();
      const trace: unknown[] = [];
      const pair = () => ({
        provider: store.state.model.defaultProviderId,
        model: selectSelectedModel.select(store.state),
      });
      const dispatch = (action: { type: string; payload?: unknown }) => {
        store.dispatch(action);
        trace.push({ action, pair: pair() });
        channel.put(action);
        return action;
      };
      let releaseCatalog!: () => void;
      request.mockImplementation(async (method, params) => {
        trace.push({ method, params });
        if (method === 'models.list') {
          await new Promise<void>((resolve) => {
            releaseCatalog = resolve;
          });
          return catalogReply(params);
        }
        if (method === 'settings.list') return { settings: snapshot(), revision: 0 };
        if (method === 'settings.update') {
          const changes = (params as { changes: AppSettingChange[] }).changes;
          // v0.9.38 returns only changed paths and may append model.default on a provider switch.
          const effective = [...changes, { path: 'model.default', value: '' }];
          const applied = effective
            .filter(({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value))
            .map((change) => ({ ...change, origin: 'file' as const }));
          for (const { path, value } of applied) persisted[path] = structuredClone(value);
          trace.push({ saved: structuredClone(persisted) });
          dispatch(settingsChangesReceived(applied, 1));
          return { applied, revision: 1 };
        }
        throw new Error(`Unexpected request ${method}`);
      });
      tasks.push(
        runSaga({ channel, dispatch, getState: () => store.state }, settingsHydrationSaga),
      );
      await Promise.resolve();
      tasks.push(runSaga({ channel, dispatch, getState: () => store.state }, modelSelectionSaga));
      tasks.push(runSaga({ channel, dispatch, getState: () => store.state }, modelReloadSaga));
      // The action emitted by the Settings ModelPicker's updateGlobalDefault path.
      dispatch(selectModel('grok4.5', 'grok'));
      await vi.waitFor(() => expect(releaseCatalog).toBeTypeOf('function'));
      expect(pair()).toEqual({ provider: 'grok', model: 'grok4.5' });
      expect(request).toHaveBeenCalledWith('settings.update', {
        changes: [
          { path: 'model.defaultProvider', value: 'grok' },
          {
            path: 'model.providerDefaults',
            value: {
              ...(legacyEmptyKey ? { '': 'grok4.5' } : {}),
              auggie: 'gpt6-astra',
              codex: 'gpt-6-astra',
              grok: 'grok4.5',
            },
          },
        ],
      });
      dispatch(settingsChangesReceived(initialSnapshot, 0));
      expect(pair()).toEqual({ provider: 'grok', model: 'grok4.5' });
      // A catalog read completes after the settings save/echo.
      releaseCatalog();
      await vi.waitFor(() => expect(getItems(store.state.model.availableModels)).toHaveLength(1));
      applySettingsChanges(snapshot());
      trace.push({ afterHydration: pair(), persisted: structuredClone(persisted) });
      const view = render(DefaultAgentModelSettings, {
        context: new Map([['redux-store-context', { store }]]),
      });
      await tick();
      trace.push({ settingsAfterRemount: view.container.textContent });
      console.log(JSON.stringify(trace));
      expect(persisted['model.defaultProvider']).toBe('grok');
      expect((persisted['model.providerDefaults'] as Record<string, string>).grok).toBe('grok4.5');
      expect(pair()).toEqual({ provider: 'grok', model: 'grok4.5' });
      expect(screen.getByRole('button', { name: /Grok 4.5/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /GPT 6 Astra/ })).toBeNull();
      expect(store.state.model.availableModelsProviderId).toBe('grok');
      expect(request).toHaveBeenCalledWith('models.list', { providerId: 'grok' });
    });

    it('keeps the persisted Codex default after boot catalog loading', async () => {
      dispose = store.init();
      applySettingsChanges([
        { path: 'model.defaultProvider', value: 'codex' },
        {
          path: 'model.providerDefaults',
          value: {
            ...(legacyEmptyKey ? { '': 'grok4.5' } : {}),
            auggie: 'gpt6-astra',
            codex: 'gpt-6-astra',
          },
        },
      ]);
      request.mockImplementation(async (_method, params) => catalogReply(params));
      await runSaga(
        { dispatch: store.dispatch, getState: () => store.state },
        loadModelsOnBootWorker,
      ).toPromise();
      expect(store.state.model.providerModels.codex).toBe('gpt-6-astra');
      expect(selectSelectedModel.select(store.state)).toBe('gpt-6-astra');
      render(DefaultAgentModelSettings, { context: new Map([['redux-store-context', { store }]]) });
      expect(screen.getByRole('button', { name: /Codex Astra/ })).toBeTruthy();
      expect(request).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
    });
  });
}

it('keeps a Grok choice made through the real Settings dropdown after the reload returns', async () => {
  dispose = store.init();
  store.dispatch(
    providerCatalogLoaded({
      providers: ['auggie', 'codex', 'grok'].map((id) => ({
        id,
        displayName: id,
        shortName: id,
        command: id,
        visible: true,
        canBeDisabled: true,
      })),
    }),
  );
  const persisted: Record<string, unknown> = {
    'model.default': 'gpt-5.6-sol',
    'model.defaultProvider': 'codex',
    'model.providerDefaults': { codex: 'gpt-6-astra', auggie: 'gpt6-astra' },
    'providers.enabled': { codex: true, grok: true, auggie: false },
  };
  let revision = 0;
  const snapshot = () =>
    Object.entries(persisted).map(([path, value]) => ({ path, value: structuredClone(value) }));
  applySettingsChanges(snapshot());
  const catalogs = {
    codex: [{ value: 'gpt-6-astra', label: 'Codex Astra' }],
    grok: [{ value: 'grok4.5', label: 'Grok 4.5' }],
  };
  for (const [id, models] of Object.entries(catalogs)) {
    store.dispatch(checkSingleProviderSuccess(id, { available: true, authenticated: true }));
    store.dispatch(providerModelsLoaded(id, { models }, 0));
  }
  const originalInvoke = window.electronAPI!.invoke;
  window.electronAPI!.invoke = vi.fn(async (channel: string) => ({
    success: true,
    data: catalogs[channel.split(':')[0] as keyof typeof catalogs] ?? [],
  }));
  let release!: () => void;
  request.mockImplementation(async (method, params) => {
    if (method === 'models.list') {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return catalogReply(params);
    }
    if (method === 'settings.update') {
      const changes = (params as { changes: AppSettingChange[] }).changes;
      const effective = changes.some(({ path }) => path === 'model.defaultProvider')
        ? [...changes, { path: 'model.default', value: '' }]
        : changes;
      const applied = effective.filter(
        ({ path, value }) => JSON.stringify(persisted[path]) !== JSON.stringify(value),
      );
      for (const { path, value } of applied) persisted[path] = structuredClone(value);
      if (applied.length) revision += 1;
      store.dispatch(settingsChangesReceived(applied, revision));
      return { applied, revision };
    }
    if (method === 'settings.list') return { settings: snapshot(), revision };
    throw new Error(`Unexpected request ${method}`);
  });
  cancelSagas.push(store.runSaga(settingsHydrationSaga));
  await Promise.resolve();
  cancelSagas.push(store.runSaga(modelSelectionSaga), store.runSaga(modelReloadSaga));
  try {
    const view = render(DefaultAgentModelSettings, {
      context: new Map([['redux-store-context', { store }]]),
    });
    await fireEvent.click(screen.getByRole('button', { name: /Codex Astra/ }));
    const grokTab = screen.queryByRole('tab', { name: /grok/ });
    if (grokTab) await fireEvent.click(grokTab);
    await fireEvent.click(await screen.findByRole('option', { name: /Grok 4.5/ }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(store.state.model.defaultProviderId).toBe('grok');
    expect(store.state.model.providerModels.grok).toBe('grok4.5');
    await tick();
    expect(screen.getByRole('button', { name: /grok4.5|Grok 4.5/ })).toBeTruthy();
    release();
    await vi.waitFor(() => expect(getItems(store.state.model.availableModels)).toHaveLength(1));
    await tick();
    expect(screen.getByRole('button', { name: /Grok 4.5/ })).toBeTruthy();
    view.unmount();
    render(DefaultAgentModelSettings, {
      context: new Map([['redux-store-context', { store }]]),
    });
    await tick();
    expect(screen.getByRole('button', { name: /Grok 4.5/ })).toBeTruthy();
    expect(selectSelectedModel.select(store.state)).toBe('grok4.5');

    const { appClient } = await import('$lib/client');
    await appClient.settings.updateSnapshot([
      { path: 'model.defaultReasoningEffort', value: 'high' },
    ]);
    expect(persisted['model.defaultProvider']).toBe('grok');
    expect(persisted['model.providerDefaults']).toEqual({
      codex: 'gpt-6-astra',
      auggie: 'gpt6-astra',
      grok: 'grok4.5',
    });
    store.dispatch(backendReconnected());
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('settings.list'));
    await tick();
    expect(screen.getByRole('button', { name: /Grok 4.5/ })).toBeTruthy();
  } finally {
    window.electronAPI!.invoke = originalInvoke;
  }
});

it('rehydrates a fresh renderer from the saved Grok pair before boot catalog loading', async () => {
  dispose = store.init();
  // Serialized shape persisted by the selection path and retained in the
  // independently captured daemon restart evidence. No optimistic state.
  const saved = JSON.stringify([
    { path: 'model.defaultProvider', value: 'grok' },
    {
      path: 'model.providerDefaults',
      value: { codex: 'gpt-6-astra', auggie: 'gpt6-astra', grok: 'grok4.5' },
    },
    { path: 'providers.enabled', value: { codex: true, grok: true, auggie: false } },
    { path: 'model.defaultReasoningEffort', value: 'high' },
  ]);
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') return { settings: JSON.parse(saved), revision: 0 };
    if (method === 'models.list') return catalogReply(params);
    throw new Error(`Unexpected request ${method}`);
  });
  await runSaga(
    { dispatch: store.dispatch, getState: () => store.state },
    hydrateSettingsOnceSaga,
  ).toPromise();
  expect(store.state.model.pendingProviderModels).toEqual({});
  expect(selectSelectedModel.select(store.state)).toBe('grok4.5');
  await runSaga(
    { dispatch: store.dispatch, getState: () => store.state },
    loadModelsOnBootWorker,
  ).toPromise();
  store.dispatch(
    providerCatalogLoaded({
      providers: [
        {
          id: 'grok',
          displayName: 'grok',
          shortName: 'grok',
          command: 'grok',
          visible: true,
          canBeDisabled: true,
        },
      ],
    }),
  );
  store.dispatch(checkSingleProviderSuccess('grok', { available: true, authenticated: true }));
  store.dispatch(
    providerModelsLoaded('grok', { models: [{ value: 'grok4.5', label: 'Grok 4.5' }] }, Date.now()),
  );
  render(DefaultAgentModelSettings, { context: new Map([['redux-store-context', { store }]]) });
  await tick();
  expect(screen.getByRole('button', { name: /Grok 4.5/ })).toBeTruthy();
  expect(store.state.model.defaultProviderId).toBe('grok');
  expect(request.mock.calls.some(([method]) => method === 'settings.update')).toBe(false);
});

it.each([
  ['empty', { providerId: 'grok', models: [] }],
  [
    'partial',
    { providerId: 'grok', models: [{ id: 'grok-old', name: 'Old Grok', isDefault: true }] },
  ],
  ['unscoped', auggieCatalog],
  ['foreign', { ...auggieCatalog, providerId: 'auggie' }],
])('keeps the explicit choice through a %s catalog', async (_name, reply) => {
  dispose = store.init();
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'grok' },
    { path: 'model.providerDefaults', value: { grok: 'grok4.5', auggie: 'gpt6-astra' } },
  ]);
  request.mockResolvedValue(reply);
  await runSaga(
    { dispatch: store.dispatch, getState: () => store.state },
    loadModelsOnBootWorker,
  ).toPromise();
  expect(selectSelectedModel.select(store.state)).toBe('grok4.5');
  expect(store.state.model.defaultProviderId).toBe('grok');
  expect(
    getItems(store.state.model.availableModels).some((model) => model.value === 'gpt6-astra'),
  ).toBe(false);
});
