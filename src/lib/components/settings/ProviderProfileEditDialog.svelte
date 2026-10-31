<script lang="ts">
  /**
   * Settings → Providers → profile ⋯ → Edit for Claude Code and Codex: the
   * approved kind dialog in edit mode, wired to the store.
   *
   * The screen is the one `detectProfileKind` reads from the saved env; an
   * older daemon that masks the folder path opens Advanced. A saved key or
   * token reads "Saved ••••" and is sent as `keep` unless replaced; saving a
   * specialized screen re-adds any missing unsets. A replaced key or token is
   * saved and checked (`providerProfileSecretEditRequested`); the
   * Different-login screen signs in to the saved folder
   * (`providerProfileSavedFolderSignInRequested`). Switch to Advanced keeps
   * the unsaved name and backup, and carries a typed key or Custom endpoint
   * into the raw rows.
   */
  import { untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { notify } from '$lib/components/patterns/notify';
  import type {
    EnvEntryRead,
    EnvEntryWrite,
    ProviderProfile,
    ProviderProfileFailure,
  } from '$shared/provider-profiles';
  import {
    buildEnvWrites,
    isEnvUnchanged,
    mapFieldErrors,
    restartGuidance,
    rowsFromSaved,
    writtenRows,
    type EnvRow,
  } from '$features/settings/profile-env-form';
  import {
    buildUpdateEnv,
    detectProfileKind,
    type ProfileKind,
    type ProfileKindEdits,
    type ProfileProvider,
  } from '$lib/provider-profile-kinds';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileMutationDismissed,
    providerProfileSavedFolderSignInRequested,
    providerProfileSecretEditRequested,
    providerProfileSetupDismissed,
    providerProfileUpdateRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderProfileMutations,
    selectProviderProfileSetups,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import type { ProviderProfileSetup } from '$store/renderer/slices/provider-settings/provider-settings-types';
  import { selectIsDaemonAppOwned } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
  import type {
    BaseUrlAction,
    ProfileSetupError,
    ProfileSignInState,
  } from './profile-kinds/profile-kind-mock';
  import { advancedRowsFromEdit, editEnvChanges, editScreenFacts } from './provider-profile-edit';

  interface Props {
    open?: boolean;
    providerName: string;
    provider: ProfileProvider;
    profile: ProviderProfile;
    /** Render in place instead of as a modal overlay (component previews). */
    static?: boolean;
  }

  let {
    open = $bindable(false),
    providerName,
    provider,
    profile,
    static: staticPosition = false,
  }: Props = $props();

  const setups$ = selectProviderProfileSetups();
  const mutations$ = selectProviderProfileMutations();
  const appOwned$ = selectIsDaemonAppOwned();
  const newId = () => crypto.randomUUID();

  let kind = $state<ProfileKind>('advanced');
  let name = $state('');
  let backup = $state(false);
  let secret = $state('');
  let replacingSecret = $state(false);
  let baseUrl = $state('');
  let baseUrlAction = $state<BaseUrlAction>('keep');
  let customEndpointOpen = $state(false);
  let envRows = $state<EnvRow[]>([]);
  let errors = $state<Record<string, string>>({});
  /** The saved env this opening was seeded from (Advanced rows and the change warning). */
  let savedEnv = $state<EnvEntryRead[]>([]);
  /** Key check or saved-folder sign-in this opening drives. */
  let setupId = $state<string | null>(null);
  /** The plain `providers.profiles.update` this opening waits on. */
  let activeRequestId = $state<string | null>(null);
  /**
   * Every plain update this dialog sent, kept across close/reopen so a
   * cancelled dialog still reports its outcome (restart warning or rejection).
   */
  let submissions = $state<Record<string, { name: string; rows: EnvRow[] }>>({});
  let wasOpen = false;

  const facts = $derived(editScreenFacts(provider, kind, savedEnv));
  const setup = $derived<ProviderProfileSetup | undefined>(setupId ? $setups$[setupId] : undefined);

  function dismissSetup() {
    if (setupId) appStore.dispatch(providerProfileSetupDismissed(setupId));
    setupId = null;
  }

  /** Seed from the saved profile once per opening. */
  function seed() {
    savedEnv = profile.env;
    kind = detectProfileKind(provider, profile.env);
    name = profile.name;
    backup = profile.backup === true;
    secret = '';
    replacingSecret = false;
    baseUrl = '';
    baseUrlAction = 'keep';
    customEndpointOpen = editScreenFacts(provider, kind, profile.env).baseUrlSaved;
    envRows = rowsFromSaved(profile.env, newId);
    errors = {};
    setupId = null;
    activeRequestId = null;
  }

  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen && !wasOpen) seed();
      if (!isOpen && wasOpen) dismissSetup();
      wasOpen = isOpen;
    });
  });

  function failureErrors(
    failure: ProviderProfileFailure,
    rows: EnvRow[] = [],
  ): Record<string, string> {
    if (failure.kind === 'fieldErrors')
      return mapFieldErrors(failure.fieldErrors, rows, providerName);
    return {
      general:
        failure.kind === 'notFound'
          ? m.settings_providerProfiles_notFound_error()
          : m.settings_providerProfiles_saveFailed_error(),
    };
  }

  function savedToast(savedName: string, envChanged: boolean, description?: string) {
    if (!envChanged) {
      notify.success(m.settings_providerProfiles_saved_label({ name: savedName }));
      return;
    }
    const guidance = restartGuidance(selectIsDaemonAppOwned.select(appStore.state));
    notify.warning(m.settings_providerProfiles_saved_label({ name: savedName }), {
      description: description ? `${description} ${guidance}` : guidance,
    });
  }

  // Plain update: today's outcome handling (close + toast, or errors in place;
  // a save from a closed dialog still toasts its outcome).
  $effect(() => {
    for (const [id, submission] of Object.entries(submissions)) {
      const settled = $mutations$[id];
      if (!settled || settled.status === 'pending') continue;
      untrack(() => {
        appStore.dispatch(providerProfileMutationDismissed(id));
        const { [id]: _done, ...rest } = submissions;
        submissions = rest;
        const visible = open && id === activeRequestId;
        if (visible) activeRequestId = null;
        if (settled.status === 'success') {
          if (visible) open = false;
          savedToast(submission.name.trim(), settled.activation?.envChanged === true);
        } else if (visible) {
          errors = failureErrors(settled.failure ?? { kind: 'other' }, submission.rows);
        } else {
          notify.error(
            settled.failure?.kind === 'notFound'
              ? m.settings_providerProfiles_notFound_error()
              : m.settings_providerProfiles_saveFailed_error(),
          );
        }
      });
    }
  });

  // Replaced key: a rejected save reopens the form; "Key works" closes it.
  let handledPhase = '';
  $effect(() => {
    const current = setup;
    if (!current) return;
    untrack(() => {
      const key = `${current.id}:${current.phase}`;
      if (handledPhase === key) return;
      handledPhase = key;
      if (current.phase === 'failed' && current.failure?.kind === 'saveFailed') {
        errors = failureErrors(current.failure.failure);
        dismissSetup();
      } else if (current.phase === 'keyWorks') {
        open = false;
        savedToast(name.trim(), true, m.settings_providerProfileKinds_keyWorks_label());
      }
    });
  });

  const signIn = $derived.by((): ProfileSignInState => {
    switch (setup?.phase) {
      case 'openingTerminal':
      case 'waiting':
        return { status: 'waiting', deviceAuth: setup.deviceAuth === true };
      case 'stillWaiting':
        return { status: 'stillWaiting' };
      case 'signedIn':
        return { status: 'signedIn', ...(setup.email ? { email: setup.email } : {}) };
      case 'checkingKey':
        return { status: 'checkingKey' };
      case 'keyWorks':
        return { status: 'keyWorks' };
      case 'keyRejected':
        return { status: 'keyRejected' };
      default:
        return { status: 'idle' };
    }
  });
  const setupError = $derived.by((): ProfileSetupError | undefined => {
    const failure = setup?.phase === 'failed' ? setup.failure : undefined;
    if (failure?.kind === 'folderFailed') return { kind: 'folderFailed', path: failure.path };
    if (failure?.kind === 'terminalFailed') return { kind: 'terminalFailed' };
    return undefined;
  });
  const busy = $derived(
    setup?.phase === 'saving' ||
      setup?.phase === 'checkingKey' ||
      (activeRequestId !== null && $mutations$[activeRequestId]?.status === 'pending'),
  );

  /** The screen's edits for `buildUpdateEnv` (an untouched key is `keep`). */
  function screenEdits(): ProfileKindEdits {
    const typedSecret = replacingSecret || !facts.secretSaved ? secret.trim() : '';
    const edits: ProfileKindEdits = {};
    if (typedSecret) {
      if (kind === 'apiKey') edits.apiKey = typedSecret;
      else edits.token = typedSecret;
    }
    if (kind === 'apiKey') {
      if (facts.baseUrlSaved && baseUrlAction === 'remove') edits.baseUrl = null;
      else if ((baseUrlAction === 'replace' || !facts.baseUrlSaved) && baseUrl.trim())
        edits.baseUrl = baseUrl.trim();
    }
    return edits;
  }

  function sendUpdate(env: EnvEntryWrite[] | undefined, rows: EnvRow[]) {
    const nameChanged = name !== profile.name;
    const backupChanged = backup !== (profile.backup === true);
    if (!nameChanged && !backupChanged && !env) {
      open = false;
      return;
    }
    const id = crypto.randomUUID();
    activeRequestId = id;
    submissions = { ...submissions, [id]: { name, rows } };
    appStore.dispatch(
      providerProfileUpdateRequested({
        requestId: id,
        profileId: profile.id,
        ...(nameChanged ? { name } : {}),
        ...(env ? { env } : {}),
        ...(backupChanged ? { backup } : {}),
      }),
    );
  }

  function save() {
    if (busy) return;
    errors = {};
    if (kind === 'advanced') {
      const changed = !isEnvUnchanged(envRows, savedEnv);
      const built = changed ? buildEnvWrites(envRows) : { ok: true as const, env: undefined };
      if (!built.ok) {
        errors = built.rowErrors;
        return;
      }
      sendUpdate(changed ? built.env : undefined, writtenRows(envRows));
      return;
    }
    const edits = screenEdits();
    const env = buildUpdateEnv(kind, provider, savedEnv, edits);
    const replaced = edits.apiKey !== undefined || edits.token !== undefined;
    if (!replaced) {
      sendUpdate(editEnvChanges(savedEnv, env) ? env : undefined, []);
      return;
    }
    dismissSetup();
    const id = crypto.randomUUID();
    setupId = id;
    appStore.dispatch(
      providerProfileSecretEditRequested({
        setupId: id,
        profileId: profile.id,
        env,
        ...(name !== profile.name ? { name } : {}),
        ...(backup !== (profile.backup === true) ? { backup } : {}),
      }),
    );
  }

  function signInToSavedFolder() {
    dismissSetup();
    errors = {};
    const id = crypto.randomUUID();
    setupId = id;
    appStore.dispatch(
      providerProfileSavedFolderSignInRequested({ setupId: id, profileId: profile.id }),
    );
  }

  /** Name and backup are shared state; typed secrets carry into the raw rows. */
  function switchToAdvanced() {
    if (kind === 'advanced') return;
    envRows = advancedRowsFromEdit(
      provider,
      kind,
      savedEnv,
      {
        secret,
        replacing: replacingSecret,
        secretSaved: facts.secretSaved,
        baseUrl,
        baseUrlSaved: facts.baseUrlSaved,
        baseUrlAction,
      },
      newId,
    );
    dismissSetup();
    errors = {};
    kind = 'advanced';
  }
</script>

<ProviderProfileKindDialog
  bind:open
  static={staticPosition}
  {provider}
  {providerName}
  mode="edit"
  step="details"
  bind:kind
  bind:name
  bind:backup
  savedName={profile.name}
  savedFolderPath={facts.folder}
  remoteDaemon={!$appOwned$}
  {signIn}
  nameError={errors.name}
  {setupError}
  {busy}
  bind:secret
  secretSaved={facts.secretSaved}
  bind:replacingSecret
  bind:baseUrl
  baseUrlSaved={facts.baseUrlSaved}
  bind:baseUrlAction
  bind:customEndpointOpen
  {savedEnv}
  bind:envRows
  envErrors={errors}
  onSave={save}
  onSignIn={signInToSavedFolder}
  onSwitchToAdvanced={switchToAdvanced}
/>
