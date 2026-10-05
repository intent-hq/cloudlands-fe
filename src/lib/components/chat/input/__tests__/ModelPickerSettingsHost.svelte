<script lang="ts">
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import { onDestroy } from 'svelte';
  import SpecialistModelOptions from '../../../settings/SpecialistModelOptions.svelte';
  import DefaultAgentModelSettings from '../../../settings/DefaultAgentModelSettings.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';
  import { setProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    checkSingleProviderSuccess,
    checkAllProvidersComplete,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import {
    loadDefaultReasoningEffortFromStorage,
    loadProviderModelsFromStorage,
    setAvailableModels,
  } from '$store/renderer/slices/model/model-slice';
  import { selectDefaultReasoningEffort } from '$store/renderer/slices/model/model-selectors';
  import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
  import { wireModelsToProviderModels } from '$shared/models/wire-model-info';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';
  import { appClient } from '$lib/client';
  import { applySettingsChanges } from '$features/settings/settings-hydration-service';
  // eslint-disable-next-line themis/forbidden-component-import -- CT-only root harness starts the real default selection owner
  import { modelSelectionSaga } from '$store/renderer/slices/model/sagas/model-selection-saga';
  // eslint-disable-next-line themis/forbidden-component-import -- CT-only root harness starts the real default provider owner
  import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';

  let { consumer }: { consumer: 'specialist' | 'default' } = $props();
  let committed = $state<SpecialistModelOption[]>([]);
  const initialOptions = [{ provider: 'codex', model: 'first', hint: '', reasoningEffort: 'high' }];
  const models = wireModelsToProviderModels({
    providerId: 'codex',
    models: [
      { id: 'first', name: 'First model', effortLevels: ['low', 'high'] },
      { id: 'second', name: 'Second model', effortLevels: ['low', 'high'] },
      { id: 'third', name: 'Third model', effortLevels: ['medium', 'max'] },
      { id: 'plain', name: 'Plain model' },
    ],
  });
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
  store.dispatch(hydrateDefaultProvider(consumer === 'specialist' ? 'claude-code' : 'codex'));
  for (const providerId of ['codex', 'claude-code']) {
    store.dispatch(setProviderEnabled({ providerId, enabled: true }));
    store.dispatch(
      checkSingleProviderSuccess(providerId, { available: true, authenticated: true }),
    );
    const providerModels =
      providerId === 'codex' ? models : [{ value: 'other', label: 'Other provider model' }];
    store.dispatch(providerModelsLoaded(providerId, { models: providerModels }, 0));
    // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only in-memory catalogs
    registerMockIpcHandler(`${providerId}:get-models`, () => ({
      success: true,
      data: providerModels,
    }));
  }
  store.dispatch(checkAllProvidersComplete());
  store.dispatch(setAvailableModels(models, 'codex'));
  store.dispatch(loadProviderModelsFromStorage({ codex: 'first' }));
  store.dispatch(loadDefaultReasoningEffortFromStorage('high'));
  const originalUpdate = appClient.settings.update;
  const originalUpdateSnapshot = appClient.settings.updateSnapshot;
  const originalListSnapshot = appClient.settings.listSnapshot;
  const saved = new Map<string, unknown>([
    ['model.defaultProvider', 'codex'],
    ['model.providerDefaults', { codex: 'first' }],
    ['model.defaultReasoningEffort', 'high'],
    ['quickActions.defaultModel', null],
    ['quickActions.typeOverrides', {}],
    ['quickActions.defaultReasoningEffort', null],
    ['quickActions.typeReasoningEffortOverrides', {}],
    ['quickActions.providerSettings', {}],
  ]);
  appClient.settings.listSnapshot = async () => ({
    settings: [...saved].map(([path, value]) => ({
      path,
      value,
      label: '',
      description: '',
      category: 'model',
      type: typeof value === 'string' ? ('string' as const) : ('object' as const),
    })),
    revision: 1,
  });
  appClient.settings.update = async (changes) => {
    for (const { path, value } of changes) saved.set(path, value);
    // Independent mock daemon delivery; the production writer ignores the response.
    // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only mock daemon receipt, not a component transport call
    queueMicrotask(() => applySettingsChanges(changes));
    return changes;
  };
  appClient.settings.updateSnapshot = async (changes) => ({ applied: changes, revision: 1 });
  const stopDefaultOwner = store.runSaga(modelSelectionSaga);
  const stopProviderOwner = store.runSaga(providerSettingsSaga);
  const defaultEffort$ = selectDefaultReasoningEffort();
  onDestroy(() => {
    stopDefaultOwner();
    stopProviderOwner();
    appClient.settings.update = originalUpdate;
    appClient.settings.updateSnapshot = originalUpdateSnapshot;
    appClient.settings.listSnapshot = originalListSnapshot;
    for (const providerId of ['codex', 'claude-code']) {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only handler cleanup
      unregisterMockIpcHandler(`${providerId}:get-models`);
    }
    disposeStore();
  });
</script>

<div class="p-6" data-testid="settings-consumer">
  {#if consumer === 'specialist'}
    <SpecialistModelOptions
      savedOptions={initialOptions}
      onCommit={(options) => {
        committed = options;
      }}
    />
  {:else}
    <DefaultAgentModelSettings workspaceId={null} />
  {/if}
</div>
<output data-testid="settings-selection" class="sr-only"
  >{JSON.stringify({ committed, defaultEffort: $defaultEffort$ })}</output
>
