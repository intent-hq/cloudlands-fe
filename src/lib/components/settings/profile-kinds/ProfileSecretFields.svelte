<script lang="ts">
  /**
   * Body of the secret-based screens: Claude API key (add + edit, with the
   * optional Custom endpoint) and Token (add + edit, both providers). A saved
   * key or token is never shown: edit reads "Saved ••••" with Replace.
   * Presentational only; the dialog owns validation and the key check.
   */
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { FormField } from '$lib/components/patterns/form';
  import { Button, CopyButton, Input } from '$lib/components/patterns/settings/custom-controls';
  import type { BaseUrlAction, ProfileKindProvider } from './profile-kind-mock';

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
  }: Props = $props();

  const ANTHROPIC_CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys'; // i18n-ignore (URL)
  const OPENAI_ACCESS_TOKENS_URL = 'https://developers.openai.com/codex/enterprise/access-tokens'; // i18n-ignore (URL)
  const SETUP_TOKEN_COMMAND = 'claude setup-token'; // i18n-ignore (CLI command)
  const BASE_URL_PLACEHOLDER = 'https://'; // i18n-ignore (URL prefix)

  const claudeApiKey = $derived(provider === 'claude' && kind === 'apiKey');
  const showSecretField = $derived(mode === 'add' || !secretSaved || replacing);
  const fieldLabel = $derived(
    kind === 'apiKey'
      ? m.settings_providerProfileKinds_apiKey_label()
      : m.settings_providerProfileKinds_token_label(),
  );

  /** Steps link: Anthropic Console (Claude API key) or OpenAI's token guide (Codex token). */
  const stepsLink = $derived.by(() => {
    if (claudeApiKey) {
      return {
        href: ANTHROPIC_CONSOLE_KEYS_URL,
        label: m.settings_providerProfileKinds_anthropicConsole_link(),
      };
    }
    if (provider === 'codex') {
      return {
        href: OPENAI_ACCESS_TOKENS_URL,
        label: m.settings_providerProfileKinds_openAiAccessTokens_link(),
      };
    }
    return undefined;
  });

  function cancelReplace() {
    replacing = false;
    secret = '';
  }
</script>

<div class="space-y-5" data-testid="provider-profile-secret" data-kind={kind}>
  {#if provider === 'codex' && kind === 'token'}
    <p class="type-body text-muted-foreground" data-testid="provider-profile-token-eligibility">
      {m.settings_providerProfileKinds_tokenCodexEligibility_description()}
    </p>
  {/if}

  {#if mode === 'add' || replacing}
    <section class="space-y-2" data-testid="provider-profile-secret-steps">
      <h3 class="type-body font-medium! text-foreground">
        {claudeApiKey
          ? m.settings_providerProfileKinds_apiKeyClaudeSteps_label()
          : m.settings_providerProfileKinds_tokenSteps_label()}
      </h3>
      <!-- Fixed instruction copy per kind, not a data collection. -->
      <ol class="type-body list-decimal space-y-1 pl-5 text-muted-foreground">
        {#if claudeApiKey}
          <li>{m.settings_providerProfileKinds_apiKeyClaudeStep1_label()}</li>
          <li>{m.settings_providerProfileKinds_apiKeyClaudeStep2_label()}</li>
          <li>{m.settings_providerProfileKinds_apiKeyClaudeStep3_label()}</li>
        {:else if provider === 'claude'}
          <li>
            {m.settings_providerProfileKinds_tokenClaudeStep1_label()}
            <span class="mt-1 flex items-center gap-2" data-testid="provider-profile-setup-token">
              <code
                class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono type-caption text-foreground"
                >{SETUP_TOKEN_COMMAND}</code
              >
              <CopyButton text={SETUP_TOKEN_COMMAND} size="sm" />
            </span>
          </li>
          <li>{m.settings_providerProfileKinds_tokenClaudeStep2_label()}</li>
          <li>{m.settings_providerProfileKinds_tokenClaudeStep3_label()}</li>
        {:else}
          <li>{m.settings_providerProfileKinds_tokenCodexStep1_label()}</li>
          <li>{m.settings_providerProfileKinds_tokenCodexStep2_label()}</li>
        {/if}
      </ol>
      {#if stepsLink}
        <Button
          variant="link"
          size="sm"
          href={stepsLink.href}
          target="_blank"
          rel="noopener noreferrer"
          class="h-auto px-0">{stepsLink.label}</Button
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

  {#if claudeApiKey}
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
