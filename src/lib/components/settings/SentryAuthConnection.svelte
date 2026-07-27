<script lang="ts">
  import { handleLink } from '$features/navigation/link-handler';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
  selectSentryIsAuthenticated,
  selectSentryOrganization,
  selectSentryIsConnecting,
  selectSentryError,
} from '$store/renderer/slices/sentry-auth/sentry-auth-selectors';
  import {
  initializeSentryAuth,
  connectSentry,
  logoutSentry,
  clearSentryError,
} from '$store/renderer/slices/sentry-auth/sentry-auth-slice';


  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();
  const activeWorkspaceId = selectActiveWorkspaceId();
  const isAuthenticated$ = selectSentryIsAuthenticated();
  const organization$ = selectSentryOrganization();
  const storeIsConnecting$ = selectSentryIsConnecting();
  const error$ = selectSentryError();

  let isDisconnectingSentry = $state(false);
  let showConnectForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');
  let pendingConnect = $state(false);

  onMount(() => {
    if (!skipInitialize) {
      appStore.dispatch(initializeSentryAuth());
    }
  });

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

<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <div class="flex items-center gap-1">
      <SentryIcon size={17} class="text-ghost" />
      <!-- i18n-ignore (brand name) -->
      <span class="text-sm text-foreground">Sentry</span>
      {#if $isAuthenticated$}
        <span class="text-xs text-subtle flex items-center gap-1">
          <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
          {#if $organization$}
            {$organization$}
          {:else}
            {m.settings_connections_connected()}
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-xs text-subtle pl-6">{m.settings_connections_sentry_description()}</p>
    {#if $error$}
      <p class="text-xs text-destructive-foreground pl-6">{$error$}</p>
    {/if}
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if $storeIsConnecting$ || pendingConnect}
      <span class="text-subtle">{m.settings_connections_connecting()}</span>
    {:else if $isAuthenticated$}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onclick={handleSentryReconnect}
      >
        {m.settings_connections_reconnect()}
      </button>
      <span class="text-ghost">·</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
        onclick={handleSentryDisconnect}
        disabled={isDisconnectingSentry}
      >
        {isDisconnectingSentry
          ? m.settings_connections_disconnecting()
          : m.settings_connections_disconnect()}
      </button>
    {:else}
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
        onclick={() => (showConnectForm = true)}
      >
        {m.settings_connections_connect()}
      </button>
    {/if}
  </div>
</div>

{#if showConnectForm && !$storeIsConnecting$}
  <div class="space-y-3 rounded-md bg-sidebar p-3">
    <div class="space-y-2">
      <label for="sentry-org" class="block text-xs font-medium text-foreground">
        {m.settings_connections_sentry_orgSlug_label()}
      </label>
      <Input
        id="sentry-org"
        bind:value={sentryOrg}
        placeholder={m.settings_connections_sentry_orgSlug_placeholder()}
        disabled={$storeIsConnecting$}
        class="text-sm"
      />
      <p class="text-xs text-subtle">
        {m.settings_connections_sentry_orgSlug_description()}
      </p>
    </div>

    <div class="space-y-2">
      <label for="sentry-token" class="block text-xs font-medium text-foreground">
        {m.settings_connections_sentry_apiToken_label()}
      </label>
      <Input
        id="sentry-token"
        type="password"
        bind:value={sentryToken}
        placeholder={'sntrys_...' /* i18n-ignore (token format) */}
        disabled={$storeIsConnecting$}
        class="text-sm"
      />
      <p class="text-xs text-subtle">
        {m.settings_connections_sentry_apiToken_createTokenAt()}{' '}
        <button
          type="button"
          onclick={() => {
            handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
              workspaceId: $activeWorkspaceId ?? undefined,
            });
          }}
          class="text-primary hover:underline cursor-pointer"
        >
          <!-- i18n-ignore (URL) -->
          sentry.io/settings/account/api/auth-tokens/
        </button>
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
      <Button variant="ghost" size="sm" onclick={handleCancelConnect} disabled={$storeIsConnecting$}>
        {m.settings_connections_cancel()}
      </Button>
    </div>
  </div>
{/if}
