<script lang="ts">
  /**
   * Body of the Different-login screens (add + edit, both providers). Add
   * mode previews the `~/…` folder
   * that Create & sign in will make; edit mode shows the saved folder
   * read-only with the sign-in actions. Presentational only.
   */
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Button, CopyButton, Input } from '$lib/components/patterns/settings/custom-controls';
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
    /** Edit mode sign-in action (Log In, or Sign in with ChatGPT for Codex). */
    onSignIn?: () => void;
  }

  let {
    provider,
    mode,
    folderPath,
    command,
    disabled = false,
    started = false,
    onSignIn,
  }: Props = $props();
</script>

<div class="space-y-5" data-testid="provider-profile-folder-login">
  <section class="space-y-2" data-testid="provider-profile-folder">
    <p class="type-body text-foreground">{m.settings_providerProfileKinds_folder_label()}</p>
    {#if mode === 'edit'}
      <div class="flex items-center gap-2">
        <Input
          value={folderPath}
          readonly
          class="font-mono"
          aria-label={m.settings_providerProfileKinds_folder_label()}
          data-testid="provider-profile-folder-path"
        />
        <CopyButton text={folderPath} size="sm" />
      </div>
      <p class="type-caption text-muted-foreground">
        {m.settings_providerProfileKinds_folderEdit_description()}
      </p>
    {:else}
      <p
        class="type-body break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-foreground"
        data-testid="provider-profile-folder-path"
      >
        {folderPath}
      </p>
      <p class="type-caption text-muted-foreground">
        {m.settings_providerProfileKinds_folderNew_description()}
      </p>
    {/if}
  </section>

  {#if mode === 'add'}
    <p
      class="flex items-start gap-2 type-body text-warning-ink"
      data-testid="provider-profile-starts-fresh"
    >
      <Fa icon={faTriangleExclamation} class="mt-1 size-3.5 shrink-0" />
      <span>
        {provider === 'codex'
          ? m.settings_providerProfileKinds_startsFreshCodex_description()
          : m.settings_providerProfileKinds_startsFreshClaude_description()}
      </span>
    </p>
    {#if !started}
      <p class="type-caption text-muted-foreground">
        {m.settings_providerProfileKinds_createRuns_label()}
        <code
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono type-caption text-foreground"
          >{command}</code
        >
      </p>
    {/if}
  {:else}
    <section class="space-y-2" data-testid="provider-profile-sign-in-actions">
      <p class="type-body text-muted-foreground">
        {m.settings_providerProfileKinds_editSignIn_description()}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" {disabled} onclick={() => onSignIn?.()}>
          {provider === 'codex'
            ? m.settings_providerProfileKinds_signInChatGpt_label()
            : m.settings_providerProfileKinds_logIn_label()}
        </Button>
      </div>
    </section>
  {/if}
</div>
