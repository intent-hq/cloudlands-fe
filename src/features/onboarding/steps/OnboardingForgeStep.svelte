<script lang="ts">
  /**
   * Onboarding step: connect a forge. GitHub keeps the daemon-owned device
   * flow (PROTOCOL §5.27) the github-auth slice drives; GitLab takes an
   * instance host and goes through the shared GitLabConnectForm (device grant
   * when the host supports it, personal access token otherwise). The step is
   * optional: "Skip for now" advances without connecting, and Settings remains
   * the later entry point. The GitLab option is offered only once the daemon
   * has reported a protocol that serves the `sourceControl.*` auth methods.
   */
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
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
  import {
    initializeGitLabAuth,
    cancelGitLabAuth,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import {
    selectGitLabAuthHost,
    selectGitLabAuthIsAuthenticating,
    selectGitLabAuthIsConfigured,
    selectGitLabAuthUser,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectDaemonSupportsSourceControlAuth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import GitLabConnectForm from '$lib/components/GitLabConnectForm.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';

  interface Props {
    /** Advance to the next onboarding step (Continue when connected). */
    onContinue: () => void;
    /** Advance without connecting — a forge stays optional. */
    onSkip: () => void;
  }

  let { onContinue, onSkip }: Props = $props();

  type ForgeChoice = 'github' | 'gitlab';
  let choice = $state<ForgeChoice | null>(null);

  const githubIsAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const githubIsAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const githubDeviceFlow$ = selectGitHubAuthDeviceFlow();
  const githubUser$ = selectGitHubAuthUser();
  const githubError$ = selectGitHubAuthError();
  const githubRequiresDaemonAuth$ = selectGitHubAuthRequiresDaemonAuth();

  const gitlabIsConfigured$ = selectGitLabAuthIsConfigured();
  const gitlabIsAuthenticating$ = selectGitLabAuthIsAuthenticating();
  const gitlabUser$ = selectGitLabAuthUser();
  const gitlabHost$ = selectGitLabAuthHost();
  const gitlabSupported$ = selectDaemonSupportsSourceControlAuth();
  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const gitlabSetupAvailable = $derived($gitlabEnabled$ && $gitlabSupported$);

  const anyConnected = $derived($githubIsAuthenticated$ || $gitlabIsConfigured$);
  // A flow in progress opens its panel even before the user re-picks it (e.g.
  // a pending device grant resumed by the initialize hydration) and the panel
  // stays open once the flow ends, so cancelling into the PAT fallback does not
  // bounce back to the chooser. The GitLab panel is never resumed or kept open
  // on a daemon that does not serve its auth methods.
  $effect(() => {
    if (!gitlabSetupAvailable && choice === 'gitlab') choice = null;
    if (choice !== null) return;
    if ($githubIsAuthenticating$) choice = 'github';
    else if ($gitlabIsAuthenticating$ && gitlabSetupAvailable) choice = 'gitlab';
  });
  const activeChoice = $derived.by<ForgeChoice | null>(() => {
    const resolved =
      choice ?? ($githubIsAuthenticating$ ? 'github' : $gitlabIsAuthenticating$ ? 'gitlab' : null);
    return resolved === 'gitlab' && !gitlabSetupAvailable ? null : resolved;
  });

  onMount(() => {
    // Hydrate both forges so an already-resolved credential renders as
    // connected instead of forcing a reconnect, and a still-pending device
    // grant is resumed.
    appStore.dispatch(initializeGitHubAuth());
    appStore.dispatch(initializeGitLabAuth());

    // Check GitHub auth status immediately when the window gains focus so the
    // UI updates snappily when the user returns from the browser (the GitLab
    // form owns its own focus check).
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

  function handleChooseGitHub() {
    choice = 'github';
    appStore.dispatch(startGitHubAuth());
  }

  function handleChooseGitLab() {
    if (!selectLabsGitLabEnabled.select(appStore.state)) return;
    choice = 'gitlab';
  }

  function handleBackToChoices() {
    choice = null;
  }

  function handleGitHubCancel() {
    appStore.dispatch(cancelGitHubAuth());
  }

  function cancelPendingFlows() {
    // Skipping abandons a still-pending flow — cancel it so it doesn't keep
    // polling in the background and resurface in Settings.
    const state = appStore.state;
    if (selectGitHubAuthIsAuthenticating.select(state)) {
      appStore.dispatch(cancelGitHubAuth());
    }
    if (selectGitLabAuthIsAuthenticating.select(state)) {
      appStore.dispatch(cancelGitLabAuth());
    }
  }

  function handleSkip() {
    cancelPendingFlows();
    onSkip();
  }
</script>

<div class="space-y-6">
  {#if anyConnected}
    <div class="space-y-2 text-base" data-testid="forge-step-connected">
      {#if $githubIsAuthenticated$}
        <div class="flex items-center gap-3">
          <Fa icon={faGithub} class="text-foreground" />
          <span class="flex items-center gap-2">
            <Fa icon={faCheck} class="text-success" />
            {#if $githubUser$}
              <!-- i18n-ignore (brand name) -->
              {m.onboarding_forgeStep_connectedAs_label({
                provider: 'GitHub',
                username: `@${$githubUser$.login}`,
              })}
            {:else}
              <!-- i18n-ignore (brand name) -->
              {m.onboarding_forgeStep_connected_label({ provider: 'GitHub' })}
            {/if}
          </span>
        </div>
      {/if}
      {#if $gitlabIsConfigured$}
        <div class="flex items-center gap-3">
          <Fa icon={faGitlab} class="text-foreground" />
          <span class="flex items-center gap-2">
            <Fa icon={faCheck} class="text-success" />
            {#if $gitlabUser$}
              <!-- i18n-ignore (brand name) -->
              {m.onboarding_forgeStep_connectedAs_label({
                provider: 'GitLab',
                username: `@${$gitlabUser$.login}`,
              })}
            {:else}
              <!-- i18n-ignore (brand name) -->
              {m.onboarding_forgeStep_connected_label({ provider: 'GitLab' })}
            {/if}
            <span class="text-subtle text-sm">{$gitlabHost$}</span>
          </span>
        </div>
      {/if}
    </div>
  {:else if activeChoice === 'github'}
    <div class="space-y-4" data-testid="forge-step-github">
      {#if $githubIsAuthenticating$ && $githubDeviceFlow$}
        <div class="max-w-sm space-y-3" data-testid="github-step-device-flow">
          <GitHubDeviceCodeCard
            userCode={$githubDeviceFlow$.userCode}
            verificationUri={$githubDeviceFlow$.verificationUri}
          />
          <div class="flex items-center gap-2 text-subtle text-sm">
            <IntentMarkLoader size={16} class="shrink-0" />
            <span>{m.onboarding_forgeStep_waitingForAuthorization_label()}</span>
            <Button
              variant="ghost"
              type="button"
              class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors ml-2"
              onclick={handleGitHubCancel}
            >
              {m.onboarding_forgeStep_cancel_label()}
            </Button>
          </div>
        </div>
      {:else if $githubIsAuthenticating$}
        <div class="flex items-center gap-2 text-subtle text-sm">
          <IntentMarkLoader size={16} class="shrink-0" />
          <span>{m.onboarding_forgeStep_startingAuthentication_label()}</span>
        </div>
      {:else if $githubRequiresDaemonAuth$}
        <p class="text-sm text-subtle">{m.onboarding_forgeStep_requiresDaemonAuth_label()}</p>
      {:else}
        <Button class="group/button" size="xl" variant="primary" onclick={handleChooseGitHub}>
          <Fa icon={faGithub} />
          {m.onboarding_forgeStep_connectGithub_label()}
        </Button>
      {/if}
      {#if $githubError$}
        <p class="text-sm text-danger" role="alert">{$githubError$}</p>
      {/if}
      {#if !$githubIsAuthenticating$}
        <Button variant="ghost" type="button" onclick={handleBackToChoices}>
          {m.onboarding_forgeStep_chooseDifferent_label()}
        </Button>
      {/if}
    </div>
  {:else if activeChoice === 'gitlab'}
    <div class="space-y-4" data-testid="forge-step-gitlab">
      <p class="max-w-lg text-sm text-muted-foreground">
        {m.onboarding_forgeStep_gitlabScope_description()}
      </p>
      <GitLabConnectForm />
      {#if !$gitlabIsAuthenticating$}
        <Button variant="ghost" type="button" onclick={handleBackToChoices}>
          {m.onboarding_forgeStep_chooseDifferent_label()}
        </Button>
      {/if}
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-3" data-testid="forge-step-choices">
      {#if $githubRequiresDaemonAuth$}
        <p class="text-sm text-subtle">{m.onboarding_forgeStep_requiresDaemonAuth_label()}</p>
      {:else}
        <Button class="group/button" size="xl" variant="primary" onclick={handleChooseGitHub}>
          <Fa icon={faGithub} />
          {m.onboarding_forgeStep_connectGithub_label()}
        </Button>
      {/if}
      {#if gitlabSetupAvailable}
        <Button class="group/button" size="xl" variant="outline" onclick={handleChooseGitLab}>
          <Fa icon={faGitlab} />
          {m.onboarding_forgeStep_connectGitlab_label()}
        </Button>
      {/if}
    </div>
    {#if $githubError$}
      <p class="text-sm text-danger" role="alert">{$githubError$}</p>
    {/if}
  {/if}

  <div class="flex flex-col items-start gap-2 mt-9">
    {#if anyConnected}
      <Button class="group/button" size="xl" variant="primary" onclick={onContinue}>
        {m.onboarding_forgeStep_continue_label()}
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
    {:else}
      <Button class="group/button" size="xl" variant="outline" onclick={handleSkip}>
        {m.onboarding_forgeStep_skipForNow_label()}
        <span class="ml-1 opacity-50">⌘↵</span>
      </Button>
      <p class="text-xs text-muted-foreground">
        {m.onboarding_forgeStep_connectLater_description()}
      </p>
    {/if}
  </div>
</div>
