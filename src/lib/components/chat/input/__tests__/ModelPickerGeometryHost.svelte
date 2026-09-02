<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ModelPicker from '../ModelPicker.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
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
  import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';

  let {
    placement = 'settings',
    longList = false,
    disabled = false,
  }: {
    placement?: 'settings' | 'composer' | 'modal';
    longList?: boolean;
    disabled?: boolean;
  } = $props();
  let model = $state('reasoning-model');
  let effort = $state<string | null>(null);
  let changes = $state(0);
  let modalOpen = $state(true);
  const levels = untrack(() =>
    longList
      ? [...Array.from({ length: 20 }, (_, i) => `level-${i + 1}`), 'last-effort']
      : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  );
  const models = Array.from({ length: 20 }, (_, i) => ({
    value: i === 0 ? 'reasoning-model' : `model-${i + 1}`,
    label: i === 0 ? 'Reasoning model' : `Model ${i + 1}`,
    effortLevels: levels,
  }));
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
  store.dispatch(setActiveProvider('codex'));
  store.dispatch(setProviderEnabled({ providerId: 'codex', enabled: true }));
  store.dispatch(checkSingleProviderSuccess('codex', { available: true, authenticated: true }));
  store.dispatch(checkAllProvidersComplete());
  store.dispatch(providerModelsLoaded('codex', { models }, 0));
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only in-memory catalog, not a domain fetch
  registerMockIpcHandler('codex:get-models', () => ({ success: true, data: models }));
  onDestroy(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- clean up the CT-only catalog handler
    unregisterMockIpcHandler('codex:get-models');
    disposeStore();
  });
</script>

{#snippet picker()}
  <div data-testid="model-picker-host">
    <ModelPicker
      selectedModel={model}
      providerId="codex"
      showReasoning
      reasoningEffort={effort}
      reasoningDisabled={disabled}
      onReasoningChange={(value) => {
        effort = value;
        changes += 1;
        return true;
      }}
      onModelChange={(value) => {
        model = value;
      }}
      portal={placement !== 'modal'}
      modalAware={placement === 'modal'}
      collisionBoundary={placement === 'modal' ? '[data-testid="picker-modal"]' : null}
    />
  </div>
  <output class="sr-only" data-testid="selection"
    >{JSON.stringify({ model, effort, changes })}</output
  >
{/snippet}

{#if placement === 'modal'}
  <Dialog.Root bind:open={modalOpen}>
    <Dialog.Content
      class="h-[min(520px,calc(100dvh-32px))] grid-rows-[auto_1fr] overflow-hidden"
      showCloseButton={false}
      data-testid="picker-modal"
    >
      <Dialog.Title>Model settings</Dialog.Title>
      <div class="self-start">{@render picker()}</div>
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <section
    class="fixed left-4 right-4"
    style:top={placement === 'settings' ? '24px' : undefined}
    style:bottom={placement === 'composer' ? '24px' : undefined}
  >
    {@render picker()}
  </section>
{/if}
