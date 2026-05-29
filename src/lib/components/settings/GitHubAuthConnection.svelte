<script lang="ts">
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$lib/store/store';
  import {
  initializeGitHubAuth,
  startGitHubAuth,
  logoutGitHub,
  checkGitHubAuthStatus,
} from '$lib/store/slices/github-auth/github-auth-slice';
  import {
  selectGitHubAuthIsAuthenticated,
  selectGitHubAuthIsAuthenticating,
  selectGitHubAuthOauthUrl,
  selectGitHubAuthUser,
  selectGitHubAuthError,
  selectGitHubAuthRequiresAugmentAuth,
} from '$lib/store/slices/github-auth/github-auth-selectors';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  let isDisconnectingGitHub = $state(false);

  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const user$ = selectGitHubAuthUser();
  const error$ = selectGitHubAuthError();
  const requiresAugmentAuth$ = selectGitHubAuthRequiresAugmentAuth();

  onMount(() => {
    if (!skipInitialize) {
      appStore.dispatch(initializeGitHubAuth());
    }

    // Check auth status immediately when window gains focus
    // This makes the UI update snappily when user returns from browser
    const handleFocus = () => {
      const state = appStore.state;
      const isAuthenticating = selectGitHubAuthIsAuthenticating.select(state);
      const oauthUrl = selectGitHubAuthOauthUrl.select(state);
      if (isAuthenticating && oauthUrl) {
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

<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <Fa icon={faGithub} class="w-4 h-4 text-ghost" />
      <span class="text-sm text-foreground">GitHub</span>
      {#if $isAuthenticated$}
        <span class="text-xs text-subtle flex items-center gap-1">
          <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
          {#if $user$}
            @{$user$.login}
          {:else}
            Connected
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-xs text-subtle pl-6">
      Push changes and create pull requests directly from workspaces.
    </p>
    {#if $error$}
      <p class="text-xs text-destructive-foreground pl-6">{$error$}</p>
    {/if}
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if $isAuthenticating$}
      <span class="text-subtle">Waiting for authorization...</span>
    {:else if $isAuthenticated$}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onclick={handleGitHubReconnect}
      >
        Reconnect
      </button>
      <span class="text-ghost">·</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
        onclick={handleGitHubDisconnect}
        disabled={isDisconnectingGitHub}
      >
        {isDisconnectingGitHub ? 'Disconnecting...' : 'Disconnect'}
      </button>
    {:else if !$requiresAugmentAuth$}
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
        onclick={handleGitHubConnect}
      >
        Connect
      </button>
    {:else}
      <span class="text-xs text-subtle">Requires Augment authentication</span>
    {/if}
  </div>
</div>
