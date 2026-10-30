<script lang="ts">
  /**
   * Mock-up of the redesigned add/edit profile dialog (props + fake data
   * only; no store, no daemon). Add opens on the kind picker; picking a card
   * shows that kind's screen. Edit opens straight on the screen for `kind`.
   *
   * Every callback is optional: without one, the mock-up advances its own
   * local state (e.g. Create & sign in shows "Waiting for sign-in…") so the
   * sandbox is clickable. Wiring passes real handlers and drives `signIn`.
   *
   * Screens owned elsewhere: Claude API key and Token bodies come with the
   * API key / Token mock-ups; Advanced reuses today's env editor.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormActions, FormField } from '$lib/components/patterns/form';
  import { Button, Input, Switch } from '$lib/components/patterns/settings/custom-controls';
  import { newRow, type EnvRow } from '$features/settings/profile-env-form';
  import ProviderProfileEnvEditor from '../ProviderProfileEnvEditor.svelte';
  import ProfileKindPicker from './ProfileKindPicker.svelte';
  import ProfileFolderLoginFields from './ProfileFolderLoginFields.svelte';
  import ProfileSignInStatus from './ProfileSignInStatus.svelte';
  import {
    previewProfileFolder,
    signInCommand,
    type ProfileKindChoice,
    type ProfileKindProvider,
    type ProfileKindStep,
    type ProfileSetupError,
    type ProfileSignInMethod,
    type ProfileSignInState,
  } from './profile-kind-mock';
  import { randomSuffix } from '$lib/provider-profile-kinds';

  interface Props {
    open?: boolean;
    /** Render in place instead of as a modal overlay (component previews). */
    static?: boolean;
    provider: ProfileKindProvider;
    providerName: string;
    mode: 'add' | 'edit';
    /** Add: starts on `pick`. Edit always shows `details`. */
    step?: ProfileKindStep;
    kind?: ProfileKindChoice;
    name?: string;
    backup?: boolean;
    /** Edit: the profile's saved name (for the title). */
    savedName?: string;
    /** Add: the random folder suffix; Edit: unused. */
    folderSuffix?: string;
    /** Edit: the folder saved on the profile. */
    savedFolderPath?: string;
    /** Codex on a daemon that is not the app's own sidecar. */
    remoteDaemon?: boolean;
    signIn?: ProfileSignInState;
    /** The sign-in method `signIn` is tracking (Codex edit offers both). */
    signInMethod?: ProfileSignInMethod;
    nameError?: string;
    setupError?: ProfileSetupError;
    busy?: boolean;
    envRows?: EnvRow[];
    onCreateAndSignIn?: () => void;
    onSave?: () => void;
    onSignIn?: (method: ProfileSignInMethod) => void;
    onRetry?: () => void;
    onSwitchToAdvanced?: () => void;
  }

  let {
    open = $bindable(true),
    static: staticPosition = false,
    provider,
    providerName,
    mode,
    step = $bindable(mode === 'edit' ? 'details' : 'pick'),
    kind = $bindable('differentLogin'),
    name = $bindable(''),
    backup = $bindable(false),
    savedName = '',
    folderSuffix = randomSuffix(),
    savedFolderPath = '',
    remoteDaemon = false,
    signIn = $bindable({ status: 'idle' }),
    signInMethod = $bindable('chatgpt'),
    nameError,
    setupError = $bindable(),
    busy = false,
    envRows = $bindable([newRow(() => crypto.randomUUID())]),
    onCreateAndSignIn,
    onSave,
    onSignIn,
    onRetry,
    onSwitchToAdvanced,
  }: Props = $props();

  const picking = $derived(mode === 'add' && step === 'pick');
  /** Codex API key is a folder profile signed in with `codex login --with-api-key`. */
  const codexApiKey = $derived(provider === 'codex' && kind === 'apiKey');
  const folderKind = $derived(kind === 'differentLogin' || codexApiKey);
  const apiKeySignIn = $derived(
    codexApiKey || (mode === 'edit' && provider === 'codex' && signInMethod === 'apiKey'),
  );
  const command = $derived(
    signInCommand(provider, apiKeySignIn ? 'apiKey' : 'chatgpt', remoteDaemon),
  );
  const folderPath = $derived(
    mode === 'edit' ? savedFolderPath : previewProfileFolder(provider, name, folderSuffix),
  );
  /** After Create & sign in the add form is locked: the profile is saved. */
  const started = $derived(mode === 'add' && (signIn.status !== 'idle' || !!setupError));
  const fieldsDisabled = $derived(busy || started);

  const title = $derived(
    mode === 'edit'
      ? m.settings_providerProfiles_editTitle_label({ name: savedName })
      : m.settings_providerProfiles_addTitle_label({ provider: providerName }),
  );
  const description = $derived.by(() => {
    if (picking) return m.settings_providerProfileKinds_pick_description();
    if (folderKind) {
      return codexApiKey
        ? m.settings_providerProfileKinds_apiKeyCodexDialog_description()
        : m.settings_providerProfileKinds_differentLoginDialog_description();
    }
    return m.settings_providerProfiles_dialog_description();
  });
  const submitLabel = $derived(
    mode === 'edit'
      ? m.settings_providerProfiles_save_label()
      : folderKind
        ? m.settings_providerProfileKinds_createAndSignIn_label()
        : m.settings_providerProfiles_create_label(),
  );
  const setupErrorMessage = $derived(
    setupError?.kind === 'folderFailed'
      ? m.settings_providerProfileKinds_folderFailed_error({ path: setupError.path })
      : setupError?.kind === 'terminalFailed'
        ? m.settings_providerProfileKinds_terminalFailed_error()
        : '',
  );

  function startWaiting() {
    setupError = undefined;
    signIn = { status: 'waiting', deviceAuth: provider === 'codex' && remoteDaemon };
  }

  function pick(next: ProfileKindChoice) {
    kind = next;
    step = 'details';
  }

  function submit() {
    if (picking || busy) return;
    if (mode === 'edit') {
      if (onSave) onSave();
      else open = false;
      return;
    }
    if (!folderKind) {
      // TODO(provider-profile-kinds): Claude API key / Token / Advanced create.
      open = false;
      return;
    }
    if (onCreateAndSignIn) onCreateAndSignIn();
    else startWaiting();
  }

  function signInFromEdit(method: ProfileSignInMethod) {
    signInMethod = method;
    if (onSignIn) onSignIn(method);
    else startWaiting();
  }

  function retry() {
    if (onRetry) onRetry();
    else startWaiting();
  }

  function switchToAdvanced() {
    if (onSwitchToAdvanced) onSwitchToAdvanced();
    else kind = 'advanced';
  }

  /** Footer once the add flow has started a sign-in (or failed after saving). */
  const startedFooter = $derived.by((): { retry: boolean; done: boolean } => {
    if (setupError) return { retry: true, done: false };
    switch (signIn.status) {
      case 'stillWaiting':
      case 'keyRejected':
        return { retry: true, done: false };
      case 'signedIn':
      case 'keyWorks':
        return { retry: false, done: true };
      default:
        return { retry: false, done: false };
    }
  });
