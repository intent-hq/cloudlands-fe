<script lang="ts">
  /**
   * Create or edit a named provider profile (§5.54): a name plus environment
   * overrides. The daemon validates; its field errors land on the named
   * fields. Saving env edits warns that running sessions keep their current
   * settings and names who must restart (never a frontend reconnect).
   */
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormField } from '$lib/components/patterns/form';
  import { notify } from '$lib/components/patterns/notify';
  import { Input } from '$lib/components/patterns/settings/custom-controls';
  import type { ProviderProfile, ProviderProfileFailure } from '$shared/provider-profiles';
  import {
    buildEnvWrites,
    isEnvUnchanged,
    mapFieldErrors,
    newRow,
    restartGuidance,
    rowsFromSaved,
    writtenRows,
    type EnvRow,
  } from '$features/settings/profile-env-form';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileCreateRequested,
    providerProfileMutationDismissed,
    providerProfileUpdateRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { selectProviderProfileMutations } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectIsDaemonAppOwned } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import ProviderProfileEnvEditor from './ProviderProfileEnvEditor.svelte';

  interface Props {
    open?: boolean;
    providerId: string;
    providerName: string;
    /** Present when editing; absent when adding. */
    profile?: ProviderProfile;
  }

  let { open = $bindable(false), providerId, providerName, profile }: Props = $props();

  const mutations$ = selectProviderProfileMutations();
  const appOwned$ = selectIsDaemonAppOwned();
  const newId = () => crypto.randomUUID();

  let name = $state('');
  let rows = $state<EnvRow[]>([]);
  let errors = $state<Record<string, string>>({});
  /** The save this open dialog is waiting on; reset when the dialog reopens. */
  let activeRequestId = $state<string | null>(null);
  /**
   * Every save this dialog sent, kept across close/reopen so a cancelled
   * dialog still reports its outcome (restart warning or rejection).
   */
  let submissions = $state<Record<string, { name: string; rows: EnvRow[] }>>({});
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      name = profile?.name ?? '';
      rows = profile ? rowsFromSaved(profile.env, newId) : [newRow(newId)];
      errors = {};
      activeRequestId = null;
    }
    wasOpen = open;
  });

  const envChanged = $derived(!profile || !isEnvUnchanged(rows, profile.env));
  const pending = $derived(
    activeRequestId !== null && $mutations$[activeRequestId]?.status === 'pending',
  );

  function failureMessage(failure: ProviderProfileFailure | undefined): string {
    return failure?.kind === 'notFound'
      ? m.settings_providerProfiles_notFound_error()
      : m.settings_providerProfiles_saveFailed_error();
  }

  $effect(() => {
    for (const [id, submission] of Object.entries(submissions)) {
      const settled = $mutations$[id];
      if (!settled || settled.status === 'pending') continue;
      appStore.dispatch(providerProfileMutationDismissed(id));
      const { [id]: _done, ...rest } = submissions;
      submissions = rest;
      const visible = open && id === activeRequestId;
      if (visible) activeRequestId = null;
      const savedName = submission.name.trim();
      if (settled.status === 'success') {
        if (visible) open = false;
        if (settled.kind === 'create') {
          notify.success(m.settings_providerProfiles_created_label({ name: savedName }));
        } else if (settled.activation?.envChanged) {
          notify.warning(m.settings_providerProfiles_saved_label({ name: savedName }), {
            description: restartGuidance(selectIsDaemonAppOwned.select(appStore.state)),
          });
        } else {
          notify.success(m.settings_providerProfiles_saved_label({ name: savedName }));
        }
      } else if (visible) {
        errors =
          settled.failure?.kind === 'fieldErrors'
            ? mapFieldErrors(settled.failure.fieldErrors, submission.rows, providerName)
            : { general: failureMessage(settled.failure) };
      } else {
        notify.error(failureMessage(settled.failure));
      }
    }
  });

  function submit() {
    if (pending) return;
    errors = {};
    const includeEnv = profile ? envChanged : writtenRows(rows).length > 0;
    const built = includeEnv ? buildEnvWrites(rows) : { ok: true as const, env: undefined };
    if (!built.ok) {
      errors = built.rowErrors;
      return;
    }
    const id = crypto.randomUUID();
    activeRequestId = id;
    submissions = { ...submissions, [id]: { name, rows: writtenRows(rows) } };
    if (profile) {
      appStore.dispatch(
        providerProfileUpdateRequested({
          requestId: id,
          profileId: profile.id,
          ...(name !== profile.name ? { name } : {}),
          ...(built.env ? { env: built.env } : {}),
        }),
      );
    } else {
      appStore.dispatch(
        providerProfileCreateRequested({
          requestId: id,
          baseProviderId: providerId,
          name,
          ...(built.env ? { env: built.env } : {}),
        }),
      );
    }
  }
</script>

<FormDialog
  bind:open
  size="wide"
  title={profile
    ? m.settings_providerProfiles_editTitle_label({ name: profile.name })
    : m.settings_providerProfiles_addTitle_label({ provider: providerName })}
  description={m.settings_providerProfiles_dialog_description()}
  submitLabel={profile
    ? m.settings_providerProfiles_save_label()
    : m.settings_providerProfiles_create_label()}
  submitBusy={pending}
  dismissOnInteractOutside={false}
  onSubmit={submit}
>
  <div class="space-y-5">
    <FormField
      label={m.settings_providerProfiles_name_label()}
      description={m.settings_providerProfiles_name_description()}
      error={errors.name}
      required
    >
      {#snippet control(props)}
        <Input {...props} bind:value={name} autocomplete="off" disabled={pending} />
      {/snippet}
    </FormField>

    <ProviderProfileEnvEditor bind:rows {errors} disabled={pending} />

    {#if profile && envChanged}
      <p
        role="status"
        class="flex items-start gap-2 type-body text-warning-ink"
        data-testid="provider-profile-restart-warning"
      >
        <Fa icon={faTriangleExclamation} class="mt-1 size-3.5 shrink-0" />
        <span>{restartGuidance($appOwned$)}</span>
      </p>
    {/if}

    {#if errors.general}
      <p class="type-body text-danger" role="alert">{errors.general}</p>
    {/if}
  </div>
</FormDialog>
