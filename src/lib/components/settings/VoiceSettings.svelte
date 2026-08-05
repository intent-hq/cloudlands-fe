<script lang="ts">
  import { onMount } from 'svelte';
  import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { faApple } from '@fortawesome/free-brands-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Select } from '$lib/components/ui/select';
  import Input from '$lib/components/ui/input/input.svelte';
  import ElevenLabsIcon from '$lib/components/icons/ElevenLabsIcon.svelte';
  import OpenAIIcon from '$lib/components/icons/OpenAIIcon.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    addVoiceVocabularyTerm,
    changeVoiceEngine,
    changeVoiceInputDevice,
    changeVoiceOpenAiModel,
    changeVoiceProvider,
    clearVoiceKey,
    initializeVoiceSettings,
    removeVoiceVocabularyTerm,
    saveVoiceKey,
    setVoiceSettingsError,
  } from '$store/renderer/slices/voice-settings/voice-settings-slice';
  import {
    selectVoiceBusyProvider,
    selectVoiceEngine,
    selectVoiceInputDeviceId,
    selectVoiceInputDevices,
    selectVoiceKeyConfigured,
    selectVoiceOpenAiModel,
    selectVoiceOsEngineAvailable,
    selectVoiceProvider,
    selectVoiceSettingsAvailable,
    selectVoiceSettingsError,
    selectVoiceSettingsIsLoading,
    selectVoiceVocabulary,
  } from '$store/renderer/slices/voice-settings/voice-settings-selectors';
  import type { VoiceInputDevice } from '$store/renderer/slices/voice-settings/voice-settings-types';
  import {
    VOICE_OPENAI_MODELS,
    VOICE_PROVIDERS,
    VOICE_VOCABULARY_TERM_MAX_LENGTH,
    type VoiceOpenAiModel,
    type VoiceProvider,
  } from '$features/voice/voice-settings-service';
  import { isMacPlatform } from '$lib/utils/shortcuts';

  // Provider display names are brand names — not translated.
  const PROVIDER_LABELS: Record<VoiceProvider, string> = {
    elevenlabs: 'ElevenLabs',
    openai: 'OpenAI',
  };
  // i18n-ignore (API key formats)
  const KEY_PLACEHOLDERS: Record<VoiceProvider, string> = {
    elevenlabs: 'sk_...',
    openai: 'sk-...',
  };
  // Per-provider row descriptions (getters so strings re-evaluate on locale change).
  const PROVIDER_DESCRIPTIONS: Record<VoiceProvider, () => string> = {
    elevenlabs: () => m.settings_voice_elevenlabs_description(),
    openai: () => m.settings_voice_openai_description(),
  };

  // The OS dictation row only exists on macOS (the speech helper is mac-only).
  const showOsRow = isMacPlatform();

  const isLoading$ = selectVoiceSettingsIsLoading();
  const available$ = selectVoiceSettingsAvailable();
  const engine$ = selectVoiceEngine();
  const osEngineAvailable$ = selectVoiceOsEngineAvailable();
  const provider$ = selectVoiceProvider();
  const keyConfigured$ = selectVoiceKeyConfigured();
  const openaiModel$ = selectVoiceOpenAiModel();
  const busyProvider$ = selectVoiceBusyProvider();
  const error$ = selectVoiceSettingsError();
  const vocabulary$ = selectVoiceVocabulary();
  const inputDeviceId$ = selectVoiceInputDeviceId();
  const inputDevices$ = selectVoiceInputDevices();

  // Permission-less contexts return devices with empty labels (Web API behavior).
  function inputDeviceLabel(device: VoiceInputDevice, index: number): string {
    return device.label !== ''
      ? device.label
      : m.settings_voice_inputDevice_unnamed({ number: index + 1 });
  }

  // Trigger text: selected device label, or "System default" when unset/gone.
  const selectedInputDevice = $derived(
    $inputDevices$.find((device) => device.deviceId === $inputDeviceId$),
  );

  // Paste-key flow (mirrors LinearAuthConnection): one provider's input open
  // at a time. Draft state is ephemeral component-local UI state.
  let keyInputFor = $state<VoiceProvider | null>(null);
  let apiKeyDraft = $state('');

  // Vocabulary editor drafts — ephemeral component-local UI state.
  let vocabularyDraft = $state('');
  let vocabularyDraftError = $state<string | null>(null);

  onMount(() => {
    appStore.dispatch(initializeVoiceSettings());
  });

  function handleSetProviderDefault(target: VoiceProvider) {
    // Provider first (daemon write, rolls back on failure), engine flip after —
    // so a failed provider write never leaves the engine flipped to `daemon`
    // with the old provider. Each flow no-ops when unchanged.
    appStore.dispatch(changeVoiceProvider(target));
    appStore.dispatch(changeVoiceEngine('daemon'));
  }

  function handleSetOsDefault() {
    // The flow guards availability and fires the enable-time TCC prompt.
    appStore.dispatch(changeVoiceEngine('os'));
  }

  function handleModelChange(next: string) {
    appStore.dispatch(changeVoiceOpenAiModel(next as VoiceOpenAiModel));
  }

  function handleShowKeyInput(target: VoiceProvider) {
    apiKeyDraft = '';
    keyInputFor = target;
    appStore.dispatch(setVoiceSettingsError(null));
  }

  function handleCancelKeyInput() {
    keyInputFor = null;
    apiKeyDraft = '';
  }

  function handleSubmitApiKey(target: VoiceProvider) {
    const key = apiKeyDraft.trim();
    if (!key) return;
    appStore.dispatch(saveVoiceKey(target, key));
    keyInputFor = null;
    apiKeyDraft = '';
  }

  function handleClearApiKey(target: VoiceProvider) {
    appStore.dispatch(clearVoiceKey(target));
  }

  function handleAddVocabularyTerm() {
    const term = vocabularyDraft.trim();
    if (!term) return;
    if (term.length > VOICE_VOCABULARY_TERM_MAX_LENGTH) {
      vocabularyDraftError = m.settings_voice_vocabulary_tooLong_error();
      return;
    }
    vocabularyDraftError = null;
    // Duplicate (case-insensitive) adds are ignored — the term is already listed.
    const current = selectVoiceVocabulary.select(appStore.state) ?? [];
    if (current.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
      vocabularyDraft = '';
      return;
    }
    appStore.dispatch(addVoiceVocabularyTerm(term));
    vocabularyDraft = '';
  }

  function handleRemoveVocabularyTerm(term: string) {
    appStore.dispatch(removeVoiceVocabularyTerm(term));
  }

  function handleInputDeviceChange(next: string) {
    // Empty string is the "System default" sentinel (Select values are strings).
    appStore.dispatch(changeVoiceInputDevice(next === '' ? null : next));
  }
