// Compatibility facade for the retained Svelte renderer. Keep these public signatures
// until its transcript consumers migrate; both renderers share the neutral core.
import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import {
  formatProviderRehomedLabel as formatLabel,
  type ProviderRehomedNoticeInfo,
} from './rehome-notice-core';

export { getProviderRehomedNotice, type ProviderRehomedNoticeInfo } from './rehome-notice-core';

const displayNames = {
  providerDisplayName: (providerId: string) =>
    selectProviderDisplayName.select(appStore.state, providerId),
  modelDisplayName: (providerId: string, modelId: string, workspaceId?: string) =>
    selectModelDisplayName.select(appStore.state, providerId, modelId, workspaceId),
};

export function formatProviderRehomedLabel(
  notice: ProviderRehomedNoticeInfo,
  fallbackText: string,
  workspaceId?: string,
): string {
  return formatLabel(notice, fallbackText, workspaceId, displayNames);
}
