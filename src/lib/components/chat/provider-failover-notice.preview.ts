import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import {
  selectProviderCatalogEntries,
  selectProviderCatalogProfiles,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import ProviderFailoverNotice from './ProviderFailoverNotice.svelte';

const PROFILES = [
  {
    id: 'ppersonal0001',
    providerRef: 'claude-code@ppersonal0001',
    baseProviderId: 'claude-code',
    name: 'Personal',
  },
  {
    id: 'pwork00000001',
    providerRef: 'claude-code@pwork00000001',
    baseProviderId: 'claude-code',
    name: 'Work',
  },
];

/** Named profiles (§5.54) label the notice; it never shows a profile reference. */
function setupProfiles() {
  const providers = selectProviderCatalogEntries.select(appStore.state);
  const profiles = selectProviderCatalogProfiles.select(appStore.state);
  appStore.dispatch(
    providerCatalogLoaded({ providers: MOCK_PROVIDER_CATALOG.providers, profiles: PROFILES }),
  );
  return () => {
    appStore.dispatch(providerCatalogLoaded({ providers, profiles }));
  };
}

const quota = (fromProvider: string, toProvider: string) => ({
  notice: { fromProvider, toProvider, model: 'opus', reason: 'quota-exceeded' },
});

export const preview = definePreview<ComponentProps<typeof ProviderFailoverNotice>>({
  id: 'provider-failover-notice',
  title: 'Provider failover notice',
  defaultState: 'profile-to-backup',
  states: {
    'profile-to-backup': {
      props: quota('claude-code@ppersonal0001', 'claude-code@pwork00000001'),
      setup: setupProfiles,
    },
    'default-to-backup': {
      props: quota('claude-code', 'claude-code@pwork00000001'),
      setup: setupProfiles,
    },
    'removed-profile': {
      props: quota('claude-code@pgone00000001', 'claude-code@pwork00000001'),
      setup: setupProfiles,
    },
    fallback: {
      props: {
        notice: { model: null },
        fallbackText: 'claude-code ran out of quota. Switched to the backup claude-code (Work).',
      },
    },
  },
});

export default ProviderFailoverNotice;