</script>

<div class="space-y-4">
  {#if $error$}
    <p class="text-xs text-destructive-foreground">{$error$}</p>
  {/if}

  {#if $isLoading$}
    <div class="space-y-2">
      <div class="h-4 w-48 bg-muted/50 rounded animate-pulse"></div>
      <div class="h-4 w-48 bg-muted/50 rounded animate-pulse"></div>
    </div>
  {:else if !$available$}
    <p class="text-xs text-subtle">{m.settings_voice_unavailable()}</p>
  {:else}
    <div class="space-y-6">
      {#each VOICE_PROVIDERS as target (target)}
        {@const isDefault = $engine$ === 'daemon' && $provider$ === target}
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                {#if target === 'elevenlabs'}
                  <ElevenLabsIcon size={14} class="text-ghost" />
                {:else}
                  <OpenAIIcon size={14} class="text-ghost" />
                {/if}
                <span class="text-sm text-foreground">{PROVIDER_LABELS[target]}</span>
                {#if isDefault}
                  <span class="text-xs text-subtle flex items-center gap-1">
                    <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
                    {m.settings_voice_default_label()}
                  </span>
                {/if}
              </div>
              <p class="text-xs text-subtle pl-6">{PROVIDER_DESCRIPTIONS[target]()}</p>
            </div>
            <div class="flex items-center gap-2 text-xs shrink-0">
              {#if $busyProvider$ === target}
                <span class="text-subtle">{m.settings_voice_saving()}</span>
              {:else}
                {#if !isDefault && $keyConfigured$[target]}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    onclick={() => handleSetProviderDefault(target)}
                  >
                    {m.settings_voice_setDefault()}
                  </button>
                  <span class="text-ghost">·</span>
                {/if}
                {#if $keyConfigured$[target]}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    onclick={() => handleShowKeyInput(target)}
                  >
                    {m.settings_voice_replaceKey()}
                  </button>
                  <span class="text-ghost">·</span>
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
                    onclick={() => handleClearApiKey(target)}
                  >
                    {m.settings_voice_clearKey()}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                    onclick={() => handleShowKeyInput(target)}
                  >
                    {m.settings_voice_setKey()}
                  </button>
                {/if}
              {/if}
            </div>
          </div>

          {#if keyInputFor === target && $busyProvider$ !== target}
            <div class="pl-6 space-y-2">
              <div class="flex items-center gap-2">
                <Input
                  type="password"
                  bind:value={apiKeyDraft}
                  placeholder={KEY_PLACEHOLDERS[target]}
                  class="h-7 text-xs flex-1"
                  aria-label={m.settings_voice_apiKey_ariaLabel({
                    provider: PROVIDER_LABELS[target],
                  })}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSubmitApiKey(target);
                    if (e.key === 'Escape') handleCancelKeyInput();
                  }}
                />
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium text-xs"
                  onclick={() => handleSubmitApiKey(target)}
                  disabled={!apiKeyDraft.trim()}
                >
                  {m.settings_voice_save()}
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-xs"
                  onclick={handleCancelKeyInput}
                >
                  {m.settings_voice_cancel()}
                </button>
              </div>
              <p class="text-xs text-subtle">
                {m.settings_voice_apiKeyStorageNote()}
              </p>
            </div>
          {/if}

          {#if target === 'openai' && $keyConfigured$.openai && $openaiModel$ !== null}
            <div class="pl-6 flex items-center gap-3">
              <span class="text-xs text-subtle shrink-0">{m.settings_voice_model_label()}</span>
              <Select.Root value={$openaiModel$} onchange={(v) => handleModelChange(v)}>
                <Select.Trigger
                  class="h-7 text-xs w-[200px]"
                  aria-label={m.settings_voice_model_ariaLabel()}
                >
                  {$openaiModel$}
                </Select.Trigger>
                <Select.Content>
                  {#each VOICE_OPENAI_MODELS as model (model)}
                    <Select.Item value={model}>
                      <!-- i18n-ignore (model identifiers) -->
                      <span class="text-xs">{model}</span>
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
          {/if}
        </div>
      {/each}

      {#if showOsRow}
        {@const isOsDefault = $engine$ === 'os'}
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Fa icon={faApple} class="w-3.5 h-3.5 text-ghost" />
              <span class="text-sm text-foreground">{m.settings_voice_osEngine_label()}</span>
              {#if isOsDefault}
                <span class="text-xs text-subtle flex items-center gap-1">
                  <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
                  {m.settings_voice_default_label()}
                </span>
              {/if}
            </div>
            <p class="text-xs text-subtle pl-6">{m.settings_voice_osEngine_description()}</p>
            {#if isOsDefault}
              <p class="text-xs text-subtle pl-6">{m.settings_voice_osEngine_permissionNote()}</p>
            {/if}
            {#if !$osEngineAvailable$}
              <p class="text-xs text-destructive-foreground pl-6">
                {m.settings_voice_osEngine_helperMissing_description()}
              </p>
            {/if}
          </div>
          <div class="flex items-center gap-2 text-xs shrink-0">
            {#if !isOsDefault}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onclick={handleSetOsDefault}
                disabled={!$osEngineAvailable$}
              >
                {m.settings_voice_setDefault()}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="space-y-2 pt-1">
        <span class="text-xs text-foreground">{m.settings_voice_inputDevice_label()}</span>
        <Select.Root value={$inputDeviceId$ ?? ''} onchange={handleInputDeviceChange}>
          <Select.Trigger
            class="h-7 text-xs w-[280px]"
            aria-label={m.settings_voice_inputDevice_ariaLabel()}
          >
            {selectedInputDevice
              ? inputDeviceLabel(selectedInputDevice, $inputDevices$.indexOf(selectedInputDevice))
              : m.settings_voice_inputDevice_default()}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="">
              <span class="text-xs">{m.settings_voice_inputDevice_default()}</span>
            </Select.Item>
            {#each $inputDevices$ as device, index (device.deviceId)}
              <Select.Item value={device.deviceId}>
                <span class="text-xs">{inputDeviceLabel(device, index)}</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if $vocabulary$ !== null}
        <div class="space-y-2 pt-1">
          <div class="space-y-1">
            <span class="text-xs text-foreground">{m.settings_voice_vocabulary_label()}</span>
            <p class="text-xs text-subtle">{m.settings_voice_vocabulary_description()}</p>
          </div>
          <div class="flex items-center gap-2">
            <Input
              bind:value={vocabularyDraft}
              placeholder={m.settings_voice_vocabulary_placeholder()}
              class="h-7 text-xs flex-1"
              aria-label={m.settings_voice_vocabulary_input_ariaLabel()}
              oninput={() => (vocabularyDraftError = null)}
              onkeydown={(e) => {
                if (e.key === 'Enter') handleAddVocabularyTerm();
              }}
            />
            <button
              type="button"
              class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium text-xs"
              onclick={handleAddVocabularyTerm}
              disabled={!vocabularyDraft.trim()}
            >
              {m.settings_voice_vocabulary_add()}
            </button>
          </div>
          {#if vocabularyDraftError}
            <p class="text-xs text-destructive-foreground">{vocabularyDraftError}</p>
          {/if}
          {#if $vocabulary$.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each $vocabulary$ as term (term)}
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-xs text-foreground"
                >
                  {term}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
                    aria-label={m.settings_voice_vocabulary_remove_ariaLabel({ term })}
                    onclick={() => handleRemoveVocabularyTerm(term)}
                  >
                    <Fa icon={faXmark} class="w-2.5 h-2.5" />
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
