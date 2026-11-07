<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListView } from '$lib/components/patterns/collection';
  import { Fa } from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import DeviceRow, { type DevicePanelMode } from './DeviceRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { SELECTABLE_CONNECTION_ACCENTS, type ConnectionRecord } from '$shared/types/connections';
  import {
    selectConnections,
    selectConnectionsLoaded,
    selectRemoteConnections,
    selectConnectionWorkflow,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { orderMachineRows } from '$lib/utils/machine-row-order';
  import {
    connectionWorkflowRequested,
    connectionWorkflowCleared,
  } from '$store/renderer/slices/connections/connections-slice';
  import { store as appStore } from '$store/renderer/store';
  import RemoteMachinesSection from '$features/remote-machines/RemoteMachinesSection.svelte';
  import BackendsWithAccessSection from '$features/remote-machines/BackendsWithAccessSection.svelte';
  import { remoteMachinesRefreshRequested } from '$features/remote-machines/remote-machines-slice';
  import CloudMachineRow from '$features/cloud-machines/CloudMachineRow.svelte';
  import {
    selectCloudMachinesVisible,
    selectE2bProvider,
  } from '$features/cloud-machines/cloud-machines-selectors';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import { faCloud, faDesktop } from '$lib/icons/phosphor-icons';

  let {
    initialEditedMachine,
    initialCloudSetup = false,
    initialAddMenuOpen = false,
  }: {
    initialEditedMachine?: string;
    initialCloudSetup?: boolean;
    /** Previews: open the Add machine menu on mount. */
    initialAddMenuOpen?: boolean;
  } = $props();

  // Full ordered list (local first) drives the rows AND the empty state (the
  // always-present local row and the "no devices" box must not render
  // together); the remote-only list keeps driving accent cycling.
  const connections$ = selectConnections();
  const devices$ = selectRemoteConnections();
  const loaded$ = selectConnectionsLoaded();
  const currentConnectionId$ = selectCurrentConnectionId();
  // The backend this window uses sits right after the local row.
  const rows = $derived(orderMachineRows($connections$, $currentConnectionId$));
  // Cloud machines (E2B): one row after the saved machines, while set up or being set up.
  const cloudVisible$ = selectCloudMachinesVisible();
  const e2bProvider$ = selectE2bProvider();
  let cloudSetupOpen = $state(untrack(() => initialCloudSetup));
  let cloudEditing = $state(untrack(() => initialCloudSetup));
  let addMenuOpen = $state(untrack(() => initialAddMenuOpen));
  const showCloudRow = $derived($cloudVisible$ && (!!$e2bProvider$ || cloudSetupOpen));
  type MachineListRow = { kind: 'device'; device: ConnectionRecord } | { kind: 'cloud' };
  const listRows = $derived<MachineListRow[]>([
    ...rows.map((device): MachineListRow => ({ kind: 'device', device })),
    ...(showCloudRow ? [{ kind: 'cloud' } as const] : []),
  ]);

  function openCloudSetup() {
    cloudSetupOpen = true;
    cloudEditing = true;
  }

  function closeCloudSetup() {
    cloudSetupOpen = false;
    cloudEditing = false;
  }

  let connectModalOpen = $state(false);
  let activeDeviceId = $state<string | null>(untrack(() => initialEditedMachine ?? null));
  let activePanel = $state<DevicePanelMode>(untrack(() => (initialEditedMachine ? 'edit' : null)));
  let removeDialogOpen = $state(false);
  let removeTarget = $state<ConnectionRecord | null>(null);
  const consumerId = $props.id();
  const workflow$ = selectConnectionWorkflow(consumerId);
  const removeError = $derived(
    $workflow$?.outcome?.kind === 'error' ? m.settings_devices_remove_error() : null,
  );
  const removing = $derived(!!$workflow$ && $workflow$.phase !== 'settled');
  onDestroy(() => appStore.dispatch(connectionWorkflowCleared(consumerId)));
  onMount(() => appStore.dispatch(remoteMachinesRefreshRequested()));
  $effect(() => {
    if ($workflow$?.outcome?.kind !== 'done') return;
    appStore.dispatch(connectionWorkflowCleared(consumerId));
    untrack(() => {
      if (activeDeviceId === removeTarget?.id) closePanel();
      removeTarget = null;
    });
  });

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
    appStore.dispatch(connectionWorkflowCleared(consumerId));
    removeDialogOpen = true;
  }

  function removeDevice(device = removeTarget) {
    if (!device || removing) return;
    appStore.dispatch(connectionWorkflowRequested(consumerId, { kind: 'forget', id: device.id }));
  }
