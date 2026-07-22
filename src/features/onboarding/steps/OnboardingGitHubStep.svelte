<script lang="ts">
  /**
   * Onboarding step: connect GitHub via the daemon-owned device flow
   * (PROTOCOL §5.27). Reuses the shared GitHubDeviceCodeCard and the
   * github-auth slice — this is the same flow Settings drives, framed for
   * first-run onboarding. The step is optional: "Skip for now" advances
   * without connecting, and Settings remains the later entry point.
   */
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import {
    initializeGitHubAuth,
    startGitHubAuth,
    cancelGitHubAuth,
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
  import { Button } from '$lib/components/ui/button';

  interface Props {
    /** Advance to the next onboarding step (Continue when connected). */
    onContinue: () => void;
    /** Advance without connecting — GitHub stays optional. */
    onSkip: () => void;
  }

  let { onContinue, onSkip }: Props = $props();

  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const deviceFlow$ = selectGitHubAuthDeviceFlow();
  const user$ = selectGitHubAuthUser();
  const error$ = selectGitHubAuthError();
  const requiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  onMount(() => {
    // Hydrate auth state so an already-resolved token (env, gh CLI, or a
    // stored device-flow token) renders as connected instead of forcing a
    // reconnect. Also resumes a still-pending device flow (§5.27).
    appStore.dispatch(initializeGitHubAuth());

    // Check auth status immediately when window gains focus so the UI
    // updates snappily when the user returns from the browser.
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

  function handleConnect() {
    appStore.dispatch(startGitHubAuth());
  }

  function handleCancel() {
    appStore.dispatch(cancelGitHubAuth());
  }

  function handleSkip() {
    // Skipping abandons a still-pending device flow — cancel it so it doesn't
    // keep polling in the background and resurface in Settings.
    if (selectGitHubAuthIsAuthenticating.select(appStore.state)) {
      appStore.dispatch(cancelGitHubAuth());
    }
    onSkip();
  }
</script>

<div class="space-y-6">
  {#if $isAuthenticated$}
    <div class="flex items-center gap-3 text-base" data-testid="github-step-connected">
      <Fa icon={faGithub} class="text-foreground" />
      <span class="flex items-center gap-2">
        <Fa icon={faCheck} class="text-green-500" />
        {#if $user$}
          Connected @{$user$.login}
        {:else}
          Connected
        {/if}
      </span>
    </div>
  {:else if $isAuthenticating$ && $deviceFlow$}
    <div class="max-w-sm space-y-3" data-testid="github-step-device-flow">
      <GitHubDeviceCodeCard
        userCode={$deviceFlow$.userCode}
        verificationUri={$deviceFlow$.verificationUri}
      />
      <div class="flex items-center gap-2 text-subtle text-sm">
        <div
          class="w-4 h-4 border-[2px] border-border border-t-blue-600 rounded-full animate-spin"
        ></div>
        <span>Waiting for authorization...</span>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors ml-2"
          onclick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  {:else if $isAuthenticating$}
    <div class="flex items-center gap-2 text-subtle text-sm">
      <div
        class="w-4 h-4 border-[2px] border-border border-t-blue-600 rounded-full animate-spin"
      ></div>
      <span>Starting authentication...</span>
    </div>
  {:else if $requiresDaemonAuth$}
    <p class="text-sm text-subtle">Requires daemon authentication.</p>
  {:else}
    <Button class="group/button" size="xl" onclick={handleConnect}>
      <Fa icon={faGithub} />
      Connect GitHub
    </Button>
  {/if}

  {#if $error$}
    <p class="text-sm text-destructive-foreground">{$error$}</p>
  {/if}

  <div class="flex flex-col items-start gap-2 mt-9">
    {#if $isAuthenticated$}
      <Button class="group/button" size="xl" onclick={onContinue}>
        Continue
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
    {:else}
      <Button class="group/button" size="xl" variant="outline" onclick={handleSkip}>
        Skip for now
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
      <p class="text-xs text-muted-foreground">You can connect GitHub later from Settings</p>
    {/if}
  </div>
</div>
