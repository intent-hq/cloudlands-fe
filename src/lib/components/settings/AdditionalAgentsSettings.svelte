<script lang="ts">
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectEnabledProviders } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { toggleProvider } from '$lib/store/slices/provider-settings/provider-settings-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { ACP_PROVIDERS } from '$shared/config/provider-config';

  const dispatch = getDispatch();
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
          pressed={$enabledProviders$[provider.id] === true}
          onclick={() => dispatch(toggleProvider(provider.id))}
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
