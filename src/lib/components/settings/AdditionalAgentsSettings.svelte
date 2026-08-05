<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import { toggleProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderStatusMap } from '$store/renderer/slices/agent-availability/agent-availability-selectors';

  import { selectIsProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
  selectProviderCatalogEntries,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const enabledProviders$ = selectEnabledProviders();
  const providerInUseReasons$ = selectProviderInUseReasons();
  const catalogEntries$ = selectProviderCatalogEntries();
  const providerStatusMap$ = selectProviderStatusMap();

  // Get providers that can be toggled (those marked as canBeDisabled)
  const additionalProviders = $derived($catalogEntries$.filter((p) => p.canBeDisabled));

  // Reactive enabled check (re-runs when the persisted map changes).
  function isEnabled(providerId: string): boolean {
    void $enabledProviders$;
    return selectIsProviderEnabled.select(appStore.state, providerId);
  }

  // Same in-use guard as ProviderSelector's Disable control: a toggle that
  // would disable an in-use provider is rejected with the pinning reason.
  function handleToggle(providerId: string) {
    if (isEnabled(providerId)) {
      const reason = $providerInUseReasons$[providerId];
      if (reason) {
        toast.error(
          m.settings_additionalAgents_cannotDisable({
            name: selectProviderDisplayName.select(appStore.state, providerId),
          }),
          { description: reason },
        );
        return;
      }
    }
    appStore.dispatch(toggleProvider(providerId));
  }
</script>

<div class="space-y-4">
  <div>
    <p class="text-sm font-medium text-foreground mb-1">{m.settings_additionalAgents_title()}</p>
    <p class="text-xs text-subtle">
      {m.settings_additionalAgents_description()}
    </p>
  </div>

  <div class="space-y-3">
    {#each additionalProviders as provider (provider.id)}
      {@const isAvailable = $providerStatusMap$[provider.id]?.available ?? false}
      <div class="flex items-center justify-between py-2">
        <div>
          <p class="text-sm font-medium text-foreground mb-1">{provider.displayName}</p>
          <p class="text-xs text-subtle">
            {m.settings_additionalAgents_cliDescription_before()}
            <code class="px-1 py-0.5 bg-muted rounded text-ui">{provider.command}</code>
            {m.settings_additionalAgents_cliDescription_after()}
          </p>
          {#if isEnabled(provider.id) && !isAvailable}
            <p class="text-xs text-yellow-600 dark:text-yellow-500 flex items-center gap-1 mt-1">
              <Fa icon={faTriangleExclamation} class="w-2.5 h-2.5" />
              {m.settings_additionalAgents_notInstalled_label()}
            </p>
          {/if}
        </div>
        <Toggle
          pressed={isEnabled(provider.id)}
          onclick={() => handleToggle(provider.id)}
          variant="indicator"
          size="xs"
          ariaLabel={m.settings_additionalAgents_enableToggleAriaLabel({
            name: provider.displayName,
          })}
        />
      </div>
    {/each}

    {#if additionalProviders.length === 0}
      <p class="text-sm text-subtle italic">{m.settings_additionalAgents_empty()}</p>
    {/if}
  </div>
</div>
