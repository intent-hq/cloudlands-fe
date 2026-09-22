<script module lang="ts">
  import { MOCK_PROVIDER_CATALOG } from '../../../../../test/fixtures/provider-catalog.fixture';

  const catalog = {
    providers: MOCK_PROVIDER_CATALOG.providers.filter((provider) => provider.id === 'auggie'),
  };
</script>

<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { checkSingleProviderSuccess } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import {
    loadEnabledProvidersFromStorage,
    setActiveProvider,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import ProviderSelector from '../../ProviderSelector.svelte';

  // CT initializes an isolated renderer store without persistence/probe sagas.
  // Keep production provider/menu/form components; seed only their data inputs.
  appStore.dispatch(providerCatalogLoaded(catalog));
  appStore.dispatch(loadEnabledProvidersFromStorage({ auggie: true }));
  appStore.dispatch(setActiveProvider('auggie'));
  appStore.dispatch(checkSingleProviderSuccess('auggie', { available: true, authenticated: true }));

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
