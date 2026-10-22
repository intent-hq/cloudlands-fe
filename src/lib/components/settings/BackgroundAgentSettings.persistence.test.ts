/** Real picker → settings.update coverage for provider-local quick actions (#6116). */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('svelte-fa', async () => ({
  default: (await import('../ui/__tests__/mocks/Fa.svelte')).default,
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import type { AppSettingChange } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
import {
  checkAllProvidersComplete,
  checkSingleProviderSuccess,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
import { backgroundAgentSettingsSaga } from '$store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga';
import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';

const emptyOverrides = { commit: '', pr: '', review: '', fast: '' };
const request = vi.mocked(backendRequest);
const stops: (() => void)[] = [];
let dispose: () => void;
let persisted: Record<string, unknown>;
let writes: AppSettingChange[][];
let revision: number;

beforeEach(() => {
  dispose = store.init();
  persisted = {
    'model.defaultProvider': 'codex',
    'providers.enabled': { codex: true, 'claude-code': true },
    'quickActions.defaultModel': '',
    'quickActions.typeOverrides': { ...emptyOverrides },
    'quickActions.defaultReasoningEffort': 'medium',
    'quickActions.typeReasoningEffortOverrides': { commit: 'high' },
    'quickActions.providerSettings': {
      'claude-code': {
        defaultModel: '',
        typeOverrides: { ...emptyOverrides },
        defaultReasoningEffort: 'low',
        typeReasoningEffortOverrides: { commit: 'high' },
      },
    },
  };
  writes = [];
  revision = 1;
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.list') {
      expect(params).toBeUndefined();
      return {
        settings: Object.entries(persisted).map(([path, value]) => ({
          path,
          value: structuredClone(value),
        })),
        revision,
      };
    }
    expect(method).toBe('settings.update');
    const { changes } = params as { changes: AppSettingChange[] };
    expect(params).toEqual({ changes });
    // Independent daemon contract: bare IDs only, with atomic batch acceptance.
    for (const { path, value } of changes) {
      const models =
        path === 'quickActions.defaultModel'
          ? [value]
          : path === 'quickActions.typeOverrides'
            ? Object.values(value as object)
            : [];
      expect(models.every((model) => typeof model === 'string' && !model.includes(':'))).toBe(true);
    }
    writes.push(structuredClone(changes));
    for (const { path, value } of changes) persisted[path] = structuredClone(value);
    return { applied: changes, revision: ++revision };
  });
  store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
  for (const provider of ['codex', 'claude-code']) {
    store.dispatch(checkSingleProviderSuccess(provider, { available: true }));
    // The shared ID deliberately exists under both providers: ownership cannot be guessed.
    store.dispatch(
      providerModelsLoaded(
        provider,
        {
          models: [
            {
              value: 'shared-model',
              label: `${provider} shared`,
              isDefault: true,
              effortLevels: ['low', 'medium', 'high'],
            },
            {
              value: `${provider}:legacy-model`,
              label: `${provider} legacy`,
              effortLevels: ['low', 'medium', 'high'],
            },
          ],
        },
        0,
      ),
    );
  }
  store.dispatch(checkAllProvidersComplete());
  stops.push(store.runSaga(providerSettingsSaga), store.runSaga(backgroundAgentSettingsSaga));
  applySettingsChanges(Object.entries(persisted).map(([path, value]) => ({ path, value })));
});

afterEach(() => {
  cleanup();
  for (const stop of stops.splice(0)) stop();
  dispose();
  vi.resetAllMocks();
});

async function openRow(index: number) {
  await tick();
  await fireEvent.click(screen.getAllByRole('button', { expanded: false })[index]);
}

it('does not offer foreign-provider picks in quick-action settings', async () => {
  render(BackgroundAgentSettings);
  await openRow(0);
  expect(await screen.findByRole('tab', { name: /Codex/ })).toBeTruthy();
  expect(screen.queryByRole('tab', { name: /Claude Code/ })).toBeNull();
  expect(writes).toEqual([]);
});

it.each([0, 1, 2, 3].flatMap((row) => ['shared', 'legacy'].map((choice) => ({ row, choice }))))(
  'saves bare model IDs after switching providers, preserving effort (row $row, $choice)',
  async ({ row, choice }) => {
    store.dispatch(setActiveProvider('claude-code'));
    expect(store.state.model.defaultProviderId).toBe('codex');
    await waitFor(() => expect(persisted['model.defaultProvider']).toBe('claude-code'));
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'settings.list',
      'settings.update',
    ]);
    expect(store.state.model.defaultProviderId).toBe('codex');
    expect(store.state.backgroundAgentSettings.providerId).toBe('codex');
    // Deliver the daemon event separately from the successful write acknowledgement.
    applySettingsChanges(
      Object.entries(persisted).map(([path, value]) => ({ path, value })),
      revision,
    );
    expect(store.state.model.defaultProviderId).toBe('claude-code');
    expect(store.state.backgroundAgentSettings.providerId).toBe('claude-code');
    writes.length = 0;
    render(BackgroundAgentSettings);
    await openRow(row);
    await fireEvent.click(
      await screen.findByRole('option', { name: new RegExp(`claude-code ${choice}`) }),
    );
    const model = choice === 'legacy' ? 'legacy-model' : 'shared-model';
    const overrides = {
      ...emptyOverrides,
      ...(row ? { [['commit', 'pr', 'fast'][row - 1]]: model } : {}),
    };
    await waitFor(() => {
      expect(writes).toHaveLength(1);
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false);
    });
    expect(writes[0]).toEqual([
      { path: 'model.defaultProvider', value: 'claude-code' },
      { path: 'quickActions.defaultModel', value: row ? '' : model },
      { path: 'quickActions.typeOverrides', value: overrides },
      { path: 'quickActions.defaultReasoningEffort', value: 'low' },
      { path: 'quickActions.typeReasoningEffortOverrides', value: { commit: 'high' } },
      {
        path: 'quickActions.providerSettings',
        value: {
          'claude-code': {
            defaultModel: '',
            typeOverrides: emptyOverrides,
            defaultReasoningEffort: 'low',
            typeReasoningEffortOverrides: { commit: 'high' },
          },
          codex: {
            defaultModel: '',
            typeOverrides: emptyOverrides,
            defaultReasoningEffort: 'medium',
            typeReasoningEffortOverrides: { commit: 'high' },
          },
        },
      },
    ]);
    expect(persisted['model.defaultProvider']).toBe('claude-code');
    cleanup();
    const saved = structuredClone(persisted);
    for (const stop of stops.splice(0)) stop();
    dispose();
    dispose = store.init();
    stops.push(store.runSaga(backgroundAgentSettingsSaga));
    applySettingsChanges(Object.entries(saved).map(([path, value]) => ({ path, value })));
    expect(store.state.backgroundAgentSettings).toMatchObject({
      providerId: 'claude-code',
      defaultModel: row ? '' : model,
      typeOverrides: overrides,
      defaultReasoningEffort: 'low',
      typeReasoningEffortOverrides: { commit: 'high' },
    });
  },
);

it('keeps a saved foreign legacy model readable without rewriting it', async () => {
  applySettingsChanges([{ path: 'quickActions.defaultModel', value: 'claude-code:shared-model' }]);
  render(BackgroundAgentSettings);
  await tick();
  const trigger = screen.getAllByRole('button', { expanded: false })[0];
  expect(trigger.textContent).toContain('claude-code shared');
  expect(store.state.backgroundAgentSettings.defaultModel).toBe('claude-code:shared-model');
  expect(writes).toEqual([]);
});
