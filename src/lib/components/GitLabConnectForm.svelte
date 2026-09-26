<script lang="ts">
  /**
   * GitLab connect form shared by onboarding and Settings → Connections:
   * instance host input, then the daemon-owned device grant
   * (`sourceControl.connect { provider: "gitlab", method: "device" }`) when the
   * host supports it, or a personal-access-token paste
   * (`method: "pat"`) otherwise. Every dispatch carries the host the user
   * entered; the token goes straight to the daemon and is never kept in state.
   */
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { DEFAULT_GITLAB_HOST } from '$features/forge-auth/constants';
  import { gitlabPersonalAccessTokenUrl, normalizeGitLabHost } from '$lib/utils/gitlab-host';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    cancelGitLabAuth,
    checkGitLabAuthStatus,
    connectGitLabWithToken,
    initializeGitLabAuth,
    startGitLabDeviceAuth,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import {
    selectGitLabAuthDeviceFlow,
    selectGitLabAuthDeviceGrantSupported,
    selectGitLabAuthError,
    selectGitLabAuthHost,
    selectGitLabAuthIsAuthenticating,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';

  interface Props {
    /** Tighter layout for the Settings row. */
    compact?: boolean;
    /** Shown as a Cancel action while idle (Settings closes the form with it). */
    onCancel?: () => void;
  }

  let { compact = false, onCancel }: Props = $props();

  const uid = $props.id();
  const hostInputId = `${uid}-host`;
  const tokenInputId = `${uid}-token`;

  const host$ = selectGitLabAuthHost();
  const isAuthenticating$ = selectGitLabAuthIsAuthenticating();
  const deviceFlow$ = selectGitLabAuthDeviceFlow();
  const deviceGrantSupported$ = selectGitLabAuthDeviceGrantSupported();
  const error$ = selectGitLabAuthError();

  let hostDraft = $state(selectGitLabAuthHost.select(appStore.state));
  let tokenDraft = $state('');
  let preferToken = $state(false);

  const host = $derived(normalizeGitLabHost(hostDraft) || DEFAULT_GITLAB_HOST);
  // Device-grant support is only known for the host the daemon last reported
  // (`null` until `initializeGitLabAuth()` has hydrated it); an unreported host
  // is attempted with the device grant first and the saga falls back
  // (`device-grant-unsupported`) when the instance refuses it.
  const showTokenField = $derived(
    preferToken || (host === $host$ && $deviceGrantSupported$ === false),
  );
  const tokenPageUrl = $derived(gitlabPersonalAccessTokenUrl(host));
  const canSubmitToken = $derived(tokenDraft.trim().length > 0);

  onMount(() => {
    const handleFocus = () => {
      const state = appStore.state;
      if (
        selectGitLabAuthIsAuthenticating.select(state) &&
        selectGitLabAuthDeviceFlow.select(state)
      ) {
        appStore.dispatch(checkGitLabAuthStatus());
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  });

  function handleHostCommit() {
    if (host === $host$ || $isAuthenticating$) return;
    appStore.dispatch(initializeGitLabAuth(host));
  }

  function handleStartDevice() {
    appStore.dispatch(startGitLabDeviceAuth(host));
  }

  function handleConnectToken() {
    const token = tokenDraft.trim();
    if (!token) return;
    appStore.dispatch(connectGitLabWithToken(host, token));
    tokenDraft = '';
  }

  function handleUseToken() {
    if ($isAuthenticating$) appStore.dispatch(cancelGitLabAuth());
    preferToken = true;
  }

  function handleUseDevice() {
    preferToken = false;
  }

  function handleCancelDeviceFlow() {
    appStore.dispatch(cancelGitLabAuth());
  }

  function handleOpenTokenPage() {
    void handleLink(tokenPageUrl, {});
  }

  function handleHostKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleHostCommit();
    if (showTokenField) document.getElementById(tokenInputId)?.focus();
    else handleStartDevice();
  }

  function handleTokenKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConnectToken();
    }
  }

  const primarySize = $derived(compact ? 'sm' : 'xl');
  const secondarySize = $derived(compact ? 'sm' : 'default');
