// Success actions restore visible values; loaded/check flags and epochs may remain.
// Newly introduced availability keys settle to unavailable because no remove action exists.
import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
import {
  selectEffectiveDefaultProviderId,
  selectProviderCatalogEntries,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  selectProviderStatusMap,
  selectProviderLoadingMap,
} from '$store/renderer/slices/agent-availability/agent-availability-selectors';
import {
  checkSingleProviderSuccess,
  checkAllProvidersComplete,
  setAllProvidersLoading,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import ProviderSelector from './ProviderSelector.svelte';

export const previewProviders = [
  {
    id: 'codex',
    displayName: 'Codex',
    shortName: 'Codex',
    command: 'codex',
    canBeDisabled: true,
    visible: true,
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    shortName: 'Claude',
    command: 'claude',
    canBeDisabled: true,
    visible: true,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    shortName: 'OpenCode',
    command: 'opencode',
    canBeDisabled: true,
    visible: true,
  },
];

export function setupPreviewProviders() {
  const defaultProvider = selectEffectiveDefaultProviderId.select(appStore.state);
  const catalog = selectProviderCatalogEntries.select(appStore.state);
  const statuses = selectProviderStatusMap.select(appStore.state);
  const loading = selectProviderLoadingMap.select(appStore.state);
  const enabled = selectEnabledProviders.select(appStore.state);
  appStore.dispatch(providerCatalogLoaded({ providers: previewProviders }));
  appStore.dispatch(
    loadEnabledProvidersFromStorage({ codex: true, 'claude-code': true, opencode: false }),
  );
  for (const { id } of previewProviders) {
    appStore.dispatch(
      checkSingleProviderSuccess(id, {
        available: id !== 'opencode',
        authenticated: id !== 'opencode',
      }),
    );
  }
  appStore.dispatch(checkAllProvidersComplete());
  return () => {
    appStore.dispatch(providerCatalogLoaded({ providers: catalog }));
    appStore.dispatch(hydrateDefaultProvider(defaultProvider));
    appStore.dispatch(loadEnabledProvidersFromStorage(enabled));
    for (const { id } of previewProviders) {
      appStore.dispatch(checkSingleProviderSuccess(id, statuses[id] ?? { available: false }));
    }
    appStore.dispatch(setAllProvidersLoading(loading));
  };
}

function setupProviderSelector() {
  const restoreProviders = setupPreviewProviders();
  const unavailable = { available: false };
  const availability: ProviderAvailabilityResult = {
    hasAnyProvider: true,
    hiddenProviders: [],
    providers: {
      codex: { available: true, authenticated: true },
      claudeCode: { available: true, authenticated: true },
      auggie: unavailable,
      cortex: unavailable,
      mock: unavailable,
      opencode: unavailable,
      pi: unavailable,
      droid: unavailable,
      grok: unavailable,
      unsloth: unavailable,
    },
  };
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, () => ({
    success: true,
    data: availability,
  }));
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, () => ({
    success: true,
    data: { paths: {}, secondaryPaths: {} },
  }));
  return () => {
    unregisterMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY);
    unregisterMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS);
    restoreProviders();
  };
}

export const preview = definePreview<ComponentProps<typeof ProviderSelector>>({
  id: 'provider-selector',
  title: 'Provider selector',
  defaultState: 'mixed',
  states: { mixed: { props: {}, setup: setupProviderSelector } },
});

export default ProviderSelector;
