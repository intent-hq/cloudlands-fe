<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { selectEnabledProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import { toggleProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';

  import { selectIsProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
  selectProviderCatalogEntries,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { store as appStore } from '$store/renderer/store';

  const enabledProviders$ = selectEnabledProviders();
  const providerInUseReasons$ = selectProviderInUseReasons();
  const catalogEntries$ = selectProviderCatalogEntries();

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
      <div class="flex items-center justify-between py-2">
        <div>
          <p class="text-sm font-medium text-foreground mb-1">{provider.displayName}</p>
          <p class="text-xs text-subtle">
            {m.settings_additionalAgents_cliDescription_before()}
            <code class="px-1 py-0.5 bg-muted rounded text-ui">{provider.command}</code>
            {m.settings_additionalAgents_cliDescription_after()}
          </p>
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
