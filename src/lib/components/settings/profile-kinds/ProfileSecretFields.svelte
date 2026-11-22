<script lang="ts">
  /**
   * Body of the secret-based screens: API key (add + edit; Claude's has the
   * optional Custom endpoint) and Token (add + edit), for every provider with
   * profile kinds; the steps and links come from `profile-kind-copy`. Onboarding reuses it without the last "paste it" step. A saved
   * key or token is never shown: edit reads "Saved ••••" with Replace.
   * Presentational only; the dialog owns validation and the key check.
   */
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { FormField } from '$lib/components/patterns/form';
  import { Button, CopyButton, Input } from '$lib/components/patterns/settings/custom-controls';
  import type { BaseUrlAction, ProfileKindProvider } from './profile-kind-mock';
  import {
    pasteStepLabel as pasteStepText,
    secretGuide,
    secretKindLabel,
  } from './profile-kind-copy';

  interface Props {
    provider: ProfileKindProvider;
    kind: 'apiKey' | 'token';
    mode: 'add' | 'edit';
    secret?: string;
    /** Edit: the profile has a saved key/token (shown as Saved ••••). */
    secretSaved?: boolean;
    /** Edit: the user chose Replace, so the field is shown. */
    replacing?: boolean;
    secretError?: string;
    baseUrl?: string;
    /** Edit: the profile has a saved ANTHROPIC_BASE_URL (masked on read). */
    baseUrlSaved?: boolean;
    baseUrlAction?: BaseUrlAction;
    customEndpointOpen?: boolean;
    disabled?: boolean;
    /** The secret field stays editable after "Key was rejected". */
    secretDisabled?: boolean;
    /**
     * The backend checks the key with a test prompt after Create. An
     * orchestrator runs no provider, so it only checks the key's format.
     */
    keyCheck?: boolean;
    /** Show the last "Paste it below and choose Create" step (off in onboarding). */
    pasteStep?: boolean;
    /** Offer Claude's Custom endpoint (off in onboarding). */
    customEndpoint?: boolean;
  }

  let {
    provider,
    kind,
    mode,
    secret = $bindable(''),
    secretSaved = false,
    replacing = $bindable(false),
    secretError,
    baseUrl = $bindable(''),
    baseUrlSaved = false,
    baseUrlAction = $bindable('keep'),
    customEndpointOpen = $bindable(false),
    disabled = false,
    secretDisabled = disabled,
    keyCheck = true,
    pasteStep = true,
    customEndpoint = true,
  }: Props = $props();

  const BASE_URL_PLACEHOLDER = 'https://'; // i18n-ignore (URL prefix)

  const claudeApiKey = $derived(provider === 'claude' && kind === 'apiKey');
  const guide = $derived(secretGuide(provider, kind));
  const pasteStepLabel = $derived(pasteStepText(kind, keyCheck));
  const showSecretField = $derived(mode === 'add' || !secretSaved || replacing);
  const fieldLabel = $derived(secretKindLabel(provider, kind));

  function cancelReplace() {
    replacing = false;
    secret = '';
  }
</script>

