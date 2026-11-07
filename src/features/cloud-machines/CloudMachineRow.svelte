<!--
  Settings → Machines: the E2B row. Before setup it holds the inline setup
  form; after, it names the template and size, and lists the live sandboxes
  under it. Editing reopens the form; Remove deletes the key and every sandbox.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import { Badge, type BadgeColor } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { faCloud, faPen, faTrash } from '$lib/icons/phosphor-icons';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import {
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxes,
    selectE2bProvider,
  } from './cloud-machines-selectors';
  import { CLOUD_REMOVE_KEY, cloudMachinesRemoveRequested } from './cloud-machines-slice';
  import { cloudErrorText, cloudSizeLabel, templateVersionLabel } from './cloud-machines-format';
  import CloudMachineSetupForm from './CloudMachineSetupForm.svelte';
  import CloudSandboxList from './CloudSandboxList.svelte';

  interface Props {
    /** The setup/edit form is open. */
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    /** Fixed clock for previews and tests. */
    now?: number;
  }

  let { editing, onEdit, onClose, now }: Props = $props();

  const provider$ = selectE2bProvider();
  const sandboxes$ = selectCloudSandboxes();
  const backendLabel$ = selectCurrentBackendLabel();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();

  const provider = $derived($provider$);
  const removing = $derived($operations$[CLOUD_REMOVE_KEY] === 'removing');
  const removeFailure = $derived($failures$[CLOUD_REMOVE_KEY] ?? null);

  /** "intent-node 0.212.0" from "<project>/intent-node-4x8:0.212.0". */
  const templateLabel = $derived(provider ? templateVersionLabel(provider.template) : null);

  const state = $derived.by((): { label: string; color: BadgeColor; dot: string } | null => {
    if (!provider) return null;
    switch (provider.state) {
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
    provider
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
    if (id === 'edit') onEdit();
    else if (id === 'remove') appStore.dispatch(cloudMachinesRemoveRequested());
  }
</script>

<article
  class="border-t border-border"
  aria-labelledby="cloud-machine-e2b-name"
  aria-busy={removing}
  data-cloud-machine-row
>
  <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
    {#snippet leading()}
      <span class="flex items-center gap-3">
        <span
          class={cn(
            'size-2.5 rounded-full ring-2 ring-background outline outline-1 outline-border',
            state?.dot ?? 'bg-transparent',
          )}
          aria-hidden="true"
        ></span>
        <Fa icon={faCloud} class="size-5! text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}<span id="cloud-machine-e2b-name">{provider?.name ?? 'E2B'}</span>{/snippet}
    {#snippet meta()}
      <span class="inline-flex h-[1lh] items-center gap-1.5 align-top">
        {#if state}
          <Badge variant="dot" color={state.color}>{state.label}</Badge>
          {#if templateLabel}<span>{templateLabel}</span>{/if}
          <span aria-hidden="true">·</span>
          <span>{cloudSizeLabel(provider?.size ?? '')}</span>
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
          overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name: provider?.name ?? 'E2B' })}
        />
      {/if}
    {/snippet}
  </ListRow>

  {#if removeFailure}
    <div class="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5" role="alert">
      <p class="type-body text-danger">
        {removeFailure.forbidden
          ? m.cloudMachines_error_ownerOnly()
          : removeFailure.cloud
            ? cloudErrorText(removeFailure.cloud).description
            : removeFailure.message}
      </p>
      {#if removeFailure.inUse}
        <Button
          variant="outline"
          size="sm"
          onclick={() => appStore.dispatch(cloudMachinesRemoveRequested(true))}
          >{m.cloudMachines_remove_stopAgents_label()}</Button
        >
      {/if}
    </div>
  {/if}

  {#if editing || !provider}
    <CloudMachineSetupForm {provider} backendLabel={$backendLabel$} {onClose} />
  {:else if $sandboxes$.length > 0}
    <CloudSandboxList sandboxes={$sandboxes$} {now} />
  {/if}
</article>
