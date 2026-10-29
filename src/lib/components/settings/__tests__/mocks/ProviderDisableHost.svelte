<script lang="ts">
  import { onMount } from 'svelte';
  import { setupProviderDisablePreview } from '../../provider-selector.preview';
  import ProviderSelector from '../../ProviderSelector.svelte';
  import AgentGrid from '$features/onboarding/messages/AgentGrid.svelte';
  import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

  let {
    status = 'signed-out',
    auggieEnabled = true,
    onboarding = false,
  }: {
    status?: 'signed-out' | 'pending' | 'unavailable';
    auggieEnabled?: boolean;
    onboarding?: boolean;
  } = $props();
  let ready = $state(false);
  const enabled = selectEnabledProviders();
  onMount(() => {
    // Fixture setup seeds Redux synchronously; it does not fetch domain data.
    // eslint-disable-next-line intent/no-component-async-data-fetch
    const restore = setupProviderDisablePreview(status, auggieEnabled);
    ready = true;
    return restore;
  });
</script>

<div class="bg-background p-6 text-foreground">
  {#if ready}
    {#if onboarding}<AgentGrid />{:else}<ProviderSelector />{/if}
  {/if}
  <output hidden data-testid="enabled">{JSON.stringify($enabled)}</output>
</div>
