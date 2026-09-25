// Teardown restores model rows and user values through existing actions. Cache
// timestamps/check flags/epochs may advance; new cache keys are cleared on teardown.
import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import { mockInvoke } from '$shared/ipc-mock-router';
import { setupModelPickerPreviewHandler } from '../../../../test/catalog-preview-ipc';
import {
  providerModelsLoaded,
  providerModelsCacheCleared,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import {
  selectProviderModelsCacheMap,
  selectProviderModelsClearEpoch,
} from '$store/renderer/slices/provider-models/provider-models-selectors';
import {
  selectAvailableModels,
  selectAvailableModelsProviderId,
  selectModelPickerCollapsedGroups,
} from '$store/renderer/slices/model/model-selectors';
import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { modelReloadSaga } from '$store/renderer/slices/model/sagas/model-reload-saga';
import {
  hydrateDefaultProvider,
  setAvailableModels,
  setLoadingStateForProvider,
  setModelPickerGroupCollapsed,
} from '$store/renderer/slices/model/model-slice';
import { setupPreviewProviders } from '../../settings/provider-selector.preview';
import ModelPickerPreview from './ModelPickerPreview.svelte';

const models = [
  {
    value: 'preview-balanced',
    label: 'Balanced',
    description: 'Balanced speed and capability',
    isDefault: true,
    effortLevels: ['low', 'medium', 'high'],
  },
  { value: 'preview-fast', label: 'Fast', description: 'Quick everyday tasks' },
  { value: 'preview-deep', label: 'Deep', description: 'Detailed analysis' },
];

const selectLoadingStates = appStore.createSelector((state) => state.model.loadingState);
let activeCleanup: (() => void) | undefined;

function setupModels(populated: boolean) {
  return () => {
    activeCleanup?.();
    const previousLoading = selectLoadingStates.select(appStore.state);
    const previousCache = selectProviderModelsCacheMap.select(appStore.state);
    const previousModels = selectAvailableModels.select(appStore.state);
    const previousProvider = selectAvailableModelsProviderId.select(appStore.state);
    const previousDefault = selectEffectiveDefaultProviderId.select(appStore.state);
    const previousCollapsed = selectModelPickerCollapsedGroups.select(appStore.state);
    const restoreProviders = setupPreviewProviders();
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI;
    const originalInvoke = bridge?.invoke;
    if (bridge && originalInvoke) {
      // electronAPI.invoke takes precedence over the router in the UI-preview build.
      bridge.invoke = (channel, ...args) =>
        channel === 'codex:get-models' || channel === 'claude-code:get-models'
          ? mockInvoke(channel, ...args)
          : originalInvoke.call(bridge, channel, ...args);
    }
    appStore.dispatch(hydrateDefaultProvider('codex'));
    for (const group of previousCollapsed)
      appStore.dispatch(setModelPickerGroupCollapsed(group, false));
    const epoch = selectProviderModelsClearEpoch.select(appStore.state);
    const restoreModelHandlers: Array<() => void> = [];
    for (const providerId of ['codex', 'claude-code']) {
      const rows = populated
        ? models.map((model) => ({ ...model, value: `${providerId}-${model.value}` }))
        : [];
      restoreModelHandlers.push(setupModelPickerPreviewHandler(providerId, rows));
      appStore.dispatch(providerModelsLoaded(providerId, { models: rows }, epoch));
      if (providerId === 'codex') appStore.dispatch(setAvailableModels(rows, providerId));
    }
    const cancelCatalog = appStore.runSaga(modelReloadSaga);
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (activeCleanup === cleanup) activeCleanup = undefined;
      cancelCatalog();
      if (bridge && originalInvoke) bridge.invoke = originalInvoke;
      for (const restoreHandler of restoreModelHandlers) restoreHandler();
      appStore.dispatch(providerModelsCacheCleared());
      const restoreEpoch = selectProviderModelsClearEpoch.select(appStore.state);
      for (const [providerId, entry] of Object.entries(previousCache))
        appStore.dispatch(providerModelsLoaded(providerId, entry, restoreEpoch));
      appStore.dispatch(setAvailableModels(previousModels, previousProvider));
      for (const group of selectModelPickerCollapsedGroups.select(appStore.state))
        appStore.dispatch(setModelPickerGroupCollapsed(group, false));
      for (const group of previousCollapsed)
        appStore.dispatch(setModelPickerGroupCollapsed(group, true));
      restoreProviders();
      appStore.dispatch(hydrateDefaultProvider(previousDefault));
      for (const providerId of ['codex', 'claude-code']) {
        appStore.dispatch(
          setLoadingStateForProvider({
            providerId,
            ...(previousLoading[providerId] ?? { status: 'success' }),
          }),
        );
      }
    };
    activeCleanup = cleanup;
    return cleanup;
  };
}

export const preview = definePreview<ComponentProps<typeof ModelPickerPreview>>({
  id: 'model-picker',
  title: 'Model picker',
  defaultState: 'populated',
  states: {
    populated: {
      props: {
        selectedModel: null,
        defaultModelId: 'codex-preview-balanced',
        defaultOptionLabel: m.chat_modelPicker_providerDefault_label(),
        defaultOptionDescription: m.settings_backgroundAgent_providerDefault_description(),
        showDefaultOption: true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(true),
    },
    open: {
      props: {
        initialOpen: true,
        selectedModel: null,
        defaultModelId: 'codex-preview-balanced',
        showDefaultOption: true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(true),
    },
    reasoning: {
      props: {
        initialOpen: true,
        selectedModel: 'codex-preview-balanced',
        showReasoning: true,
        reasoningEffort: 'medium',
        onReasoningChange: () => true,
        updateGlobalStore: false,
        updateGlobalDefault: false,
      },
      setup: setupModels(true),
    },
    // Open the “Default model” trigger to reveal the empty state and Retry button.
    // No search is needed: both available providers return an empty model catalog.
    empty: {
      props: {
        selectedModel: null,
        showDefaultOption: false,
        updateGlobalStore: false,
        updateGlobalDefault: false,
        showManageLink: false,
      },
      setup: setupModels(false),
    },
  },
});

export default ModelPickerPreview;