</script>

<FormDialog
  bind:open
  static={staticPosition}
  size="wide"
  {title}
  {description}
  dismissOnInteractOutside={false}
  onSubmit={submit}
>
  {#if picking}
    <ProfileKindPicker {provider} disabled={busy} onPick={pick} />
  {:else}
    <div class="space-y-5" data-testid="provider-profile-kind-details" data-kind={kind}>
      <FormField
        label={m.settings_providerProfiles_name_label()}
        description={m.settings_providerProfiles_name_description()}
        error={nameError}
        required
      >
        {#snippet control(props)}
          <Input {...props} bind:value={name} autocomplete="off" disabled={fieldsDisabled} />
        {/snippet}
      </FormField>

      <div class="flex items-start justify-between gap-4" data-testid="provider-profile-backup">
        <div class="min-w-0 space-y-1">
          <label for="provider-profile-kind-backup-switch" class="type-body text-foreground">
            {m.settings_providerProfiles_backup_label()}
          </label>
          <p
            id="provider-profile-kind-backup-description"
            class="type-caption text-muted-foreground"
          >
            {m.settings_providerProfiles_backup_description()}
          </p>
        </div>
        <Switch
          id="provider-profile-kind-backup-switch"
          bind:checked={backup}
          size="sm"
          disabled={fieldsDisabled}
          ariaLabel={m.settings_providerProfiles_backup_label()}
          ariaDescribedby="provider-profile-kind-backup-description"
        />
      </div>

      {#if folderKind}
        <ProfileFolderLoginFields
          {provider}
          {mode}
          apiKey={codexApiKey}
          {folderPath}
          {command}
          disabled={fieldsDisabled || signIn.status === 'waiting'}
          {started}
          onSignIn={signInFromEdit}
        />
      {:else if kind === 'advanced'}
        <ProviderProfileEnvEditor bind:rows={envRows} disabled={fieldsDisabled} />
      {/if}

      <ProfileSignInStatus {provider} state={signIn} {command} apiKey={apiKeySignIn} />

      {#if setupErrorMessage}
        <p class="type-body text-danger" role="alert" data-testid="provider-profile-setup-error">
          {setupErrorMessage}
        </p>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    <FormActions>
      {#snippet destructive()}
        {#if !picking && mode === 'add' && !started}
          <Button variant="ghost-light" disabled={busy} onclick={() => (step = 'pick')}>
            {m.settings_providerProfileKinds_back_label()}
          </Button>
        {:else if mode === 'edit' && kind !== 'advanced'}
          <Button variant="ghost-light" disabled={busy} onclick={switchToAdvanced}>
            {m.settings_providerProfileKinds_switchToAdvanced_label()}
          </Button>
        {/if}
      {/snippet}
      {#snippet secondary()}
        {#if !startedFooter.done}
          <Button variant="ghost-light" disabled={busy} onclick={() => (open = false)}>
            {started
              ? m.settings_providerProfileKinds_close_label()
              : m.modals_bulkActionConfirm_cancel_label()}
          </Button>
        {/if}
      {/snippet}
      {#snippet primary()}
        {#if picking}
          <!-- The picker has no submit: a card is the next step. -->
        {:else if started}
          {#if startedFooter.retry}
            <Button variant="primary" onclick={retry}>
              {m.settings_providerProfileKinds_tryAgain_label()}
            </Button>
          {:else if startedFooter.done}
            <Button variant="primary" onclick={() => (open = false)}>
              {m.settings_providerProfileKinds_done_label()}
            </Button>
          {/if}
        {:else}
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={busy || name.trim() === ''}
          >
            {submitLabel}
          </Button>
        {/if}
      {/snippet}
    </FormActions>
  {/snippet}
</FormDialog>
