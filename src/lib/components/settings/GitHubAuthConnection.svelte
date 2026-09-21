<script lang="ts">
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
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

  let isDisconnectingGitHub = $state(false);

  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const deviceFlow$ = selectGitHubAuthDeviceFlow();
  const user$ = selectGitHubAuthUser();
  const error$ = selectGitHubAuthError();
  const requiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  onMount(() => {
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
    setTimeout(() => {
      isDisconnectingGitHub = false;
    }, 500);
  }

  function handleGitHubReconnect() {
    appStore.dispatch(startGitHubAuth({ reconnect: true }));
  }
</script>

<div class="py-3">
  <div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
    <div class="flex size-4 items-center justify-center text-ghost">
      <Fa icon={faGithub} class="size-4" />
    </div>
    <div class="flex min-w-0 items-center gap-3">
      <!-- i18n-ignore (brand name) -->
      <span class="type-body font-medium text-foreground">GitHub</span>
      {#if $isAuthenticated$}
        <span class="type-body flex min-w-0 items-center gap-1 text-muted-foreground">
          <Fa icon={faCheck} class="size-3 text-success" />
          {#if $user$}
            @{$user$.login}
          {:else}
            {m.settings_connections_connected()}
          {/if}
        </span>
      {/if}
    </div>

    <div class="flex h-[22px] items-center gap-3 self-start">
      {#if $isAuthenticating$}
        <span class="type-body text-muted-foreground"
          >{m.settings_connections_github_waitingForAuthorization()}</span
        >
      {:else if $isAuthenticated$}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleGitHubReconnect}
        >
          {m.settings_connections_reconnect()}
        </Button>
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleGitHubDisconnect}
          disabled={isDisconnectingGitHub}
        >
          {isDisconnectingGitHub
            ? m.settings_connections_disconnecting()
            : m.settings_connections_disconnect()}
        </Button>
      {:else if !$requiresDaemonAuth$}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-[22px] px-0"
          onclick={handleGitHubConnect}
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
      {m.settings_connections_github_description()}
    </p>
    {#if $error$}
      <p class="type-body col-start-2 text-danger">{$error$}</p>
    {/if}
  </div>

  {#if $isAuthenticating$ && $deviceFlow$}
    <div class="mt-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
      <div></div>
      <div class="max-w-xs">
        <GitHubDeviceCodeCard
          userCode={$deviceFlow$.userCode}
          verificationUri={$deviceFlow$.verificationUri}
          compact
        />
      </div>
    </div>
  {/if}
</div>