<div class="space-y-5" data-testid="provider-profile-secret" data-kind={kind}>
  {#if guide.eligibility}
    <p class="type-body text-muted-foreground" data-testid="provider-profile-token-eligibility">
      {guide.eligibility}
    </p>
  {/if}

  {#if mode === 'add' || replacing}
    <section class="space-y-2" data-testid="provider-profile-secret-steps">
      <h3 class="type-body font-medium! text-foreground">
        {kind === 'apiKey'
          ? m.settings_providerProfileKinds_apiKeyClaudeSteps_label()
          : m.settings_providerProfileKinds_tokenSteps_label()}
      </h3>
      <!-- Fixed instruction copy per provider and kind, not a data collection. -->
      <ol class="type-body list-decimal space-y-1 pl-5 text-muted-foreground">
        <!-- At most two fixed steps, so no collection rendering. -->
        <li>
          {guide.steps[0]}
          {#if guide.command}
            <span class="mt-1 flex items-center gap-2" data-testid="provider-profile-setup-token">
              <code
                class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono type-caption text-foreground"
                >{guide.command}</code
              >
              <CopyButton text={guide.command} size="sm" />
            </span>
          {/if}
        </li>
        {#if guide.steps[1]}
          <li>{guide.steps[1]}</li>
        {/if}
        {#if pasteStep}
          <li>{pasteStepLabel}</li>
        {/if}
      </ol>
      {#if guide.link}
        <Button
          variant="link"
          size="sm"
          href={guide.link.href}
          target="_blank"
          rel="noopener noreferrer"
          class="h-auto px-0">{guide.link.label}</Button
        >
      {/if}
    </section>
  {/if}

  {#if showSecretField}
    <!-- Not `required`: the dialog shows its own inline error instead of the browser's. -->
    <FormField label={fieldLabel} error={secretError}>
      {#snippet control(props)}
        <div class="flex items-center gap-2">
          <Input
            {...props}
            type="password"
            bind:value={secret}
            autocomplete="off"
            spellcheck={false}
            class="font-mono"
            disabled={secretDisabled}
            data-testid="provider-profile-secret-input"
          />
          {#if mode === 'edit' && secretSaved}
            <Button
              variant="ghost-light"
              size="sm"
              disabled={secretDisabled}
              onclick={cancelReplace}
            >
              {m.settings_providerProfileKinds_keepSaved_label()}
            </Button>
          {/if}
        </div>
      {/snippet}
    </FormField>
  {:else}
    <div class="space-y-2" data-testid="provider-profile-secret-saved">
      <p class="type-body text-foreground">{fieldLabel}</p>
      <div class="flex items-center gap-3">
        <span class="type-body font-mono text-muted-foreground"
          >{m.settings_providerProfileKinds_saved_label()}</span
        >
        <Button variant="outline" size="sm" {disabled} onclick={() => (replacing = true)}>
          {m.settings_providerProfileKinds_replace_label()}
        </Button>
      </div>
    </div>
  {/if}

  {#if claudeApiKey && customEndpoint}
    <details
      class="group rounded-md border border-border"
      bind:open={customEndpointOpen}
      data-testid="provider-profile-custom-endpoint"
    >
      <summary
        class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 type-body text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Fa icon={faChevronRight} class="size-3 transition-transform group-open:rotate-90" />
        {m.settings_providerProfileKinds_customEndpoint_label()}
      </summary>
      <div class="space-y-2 border-t border-border px-3 py-3">
        <p class="type-caption text-muted-foreground">
          {m.settings_providerProfileKinds_customEndpoint_description()}
        </p>
        {#if mode === 'edit' && baseUrlSaved && baseUrlAction !== 'replace'}
          <div
            class="flex flex-wrap items-center gap-3"
            data-testid="provider-profile-base-url-saved"
          >
            <span class="type-body text-foreground"
              >{m.settings_providerProfileKinds_baseUrl_label()}</span
            >
            {#if baseUrlAction === 'remove'}
              <span class="type-body text-muted-foreground">
                {m.settings_providerProfileKinds_baseUrlRemoved_label()}
              </span>
              <Button
                variant="ghost-light"
                size="sm"
                {disabled}
                onclick={() => (baseUrlAction = 'keep')}
              >
                {m.settings_providerProfileKinds_keepSaved_label()}
              </Button>
            {:else}
              <span class="type-body font-mono text-muted-foreground"
                >{m.settings_providerProfileKinds_saved_label()}</span
              >
              <Button
                variant="outline"
                size="sm"
                {disabled}
                onclick={() => (baseUrlAction = 'replace')}
              >
                {m.settings_providerProfileKinds_replace_label()}
              </Button>
              <Button
                variant="ghost-light"
                size="sm"
                {disabled}
                onclick={() => (baseUrlAction = 'remove')}
              >
                {m.settings_providerProfiles_remove_label()}
              </Button>
            {/if}
          </div>
        {:else}
          <FormField label={m.settings_providerProfileKinds_baseUrl_label()}>
            {#snippet control(props)}
              <div class="flex items-center gap-2">
                <Input
                  {...props}
                  type="url"
                  bind:value={baseUrl}
                  placeholder={BASE_URL_PLACEHOLDER}
                  autocomplete="off"
                  spellcheck={false}
                  class="font-mono"
                  {disabled}
                  data-testid="provider-profile-base-url-input"
                />
                {#if mode === 'edit' && baseUrlSaved}
                  <Button
                    variant="ghost-light"
                    size="sm"
                    {disabled}
                    onclick={() => {
                      baseUrlAction = 'keep';
                      baseUrl = '';
                    }}
                  >
                    {m.settings_providerProfileKinds_keepSaved_label()}
                  </Button>
                {/if}
              </div>
            {/snippet}
          </FormField>
        {/if}
      </div>
    </details>
  {/if}
</div>
