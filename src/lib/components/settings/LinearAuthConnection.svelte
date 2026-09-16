<script lang="ts">
  import {
    LINEAR_ISSUE_FILTER_OPTIONS,
    type LinearIssueFilter,
  } from '$features/linear-auth/constants';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { Select } from '$lib/components/ui/select';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectLinearIsAuthenticated,
    selectLinearIsAuthenticating,
    selectLinearError,
    selectLinearIssueFilter,
    selectLinearRequiresDaemonAuth,
  } from '$store/renderer/slices/linear-auth/linear-auth-selectors';
  import {
    connectLinear,
    initializeLinearIssueFilter,
    logoutLinear,
    setLinearIssueFilter,
  } from '$store/renderer/slices/linear-auth/linear-auth-slice';
  import Input from '$lib/components/ui/input/input.svelte';

  const isAuthenticated$ = selectLinearIsAuthenticated();
  const isAuthenticating$ = selectLinearIsAuthenticating();
  const error$ = selectLinearError();
  const requiresDaemonAuth$ = selectLinearRequiresDaemonAuth();
  const issueFilter$ = selectLinearIssueFilter();

  // Paste-API-key connect flow (PROTOCOL §5.28 — no OAuth; the key is stored
  // via the daemon secrets-file path and the connection re-probed).
  let showKeyInput = $state(false);
  let apiKeyDraft = $state('');

  onMount(() => {
    appStore.dispatch(initializeLinearIssueFilter());
  });

  function handleShowKeyInput() {
    apiKeyDraft = '';
    showKeyInput = true;
  }

  function handleCancelKeyInput() {
    showKeyInput = false;
    apiKeyDraft = '';
  }

  function handleSubmitApiKey() {
    const key = apiKeyDraft.trim();
    if (!key) return;
    appStore.dispatch(connectLinear(key));
    showKeyInput = false;
    apiKeyDraft = '';
  }

  function handleLinearDisconnect() {
    appStore.dispatch(logoutLinear());
  }

  function handleIssueFilterChange(value: string | undefined) {
    if (LINEAR_ISSUE_FILTER_OPTIONS.some((option) => option.value === value)) {
      appStore.dispatch(setLinearIssueFilter(value as LinearIssueFilter));
    }
  }
</script>

<div class="space-y-3">
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <LinearIcon size={14} class="text-ghost" />
        <!-- i18n-ignore (brand name) -->
        <span class="text-sm text-foreground">Linear</span>
        {#if $isAuthenticated$}
          <span class="text-xs text-subtle flex items-center gap-1">
            <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
            {m.settings_connections_connected()}
          </span>
        {/if}
      </div>
      <p class="text-xs text-subtle pl-6">
        {m.settings_connections_linear_description()}
      </p>
      {#if $error$}
        <p class="text-xs text-danger pl-6">{$error$}</p>
      {/if}
    </div>

    <div class="flex items-center gap-2 text-xs">
      {#if $isAuthenticating$}
        <span class="text-subtle">{m.settings_connections_linear_validatingApiKey()}</span>
      {:else if $isAuthenticated$}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onclick={handleShowKeyInput}
        >
          {m.settings_connections_linear_replaceKey()}
        </button>
        <span class="text-ghost">·</span>
        <button
          type="button"
          class="text-muted-foreground hover:text-danger cursor-pointer transition-colors"
          onclick={handleLinearDisconnect}
        >
          {m.settings_connections_disconnect()}
        </button>
      {:else if !$requiresDaemonAuth$}
        <button
          type="button"
          class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
          onclick={handleShowKeyInput}
        >
          {m.settings_connections_connect()}
        </button>
      {:else}
        <span class="text-xs text-subtle">{m.settings_connections_requiresDaemonAuth()}</span>
      {/if}
    </div>
  </div>

  {#if showKeyInput && !$isAuthenticating$}
    <div class="pl-6 space-y-2">
      <div class="flex items-center gap-2">
        <Input
          type="password"
          bind:value={apiKeyDraft}
          placeholder={/* i18n-ignore (credential format example) */ 'lin_api_...'}
          class="h-7 text-xs flex-1"
          aria-label={m.settings_connections_linear_apiKeyAriaLabel()}
          onkeydown={(e) => {
            if (e.key === 'Enter') handleSubmitApiKey();
            if (e.key === 'Escape') handleCancelKeyInput();
          }}
        />
        <button
          type="button"
          class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium text-xs"
          onclick={handleSubmitApiKey}
          disabled={!apiKeyDraft.trim()}
        >
          {m.settings_connections_save()}
        </button>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-xs"
          onclick={handleCancelKeyInput}
        >
          {m.settings_connections_cancel()}
        </button>
      </div>
      <p class="text-xs text-subtle">
        {m.settings_connections_linear_apiKeyStorageNote()}
      </p>
    </div>
  {/if}

  {#if $isAuthenticated$}
    <div class="pl-6 flex items-center gap-3">
      <span class="text-xs text-subtle shrink-0">{m.settings_connections_linear_showIssues()}</span>
      <Select.Root value={$issueFilter$} onchange={handleIssueFilterChange}>
        <Select.Trigger class="h-7 text-xs w-[180px]">
          {LINEAR_ISSUE_FILTER_OPTIONS.find((o) => o.value === $issueFilter$)?.label ||
            m.settings_connections_linear_selectPlaceholder()}
        </Select.Trigger>
        <Select.Content>
          {#each LINEAR_ISSUE_FILTER_OPTIONS as option (option.value)}
            <Select.Item value={option.value}>
              <span class="text-xs">{option.label}</span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
</div>
