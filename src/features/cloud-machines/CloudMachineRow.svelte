<!--
  Settings → one E2B entry. Before setup it holds the inline setup form; after,
  it names the template and size, and lists the entry's live sandboxes under
  it. With named entries (Nodes), the name renames in place. Editing reopens
  the form; Remove deletes the entry's key and every sandbox it started.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import { Badge, type BadgeColor } from '$lib/components/ui/badge';
  import EditableName from '$lib/components/ui/EditableName.svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { faCloud, faPen, faTrash } from '$lib/icons/phosphor-icons';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { CloudMachineProvider } from '$shared/types/cloud-machines';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import {
    selectCloudEntries,
    selectCloudEntriesSupported,
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxes,
  } from './cloud-machines-selectors';
  import {
    NEW_CLOUD_ENTRY,
    cloudConfigureKey,
    cloudMachineFailureDismissed,
    cloudMachinesConfigureRequested,
    cloudMachinesRemoveRequested,
    cloudRemoveKey,
  } from './cloud-machines-slice';
  import {
    cloudEntryNameError,
    cloudErrorText,
    cloudSizeLabel,
    templateVersionLabel,
  } from './cloud-machines-format';
  import CloudMachineSetupForm from './CloudMachineSetupForm.svelte';
  import CloudSandboxList from './CloudSandboxList.svelte';

  interface Props {
    /** The saved entry; null while a new one is set up. */
    entry: CloudMachineProvider | null;
    /** The setup/edit form is open. */
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    /** First row of its list: no top border. */
    first?: boolean;
    /** Fixed clock for previews and tests. */
    now?: number;
  }

  let { entry, editing, onEdit, onClose, first = false, now }: Props = $props();

  const named$ = selectCloudEntriesSupported();
  const entries$ = selectCloudEntries();
  const sandboxes$ = selectCloudSandboxes();
  const backendLabel$ = selectCurrentBackendLabel();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();

  const name = $derived(entry?.name ?? 'E2B'); // i18n-ignore (product name)
  const sandboxes = $derived(
    entry ? $sandboxes$.filter((machine) => machine.cloud?.cloudMachineId === entry.id) : [],
  );
  const removing = $derived(!!entry && $operations$[cloudRemoveKey(entry.id)] === 'removing');
  const removeFailure = $derived(entry ? ($failures$[cloudRemoveKey(entry.id)] ?? null) : null);
  // A rename's failure; the edit form shows its own.
  const renameFailure = $derived(
    entry && !editing ? ($failures$[cloudConfigureKey(entry.id)] ?? null) : null,
  );
  let renameError = $state<string | null>(null);

  /** "intent-node 0.212.0" from "<project>/intent-node-4x8:0.212.0". */
  const templateLabel = $derived(entry ? templateVersionLabel(entry.template) : null);

  const status = $derived.by((): { label: string; color: BadgeColor; dot: string } | null => {
    if (!entry) return null;
    switch (entry.state) {
      case 'ready':
        return {
          label: m.remoteMachines_state_available_label({ backend: $backendLabel$ }),
          color: 'green',
          dot: 'bg-success',
        };
      case 'key-rejected':
        return {
          label: m.cloudMachines_state_keyRejected_label(),
          color: 'red',
          dot: 'bg-danger',
        };
      default:
        return {
          label: m.cloudMachines_state_unreachable_label(),
          color: 'amber',
          dot: 'bg-warning',
        };
    }
  });

  const actions = $derived<ActionDefinition[]>(
    entry
      ? [
          { id: 'edit', label: m.cloudMachines_edit_label(), icon: faPen },
          {
            id: 'remove',
            label: m.cloudMachines_remove_label(),
            icon: faTrash,
            destructive: true,
            disabled: removing,
          },
        ]
      : [],
  );

  function onAction(id: string) {
    if (!entry) return;
    if (id === 'edit') onEdit();
    else if (id === 'remove') appStore.dispatch(cloudMachinesRemoveRequested(entry.id));
  }

  function rename(next: string) {
    if (!entry) return;
    renameError = cloudEntryNameError(next, $entries$, entry.id);
    if (renameError) return;
    appStore.dispatch(cloudMachinesConfigureRequested({ cloudMachineId: entry.id, name: next }));
  }

  function failureText(failure: NonNullable<typeof removeFailure>) {
    if (failure.forbidden) return m.cloudMachines_error_ownerOnly();
    return failure.cloud ? cloudErrorText(failure.cloud).description : failure.message;
  }
</script>

<article
  class={cn(!first && 'border-t border-border')}
  aria-label={name}
  aria-busy={removing}
  data-cloud-machine-row={entry?.id ?? NEW_CLOUD_ENTRY}
>
  <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
    {#snippet leading()}
      <span class="flex items-center gap-3">
        <span
          class={cn(
            'size-2.5 rounded-full ring-2 ring-background outline outline-1 outline-border',
            status?.dot ?? 'bg-transparent',
          )}
          aria-hidden="true"
        ></span>
        <Fa icon={faCloud} class="size-5! text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}
      <span>
        {#if entry && $named$ && !editing}
          <EditableName
            value={entry.name}
            onSave={rename}
            class="shrink-0"
            textClass="[font:inherit]"
            maxWidth={320}
            buttonAriaLabel={m.cloudMachines_rename_ariaLabel({ name: entry.name })}
            inputAriaLabel={m.cloudMachines_form_name_label()}
          />
        {:else}
          {name}
        {/if}
      </span>
    {/snippet}
    {#snippet meta()}
      <span class="inline-flex h-[1lh] items-center gap-1.5 align-top">
        {#if status}
          <Badge variant="dot" color={status.color}>{status.label}</Badge>
          {#if templateLabel}<span>{templateLabel}</span>{/if}
          <span aria-hidden="true">·</span>
          <span>{cloudSizeLabel(entry?.size ?? '')}</span>
        {:else}
          <span>{m.cloudMachines_row_notSaved()}</span>
        {/if}
      </span>
    {/snippet}
    {#snippet trailing()}
      {#if actions.length > 0}
        <RowActions
          alwaysVisible
          {actions}
          {onAction}
          visibleCount={0}
          overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name })}
        />
      {/if}
    {/snippet}
  </ListRow>

  {#if renameError || renameFailure}
    <div class="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5" role="alert">
      <p class="type-body text-danger">
        {renameError ?? (renameFailure ? failureText(renameFailure) : '')}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          renameError = null;
          if (entry) appStore.dispatch(cloudMachineFailureDismissed(cloudConfigureKey(entry.id)));
        }}>{m.cloudMachines_dismiss_label()}</Button
      >
    </div>
  {/if}

  {#if removeFailure}
    <div class="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5" role="alert">
      <p class="type-body text-danger">{failureText(removeFailure)}</p>
      {#if removeFailure.inUse && entry}
        <Button
          variant="outline"
          size="sm"
          onclick={() => appStore.dispatch(cloudMachinesRemoveRequested(entry.id, true))}
          >{m.cloudMachines_remove_stopAgents_label()}</Button
        >
      {/if}
    </div>
  {/if}

  {#if editing || !entry}
    <CloudMachineSetupForm {entry} backendLabel={$backendLabel$} {onClose} />
  {:else if sandboxes.length > 0}
    <CloudSandboxList {sandboxes} entryName={entry.name} {now} />
  {/if}
</article>
