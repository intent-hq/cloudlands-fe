<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { store as appStore } from '$store/renderer/store';
  import { antigravitySetupRequested } from '$store/renderer/slices/antigravity-setup/antigravity-setup-slice';
  import {
    selectAntigravitySetup,
    selectAntigravitySetupPolicy,
  } from '$store/renderer/slices/antigravity-setup/antigravity-setup-selectors';
  let { open = $bindable(false) }: { open?: boolean } = $props();
  const setup$ = selectAntigravitySetup();
  const policy$ = selectAntigravitySetupPolicy();
  const status = $derived($setup$.result?.ok ? $setup$.result.status : null);
  const errorCode = $derived(
    $setup$.result && !$setup$.result.ok
      ? $setup$.result.code
      : status?.phase === 'failed'
        ? status.code
        : status?.phase === 'connected' && !$policy$.connected && !$setup$.busy
          ? 'modelsUnavailable'
          : null,
  );
  const limited = $derived(
    errorCode === 'remoteHost' || errorCode === 'unsupportedHost' || errorCode === 'updateRequired',
  );

  onMount(() => {
    appStore.dispatch(antigravitySetupRequested('status'));
    return () => appStore.dispatch(antigravitySetupRequested('close'));
  });

  function connect() {
    if ($setup$.busy || limited || $policy$.connected) return;
    appStore.dispatch(
      antigravitySetupRequested(status?.phase === 'signInRequired' ? 'login' : 'start'),
    );
  }

  function cancel() {
    if ($setup$.busy || status?.phase === 'signInRequired') {
      appStore.dispatch(antigravitySetupRequested('cancel'));
    }
    open = false;
  }

  function failureText(code: string): string {
    switch (code) {
      case 'remoteHost':
        return m.antigravity_setup_remote_description();
      case 'unsupportedHost':
        return m.antigravity_setup_unsupported_description();
      case 'updateRequired':
        return m.antigravity_setup_update_description();
      case 'invalidCustomPath':
        return m.antigravity_setup_customPath_error();
      case 'downloadFailed':
        return m.antigravity_setup_download_error();
      case 'invalidArchive':
      case 'integrityFailed':
      case 'signatureFailed':
        return m.antigravity_setup_integrity_error();
      case 'diskError':
        return m.antigravity_setup_disk_error();
      case 'authenticationCheckFailed':
      case 'signInFailed':
      case 'browserUnavailable':
        return m.antigravity_setup_signIn_error();
      case 'modelsUnavailable':
        return m.antigravity_setup_models_error();
      default:
        return m.antigravity_setup_connection_error();
    }
  }
</script>

<FormDialog
  bind:open
  title={m.antigravity_setup_connect_label()}
  canSubmit={!$setup$.busy && !limited && !$policy$.connected}
  onSubmit={connect}
  onCancel={cancel}
>
  <div class="space-y-2 type-body text-muted-foreground">
    <div role="status" aria-live="polite">
      {#if errorCode}
        <p>{failureText(errorCode)}</p>
      {:else if $policy$.connected}
        <p>{m.antigravity_setup_connected_description()}</p>
      {:else if status?.phase === 'signInRequired'}
        <p>{m.antigravity_setup_signIn_description()}</p>
      {:else if status?.phase === 'signingIn'}
        <p>{m.antigravity_setup_signingIn_description()}</p>
      {:else if status?.phase === 'downloading'}
        <p>{m.antigravity_setup_downloading_description()}</p>
        <progress
          class="mt-2 w-full"
          value={status.received}
          max={status.total}
          aria-label={m.antigravity_setup_downloading_description()}
        ></progress>
      {:else if status?.phase === 'verifying'}
        <p>{m.antigravity_setup_verifying_description()}</p>
      {:else if $setup$.busy}
        <p>{m.antigravity_setup_checking_description()}</p>
      {:else if status?.phase === 'cancelled'}
        <p>{m.antigravity_setup_cancelled_description()}</p>
      {:else}
        {#if status?.cliDetected}<p>{m.antigravity_setup_cliFound_description()}</p>{/if}
        <p>
          {status?.runtimeInstalled
            ? m.antigravity_setup_existing_description()
            : m.antigravity_setup_download_description()}
        </p>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <Button variant="ghost-light" onclick={cancel}
      >{$policy$.connected || limited
        ? m.ui_dialog_close_ariaLabel()
        : m.antigravity_setup_cancel_label()}</Button
    >
    {#if !$setup$.busy && !limited && !$policy$.connected}
      <Button type="submit"
        >{status?.phase === 'signInRequired'
          ? m.antigravity_setup_signIn_label()
          : errorCode || status?.phase === 'cancelled'
            ? m.settings_providers_tryAgain()
            : m.antigravity_setup_connect_label()}</Button
      >
    {/if}
  {/snippet}
</FormDialog>
