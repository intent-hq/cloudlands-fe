import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { store as appStore } from '$store/renderer/store';
import {
  selectProviderCatalogEntries,
  selectProviderCatalogProfiles,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectProviderModelsClearEpoch } from '$store/renderer/slices/provider-models/provider-models-selectors';
import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import ModelChangeNotice from './ModelChangeNotice.svelte';

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

/** Named profiles (§5.54) label the notice; the switch never shows a profile reference. */
function setupProfiles() {
  const providers = selectProviderCatalogEntries.select(appStore.state);
  const profiles = selectProviderCatalogProfiles.select(appStore.state);
  appStore.dispatch(
    providerCatalogLoaded({ providers: MOCK_PROVIDER_CATALOG.providers, profiles: PROFILES }),
  );
  appStore.dispatch(
    providerModelsLoaded(
      'claude-code',
      { models: [{ value: 'opus', label: 'Opus 5.5' }] },
      selectProviderModelsClearEpoch.select(appStore.state),
    ),
  );
  return () => {
    appStore.dispatch(providerCatalogLoaded({ providers, profiles }));
  };
}

export const preview = definePreview<ComponentProps<typeof ModelChangeNotice>>({
  id: 'model-change-notice',
  title: 'Model change notice',
  defaultState: 'profile-switch',
  states: {
    'profile-switch': {
      props: {
        notice: {
          from: 'opus',
          to: 'opus',
          fromProvider: 'claude-code@ppersonal0001',
          toProvider: 'claude-code@pwork00000001',
        },
      },
      setup: setupProfiles,
    },
    'default-to-profile': {
      props: {
        notice: {
          from: 'opus',
          to: 'opus',
          fromProvider: 'claude-code',
          toProvider: 'claude-code@pwork00000001',
        },
      },
      setup: setupProfiles,
    },
    'removed-profile': {
      props: {
        notice: {
          from: 'opus',
          to: 'opus',
          fromProvider: 'claude-code@pgone00000001',
          toProvider: 'claude-code@pwork00000001',
        },
      },
      setup: setupProfiles,
    },
  },
});

export default ModelChangeNotice;
