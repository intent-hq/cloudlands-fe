<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Fa } from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import DeviceRow, { type DevicePanelMode } from './DeviceRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { SELECTABLE_CONNECTION_ACCENTS, type ConnectionRecord } from '$shared/types/connections';
  import {
    selectConnectionsLoaded,
    selectRemoteConnections,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { forgetConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';

  const devices$ = selectRemoteConnections();
  const loaded$ = selectConnectionsLoaded();

  let connectModalOpen = $state(false);
  let activeDeviceId = $state<string | null>(null);
  let activePanel = $state<DevicePanelMode>(null);
  let removeDialogOpen = $state(false);
  let removeTarget = $state<ConnectionRecord | null>(null);
  let removeError = $state<string | null>(null);
  let removing = $state(false);

  const defaultAccent = $derived(
    SELECTABLE_CONNECTION_ACCENTS[$devices$.length % SELECTABLE_CONNECTION_ACCENTS.length],
  );

  function openPanel(deviceId: string, panel: Exclude<DevicePanelMode, null>) {
    activeDeviceId = deviceId;
    activePanel = panel;
  }

  function closePanel() {
    activeDeviceId = null;
    activePanel = null;
  }

  function requestRemove(device: ConnectionRecord) {
    removeTarget = device;
    removeError = null;
    removeDialogOpen = true;
  }

  async function removeDevice(device = removeTarget) {
    if (!device || removing) return;
    removing = true;
    removeError = null;
    try {
      const action = forgetConnectionRequested(device.id);
      appStore.dispatch(action);
      await action.promise;
      if (activeDeviceId === device.id) closePanel();
      removeTarget = null;
    } catch {
      removeError = m.settings_devices_remove_error();
    } finally {
      removing = false;
    }
  }
</script>

<div class="space-y-5">
  <div>
    <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_devices_title()}
    </h2>
    <p class="max-w-2xl text-sm text-muted-foreground">
      {m.settings_devices_description()}
    </p>
  </div>

  {#if !$loaded$}
    <p
      class="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
      role="status"
    >
      {m.settings_devices_loading_label()}
    </p>
  {:else if $devices$.length === 0}
    <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <p class="text-sm font-medium text-foreground">{m.settings_devices_empty_title()}</p>
      <p class="mt-1 text-sm text-muted-foreground">{m.settings_devices_empty_description()}</p>
    </div>
  {:else}
    <div class="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
      {#each $devices$ as device (device.id)}
        <DeviceRow
          {device}
          panelMode={activeDeviceId === device.id ? activePanel : null}
          onOpenPanel={(panel) => openPanel(device.id, panel)}
          onClosePanel={closePanel}
          onRequestRemove={requestRemove}
        />
      {/each}
    </div>
  {/if}

  <div class="flex justify-end">
    <Button variant="ghost" size="sm" onclick={() => (connectModalOpen = true)}>
      <Fa icon={faPlus} class="mr-1.5" size="xs" />
      {m.settings_devices_add_label()}
    </Button>
  </div>

  {#if removeError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-error-foreground/30 bg-destructive/10 p-3"
      role="alert"
    >
      <p class="text-sm text-error-foreground">{removeError}</p>
      <Button variant="ghost" disabled={removing || !removeTarget} onclick={() => removeDevice()}>
        {m.settings_devices_retry_label()}
      </Button>
    </div>
  {/if}
</div>

<ConnectBackendModal bind:open={connectModalOpen} {defaultAccent} />

<BulkActionConfirmDialog
  bind:open={removeDialogOpen}
  title={m.settings_devices_removeConfirm_title()}
  description={m.settings_devices_removeConfirm_description({ name: removeTarget?.label ?? '' })}
  confirmText={removing ? m.settings_devices_removing_label() : m.settings_devices_remove_label()}
  variant="destructive"
  onConfirm={() => removeDevice()}
/>
