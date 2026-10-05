<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import { onDestroy, onMount } from 'svelte';
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

  // i18n-ignore (shell command)
  const GITHUB_LOGIN_COMMAND = 'auggie login';

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
  <ContentDialog
    {open}
    title={m.lib_githubAuth_connect_label()}
    closeLabel={m.lib_githubAuth_closeModal_ariaLabel()}
    onClose={handleCancel}
  >
    <div class="space-y-4 type-body">
      {#if $error$}
        <div class="text-danger">
          <p>{$error$}</p>
        </div>
      {:else if $requiresDaemonAuth$}
        <div class="daemon-auth-required">
          <GitHubIcon size={48} class="block mx-auto mb-4 text-foreground" />
          <p class="text-foreground">
            {m.lib_githubAuth_daemonAuthIntegration_message()}
          </p>
          <p class="text-subtle text-sm mt-2">
            {m.lib_githubAuth_run_before()}
            <code class="bg-muted px-2 py-1 rounded">{GITHUB_LOGIN_COMMAND}</code>
            {m.lib_githubAuth_inYourTerminal_after()}
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
            <IntentMarkLoader size={16} />
            <span>{m.lib_githubAuth_waitingForAuthorization_label()}</span>
          </div>
        </div>
      {:else if $isAuthenticating$}
        <div class="flex items-center gap-3 py-2">
          <IntentMarkLoader size={24} class="text-subtle" />
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
        </div>
      {/if}
    </div>
    {#snippet footer()}
      <Button variant="ghost" onclick={handleCancel}
        >{m.modals_bulkActionConfirm_cancel_label()}</Button
      >
      {#if $error$}<Button variant="primary" onclick={handleRetry}
          >{m.lib_githubAuth_tryAgain_label()}</Button
        >
      {:else if !$requiresDaemonAuth$ && !$deviceFlow$ && !$isAuthenticating$}
        <Button variant="primary" onclick={handleConnect}>{m.lib_githubAuth_connect_label()}</Button
        >
      {/if}
    {/snippet}
  </ContentDialog>
{/if}
