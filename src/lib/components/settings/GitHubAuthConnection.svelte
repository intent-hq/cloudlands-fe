<script lang="ts">
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  let isDisconnectingGitHub = $state(false);

  onMount(() => {
    if (!skipInitialize) {
      githubAuthStore.initialize();
    }

    // Check auth status immediately when window gains focus
    // This makes the UI update snappily when user returns from browser
    const handleFocus = () => {
      if (githubAuthStore.state.isAuthenticating && githubAuthStore.state.oauthUrl) {
        githubAuthStore.checkAuthStatus();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  });

  async function handleGitHubConnect() {
    await githubAuthStore.startAuth();
  }

  async function handleGitHubDisconnect() {
    isDisconnectingGitHub = true;
    try {
      await githubAuthStore.logout();
    } finally {
      isDisconnectingGitHub = false;
    }
  }

  async function handleGitHubReconnect() {
    await githubAuthStore.startAuth();
  }
</script>

<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <div class="flex items-center gap-2">
      <Fa icon={faGithub} class="w-4 h-4 text-muted-foreground" />
      <span class="text-sm text-foreground">GitHub</span>
      {#if githubAuthStore.state.isAuthenticated}
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
          {#if githubAuthStore.state.user}
            @{githubAuthStore.state.user.login}
          {:else}
            Connected
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-xs text-muted-foreground pl-6">
      Push changes and create pull requests directly from workspaces.
    </p>
    {#if githubAuthStore.state.error}
      <p class="text-xs text-destructive pl-6">{githubAuthStore.state.error}</p>
    {/if}
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if githubAuthStore.state.isAuthenticating}
      <span class="text-muted-foreground">Waiting for authorization...</span>
    {:else if githubAuthStore.state.isAuthenticated}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onclick={handleGitHubReconnect}
      >
        Reconnect
      </button>
      <span class="text-muted-foreground/30">·</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive-foreground cursor-pointer transition-colors"
        onclick={handleGitHubDisconnect}
        disabled={isDisconnectingGitHub}
      >
        {isDisconnectingGitHub ? 'Disconnecting...' : 'Disconnect'}
      </button>
    {:else if !githubAuthStore.state.requiresAugmentAuth}
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
        onclick={handleGitHubConnect}
      >
        Connect
      </button>
    {:else}
      <span class="text-xs text-muted-foreground">Requires Augment authentication</span>
    {/if}
  </div>
</div>
