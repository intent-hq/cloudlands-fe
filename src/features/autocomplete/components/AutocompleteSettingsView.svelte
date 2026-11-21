<script lang="ts">
  /**
   * Settings → Input → Autocomplete rows (approved mock-up): the switch,
   * service and model selects, and the API key row of the chosen service
   * (Voice key-row pattern). Presentational: values come in as props and
   * changes go out through callbacks; the gating rules live in
   * `autocomplete-settings-rules.ts`. Draft key, pending-enable and dialog
   * state are ephemeral component-local UI state.
   */
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import Fa from 'svelte-fa';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import {
    AUTOCOMPLETE_MODELS,
    AUTOCOMPLETE_SERVICES,
    isAutocompleteModel,
    isAutocompleteService,
    type AutocompleteModel,
    type AutocompleteService,
  } from '../autocomplete-settings-constants';
  import {
    decideEnable,
    decideServiceChange,
    shouldDisableOnKeyCancel,
    decideKeyRemove,
    type AutocompleteKeys,
  } from '../utils/autocomplete-settings-rules';
  import AutocompleteKiloConfirmDialog from './AutocompleteKiloConfirmDialog.svelte';

  let {
    enabled,
    service,
    model,
    keyConfigured,
    busyService = null,
    error = null,
    confirmOpen = $bindable(false),
    keyInputFor = $bindable(null),
    onEnabledChange,
    onServiceChange,
    onModelChange,
    onSaveKey,
    onClearKey,
  }: {
    enabled: boolean;
    service: AutocompleteService;
    model: AutocompleteModel;
    keyConfigured: AutocompleteKeys;
    busyService?: AutocompleteService | null;
    error?: string | null;
    /** The Kilo data confirmation is open (bindable for previews). */
    confirmOpen?: boolean;
    /** The key field is open for this service (bindable for previews). */
    keyInputFor?: AutocompleteService | null;
    onEnabledChange: (enabled: boolean) => void;
    onServiceChange: (service: AutocompleteService) => void;
    onModelChange: (model: AutocompleteModel) => void;
    onSaveKey: (service: AutocompleteService, apiKey: string, enableAfter: boolean) => void;
    onClearKey: (service: AutocompleteService, disableAfter: boolean) => void;
  } = $props();

  // Brand and model names are not translated.
  const SERVICE_LABELS: Record<AutocompleteService, string> = {
    kilo: 'Kilo Gateway', // i18n-ignore (brand name)
    openrouter: 'OpenRouter', // i18n-ignore (brand name)
  };
  const SERVICE_SHORT_LABELS: Record<AutocompleteService, string> = {
    kilo: 'Kilo', // i18n-ignore (brand name)
    openrouter: 'OpenRouter', // i18n-ignore (brand name)
  };
  const MODEL_LABELS: Record<AutocompleteModel, string> = {
    'nvidia/nemotron-3.5-lightning': 'Nemotron 3.5 Lightning', // i18n-ignore (model name)
    'particle-ai/particle-1': 'Particle-1', // i18n-ignore (model name)
  };
  const MODEL_DESCRIPTIONS: Record<AutocompleteModel, () => string> = {
    'nvidia/nemotron-3.5-lightning': () => m.settings_autocomplete_model_nemotron_description(),
    'particle-ai/particle-1': () => m.settings_autocomplete_model_particle_description(),
  };
  const KEY_PLACEHOLDERS: Record<AutocompleteService, () => string> = {
    kilo: () => m.settings_autocomplete_apiKey_kilo_placeholder(),
    openrouter: () => 'sk-or-…', // i18n-ignore (API key format)
  };

  /** OpenRouter was switched on without a key: the switch shows on until the key field settles. */
  let pendingEnable = $state(false);
  let apiKeyDraft = $state('');

  const switchedOn = $derived(enabled || pendingEnable);
  const hasKey = $derived(keyConfigured[service]);
  const keyBusy = $derived(busyService === service);

  function openKeyInput(target: AutocompleteService) {
    apiKeyDraft = '';
    keyInputFor = target;
  }

  function handleToggle(next: boolean) {
    if (!next) {
      pendingEnable = false;
      keyInputFor = null;
      onEnabledChange(false);
      return;
    }
    const decision = decideEnable(service, keyConfigured);
    if (decision === 'enable') onEnabledChange(true);
    else if (decision === 'confirm-kilo') confirmOpen = true;
    else {
      pendingEnable = true;
      openKeyInput(service);
    }
  }

  function handleServiceChange(value: string) {
    if (!isAutocompleteService(value) || value === service) return;
    const wasPending = pendingEnable;
    pendingEnable = false;
    keyInputFor = null;
    if (wasPending) {
      onServiceChange(value);
      // Nothing was persisted yet: re-run the switch gate for the new service.
      if (decideEnable(value, keyConfigured) === 'enable') onEnabledChange(true);
      else if (value === 'kilo') confirmOpen = true;
      return;
    }
    const decision = decideServiceChange(enabled, value, keyConfigured);
    onServiceChange(value);
    if (decision.confirmKilo) confirmOpen = true;
    if (decision.askKey) {
      // The switch to a keyless OpenRouter turns autocomplete off; saving the key turns it back on.
      pendingEnable = enabled;
      openKeyInput(value);
    }
  }

  function handleModelChange(value: string) {
    if (isAutocompleteModel(value)) onModelChange(value);
  }

  function handleConfirm() {
    confirmOpen = false;
    onEnabledChange(true);
  }

  function handleConfirmCancel() {
    confirmOpen = false;
  }

  function handleSubmitKey() {
    const key = apiKeyDraft.trim();
    if (!key || !keyInputFor) return;
    onSaveKey(keyInputFor, key, pendingEnable && !enabled);
    pendingEnable = false;
    keyInputFor = null;
    apiKeyDraft = '';
  }

  function handleCancelKey() {
    keyInputFor = null;
    apiKeyDraft = '';
    if (!shouldDisableOnKeyCancel(service, keyConfigured)) return;
    if (pendingEnable) pendingEnable = false;
    else if (enabled) onEnabledChange(false);
  }

  function handleRemoveKey() {
    const decision = decideKeyRemove(enabled, service);
    onClearKey(service, decision.disable);
    if (decision.confirmKilo) confirmOpen = true;
  }

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'autocomplete',
          title: m.settings_section_autocomplete(),
          entries: [
            {
              kind: 'switch',
              id: 'autocomplete-enabled',
              label: m.settings_autocomplete_enabled_label(),
              description: m.settings_autocomplete_enabled_description(),
              info: m.settings_autocomplete_enabled_info(),
              get: () => switchedOn,
              set: handleToggle,
              error: () => error ?? undefined,
            },
            {
              kind: 'select',
              id: 'autocomplete-service',
              label: m.settings_autocomplete_service_label(),
              description:
                service === 'kilo'
                  ? m.settings_autocomplete_service_kilo_description()
                  : m.settings_autocomplete_service_openrouter_description(),
              info:
                service === 'openrouter'
                  ? m.settings_autocomplete_service_openrouter_info()
                  : undefined,
              options: AUTOCOMPLETE_SERVICES.map((value) => ({
                value,
                label: SERVICE_LABELS[value],
              })),
              get: () => service,
              set: handleServiceChange,
            },
            {
              kind: 'select',
              id: 'autocomplete-model',
              label: m.settings_autocomplete_model_label(),
              description: MODEL_DESCRIPTIONS[model](),
              info: m.settings_autocomplete_model_info(),
              options: AUTOCOMPLETE_MODELS.map((value) => ({ value, label: MODEL_LABELS[value] })),
              get: () => model,
              set: handleModelChange,
            },
            {
              kind: 'custom',
              id: 'autocomplete-api-key',
              label: m.settings_autocomplete_apiKey_label({
                service: SERVICE_SHORT_LABELS[service],
              }),
              busy: () => keyBusy,
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet keyDescription()}
  {#if hasKey}
    <span class="inline-flex items-center gap-1">
      <Fa icon={faCheck} class="h-2.5 w-2.5 text-success" />
      {m.settings_autocomplete_apiKey_saved()}
    </span>
  {:else}
    {service === 'kilo'
      ? m.settings_autocomplete_apiKey_kilo_description()
      : m.settings_autocomplete_apiKey_openrouter_description()}
  {/if}
  {#if keyInputFor === service && !keyBusy}
    <span class="mt-2 flex items-center gap-2" data-testid="autocomplete-key-input">
      <Input
        type="password"
        bind:value={apiKeyDraft}
        placeholder={KEY_PLACEHOLDERS[service]()}
        class="type-body h-7 flex-1"
        aria-label={m.settings_autocomplete_apiKey_label({
          service: SERVICE_SHORT_LABELS[service],
        })}
        autofocus
        onkeydown={(event) => {
          if (event.key === 'Enter') handleSubmitKey();
          if (event.key === 'Escape') handleCancelKey();
        }}
      />
      <Button
        type="button"
        class="type-body cursor-pointer font-medium text-primary-ink transition-colors hover:text-primary-ink/80"
        onclick={handleSubmitKey}
        disabled={!apiKeyDraft.trim()}
      >
        {m.settings_autocomplete_save()}
      </Button>
      <Button
        type="button"
        class="type-body cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        onclick={handleCancelKey}
      >
        {m.settings_autocomplete_cancel()}
      </Button>
    </span>
    <span class="mt-1 block text-subtle">{m.settings_autocomplete_apiKey_storageNote()}</span>
  {/if}
{/snippet}

{#snippet keyActions(_context: SettingsControlContext)}
  <div class="type-caption flex shrink-0 items-center gap-2">
    {#if keyBusy}
      <span class="text-subtle">{m.settings_autocomplete_saving()}</span>
    {:else if keyInputFor === service}
      <!-- The key field below owns Save / Cancel. -->
    {:else if hasKey}
      <Button
        variant="ghost"
        type="button"
        class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => openKeyInput(service)}
      >
        {m.settings_autocomplete_replaceKey()}
      </Button>
      <span class="text-ghost">·</span>
      <Button
        variant="ghost"
        type="button"
        class="cursor-pointer text-muted-foreground transition-colors hover:text-danger"
        onclick={handleRemoveKey}
      >
        {m.settings_autocomplete_removeKey()}
      </Button>
    {:else}
      <Button
        variant="ghost"
        type="button"
        class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
        onclick={() => openKeyInput(service)}
      >
        {m.settings_autocomplete_addKey()}
      </Button>
    {/if}
  </div>
{/snippet}

<div data-autocomplete-settings class="w-full min-w-0">
  <SettingsForm
    {schema}
    embedded
    compact={false}
    custom={defineSettingsCustomControls({ 'autocomplete-api-key': keyActions })}
    descriptions={{ 'autocomplete-api-key': keyDescription }}
  />
</div>

<AutocompleteKiloConfirmDialog
  open={confirmOpen}
  onConfirm={handleConfirm}
  onCancel={handleConfirmCancel}
/>