</script>

<div class="space-y-5">
  <div>
    <h2 class="type-title mb-3 text-foreground">
      {m.settings_devices_title()}
    </h2>
    <p class="max-w-2xl type-body text-muted-foreground">
      {m.settings_devices_description()}
    </p>
  </div>

  <ListView
    virtualize={false}
    items={listRows}
    getKey={(row) => (row.kind === 'device' ? row.device.id : 'cloud:e2b')}
    getText={(row) => (row.kind === 'device' ? row.device.label : 'E2B')}
    status={$loaded$ ? 'ready' : 'loading'}
    ariaLabel={m.settings_devices_title()}
    class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
  >
    {#snippet row({ item })}
      {#if item.kind === 'device'}
        {@const device = item.device}
        <DeviceRow
          {device}
          panelMode={activeDeviceId === device.id ? activePanel : null}
          onOpenPanel={(panel) => openPanel(device.id, panel)}
          onClosePanel={closePanel}
          onRequestRemove={requestRemove}
        />
      {:else}
        <CloudMachineRow
          editing={cloudEditing}
          onEdit={() => (cloudEditing = true)}
          onClose={closeCloudSetup}
        />
      {/if}
    {/snippet}
    {#snippet loading()}
      <p
        class="rounded-xl border border-border bg-card p-6 type-body text-muted-foreground"
        role="status"
      >
        {m.settings_devices_loading_label()}
      </p>
    {/snippet}
    {#snippet empty()}
      <div class="rounded-xl border border-dashed border-border bg-card p-8 text-left">
        <p class="type-body font-medium text-foreground">{m.settings_devices_empty_title()}</p>
        <p class="mt-1 type-body text-muted-foreground">
          {m.settings_devices_empty_description()}
        </p>
      </div>
    {/snippet}
  </ListView>

  <div class="flex justify-end">
    {#if $cloudVisible$ && !$e2bProvider$ && !cloudSetupOpen}
      <Menu.Root bind:open={addMenuOpen}>
        <Menu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="sm" data-testid="add-machine-menu">
              <Fa icon={faPlus} class="mr-1.5" size="xs" />
              {m.settings_devices_add_label()}
            </Button>
          {/snippet}
        </Menu.Trigger>
        <Menu.Content align="end" class="w-80">
          <Menu.Item onSelect={() => (connectModalOpen = true)}>
            {#snippet leading()}<Fa icon={faDesktop} />{/snippet}
            <span class="flex min-w-0 flex-col">
              <span>{m.cloudMachines_addMenu_connect_label()}</span>
              <span class="type-caption text-muted-foreground"
                >{m.cloudMachines_addMenu_connect_description()}</span
              >
            </span>
          </Menu.Item>
          <Menu.Item onSelect={openCloudSetup} data-testid="add-cloud-machine">
            {#snippet leading()}<Fa icon={faCloud} />{/snippet}
            <span class="flex min-w-0 flex-col">
              <span>{m.cloudMachines_addMenu_e2b_label()}</span>
              <span class="type-caption text-muted-foreground"
                >{m.cloudMachines_addMenu_e2b_description()}</span
              >
            </span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    {:else}
      <Button variant="ghost" size="sm" onclick={() => (connectModalOpen = true)}>
        <Fa icon={faPlus} class="mr-1.5" size="xs" />
        {m.settings_devices_add_label()}
      </Button>
    {/if}
  </div>

  {#if removeError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="type-body text-danger">{removeError}</p>
      <Button variant="ghost" disabled={removing || !removeTarget} onclick={() => removeDevice()}>
        {m.settings_devices_retry_label()}
      </Button>
    </div>
  {/if}

  <RemoteMachinesSection />
  <BackendsWithAccessSection />
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
