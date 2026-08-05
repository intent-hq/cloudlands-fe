<script lang="ts">
  import { toast } from 'svelte-sonner';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import { toggleProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderStatusMap } from '$store/renderer/slices/agent-availability/agent-availability-selectors';

  import { ACP_PROVIDERS, resolveProviderEnabled } from '$shared/config/provider-config';
  import { store as appStore } from '$store/renderer/store';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const enabledProviders$ = selectEnabledProviders();
  const providerInUseReasons$ = selectProviderInUseReasons();
  const providerStatusMap$ = selectProviderStatusMap();

  // Get providers that can be toggled (those marked as canBeDisabled)
  const additionalProviders = Object.values(ACP_PROVIDERS).filter((p) => p.canBeDisabled);

  // Same in-use guard as ProviderSelector's Disable control: a toggle that
  // would disable an in-use provider is rejected with the pinning reason.
  function handleToggle(providerId: string) {
    const isEnabled = resolveProviderEnabled($enabledProviders$, providerId);
    if (isEnabled) {
      const reason = $providerInUseReasons$[providerId];
      if (reason) {
        toast.error(`Cannot disable ${ACP_PROVIDERS[providerId]?.displayName || providerId}`, {
          description: reason,
        });
        return;
      }
    }
    appStore.dispatch(toggleProvider(providerId));
  }
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
      {@const isEnabled = resolveProviderEnabled($enabledProviders$, provider.id)}
      {@const isAvailable = $providerStatusMap$[provider.id]?.available ?? false}
      <div class="flex items-center justify-between py-2">
        <div>
          <p class="text-sm font-medium text-foreground mb-1">{provider.displayName}</p>
          <p class="text-xs text-subtle">
            Use <code class="px-1 py-0.5 bg-muted rounded text-ui">{provider.command}</code> CLI as
            an agent
          </p>
          {#if isEnabled && !isAvailable}
            <p class="text-xs text-yellow-600 dark:text-yellow-500 flex items-center gap-1 mt-1">
              <Fa icon={faTriangleExclamation} class="w-2.5 h-2.5" />
              Not installed — won't appear in model pickers until available
            </p>
          {/if}
        </div>
        <Toggle
          pressed={isEnabled}
          onclick={() => handleToggle(provider.id)}
          variant="indicator"
          size="xs"
          ariaLabel={`Enable ${provider.displayName}`}
        />
      </div>
    {/each}

    {#if additionalProviders.length === 0}
      <p class="text-sm text-subtle italic">No additional agents available</p>
    {/if}
  </div>
</div>
