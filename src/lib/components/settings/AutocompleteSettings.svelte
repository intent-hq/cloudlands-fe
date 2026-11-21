<script lang="ts">
  /**
   * Settings → Input → Autocomplete: the composer ghost-text suggestions
   * (`[autocomplete]` daemon settings, PROTOCOL §5.12). Hidden when the
   * daemon catalog lacks `autocomplete.enabled` (older daemon).
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
  import { store as appStore } from '$store/renderer/store';
  import AutocompleteSettingsView from '$features/autocomplete/components/AutocompleteSettingsView.svelte';
  import {
    changeAutocompleteEnabled,
    changeAutocompleteModel,
    changeAutocompleteService,
    clearAutocompleteKey,
    initializeAutocompleteSettings,
    saveAutocompleteKey,
  } from '$store/renderer/slices/autocomplete-settings/autocomplete-settings-slice';
  import { selectAutocompleteSettings } from '$store/renderer/slices/autocomplete-settings/autocomplete-settings-selectors';

  const settings$ = selectAutocompleteSettings();

  onMount(() => {
    appStore.dispatch(initializeAutocompleteSettings());
  });
</script>

{#if !$settings$.isLoading && $settings$.available}
  <div id="autocomplete" data-highlight-id="autocomplete" use:highlightTarget class="scroll-mt-20">
    <h2 class="type-title mb-3 text-foreground">{m.settings_section_autocomplete()}</h2>
    <div class="flex flex-col rounded-xl bg-card divide-y divide-border">
      <section data-slot="settings-section-body" class="px-6 py-2">
        <AutocompleteSettingsView
          enabled={$settings$.enabled}
          service={$settings$.service}
          model={$settings$.model}
          keyConfigured={$settings$.keyConfigured}
          busyService={$settings$.busyService}
          error={$settings$.error}
          onEnabledChange={(enabled) => appStore.dispatch(changeAutocompleteEnabled(enabled))}
          onServiceChange={(service) => appStore.dispatch(changeAutocompleteService(service))}
          onModelChange={(model) => appStore.dispatch(changeAutocompleteModel(model))}
          onSaveKey={(service, apiKey, enableAfter) =>
            appStore.dispatch(saveAutocompleteKey(service, apiKey, enableAfter))}
          onClearKey={(service, disableAfter) =>
            appStore.dispatch(clearAutocompleteKey(service, disableAfter))}
        />
      </section>
    </div>
  </div>
{/if}
