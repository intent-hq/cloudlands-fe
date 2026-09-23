<script lang="ts">
  import { Button, Input, Select } from '$lib/components/patterns/settings/custom-controls';
  import {
    LINEAR_ISSUE_FILTER_OPTIONS,
    type LinearIssueFilter,
  } from '$features/linear-auth/constants';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { safeLocalStorage } from '$lib/utils/safe-storage';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectLinearIsAuthenticated,
    selectLinearIsAuthenticating,
    selectLinearError,
    selectLinearRequiresDaemonAuth,
  } from '$store/renderer/slices/linear-auth/linear-auth-selectors';
  import {
    connectLinear,
    logoutLinear,
  } from '$store/renderer/slices/linear-auth/linear-auth-slice';

  const isAuthenticated$ = selectLinearIsAuthenticated();
  const isAuthenticating$ = selectLinearIsAuthenticating();
  const error$ = selectLinearError();
  const requiresDaemonAuth$ = selectLinearRequiresDaemonAuth();

  let isDisconnectingLinear = $state(false);
  let issueFilter = $state<LinearIssueFilter>('all');
  let filterLoaded = $state(false);

  // Paste-API-key connect flow (PROTOCOL §5.28 — no OAuth; the key is stored
  // via the daemon secrets-file path and the connection re-probed).
  let showKeyInput = $state(false);
  let apiKeyDraft = $state('');

  // PROTOCOL §5.12 classifies `linear.issueFilter` as FE-only ("Not exposed")
  // — the filter persists locally, not through daemon settings.*.
  const LINEAR_ISSUE_FILTER_STORAGE_KEY = 'linearIssueFilter';

  onMount(() => {
    loadFilter();
  });

  function loadFilter() {
    const stored = safeLocalStorage.getItem(LINEAR_ISSUE_FILTER_STORAGE_KEY);
    if (stored && LINEAR_ISSUE_FILTER_OPTIONS.some((option) => option.value === stored)) {
      issueFilter = stored as LinearIssueFilter;
    }
    filterLoaded = true;
  }

  // Save filter when it changes (after initial load)
  $effect(() => {
    if (!filterLoaded) return;
    safeLocalStorage.setItem(LINEAR_ISSUE_FILTER_STORAGE_KEY, issueFilter);
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
    isDisconnectingLinear = true;
    appStore.dispatch(logoutLinear());
    // Reset local flag after a short delay since logout is async via the service
    setTimeout(() => {
      isDisconnectingLinear = false;
    }, 500);
  }
</script>

<div class="py-3">
  <div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
    <div class="first-line-icon type-body w-4 text-ghost">
      <LinearIcon size={16} />
    </div>
    <div class="flex min-w-0 items-center gap-3">
      <!-- i18n-ignore (brand name) -->
      <span class="type-body font-medium text-foreground">Linear</span>
      {#if $isAuthenticated$}
        <span class="type-body flex items-center gap-1 text-muted-foreground">
          <Fa icon={faCheck} class="size-3 text-success" />
          {m.settings_connections_connected()}
        </span>
      {/if}
    </div>

    <div class="flex h-[22px] items-center gap-3 self-start">
      {#if $isAuthenticating$}
        <span class="type-body text-muted-foreground"
          >{m.settings_connections_linear_validatingApiKey()}</span
        >
      {:else if $isAuthenticated$}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleShowKeyInput}
        >
          {m.settings_connections_linear_replaceKey()}
        </Button>
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleLinearDisconnect}
          disabled={isDisconnectingLinear}
        >
          {isDisconnectingLinear
            ? m.settings_connections_disconnecting()
            : m.settings_connections_disconnect()}
        </Button>
      {:else if !$requiresDaemonAuth$}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleShowKeyInput}
        >
          {m.settings_connections_connect()}
        </Button>
      {:else}
        <span class="type-body text-muted-foreground"
          >{m.settings_connections_requiresDaemonAuth()}</span
        >
      {/if}
    </div>
    <p class="type-body col-start-2 text-muted-foreground">
      {m.settings_connections_linear_description()}
    </p>
    {#if $error$}
      <p class="type-body col-start-2 text-danger">{$error$}</p>
    {/if}
  </div>

  {#if showKeyInput && !$isAuthenticating$}
    <div class="mt-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
      <div></div>
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <Input
            type="password"
            bind:value={apiKeyDraft}
            placeholder={/* i18n-ignore (credential format example) */ 'lin_api_...'}
            class="flex-1"
            aria-label={m.settings_connections_linear_apiKeyAriaLabel()}
            onkeydown={(e) => {
              if (e.key === 'Enter') handleSubmitApiKey();
              if (e.key === 'Escape') handleCancelKeyInput();
            }}
          />
          <Button
            variant="link"
            size="sm"
            type="button"
            class="px-0"
            onclick={handleSubmitApiKey}
            disabled={!apiKeyDraft.trim()}
          >
            {m.settings_connections_save()}
          </Button>
          <Button
            variant="link"
            size="sm"
            type="button"
            class="px-0"
            onclick={handleCancelKeyInput}
          >
            {m.settings_connections_cancel()}
          </Button>
        </div>
        <p class="type-body text-muted-foreground">
          {m.settings_connections_linear_apiKeyStorageNote()}
        </p>
      </div>
    </div>
  {/if}

  {#if $isAuthenticated$}
    <div class="mt-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
      <div></div>
      <div class="flex items-center gap-3">
        <span class="type-body shrink-0 text-muted-foreground"
          >{m.settings_connections_linear_showIssues()}</span
        >
        <Select.Root bind:value={issueFilter}>
          <Select.Trigger class="w-[180px]">
            {LINEAR_ISSUE_FILTER_OPTIONS.find((o) => o.value === issueFilter)?.label ||
              m.settings_connections_linear_selectPlaceholder()}
          </Select.Trigger>
          <Select.Content>
            {#each LINEAR_ISSUE_FILTER_OPTIONS as option (option.value)}
              <Select.Item value={option.value}>
                <span>{option.label}</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/if}
</div>
