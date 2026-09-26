<script lang="ts">
  import { onDestroy } from 'svelte';
  import SpecialistModelOptions from '../../../settings/SpecialistModelOptions.svelte';
  import DefaultAgentModelSettings from '../../../settings/DefaultAgentModelSettings.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';
  import {
    setActiveProvider,
    setProviderEnabled,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    checkSingleProviderSuccess,
    checkAllProvidersComplete,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import {
    setDefaultReasoningEffort,
    setSelectedModel,
    setAvailableModels,
  } from '$store/renderer/slices/model/model-slice';
  import { selectDefaultReasoningEffort } from '$store/renderer/slices/model/model-selectors';
  import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
  import { wireModelsToProviderModels } from '$shared/models/wire-model-info';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';

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
  store.dispatch(setActiveProvider(consumer === 'specialist' ? 'claude-code' : 'codex'));
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
  store.dispatch(setSelectedModel({ providerId: 'codex', model: 'first' }));
  store.dispatch(setDefaultReasoningEffort('high'));
  const defaultEffort$ = selectDefaultReasoningEffort();
  onDestroy(() => {
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
