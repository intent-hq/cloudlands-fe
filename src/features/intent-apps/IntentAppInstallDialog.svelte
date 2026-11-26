<script lang="ts">
  /**
   * "Install app…": choose a workspace and the bundle folder, check it with
   * `app.install { dryRun: true }` (the daemon validates the manifest and the
   * limits and returns the would-be app), then install it. An installed id
   * offers Replace. After the install the library opens the approval dialog.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Checkbox, Input, Select } from '$lib/components/patterns/settings/custom-controls';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectIntentApps } from '$store/renderer/slices/intent-apps/intent-apps-selectors';
  import {
    intentAppInstallDialogReset,
    intentAppInstallRequested,
  } from '$store/renderer/slices/intent-apps/intent-apps-slice';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';

  let {
    open = $bindable(false),
    onInstalled,
  }: {
    open?: boolean;
    onInstalled?: (appId: string) => void;
  } = $props();

  const intentApps$ = selectIntentApps();
  const workspaces$ = selectWorkspaceItems();

  let workspaceId = $state('');
  let folder = $state('.');
  let replace = $state(false);

  const workspaceItems = $derived(
    $workspaces$.map((workspace) => ({
      value: workspace.id,
      label: workspace.title || workspace.id,
    })),
  );
  const busy = $derived($intentApps$.busy?.kind === 'install');
  const failure = $derived(
    $intentApps$.failure?.kind === 'install' ? $intentApps$.failure.error : null,
  );
  const preview = $derived($intentApps$.installPreview);
  const exists = $derived(failure?.code === 'app-exists');

  $effect(() => {
    if (!open) return;
    appStore.dispatch(intentAppInstallDialogReset());
    if (!workspaceId && workspaceItems.length > 0) workspaceId = workspaceItems[0].value;
    return () => appStore.dispatch(intentAppInstallDialogReset());
  });

  // A completed install closes the dialog and hands the app to the approval step.
  $effect(() => {
    const installed = $intentApps$.installed;
    if (!open || !installed) return;
    open = false;
    onInstalled?.(installed.app.id);
  });

  /** Any change to the inputs needs a new check. */
  function inputsChanged() {
    if (preview || failure) appStore.dispatch(intentAppInstallDialogReset());
  }

  function submit() {
    if (!workspaceId) return;
    const path = folder.trim() || '.';
    appStore.dispatch(
      intentAppInstallRequested({
        workspaceId,
        path,
        ...(replace ? { replace: true } : {}),
        dryRun: preview === null,
      }),
    );
  }
</script>

<FormDialog
  bind:open
  title={m.settings_intentApps_installDialog_title()}
  description={m.settings_intentApps_installDialog_description()}
  submitLabel={preview
    ? m.settings_intentApps_installDialog_install_label()
    : m.settings_intentApps_installDialog_check_label()}
  canSubmit={workspaceId !== '' && !busy && (!exists || replace)}
  submitBusy={busy}
  onSubmit={submit}
>
  <div class="space-y-4" data-intent-app-install>
    <label class="block space-y-1 type-caption">
      <span>{m.settings_intentApps_installDialog_workspace_label()}</span>
      <Select.Root
        bind:value={workspaceId}
        items={workspaceItems}
        onchange={inputsChanged}
      >
        <Select.Trigger aria-label={m.settings_intentApps_installDialog_workspace_label()}>
          <Select.Value placeholder={m.settings_intentApps_installDialog_workspace_placeholder()} />
        </Select.Trigger>
        <Select.Content>
          {#each workspaceItems as option (option.value)}
            <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </label>
    <label class="block space-y-1 type-caption">
      <span>{m.settings_intentApps_installDialog_path_label()}</span>
      <Input bind:value={folder} oninput={inputsChanged} spellcheck={false} autocomplete="off" />
      <span class="block text-muted-foreground"
        >{m.settings_intentApps_installDialog_path_description()}</span
      >
    </label>
    {#if exists || replace}
      <div class="flex items-center gap-2">
        <Checkbox
          id="intent-app-install-replace"
          bind:checked={replace}
          onCheckedChange={inputsChanged}
        />
        <label for="intent-app-install-replace" class="type-caption"
          >{m.settings_intentApps_installDialog_replace_label()}</label
        >
      </div>
    {/if}
    {#if preview}
      <p class="type-body text-foreground" data-intent-app-install-preview>
        {m.settings_intentApps_installDialog_preview({
          name: preview.app.name,
          version: preview.app.version,
          count: formatInteger(preview.app.fileCount),
        })}
      </p>
    {/if}
    {#if failure}
      <p class="type-caption text-destructive" role="alert" data-intent-app-install-error>
        {exists
          ? m.settings_intentApps_installDialog_exists()
          : m.settings_intentApps_actionFailed_error({ message: failure.message })}
      </p>
    {/if}
  </div>
</FormDialog>
