<script lang="ts">
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { logoutGitLab } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import {
    selectGitLabAuthError,
    selectGitLabAuthHost,
    selectGitLabAuthIsAuthenticating,
    selectGitLabAuthIsConfigured,
    selectGitLabAuthUser,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectDaemonSupportsSourceControlAuth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import GitLabConnectForm from '$lib/components/GitLabConnectForm.svelte';

  let isDisconnecting = $state(false);
  let showConnectForm = $state(false);

  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const host$ = selectGitLabAuthHost();
  const isConfigured$ = selectGitLabAuthIsConfigured();
  const isAuthenticating$ = selectGitLabAuthIsAuthenticating();
  const user$ = selectGitLabAuthUser();
  const error$ = selectGitLabAuthError();
  // The connected daemon must serve the `sourceControl.*` auth methods; an
  // older one renders a "daemon too old" note in place of the connect entry.
  const daemonSupported$ = selectDaemonSupportsSourceControlAuth();

  // The form stays open while a connect is in flight (the daemon may have
  // resumed a pending device grant before the user clicked anything).
  const formOpen = $derived(
    $gitlabEnabled$ &&
      $daemonSupported$ &&
      !$isConfigured$ &&
      (showConnectForm || $isAuthenticating$),
  );

  $effect(() => {
    if (!$gitlabEnabled$) showConnectForm = false;
  });

  function handleShowConnectForm() {
    if (!selectLabsGitLabEnabled.select(appStore.state)) return;
    showConnectForm = true;
  }

  function handleHideConnectForm() {
    showConnectForm = false;
  }

  function handleDisconnect() {
    isDisconnecting = true;
    showConnectForm = false;
    // Revokes the credential stored for the connection's host (state.host).
    appStore.dispatch(logoutGitLab());
    // The saga handles the async revoke; reset local UI state shortly after.
    setTimeout(() => {
      isDisconnecting = false;
    }, 500);
  }
</script>

{#if $gitlabEnabled$ || $isConfigured$}
  <div class="py-3">
    <div class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
      <div class="flex size-4 items-center justify-center text-ghost">
        <Fa icon={faGitlab} class="size-4" />
      </div>
      <div class="flex min-w-0 items-center gap-3">
        <!-- i18n-ignore (brand name) -->
        <span class="type-body font-medium text-foreground">GitLab</span>
        {#if $isConfigured$}
          <span class="type-body flex min-w-0 items-center gap-1 text-muted-foreground">
            <Fa icon={faCheck} class="size-3 text-success" />
            {#if $user$}
              @{$user$.login}
            {:else}
              {m.settings_connections_connected()}
            {/if}
          </span>
          <span
            class="type-body truncate text-muted-foreground"
            data-testid="gitlab-connection-host">{$host$}</span
          >
        {/if}
      </div>

      <div class="flex h-[22px] items-center gap-3 self-start">
        {#if !$daemonSupported$}
          <span
            class="type-body text-muted-foreground"
            data-testid="gitlab-connection-daemon-too-old"
            >{m.settings_connections_gitlab_daemonTooOld_label()}</span
          >
        {:else if $gitlabEnabled$ && $isAuthenticating$}
          <span class="type-body text-muted-foreground"
            >{m.settings_connections_gitlab_waitingForAuthorization()}</span
          >
        {:else if $isConfigured$}
          <Button
            variant="link"
            size="sm"
            type="button"
            class="h-[22px] px-0"
            onclick={handleDisconnect}
            disabled={isDisconnecting}
          >
            {isDisconnecting
              ? m.settings_connections_disconnecting()
              : m.settings_connections_disconnect()}
          </Button>
        {:else if !showConnectForm}
          <Button
            variant="link"
            size="sm"
            type="button"
            class="h-[22px] px-0"
            onclick={handleShowConnectForm}
          >
            {m.settings_connections_connect()}
          </Button>
        {/if}
      </div>
      <p class="type-body col-start-2 text-muted-foreground">
        {#if $daemonSupported$}
          {m.settings_connections_gitlab_description()}
        {:else}
          {m.settings_connections_gitlab_daemonTooOld_description()}
        {/if}
      </p>
      {#if $error$ && !formOpen}
        <p class="type-body col-start-2 text-danger">{$error$}</p>
      {/if}
    </div>

    {#if formOpen}
      <div class="mt-2 grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
        <div></div>
        <div class="max-w-md">
          <GitLabConnectForm compact onCancel={handleHideConnectForm} />
        </div>
      </div>
    {/if}
  </div>
{/if}
