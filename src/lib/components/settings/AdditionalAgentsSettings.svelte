<script lang="ts">
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { toggleProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';

  import { ACP_PROVIDERS, resolveProviderEnabled } from '$shared/config/provider-config';
  import { store as appStore } from '$store/renderer/store';

  const enabledProviders$ = selectEnabledProviders();

  // Get providers that can be toggled (those marked as canBeDisabled)
  const additionalProviders = Object.values(ACP_PROVIDERS).filter((p) => p.canBeDisabled);
</script>

<div class="space-y-4">
  <div>
    <p class="text-sm font-medium text-foreground mb-1">Additional Agents</p>
    <p class="text-xs text-subtle">
      Enable additional ACP-compatible agents. When enabled, their models will appear in the model
      picker grouped by agent.
    </p>
  </div>

  <div class="space-y-3">
    {#each additionalProviders as provider (provider.id)}
      <div class="flex items-center justify-between py-2">
        <div>
          <p class="text-sm font-medium text-foreground mb-1">{provider.displayName}</p>
          <p class="text-xs text-subtle">
            Use <code class="px-1 py-0.5 bg-muted rounded text-ui">{provider.command}</code> CLI as
            an agent
          </p>
        </div>
        <Toggle
          pressed={resolveProviderEnabled($enabledProviders$, provider.id)}
          onclick={() => appStore.dispatch(toggleProvider(provider.id))}
          variant="indicator"
          size="xs"
        />
      </div>
    {/each}

    {#if additionalProviders.length === 0}
      <p class="text-sm text-subtle italic">No additional agents available</p>
    {/if}
  </div>
</div>
