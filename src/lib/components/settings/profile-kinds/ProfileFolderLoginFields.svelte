<script lang="ts">
  /**
   * Body of the Different-login screens (add + edit, both providers). Edit
   * groups the sign-in status with its action; the folder path (and, on add,
   * the login command) sit in a collapsed details section. Presentational only.
   */
  import {
    faCheck,
    faChevronRight,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import {
    Button,
    CopyButton,
    IntentMarkLoader,
  } from '$lib/components/patterns/settings/custom-controls';
  import type { ProviderProfileStatus } from '$store/renderer/slices/provider-settings/provider-settings-types';
  import type { ProfileKindProvider } from './profile-kind-mock';

  interface Props {
    provider: ProfileKindProvider;
    mode: 'add' | 'edit';
    /** Add: the live preview path. Edit: the folder saved on the profile. */
    folderPath: string;
    /** The plain command Create & sign in runs (add mode). */
    command: string;
    disabled?: boolean;
    /** Add mode after the profile was saved (a sign-in failure with Try again). */
    started?: boolean;
    /** Edit: the row's last sign-in check (absent when unknown). */
    signInStatus?: ProviderProfileStatus;
    /** Edit: the signed-in account, when the check reported one. */
    email?: string;
    /** Edit mode sign-in action (Log In, or Sign in with ChatGPT for Codex). */
    onSignIn?: () => void;
    detailsOpen?: boolean;
  }

  let {
    provider,
    mode,
    folderPath,
    command,
    disabled = false,
    started = false,
    signInStatus,
    email,
    onSignIn,
    detailsOpen = $bindable(false),
  }: Props = $props();

  const statusText = $derived.by(() => {
    switch (signInStatus) {
      case 'checking':
        return m.settings_providerProfiles_statusChecking_label();
      case 'ready':
        return email
          ? m.settings_providerProfileKinds_signedInAs_label({ email })
          : m.settings_providerProfileKinds_signedIn_label();
      case 'error':
        return m.settings_providerProfileKinds_signedOut_label();
      default:
        return m.settings_providerProfileKinds_signInNotChecked_label();
    }
  });
</script>

<div class="space-y-3" data-testid="provider-profile-folder-login">
  {#if mode === 'edit'}
    <section
      class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      data-testid="provider-profile-sign-in-actions"
    >
      <span
        role="status"
        class="flex min-w-0 items-center gap-2 type-body {signInStatus === 'error'
          ? 'text-warning-ink'
          : 'text-foreground'}"
        data-profile-status={signInStatus ?? 'configured'}
      >
        {#if signInStatus === 'checking'}
          <IntentMarkLoader size={12} class="shrink-0" />
        {:else if signInStatus === 'ready'}
          <Fa icon={faCheck} class="size-3 shrink-0 text-success" />
        {:else if signInStatus === 'error'}
          <Fa icon={faTriangleExclamation} class="size-3 shrink-0" />
        {/if}
        <span class="truncate" title={email}>{statusText}</span>
      </span>
      <Button variant="outline" size="sm" {disabled} onclick={() => onSignIn?.()}>
        {provider === 'codex'
          ? m.settings_providerProfileKinds_signInChatGpt_label()
          : m.settings_providerProfileKinds_logIn_label()}
      </Button>
    </section>
  {:else}
    <p
      class="flex items-start gap-2 type-caption text-muted-foreground"
      data-testid="provider-profile-starts-fresh"
    >
      <Fa icon={faTriangleExclamation} class="mt-0.5 size-3 shrink-0 text-warning-ink" />
      <span>
        {provider === 'codex'
          ? m.settings_providerProfileKinds_startsFreshCodex_description()
          : m.settings_providerProfileKinds_startsFreshClaude_description()}
      </span>
    </p>
  {/if}

  <details class="group" bind:open={detailsOpen} data-testid="provider-profile-folder">
    <summary
      class="inline-flex cursor-pointer list-none items-center gap-2 type-caption text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
    >
      <Fa icon={faChevronRight} class="size-2.5 transition-transform group-open:rotate-90" />
      {m.settings_providerProfileKinds_folder_label()}
    </summary>
    <div class="mt-2 space-y-1.5 pl-[18px]">
      <div class="flex min-w-0 items-center gap-1">
        <code
          class="min-w-0 break-all font-mono type-caption text-foreground"
          data-testid="provider-profile-folder-path">{folderPath}</code
        >
        {#if mode === 'edit'}
          <CopyButton text={folderPath} size="sm" />
        {/if}
      </div>
      {#if mode === 'add' && !started}
        <p class="type-caption text-muted-foreground">
          {m.settings_providerProfileKinds_createRuns_label()}
          <code class="font-mono text-foreground">{command}</code>
        </p>
      {/if}
    </div>
  </details>
</div>
