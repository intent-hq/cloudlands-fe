<script lang="ts">
  import { githubAuthStore } from '$features/github-auth/renderer/github-auth.store.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import { onDestroy, onMount } from 'svelte';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    onSuccess?: () => void;
    /** If true, automatically start the auth flow when modal opens */
    autoStart?: boolean;
  }

  let {
    open = false,
    onClose = () => {},
    onSuccess = () => {},
    autoStart = false,
  }: Props = $props();

  // Access state reactively through the store getter, not via destructuring
  const { startAuth, cancelAuth, clearError } = githubAuthStore;

  let authStartedHere = false;
  let hasAutoStarted = false;
  let hasOpenedBrowser = $state(false);

  // Auto-start auth flow if requested (e.g., when modal opens due to PR creation failure)
  onMount(() => {
    if (autoStart && open && !hasAutoStarted) {
      hasAutoStarted = true;
      handleConnect();
    }
  });

  async function handleConnect() {
    authStartedHere = true;
    hasOpenedBrowser = false;
    // Run auth without blocking the UI so the spinner renders immediately
    startAuth()
      .then(() => {
        if (githubAuthStore.state.isAuthenticated) {
          onSuccess();
          onClose();
        }
      })
      .catch(() => {
        // Auth flow failed - error state will be shown in the modal
      });
  }

  function handleOpenInBrowser() {
    const url = githubAuthStore.state.oauthUrl;
    if (!url) return;

    hasOpenedBrowser = true;

    // Open in external browser
    window.electronAPI?.invoke('shell:openExternal', { url });
  }

  function handleCancel() {
    if (authStartedHere) {
      cancelAuth();
    }
    hasOpenedBrowser = false;
    onClose();
  }

  function handleRetry() {
    clearError();
    hasOpenedBrowser = false;
    handleConnect();
  }

  onDestroy(() => {
    if (authStartedHere && githubAuthStore.state.isAuthenticating) {
      cancelAuth();
    }
  });
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    onclick={handleCancel}
    onkeydown={(e) => e.key === 'Escape' && handleCancel()}
  >
    <div
      class="bg-background rounded-lg w-[420px] max-w-[90vw] shadow-lg border border-border text-foreground"
      onclick={(event) => event.stopPropagation()}
    >
      <div class="flex justify-between items-center p-4 border-b border-border">
        <h2 class="m-0 text-lg text-foreground">Connect to GitHub</h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-muted-foreground hover:text-foreground"
          onclick={handleCancel}>×</button
        >
      </div>

      <div class="p-6 text-center text-foreground">
        {#if githubAuthStore.state.error}
          <div class="text-destructive">
            <p>{githubAuthStore.state.error}</p>
            <button
              class="mt-3 bg-muted border-none px-4 py-2 rounded cursor-pointer text-foreground hover:bg-muted/80"
              onclick={handleRetry}>Try Again</button
            >
          </div>
        {:else if githubAuthStore.state.requiresAugmentAuth}
          <div class="augment-auth-required">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            <p class="text-foreground">
              Please authenticate with Augment first to enable GitHub integration.
            </p>
            <p class="text-muted-foreground text-sm mt-2">
              Run <code class="bg-muted px-2 py-1 rounded">auggie login</code> in your terminal.
            </p>
          </div>
        {:else if githubAuthStore.state.oauthUrl}
          <div class="oauth-redirect">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            {#if hasOpenedBrowser}
              <div
                class="w-6 h-6 border-[3px] border-border border-t-blue-600 rounded-full animate-spin mx-auto mb-4"
              ></div>
              <p class="text-foreground">
                Complete the authorization in your browser, then return here.
              </p>
              <p class="text-muted-foreground text-sm mt-2">Waiting for authorization...</p>
            {:else}
              <p class="text-foreground">Click below to open GitHub authorization.</p>
              <button
                class="bg-[#238636] text-white border-none px-6 py-3 rounded text-base cursor-pointer mt-4 hover:bg-[#2ea043]"
                onclick={handleOpenInBrowser}
              >
                Open GitHub Authorization
              </button>
            {/if}
          </div>
        {:else if githubAuthStore.state.isAuthenticating}
          <div class="loading">
            <div
              class="w-6 h-6 border-[3px] border-border border-t-blue-600 rounded-full animate-spin mx-auto"
            ></div>
            <p class="text-foreground">Starting authentication...</p>
          </div>
        {:else}
          <div class="connect-prompt">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            <p class="text-foreground">
              Connect your GitHub account to create pull requests and list repositories.
            </p>
            <p class="text-muted-foreground text-sm mt-2">
              Git push/pull uses your local git credentials (SSH keys or credential manager).
            </p>
            <button
              class="bg-[#238636] text-white border-none px-6 py-3 rounded text-base cursor-pointer mt-4 hover:bg-[#2ea043]"
              onclick={handleConnect}
            >
              Connect to GitHub
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
