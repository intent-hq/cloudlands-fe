<script lang="ts">
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
  initializeGitHubAuth,
  startGitHubAuth,
  logoutGitHub,
  checkGitHubAuthStatus,
} from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
  selectGitHubAuthIsAuthenticated,
  selectGitHubAuthIsAuthenticating,
  selectGitHubAuthDeviceFlow,
  selectGitHubAuthUser,
  selectGitHubAuthError,
  selectGitHubAuthRequiresDaemonAuth,
} from '$store/renderer/slices/github-auth/github-auth-selectors';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  let isDisconnectingGitHub = $state(false);

  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const deviceFlow$ = selectGitHubAuthDeviceFlow();
  const user$ = selectGitHubAuthUser();
  const error$ = selectGitHubAuthError();
  const requiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  onMount(() => {
    if (!skipInitialize) {
      appStore.dispatch(initializeGitHubAuth());
    }

    // Check auth status immediately when window gains focus
    // This makes the UI update snappily when user returns from browser
    const handleFocus = () => {
      const state = appStore.state;
      const isAuthenticating = selectGitHubAuthIsAuthenticating.select(state);
      const deviceFlow = selectGitHubAuthDeviceFlow.select(state);
      if (isAuthenticating && deviceFlow) {
        appStore.dispatch(checkGitHubAuthStatus());
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  });

  function handleGitHubConnect() {
    appStore.dispatch(startGitHubAuth());
  }

  function handleGitHubDisconnect() {
    isDisconnectingGitHub = true;
    appStore.dispatch(logoutGitHub());
    // The saga handles the async logout; we just reset local UI state
    // Use a short delay to let the saga complete
    setTimeout(() => { isDisconnectingGitHub = false; }, 500);
  }

  function handleGitHubReconnect() {
    appStore.dispatch(startGitHubAuth());
  }
</script>

<div class="space-y-2">
<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <Fa icon={faGithub} class="w-4 h-4 text-ghost" />
      <!-- i18n-ignore (brand name) -->
      <span class="text-sm text-foreground">GitHub</span>
      {#if $isAuthenticated$}
        <span class="text-xs text-subtle flex items-center gap-1">
          <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
          {#if $user$}
            @{$user$.login}
          {:else}
            {m.settings_connections_connected()}
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-xs text-subtle pl-6">
      {m.settings_connections_github_description()}
    </p>
    {#if $error$}
      <p class="text-xs text-destructive-foreground pl-6">{$error$}</p>
    {/if}
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if $isAuthenticating$}
      <span class="text-subtle">{m.settings_connections_github_waitingForAuthorization()}</span>
    {:else if $isAuthenticated$}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onclick={handleGitHubReconnect}
      >
        {m.settings_connections_reconnect()}
      </button>
      <span class="text-ghost">·</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
        onclick={handleGitHubDisconnect}
        disabled={isDisconnectingGitHub}
      >
        {isDisconnectingGitHub
          ? m.settings_connections_disconnecting()
          : m.settings_connections_disconnect()}
      </button>
    {:else if !$requiresDaemonAuth$}
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
        onclick={handleGitHubConnect}
      >
        {m.settings_connections_connect()}
      </button>
    {:else}
      <span class="text-xs text-subtle">{m.settings_connections_requiresDaemonAuth()}</span>
    {/if}
  </div>
</div>

{#if $isAuthenticating$ && $deviceFlow$}
  <div class="pl-6 max-w-xs">
    <GitHubDeviceCodeCard
      userCode={$deviceFlow$.userCode}
      verificationUri={$deviceFlow$.verificationUri}
      compact
    />
  </div>
{/if}
</div>