</script>

<div class={compact ? 'space-y-2' : 'space-y-4'} data-testid="gitlab-connect-form">
  {#if $isAuthenticating$ && $deviceFlow$}
    <div class="max-w-sm space-y-3" data-testid="gitlab-connect-device-flow">
      <GitHubDeviceCodeCard
        userCode={$deviceFlow$.userCode}
        verificationUri={$deviceFlow$.verificationUri}
        openLabel={m.lib_gitlabConnect_openGitlab_label()}
        {compact}
      />
      <div class="flex flex-wrap items-center gap-2 text-subtle text-sm">
        <IntentMarkLoader size={16} class="shrink-0" />
        <span>{m.lib_gitlabConnect_waitingForAuthorization_label()}</span>
        <Button variant="link" size="sm" type="button" class="px-0" onclick={handleUseToken}>
          {m.lib_gitlabConnect_useToken_label()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="text-muted-foreground hover:text-foreground"
          onclick={handleCancelDeviceFlow}
        >
          {m.lib_gitlabConnect_cancel_label()}
        </Button>
      </div>
    </div>
  {:else if $isAuthenticating$}
    <div class="flex items-center gap-2 text-subtle text-sm">
      <IntentMarkLoader size={16} class="shrink-0" />
      <span>{m.lib_gitlabConnect_connecting_label()}</span>
    </div>
  {:else}
    <div class="max-w-sm space-y-1">
      <Label for={hostInputId}>{m.lib_gitlabConnect_host_label()}</Label>
      <Input
        id={hostInputId}
        type="text"
        autocomplete="url"
        spellcheck={false}
        bind:value={hostDraft}
        placeholder={DEFAULT_GITLAB_HOST}
        onchange={handleHostCommit}
        onkeydown={handleHostKeydown}
      />
      <p class="text-xs text-subtle">{m.lib_gitlabConnect_host_description()}</p>
    </div>
    {#if showTokenField}
      <div class="max-w-sm space-y-1" data-testid="gitlab-connect-token">
        <Label for={tokenInputId}>{m.lib_gitlabConnect_token_label()}</Label>
        <Input
          id={tokenInputId}
          type="password"
          autocomplete="off"
          bind:value={tokenDraft}
          placeholder={/* i18n-ignore (credential format example) */ 'glpat-...'}
          onkeydown={handleTokenKeydown}
        />
        <p class="text-xs text-subtle">
          {m.lib_gitlabConnect_token_description()}
          <Button
            variant="link"
            size="sm"
            type="button"
            class="h-auto px-0 text-xs"
            onclick={handleOpenTokenPage}
          >
            {m.lib_gitlabConnect_createToken_label({ host })}
          </Button>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size={primarySize}
          type="button"
          onclick={handleConnectToken}
          disabled={!canSubmitToken}
        >
          {m.lib_gitlabConnect_connect_label()}
        </Button>
        {#if preferToken && $deviceGrantSupported$ !== false}
          <Button variant="ghost" size={secondarySize} type="button" onclick={handleUseDevice}>
            {m.lib_gitlabConnect_useDevice_label()}
          </Button>
        {/if}
        {#if onCancel}
          <Button variant="ghost" size={secondarySize} type="button" onclick={onCancel}>
            {m.lib_gitlabConnect_cancel_label()}
          </Button>
        {/if}
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="primary" size={primarySize} type="button" onclick={handleStartDevice}>
          {m.lib_gitlabConnect_connect_label()}
        </Button>
        <Button variant="ghost" size={secondarySize} type="button" onclick={handleUseToken}>
          {m.lib_gitlabConnect_useToken_label()}
        </Button>
        {#if onCancel}
          <Button variant="ghost" size={secondarySize} type="button" onclick={onCancel}>
            {m.lib_gitlabConnect_cancel_label()}
          </Button>
        {/if}
      </div>
    {/if}
  {/if}

  {#if $error$}
    <p class="text-sm text-danger" role="alert">{$error$}</p>
  {/if}
</div>
