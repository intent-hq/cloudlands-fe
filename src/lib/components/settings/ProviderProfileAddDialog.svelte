<script lang="ts">
  /**
   * Settings → Providers → ⋯ → Add profile for Claude Code and Codex: the
   * approved kind dialog (card picker, then Different login / API key /
   * Token / Advanced) wired to the store.
   *
   * - Different login: `providerProfileFolderSetupRequested` (folder pick,
   *   save, folder, terminal sign-in, wait); "Try again" reopens the sign-in.
   * - API key / Token: `providerProfileSecretSetupRequested` (save, key
   *   check); after "Key was rejected" a pasted replacement is saved and
   *   checked again.
   * - Advanced: today's create (`providerProfileCreateRequested`).
   *
   * Save failures land on the name field or as a general error, and the form
   * can be resubmitted. Closing the dialog stops the wait; the profile stays.
   */
  import { untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { notify } from '$lib/components/patterns/notify';
  import type { ProviderProfileFailure } from '$shared/provider-profiles';
  import {
    buildEnvWrites,
    mapFieldErrors,
    newRow,
    writtenRows,
    type EnvRow,
  } from '$features/settings/profile-env-form';
  import {
    baseProviderIdFor,
    buildCreatePayload,
    buildUpdateEnv,
    randomSuffix,
    type ProfileKind,
    type ProfileProvider,
  } from '$lib/provider-profile-kinds';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileCreateRequested,
    providerProfileFolderSetupRequested,
    providerProfileMutationDismissed,
    providerProfileSecretRetryRequested,
    providerProfileSecretSetupRequested,
    providerProfileSetupDismissed,
    providerProfileSignInRetryRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderProfileMutations,
    selectProviderProfilesForBase,
    selectProviderProfileSetups,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import type { ProviderProfileSetup } from '$store/renderer/slices/provider-settings/provider-settings-types';
  import { selectIsDaemonAppOwned } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
  import type {
    ProfileKindStep,
    ProfileSetupError,
    ProfileSignInState,
  } from './profile-kinds/profile-kind-mock';

  interface Props {
    open?: boolean;
    /** `claude-code` or `codex`. */
    providerId: string;
    providerName: string;
    provider: ProfileProvider;
    /** Render in place instead of as a modal overlay (component previews). */
    static?: boolean;
  }

  let {
    open = $bindable(false),
    providerId,
    providerName,
    provider,
    static: staticPosition = false,
  }: Props = $props();

  const setups$ = selectProviderProfileSetups();
  const mutations$ = selectProviderProfileMutations();
  const appOwned$ = selectIsDaemonAppOwned();
  // svelte-ignore state_referenced_locally
  const profiles$ = selectProviderProfilesForBase(providerId);
  const newId = () => crypto.randomUUID();

  let step = $state<ProfileKindStep>('pick');
  let kind = $state<ProfileKind>('differentLogin');
  let name = $state('');
  let backup = $state(false);
  let folderSuffix = $state(randomSuffix());
  let secret = $state('');
  let baseUrl = $state('');
  let customEndpointOpen = $state(false);
  let envRows = $state<EnvRow[]>([newRow(newId)]);
  let errors = $state<Record<string, string>>({});
  /** The setup (Different login, API key, Token) this opening drives. */
  let setupId = $state<string | null>(null);
  /** Advanced: the create request this opening waits on. */
  let advancedRequest = $state<{ id: string; name: string; rows: EnvRow[] } | null>(null);
  let toasted = new Set<string>();
  let wasOpen = false;

  const setup = $derived<ProviderProfileSetup | undefined>(setupId ? $setups$[setupId] : undefined);

  function reset() {
    step = 'pick';
    kind = 'differentLogin';
    name = '';
    backup = false;
    folderSuffix = randomSuffix();
    secret = '';
    baseUrl = '';
    customEndpointOpen = false;
    envRows = [newRow(newId)];
    errors = {};
    setupId = null;
    advancedRequest = null;
  }

  function dismissSetup() {
    if (setupId) appStore.dispatch(providerProfileSetupDismissed(setupId));
  }

  // Fresh form per opening; closing stops the setup's work (the profile stays).
  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen && !wasOpen) reset();
      if (!isOpen && wasOpen) dismissSetup();
      wasOpen = isOpen;
    });
  });

  // The folder that was actually saved (another suffix after a collision).
  $effect(() => {
    const folder = setup?.folder;
    if (folder) untrack(() => (folderSuffix = folder.slice(folder.lastIndexOf('-') + 1)));
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

  // Save failures reopen the form with the errors; success toasts once.
  $effect(() => {
    const current = setup;
    if (!current) return;
    untrack(() => {
      if (current.phase === 'failed' && current.failure?.kind === 'saveFailed') {
        errors = failureErrors(current.failure.failure);
        dismissSetup();
        setupId = null;
        return;
      }
      const key = `${current.id}:${current.phase}`;
      if (toasted.has(key)) return;
      if (current.phase === 'signedIn') {
        toasted.add(key);
        notify.success(m.settings_providerProfiles_created_label({ name: name.trim() }), {
          description:
            provider === 'claude' && current.email
              ? m.settings_providerProfileKinds_signedInAs_label({ email: current.email })
              : m.settings_providerProfileKinds_signedIn_label(),
        });
      } else if (current.phase === 'keyWorks') {
        toasted.add(key);
        notify.success(m.settings_providerProfiles_created_label({ name: name.trim() }));
      }
    });
  });

  // Advanced: today's create outcome handling.
  $effect(() => {
    const request = advancedRequest;
    if (!request) return;
    const settled = $mutations$[request.id];
    if (!settled || settled.status === 'pending') return;
    untrack(() => {
      appStore.dispatch(providerProfileMutationDismissed(request.id));
      advancedRequest = null;
      if (settled.status === 'success') {
        open = false;
        notify.success(m.settings_providerProfiles_created_label({ name: request.name.trim() }));
      } else if (settled.failure) {
        errors = failureErrors(settled.failure, request.rows);
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
  const advancedPending = $derived(
    advancedRequest !== null && $mutations$[advancedRequest.id]?.status !== 'failure',
  );
  const busy = $derived(setup?.phase === 'saving' || advancedPending);

  function startSetup(): string {
    dismissSetup();
    errors = {};
    const id = crypto.randomUUID();
    setupId = id;
    return id;
  }

  function createAndSignIn() {
    const id = startSetup();
    appStore.dispatch(
      providerProfileFolderSetupRequested({
        setupId: id,
        provider,
        name: name.trim(),
        backup,
        suffix: folderSuffix,
      }),
    );
  }

  function create() {
    if (kind === 'apiKey' || kind === 'token') {
      const payload = buildCreatePayload(kind, provider, {
        name,
        backup,
        apiKey: secret,
        token: secret,
        baseUrl,
      });
      const id = startSetup();
      appStore.dispatch(
        providerProfileSecretSetupRequested({
          setupId: id,
          baseProviderId: payload.baseProviderId,
          name: payload.name,
          backup: payload.backup ?? false,
          env: payload.env ?? [],
        }),
      );
      return;
    }
    errors = {};
    const rows = writtenRows(envRows);
    const built = rows.length > 0 ? buildEnvWrites(envRows) : { ok: true as const, env: undefined };
    if (!built.ok) {
      errors = built.rowErrors;
      return;
    }
    const id = crypto.randomUUID();
    advancedRequest = { id, name, rows };
    appStore.dispatch(
      providerProfileCreateRequested({
        requestId: id,
        baseProviderId: baseProviderIdFor(provider),
        name,
        ...(built.env ? { env: built.env } : {}),
        ...(backup ? { backup } : {}),
      }),
    );
  }

  function retry() {
    if (!setup) return;
    if ((kind === 'apiKey' || kind === 'token') && setup.phase === 'keyRejected') {
      const profile = $profiles$.find((item) => item.id === setup.profileId);
      if (!profile) return;
      const env = buildUpdateEnv(
        kind,
        provider,
        profile.env,
        kind === 'apiKey'
          ? { apiKey: secret, ...(baseUrl.trim() ? { baseUrl } : {}) }
          : { token: secret },
      );
      appStore.dispatch(providerProfileSecretRetryRequested({ setupId: setup.id, env }));
      return;
    }
    appStore.dispatch(providerProfileSignInRetryRequested(setup.id));
  }
</script>

<ProviderProfileKindDialog
  bind:open
  static={staticPosition}
  {provider}
  {providerName}
  mode="add"
  bind:step
  bind:kind
  bind:name
  bind:backup
  {folderSuffix}
  remoteDaemon={!$appOwned$}
  {signIn}
  nameError={errors.name}
  {setupError}
  {busy}
  bind:secret
  bind:baseUrl
  bind:customEndpointOpen
  bind:envRows
  envErrors={errors}
  onCreateAndSignIn={createAndSignIn}
  onCreate={create}
  onRetry={retry}
/>
