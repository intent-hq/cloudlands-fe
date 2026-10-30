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
   * Claude API key and Token (both providers) save a secret and then run the
   * key check ("Key works" / "Key was rejected"); Advanced reuses today's env
   * editor. Edit screens show the running-sessions warning once env changes,
   * and Switch to Advanced keeps the unsaved name and backup switch.
   */
  import { onDestroy } from 'svelte';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormActions, FormField } from '$lib/components/patterns/form';
  import { Button, Input, Switch } from '$lib/components/patterns/settings/custom-controls';
  import {
    isEnvUnchanged,
    newRow,
    restartGuidance,
    rowsFromSaved,
    type EnvRow,
  } from '$features/settings/profile-env-form';
  import type { EnvEntryRead } from '$shared/provider-profiles';
  import ProviderProfileEnvEditor from '../ProviderProfileEnvEditor.svelte';
  import ProfileKindPicker from './ProfileKindPicker.svelte';
  import ProfileFolderLoginFields from './ProfileFolderLoginFields.svelte';
  import ProfileSignInStatus from './ProfileSignInStatus.svelte';
  import ProfileSecretFields from './ProfileSecretFields.svelte';
  import {
    type BaseUrlAction,
    previewProfileFolder,
    signInCommand,
    type ProfileKindChoice,
    type ProfileKindProvider,
    type ProfileKindStep,
    type ProfileSetupError,
    type ProfileSignInState,
  } from './profile-kind-mock';
  import { isJwtShaped, randomSuffix } from '$lib/provider-profile-kinds';

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
    /** The daemon is not the app's own sidecar (Codex device auth, restart wording). */
    remoteDaemon?: boolean;
    signIn?: ProfileSignInState;
    nameError?: string;
    setupError?: ProfileSetupError;
    busy?: boolean;
    /** API key / Token: the typed secret (never a saved value). */
    secret?: string;
    /** Edit: the profile has a saved key or token. */
    secretSaved?: boolean;
    /** Edit: Replace was chosen for the saved key or token. */
    replacingSecret?: boolean;
    /** An inline secret error from the parent (otherwise the mock validates). */
    secretError?: string;
    /** Claude API key: the optional Custom endpoint (`ANTHROPIC_BASE_URL`). */
    baseUrl?: string;
    baseUrlSaved?: boolean;
    baseUrlAction?: BaseUrlAction;
    customEndpointOpen?: boolean;
    /** Edit: the profile's saved env (Advanced rows and its change warning). */
    savedEnv?: EnvEntryRead[];
    envRows?: EnvRow[];
    /** Advanced: field errors keyed like today's dialog (`<rowId>.key`, `env`, …). */
    envErrors?: Record<string, string>;
    onCreateAndSignIn?: () => void;
    /** API key / Token create (the parent then drives `signIn` through the key check). */
    onCreate?: () => void;
    onSave?: () => void;
    onSignIn?: () => void;
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
    nameError,
    setupError = $bindable(),
    busy = false,
    secret = $bindable(''),
    secretSaved = false,
    replacingSecret = $bindable(false),
    secretError,
    baseUrl = $bindable(''),
    baseUrlSaved = false,
    baseUrlAction = $bindable('keep'),
    customEndpointOpen = $bindable(false),
    savedEnv,
    envRows = $bindable(
      savedEnv
        ? rowsFromSaved(savedEnv, () => crypto.randomUUID())
        : [newRow(() => crypto.randomUUID())],
    ),
    envErrors = {},
    onCreateAndSignIn,
    onCreate,
    onSave,
    onSignIn,
    onRetry,
    onSwitchToAdvanced,
  }: Props = $props();

  const picking = $derived(mode === 'add' && step === 'pick');
  const folderKind = $derived(kind === 'differentLogin');
  /** Claude API key and Token (both providers): a pasted secret plus the key check. */
  const secretKind = $derived(kind === 'apiKey' || kind === 'token' ? kind : null);
  let localSecretError = $state<string | undefined>();
  const shownSecretError = $derived(secretError ?? localSecretError);
  const command = $derived(signInCommand(provider, remoteDaemon));
  const folderPath = $derived(
    mode === 'edit' ? savedFolderPath : previewProfileFolder(provider, name, folderSuffix),
  );
  /** After Create & sign in the add form is locked: the profile is saved. */
  const started = $derived(mode === 'add' && (signIn.status !== 'idle' || !!setupError));
  const fieldsDisabled = $derived(busy || started);
  /** After "Key was rejected" the user can paste another key and try again. */
  const secretDisabled = $derived(busy || (started && signIn.status !== 'keyRejected'));

  /** Edit screens: env would change on Save, so running sessions keep the old settings. */
  const envChanged = $derived.by(() => {
    if (mode !== 'edit') return false;
    if (kind === 'advanced') return !isEnvUnchanged(envRows, savedEnv ?? []);
    if (secretKind) {
      return (
        (replacingSecret && secret.trim() !== '') ||
        baseUrlAction === 'remove' ||
        ((baseUrlAction === 'replace' || !baseUrlSaved) && baseUrl.trim() !== '')
      );
    }
    return false;
  });

  const title = $derived(
    mode === 'edit'
      ? m.settings_providerProfiles_editTitle_label({ name: savedName })
      : m.settings_providerProfiles_addTitle_label({ provider: providerName }),
  );
  const description = $derived.by(() => {
    if (picking) return m.settings_providerProfileKinds_pick_description();
    if (folderKind) return m.settings_providerProfileKinds_differentLoginDialog_description();
    if (secretKind === 'apiKey')
      return m.settings_providerProfileKinds_apiKeyClaudeDialog_description();
    if (secretKind === 'token') {
      return provider === 'codex'
        ? m.settings_providerProfileKinds_tokenCodexDialog_description()
        : m.settings_providerProfileKinds_tokenClaudeDialog_description();
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

  let keyCheckTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(keyCheckTimer));

  /** Mock key check: "Checking the key…", then "Key works" (scenes show the rest). */
  function startKeyCheck() {
    clearTimeout(keyCheckTimer);
    signIn = { status: 'checkingKey' };
    keyCheckTimer = setTimeout(() => {
      if (signIn.status === 'checkingKey') signIn = { status: 'keyWorks' };
    }, 1200);
  }

  /** Empty key/token, or a Codex token that is not JWT-shaped (sets the inline error). */
  function validateSecret(): boolean {
    const value = secret.trim();
    if (value === '') {
      localSecretError =
        secretKind === 'token'
          ? m.settings_providerProfileKinds_tokenRequired_error()
          : m.settings_providerProfileKinds_keyRequired_error();
      return false;
    }
    if (secretKind === 'token' && provider === 'codex' && !isJwtShaped(value)) {
      localSecretError = m.settings_providerProfileKinds_tokenNotJwt_error();
      return false;
    }
    localSecretError = undefined;
    return true;
  }

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
      const checksSecret = secretKind !== null && (replacingSecret || !secretSaved);
      if (checksSecret && !validateSecret()) return;
      if (onSave) onSave();
      else if (checksSecret) startKeyCheck();
      else open = false;
      return;
    }
    if (secretKind) {
      if (!validateSecret()) return;
      if (onCreate) onCreate();
      else startKeyCheck();
      return;
    }
    if (!folderKind) {
      if (onCreate) onCreate();
      else open = false;
      return;
    }
    if (onCreateAndSignIn) onCreateAndSignIn();
    else startWaiting();
  }

  function signInFromEdit() {
    if (onSignIn) onSignIn();
    else startWaiting();
  }

  function retry() {
    if (secretKind && !validateSecret()) return;
    if (onRetry) onRetry();
    else if (secretKind) startKeyCheck();
    else startWaiting();
  }

  /** Name and backup are bound state, so the unsaved values carry over. */
  function switchToAdvanced() {
    if (onSwitchToAdvanced) {
      onSwitchToAdvanced();
      return;
    }
    if (savedEnv) envRows = rowsFromSaved(savedEnv, () => crypto.randomUUID());
    kind = 'advanced';
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
          {folderPath}
          {command}
          disabled={fieldsDisabled || signIn.status === 'waiting'}
          {started}
          onSignIn={signInFromEdit}
        />
      {:else if secretKind}
        <ProfileSecretFields
          {provider}
          kind={secretKind}
          {mode}
          bind:secret
          {secretSaved}
          bind:replacing={replacingSecret}
          secretError={shownSecretError}
          bind:baseUrl
          {baseUrlSaved}
          bind:baseUrlAction
          bind:customEndpointOpen
          disabled={fieldsDisabled}
          {secretDisabled}
        />
      {:else if kind === 'advanced'}
        <ProviderProfileEnvEditor
          bind:rows={envRows}
          errors={envErrors}
          disabled={fieldsDisabled}
        />
      {/if}

      {#if envChanged}
        <p
          role="status"
          class="flex items-start gap-2 type-body text-warning-ink"
          data-testid="provider-profile-restart-warning"
        >
          <Fa icon={faTriangleExclamation} class="mt-1 size-3.5 shrink-0" />
          <span>{restartGuidance(!remoteDaemon)}</span>
        </p>
      {/if}

      <ProfileSignInStatus {provider} state={signIn} {command} />

      {#if envErrors.general}
        <p class="type-body text-danger" role="alert">{envErrors.general}</p>
      {/if}

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
