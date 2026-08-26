<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import MachineRow from './MachineRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { CONNECTION_ACCENTS, type ConnectionRecord } from '$shared/types/connections';
  import {
    selectConnectionsLoaded,
    selectRemoteConnections,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { forgetConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';

  const machines$ = selectRemoteConnections();
  const loaded$ = selectConnectionsLoaded();

  let connectModalOpen = $state(false);
  let removeDialogOpen = $state(false);
  let removeTarget = $state<ConnectionRecord | null>(null);
  let removeError = $state<string | null>(null);
  let removing = $state(false);

  const defaultAccent = $derived(CONNECTION_ACCENTS[$machines$.length % CONNECTION_ACCENTS.length]);

  function requestRemove(machine: ConnectionRecord) {
    removeTarget = machine;
    removeError = null;
    removeDialogOpen = true;
  }

  async function removeMachine(machine = removeTarget) {
    if (!machine || removing) return;
    removing = true;
    removeError = null;
    try {
      const action = forgetConnectionRequested(machine.id);
      appStore.dispatch(action);
      await action.promise;
      removeTarget = null;
    } catch {
      removeError = m.settings_machines_remove_error();
    } finally {
      removing = false;
    }
  }
</script>

<div class="space-y-5">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h2 class="text-base font-semibold text-foreground">{m.settings_machines_title()}</h2>
      <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
        {m.settings_machines_description()}
      </p>
    </div>
    <Button onclick={() => (connectModalOpen = true)}>{m.settings_machines_add_label()}</Button>
  </div>

  {#if !$loaded$}
    <p
      class="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
      role="status"
    >
      {m.settings_machines_loading_label()}
    </p>
  {:else if $machines$.length === 0}
    <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <p class="text-sm font-medium text-foreground">{m.settings_machines_empty_title()}</p>
      <p class="mt-1 text-sm text-muted-foreground">{m.settings_machines_empty_description()}</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each $machines$ as machine (machine.id)}
        <MachineRow {machine} onRequestRemove={requestRemove} />
      {/each}
    </div>
  {/if}

  {#if removeError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-error-foreground/30 bg-destructive/10 p-3"
      role="alert"
    >
      <p class="text-sm text-error-foreground">{removeError}</p>
      <Button variant="ghost" disabled={removing || !removeTarget} onclick={() => removeMachine()}>
        {m.settings_machines_retry_label()}
      </Button>
    </div>
  {/if}
</div>

<ConnectBackendModal bind:open={connectModalOpen} {defaultAccent} />

<BulkActionConfirmDialog
  bind:open={removeDialogOpen}
  title={m.settings_machines_removeConfirm_title()}
  description={m.settings_machines_removeConfirm_description({ name: removeTarget?.label ?? '' })}
  confirmText={removing ? m.settings_machines_removing_label() : m.settings_machines_remove_label()}
  variant="destructive"
  onConfirm={() => removeMachine()}
/>
