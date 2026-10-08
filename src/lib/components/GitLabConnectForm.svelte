<script lang="ts">
  /**
   * GitLab connect form shared by onboarding and Settings → Connections:
   * complete instance address, then the daemon-owned device grant
   * (`sourceControl.connect { provider: "gitlab", method: "device" }`) when the
   * host supports it, or a personal-access-token paste
   * (`method: "pat"`) otherwise. Every dispatch carries the full instance the user
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
  import { gitlabPersonalAccessTokenUrl, normalizeGitLabInstanceUrl } from '$lib/utils/gitlab-host';
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
    selectGitLabAuthInstanceBaseUrl,
    selectGitLabAuthIsAuthenticating,
    selectGitLabAuthIsCancelling,
    selectGitLabAuthCancelOutcome,
    selectGitLabInstanceSetupSupported,
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
  const hostHelpId = `${uid}-host-help`;
  const hostErrorId = `${uid}-host-error`;
  const tokenInputId = `${uid}-token`;

  const storedInstance$ = selectGitLabAuthInstanceBaseUrl();
  const isAuthenticating$ = selectGitLabAuthIsAuthenticating();
  const isCancelling$ = selectGitLabAuthIsCancelling();
  const cancelOutcome$ = selectGitLabAuthCancelOutcome();
  const deviceFlow$ = selectGitLabAuthDeviceFlow();
  const deviceGrantSupported$ = selectGitLabAuthDeviceGrantSupported();
  const error$ = selectGitLabAuthError();
  const instanceSetupSupported$ = selectGitLabInstanceSetupSupported();

  let hostDraft = $state(selectGitLabAuthInstanceBaseUrl.select(appStore.state));
  let instanceEdited = $state(false);
  let tokenDraft = $state('');
  let preferToken = $state(false);

  const instanceBaseUrl = $derived(normalizeGitLabInstanceUrl(hostDraft));
  // Device-grant support is only known for the full instance last reported
  // (`null` until `initializeGitLabAuth()` has hydrated it); an unreported host
  // is attempted with the device grant first and the saga falls back
  // (`device-grant-unsupported`) when the instance refuses it.
  const showTokenField = $derived(
    preferToken || (instanceBaseUrl === $storedInstance$ && $deviceGrantSupported$ === false),
  );
  const tokenPageUrl = $derived(
    instanceBaseUrl ? gitlabPersonalAccessTokenUrl(instanceBaseUrl) : null,
  );
  const canSubmitToken = $derived(
    $instanceSetupSupported$ && instanceBaseUrl !== null && tokenDraft.trim().length > 0,
  );

  $effect(() => {
    const instance = $storedInstance$;
    if (!instanceEdited) hostDraft = instance;
  });

  $effect(() => {
    if (!$instanceSetupSupported$) tokenDraft = '';
  });

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
    if (
      !$instanceSetupSupported$ ||
      !instanceBaseUrl ||
      instanceBaseUrl === $storedInstance$ ||
      $isAuthenticating$ ||
      $isCancelling$
    )
      return;
    appStore.dispatch(initializeGitLabAuth(instanceBaseUrl));
  }

  function handleInstanceInput() {
    instanceEdited = true;
    // A token entered for the previous address must not follow an edited target.
    tokenDraft = '';
  }

  function handleStartDevice() {
    if (!$instanceSetupSupported$ || !instanceBaseUrl || $isAuthenticating$ || $isCancelling$)
      return;
    appStore.dispatch(startGitLabDeviceAuth(instanceBaseUrl));
  }

  function handleConnectToken() {
    const token = tokenDraft.trim();
    if (
      !$instanceSetupSupported$ ||
      !token ||
      !instanceBaseUrl ||
      $isAuthenticating$ ||
      $isCancelling$
    )
      return;
    appStore.dispatch(connectGitLabWithToken(instanceBaseUrl, token));
    tokenDraft = '';
  }

  function handleUseToken() {
    if (!$instanceSetupSupported$ || $isCancelling$) return;
    if ($isAuthenticating$) appStore.dispatch(cancelGitLabAuth());
    preferToken = true;
  }

  function handleUseDevice() {
    preferToken = false;
  }

  function handleCancelPending() {
    if (!$isCancelling$) appStore.dispatch(cancelGitLabAuth());
  }

  function handleOpenTokenPage() {
    if (tokenPageUrl) void handleLink(tokenPageUrl, {});
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
  {#if !$instanceSetupSupported$}
    <p class="text-sm text-subtle" role="status" data-testid="gitlab-instance-update-required">
      {m.lib_gitlabConnect_updateRequired_description()}
    </p>
  {/if}
  {#snippet cancelPendingAction()}
    <Button
      variant="ghost"
      size="sm"
      type="button"
      class="text-muted-foreground hover:text-foreground"
      disabled={$isCancelling$}
      onclick={handleCancelPending}
    >
      {$isCancelling$ ? m.lib_gitlabConnect_cancelling_label() : m.lib_gitlabConnect_cancel_label()}
    </Button>
  {/snippet}
  {#if $isAuthenticating$ || $isCancelling$}
    <p class="break-all type-caption text-subtle" data-testid="gitlab-connect-instance">
      {$storedInstance$}
    </p>
  {/if}
  {#if ($isAuthenticating$ || $isCancelling$) && $deviceFlow$}
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
        <Button
          variant="link"
          size="sm"
          type="button"
          class="px-0"
          disabled={$isCancelling$ || !$instanceSetupSupported$}
          onclick={handleUseToken}
        >
          {m.lib_gitlabConnect_useToken_label()}
        </Button>
        {@render cancelPendingAction()}
      </div>
    </div>
  {:else if $isAuthenticating$ || $isCancelling$}
    <div class="flex flex-wrap items-center gap-2 text-subtle text-sm">
      <IntentMarkLoader size={16} class="shrink-0" />
      <span>{m.lib_gitlabConnect_connecting_label()}</span>
      {@render cancelPendingAction()}
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
        disabled={!$instanceSetupSupported$}
        aria-invalid={!instanceBaseUrl || undefined}
        aria-describedby={instanceBaseUrl ? hostHelpId : `${hostHelpId} ${hostErrorId}`}
        placeholder={DEFAULT_GITLAB_HOST}
        oninput={handleInstanceInput}
        onchange={handleHostCommit}
        onkeydown={handleHostKeydown}
      />
      <p id={hostHelpId} class="text-xs text-subtle">{m.lib_gitlabConnect_host_description()}</p>
      {#if !instanceBaseUrl}
        <p id={hostErrorId} class="text-xs text-danger" role="alert">
          {m.lib_gitlabConnect_invalidInstance_error()}
        </p>
      {/if}
    </div>
    {#if showTokenField}
      <div class="max-w-sm space-y-1" data-testid="gitlab-connect-token">
        <Label for={tokenInputId}>{m.lib_gitlabConnect_token_label()}</Label>
        <Input
          id={tokenInputId}
          type="password"
          autocomplete="off"
          bind:value={tokenDraft}
          disabled={!$instanceSetupSupported$}
          placeholder={/* i18n-ignore (credential format example) */ 'glpat-...'}
          onkeydown={handleTokenKeydown}
        />
        <p class="text-xs text-subtle">
          {m.lib_gitlabConnect_token_description()}
          {#if tokenPageUrl && instanceBaseUrl}
            <Button
              variant="link"
              size="sm"
              type="button"
              class="h-auto px-0 text-xs"
              onclick={handleOpenTokenPage}
            >
              {m.lib_gitlabConnect_createToken_label({ host: instanceBaseUrl })}
            </Button>
          {/if}
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
        {#if preferToken && !(instanceBaseUrl === $storedInstance$ && $deviceGrantSupported$ === false)}
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
        <Button
          variant="primary"
          size={primarySize}
          type="button"
          onclick={handleStartDevice}
          disabled={!instanceBaseUrl || !$instanceSetupSupported$}
        >
          {m.lib_gitlabConnect_connect_label()}
        </Button>
        <Button
          variant="ghost"
          size={secondarySize}
          type="button"
          disabled={!$instanceSetupSupported$}
          onclick={handleUseToken}
        >
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

  {#if $cancelOutcome$ === 'cancelled'}
    <p class="text-sm text-subtle" role="status">{m.lib_gitlabConnect_cancelled_label()}</p>
  {:else if $cancelOutcome$ === 'already-started' || $cancelOutcome$ === 'failed'}
    <div class="space-y-1">
      <p class="text-sm text-subtle" role="status">
        {$cancelOutcome$ === 'already-started'
          ? m.lib_gitlabConnect_alreadyStarted_description()
          : m.lib_gitlabConnect_cancelFailed_description()}
      </p>
      <Button
        variant="link"
        size="sm"
        type="button"
        class="px-0"
        disabled={$isCancelling$}
        onclick={() => appStore.dispatch(checkGitLabAuthStatus())}
      >
        {m.lib_gitlabConnect_checkStatus_label()}
      </Button>
    </div>
  {/if}

  {#if $error$}
    <p class="text-sm text-danger" role="alert">{$error$}</p>
  {/if}
</div>
