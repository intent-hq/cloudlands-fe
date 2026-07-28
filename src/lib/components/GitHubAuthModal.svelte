<script lang="ts">
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import {
  onDestroy,
  onMount,
} from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

  import {
  startGitHubAuth,
  cancelGitHubAuth,
  clearGitHubAuthError,
} from '$store/renderer/slices/github-auth/github-auth-slice';
  import {
  selectGitHubAuthIsAuthenticated,
  selectGitHubAuthIsAuthenticating,
  selectGitHubAuthDeviceFlow,
  selectGitHubAuthError,
  selectGitHubAuthRequiresDaemonAuth,
} from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { store as appStore } from '$store/renderer/store';

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

  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const deviceFlow$ = selectGitHubAuthDeviceFlow();
  const error$ = selectGitHubAuthError();
  const requiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  let authStartedHere = false;
  let hasAutoStarted = false;

  // Auto-start auth flow if requested (e.g., when modal opens due to PR creation failure)
  onMount(() => {
    if (autoStart && open && !hasAutoStarted) {
      hasAutoStarted = true;
      handleConnect();
    }
  });

  // Watch for auth completion from saga and trigger success
  $effect(() => {
    if (authStartedHere && $isAuthenticated$) {
      authStartedHere = false;
      onSuccess();
      onClose();
    }
  });

  function handleConnect() {
    authStartedHere = true;
    appStore.dispatch(startGitHubAuth());
  }

  function handleCancel() {
    if (authStartedHere) {
      appStore.dispatch(cancelGitHubAuth());
    }
    onClose();
  }

  function handleRetry() {
    appStore.dispatch(clearGitHubAuthError());
    handleConnect();
  }

  onDestroy(() => {
    if (authStartedHere && $isAuthenticating$) {
      appStore.dispatch(cancelGitHubAuth());
    }
  });
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    aria-label={m.lib_githubAuth_closeModal_ariaLabel()}
    onclick={handleCancel}
    onkeydown={(e) => e.key === 'Escape' && handleCancel()}
  >
    <div
      class="bg-background rounded-lg w-[420px] max-w-[90vw] shadow-lg border border-border text-foreground"
      onclick={(event) => event.stopPropagation()}
    >
      <div class="flex justify-between items-center p-4 border-b border-border">
        <h2 class="m-0 text-lg text-foreground">{m.lib_githubAuth_connect_label()}</h2>
        <button
          class="bg-transparent border-none text-2xl cursor-pointer text-muted-foreground hover:text-foreground"
          onclick={handleCancel}>×</button
        >
      </div>

      <div class="p-6 text-center text-foreground">
        {#if $error$}
          <div class="text-destructive-foreground">
            <p>{$error$}</p>
            <button
              class="mt-3 bg-muted border-none px-4 py-2 rounded cursor-pointer text-foreground hover:bg-muted/80"
              onclick={handleRetry}>{m.lib_githubAuth_tryAgain_label()}</button
            >
          </div>
        {:else if $requiresDaemonAuth$}
          <div class="daemon-auth-required">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            <p class="text-foreground">
              {m.lib_githubAuth_daemonAuthIntegration_message()}
            </p>
            <p class="text-subtle text-sm mt-2">
              <!-- i18n-ignore (shell command) -->
              {m.lib_githubAuth_run_before()} <code class="bg-muted px-2 py-1 rounded">auggie login</code> {m.lib_githubAuth_inYourTerminal_after()}
            </p>
          </div>
        {:else if $deviceFlow$}
          <div class="oauth-redirect">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            <p class="text-foreground mb-4">
              {m.lib_githubAuth_enterCodeConnect_message()}
            </p>
            <GitHubDeviceCodeCard
              userCode={$deviceFlow$.userCode}
              verificationUri={$deviceFlow$.verificationUri}
            />
            <div class="flex items-center justify-center gap-2 mt-4 text-subtle text-sm">
              <div
                class="w-4 h-4 border-[2px] border-border border-t-blue-600 rounded-full animate-spin"
              ></div>
              <span>{m.lib_githubAuth_waitingForAuthorization_label()}</span>
            </div>
          </div>
        {:else if $isAuthenticating$}
          <div class="loading">
            <div
              class="w-6 h-6 border-[3px] border-border border-t-blue-600 rounded-full animate-spin mx-auto"
            ></div>
            <p class="text-foreground">{m.lib_githubAuth_startingAuthentication_label()}</p>
          </div>
        {:else}
          <div class="connect-prompt">
            <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
            <p class="text-foreground">
              {m.lib_githubAuth_connectPrompt_message()}
            </p>
            <p class="text-subtle text-sm mt-2">
              {m.lib_githubAuth_localCredentials_message()}
            </p>
            <button
              class="bg-[#238636] text-white border-none px-6 py-3 rounded text-base cursor-pointer mt-4 hover:bg-[#2ea043]"
              onclick={handleConnect}
            >
              {m.lib_githubAuth_connect_label()}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
