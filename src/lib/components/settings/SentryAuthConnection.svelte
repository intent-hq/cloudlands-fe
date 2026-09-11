<script lang="ts">
  import { handleLink } from '$features/navigation/link-handler';
  import {
    selectSentryIsAuthenticated,
    selectSentryOrganization,
    selectSentryIsConnecting,
    selectSentryError,
  } from '$store/renderer/slices/sentry-auth/sentry-auth-selectors';
  import {
    connectSentry,
    logoutSentry,
    clearSentryError,
  } from '$store/renderer/slices/sentry-auth/sentry-auth-slice';

  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { Button, Input } from '$lib/components/patterns/settings/custom-controls';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;
  const isAuthenticated$ = selectSentryIsAuthenticated();
  const organization$ = selectSentryOrganization();
  const storeIsConnecting$ = selectSentryIsConnecting();
  const error$ = selectSentryError();

  let isDisconnectingSentry = $state(false);
  let showConnectForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');
  let pendingConnect = $state(false);

  // When connect completes successfully, clear the form
  $effect(() => {
    if (pendingConnect && !$storeIsConnecting$) {
      pendingConnect = false;
      if ($isAuthenticated$) {
        sentryOrg = '';
        sentryToken = '';
        showConnectForm = false;
      }
    }
  });

  function handleSentryConnect() {
    if (!sentryOrg.trim() || !sentryToken.trim()) {
      return;
    }
    pendingConnect = true;
    appStore.dispatch(connectSentry(sentryOrg.trim(), sentryToken.trim()));
  }

  function handleSentryDisconnect() {
    isDisconnectingSentry = true;
    appStore.dispatch(logoutSentry());
    // Reset local state immediately since logout is synchronous in Redux
    isDisconnectingSentry = false;
  }

  function handleSentryReconnect() {
    showConnectForm = true;
    sentryOrg = selectSentryOrganization.select(appStore.state) || '';
    sentryToken = '';
  }

  function handleCancelConnect() {
    showConnectForm = false;
    sentryOrg = '';
    sentryToken = '';
    appStore.dispatch(clearSentryError());
  }
</script>

<div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3">
  <div class="flex size-4 items-center justify-center text-ghost">
    <SentryIcon size={16} />
  </div>
  <div class="flex min-w-0 items-center gap-3">
    <!-- i18n-ignore (brand name) -->
    <span class="type-body font-medium text-foreground">Sentry</span>
    {#if $isAuthenticated$}
      <span class="type-body flex min-w-0 items-center gap-1 text-muted-foreground">
        <Fa icon={faCheck} class="size-3 text-success" />
        {#if $organization$}
          {$organization$}
        {:else}
          {m.settings_connections_connected()}
        {/if}
      </span>
    {/if}
  </div>

  <div class="flex h-[22px] items-center gap-3 self-start">
    {#if $storeIsConnecting$ || pendingConnect}
      <span class="type-body text-muted-foreground">{m.settings_connections_connecting()}</span>
    {:else if $isAuthenticated$}
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-[22px] px-0"
        onclick={handleSentryReconnect}
      >
        {m.settings_connections_reconnect()}
      </Button>
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-[22px] px-0"
        onclick={handleSentryDisconnect}
        disabled={isDisconnectingSentry}
      >
        {isDisconnectingSentry
          ? m.settings_connections_disconnecting()
          : m.settings_connections_disconnect()}
      </Button>
    {:else}
      <Button
        variant="link"
        size="sm"
        type="button"
        class="h-[22px] px-0"
        onclick={() => (showConnectForm = true)}
      >
        {m.settings_connections_connect()}
      </Button>
    {/if}
  </div>
  <p class="type-body col-start-2 text-muted-foreground">
    {m.settings_connections_sentry_description()}
  </p>
  {#if $error$}
    <p class="type-body col-start-2 text-danger">{$error$}</p>
  {/if}

  {#if showConnectForm && !$storeIsConnecting$}
    <div class="col-span-2 col-start-2 mt-2 space-y-3 rounded-md bg-sidebar p-3">
      <div class="space-y-2">
        <label for="sentry-org" class="type-body block font-medium text-foreground">
          {m.settings_connections_sentry_orgSlug_label()}
        </label>
        <Input
          id="sentry-org"
          bind:value={sentryOrg}
          placeholder={m.settings_connections_sentry_orgSlug_placeholder()}
          disabled={$storeIsConnecting$}
        />
        <p class="type-body text-muted-foreground">
          {m.settings_connections_sentry_orgSlug_description()}
        </p>
      </div>

      <div class="space-y-2">
        <label for="sentry-token" class="type-body block font-medium text-foreground">
          {m.settings_connections_sentry_apiToken_label()}
        </label>
        <Input
          id="sentry-token"
          type="password"
          bind:value={sentryToken}
          placeholder={/* i18n-ignore (credential format example) */ 'sntrys_...'}
          disabled={$storeIsConnecting$}
        />
        <p class="type-body text-muted-foreground">
          {m.settings_connections_sentry_apiToken_createTokenAt()}{' '}
          <Button
            variant="link"
            size="sm"
            type="button"
            onclick={() => {
              handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
                workspaceId,
              });
            }}
            class="h-auto px-0"
          >
            <!-- i18n-ignore (URL) -->
            sentry.io/settings/account/api/auth-tokens/
          </Button>
          {' '}{m.settings_connections_sentry_apiToken_withScopes()}
          <!-- i18n-ignore (scope identifiers) -->
          <span class="font-mono text-subtle">org:read, project:read, event:read</span>
        </p>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onclick={handleSentryConnect}
          disabled={$storeIsConnecting$ || !sentryOrg.trim() || !sentryToken.trim()}
        >
          {$storeIsConnecting$
            ? m.settings_connections_connecting()
            : m.settings_connections_connect()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={handleCancelConnect}
          disabled={$storeIsConnecting$}
        >
          {m.settings_connections_cancel()}
        </Button>
      </div>
    </div>
  {/if}
</div>
