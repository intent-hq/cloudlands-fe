<script module lang="ts">
  import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';

  const catalog = {
    providers: MOCK_PROVIDER_CATALOG.providers.filter(
      (provider) => provider.id === 'auggie' || provider.id === 'antigravity',
    ),
  };
</script>

<script lang="ts">
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import { store as appStore } from '$store/renderer/store';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { checkSingleProviderSuccess } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import {
    loadEnabledProvidersFromStorage,
    providerPathsLoaded,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderPathsRevision } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import ProviderSelector from '../../ProviderSelector.svelte';

  // CT exercises focus handoff with seeded provider/path data and no running sagas.
  // The read saga's wire behavior has its own provider-settings-read-saga tests.
  appStore.dispatch(
    providerPathsLoaded(selectProviderPathsRevision.select(appStore.state), {
      configured: {},
      resolved: { auggie: '/fixture/bin/auggie' },
      secondary: {},
      npxPackages: {},
    }),
  );
  appStore.dispatch(providerCatalogLoaded(catalog));
  appStore.dispatch(loadEnabledProvidersFromStorage({ auggie: true }));
  appStore.dispatch(hydrateDefaultProvider('auggie'));
  appStore.dispatch(checkSingleProviderSuccess('auggie', { available: true, authenticated: true }));
  appStore.dispatch(checkSingleProviderSuccess('antigravity', { available: false }));

  let outsideClicks = $state(0);
</script>

<div class="flex items-start gap-16 bg-background p-6 text-foreground">
  <div class="w-full max-w-md">
    <ProviderSelector />
  </div>
  <div class="shrink-0">
    <Button onclick={() => outsideClicks++}>Outside action</Button>
    <output data-testid="outside-clicks">{outsideClicks}</output>
  </div>
</div>
