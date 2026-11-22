<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type {
    AutocompleteModel,
    AutocompleteService,
  } from '$features/autocomplete/autocomplete-settings-constants';

  interface Props {
    enabled?: boolean;
    service?: AutocompleteService;
    model?: AutocompleteModel;
    keyConfigured?: Record<AutocompleteService, boolean>;
    keyInputFor?: AutocompleteService | null;
    /** Show the Kilo data confirmation in place. */
    confirm?: boolean;
  }

  const noKeys = { kilo: false, openrouter: false };

  export const preview = definePreview<Props>({
    id: 'autocomplete-settings',
    title: 'Autocomplete settings',
    defaultState: 'off',
    states: {
      off: { props: { enabled: false, service: 'kilo', keyConfigured: noKeys } },
      'on-kilo': { props: { enabled: true, service: 'kilo', keyConfigured: noKeys } },
      'on-kilo-key-field': {
        props: { enabled: true, service: 'kilo', keyConfigured: noKeys, keyInputFor: 'kilo' },
      },
      'on-openrouter-with-key': {
        props: {
          enabled: true,
          service: 'openrouter',
          model: 'particle-ai/particle-1',
          keyConfigured: { kilo: false, openrouter: true },
        },
      },
      'kilo-confirm': {
        props: { enabled: false, service: 'kilo', keyConfigured: noKeys, confirm: true },
      },
    },
  });
</script>

<script lang="ts">
  import AutocompleteSettingsView from '$features/autocomplete/components/AutocompleteSettingsView.svelte';
  import AutocompleteKiloConfirmDialog from '$features/autocomplete/components/AutocompleteKiloConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    enabled: initialEnabled = false,
    service: initialService = 'kilo',
    model: initialModel = 'nvidia/nemotron-3.5-lightning',
    keyConfigured: initialKeys = noKeys,
    keyInputFor: initialKeyInputFor = null,
    confirm = false,
  }: Props = $props();

  // Local stand-in for the Redux slice so the preview stays interactive.
  let enabled = $state(initialEnabled);
  let service = $state(initialService);
  let model = $state(initialModel);
  let keys = $state({ ...initialKeys });
  let keyInputFor = $state(initialKeyInputFor);
  let confirmOpen = $state(false);
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  <h2 class="type-title mb-3 text-foreground">{m.settings_section_autocomplete()}</h2>
  <div class="flex flex-col rounded-xl bg-card divide-y divide-border">
    <section data-slot="settings-section-body" class="px-6 py-2">
      <AutocompleteSettingsView
        {enabled}
        {service}
        {model}
        keyConfigured={keys}
        bind:keyInputFor
        bind:confirmOpen
        onEnabledChange={(next) => (enabled = next)}
        onServiceChange={(next) => (service = next)}
        onModelChange={(next) => (model = next)}
        onSaveKey={(target, _key, enableAfter) => {
          keys = { ...keys, [target]: true };
          if (enableAfter) enabled = true;
        }}
        onClearKey={(target, disableAfter) => {
          keys = { ...keys, [target]: false };
          if (disableAfter) enabled = false;
        }}
      />
    </section>
  </div>
  {#if confirm}
    <div class="mt-6">
      <AutocompleteKiloConfirmDialog open static onConfirm={() => {}} onCancel={() => {}} />
    </div>
  {/if}
</div>
