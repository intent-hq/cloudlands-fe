<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListView } from '$lib/components/patterns/collection';
  import { Fa } from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import DeviceRow, { type DevicePanelMode } from './DeviceRow.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionRecord } from '$shared/types/connections';
  import {
    selectConnections,
    selectConnectionsLoaded,
    selectConnectionWorkflow,
    selectCurrentConnectionId,
    selectHostManagesConnections,
    selectKeychainSyncState,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { orderMachineRows } from '$lib/utils/machine-row-order';
  import {
    connectionWorkflowRequested,
    connectionWorkflowCleared,
    loadKeychainSyncStateRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import BackendSyncSettings from './BackendSyncSettings.svelte';
  import { store as appStore } from '$store/renderer/store';
  import RemoteMachinesSection from '$features/remote-machines/RemoteMachinesSection.svelte';
  import RemoteMachineRow from '$features/remote-machines/RemoteMachineRow.svelte';
  import {
    selectCurrentBackendLabel,
    selectLocalMachineFingerprint,
    selectMachineOrder,
    selectMachineOrderSaving,
    selectMachineOrderVisible,
    selectRemoteMachines,
    selectRemoteMachinesVisible,
  } from '$features/remote-machines/remote-machines-selectors';
  import OrderedMachinesList from '$features/remote-machines/OrderedMachinesList.svelte';
  import MachineOrderPlainRow from '$features/remote-machines/MachineOrderPlainRow.svelte';
  import type { MachineOrderControls } from '$features/remote-machines/machine-order-controls';
  import {
    selectBackendDaemonMode,
    selectCanAdministerHost,
  } from '$store/renderer/slices/principal/principal-selectors';
  import { hostRunnerRows } from '$features/remote-machines/machine-order';
  import type { MachineOrderRow } from '$shared/types/remote-machines';
  import { connectionForMachine } from '$features/remote-machines/remote-machines-utils';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { remoteMachinesRefreshRequested } from '$features/remote-machines/remote-machines-slice';
  import CloudMachineRow from '$features/cloud-machines/CloudMachineRow.svelte';
  import {
    selectCloudEntries,
    selectCloudEntriesSupported,
    selectCloudMachinesVisible,
    selectCloudProviderKinds,
  } from '$features/cloud-machines/cloud-machines-selectors';
  import {
    NEW_CLOUD_ENTRY,
    type CloudFormDraft,
  } from '$features/cloud-machines/cloud-machines-slice';
  import {
    CLOUD_ENTRY_LIMIT,
    cloudProviderName,
    type CloudMachineProvider,
    type CloudProviderKind,
  } from '$shared/types/cloud-machines';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import { faCirclePlus, faCloud } from '$lib/icons/phosphor-icons';
  import {
    machineSetupInstallPicked,
    machineSetupOpened,
  } from '$features/machine-setup/machine-setup-slice';
  import { selectHighlightedConnectionId } from '$features/nodes/nodes-selectors';

  let {
    initialEditedMachine,
    initialCloudSetup = false,
    initialCloudEdit,
    initialAddMenuOpen = false,
    initialAddCloudOpen = false,
    initialCloudProvider = 'e2b',
    initialCloudDraft,
  }: {
    initialEditedMachine?: string;
    initialCloudSetup?: boolean;
    /** Previews: open the edit form of this cloud entry on mount. */
    initialCloudEdit?: string;
    /** Previews: open the Add machine menu on mount. */
    initialAddMenuOpen?: boolean;
    /** Previews: open its Add cloud choice too. */
    initialAddCloudOpen?: boolean;
    /** Previews: the provider of the entry `initialCloudSetup` adds. */
    initialCloudProvider?: CloudProviderKind;
    /** Previews: the setup form's starting values. */
    initialCloudDraft?: CloudFormDraft;
  } = $props();

  // Full ordered list (local first) drives the rows AND the empty state (the
  // always-present local row and the "no devices" box must not render
  // together).
  const connections$ = selectConnections();
  const loaded$ = selectConnectionsLoaded();
  const currentConnectionId$ = selectCurrentConnectionId();
  // The backend this window uses sits right after the local row.
  const rows = $derived(orderMachineRows($connections$, $currentConnectionId$));
  const machineRows = $derived(rows.filter((device) => device.daemonMode !== 'node'));
  // Cloud machines (E2B). A backend with named entries lists each entry under
  // Nodes (they only run agents); an older one has one row after the machines.
  const cloudVisible$ = selectCloudMachinesVisible();
  const cloudNamed$ = selectCloudEntriesSupported();
  const cloudEntries$ = selectCloudEntries();
  /** The entry whose form is open, or `NEW_CLOUD_ENTRY` while one is added. */
  let cloudEditing = $state<string | null>(
    untrack(() => (initialCloudSetup ? NEW_CLOUD_ENTRY : (initialCloudEdit ?? null))),
  );
  let addMenuOpen = $state(untrack(() => initialAddMenuOpen));
  let addCloudOpen = $state(untrack(() => initialAddCloudOpen));
  /** The provider of the entry being added. */
  let newCloudProvider = $state<CloudProviderKind>(untrack(() => initialCloudProvider));
  const cloudKinds$ = selectCloudProviderKinds();

  /** Add runner → the wizard's Install a runner steps. */
  function installRunner() {
    appStore.dispatch(machineSetupOpened('pick', 'runner'));
    appStore.dispatch(machineSetupInstallPicked('node'));
  }

  function addCloud(provider: CloudProviderKind) {
    newCloudProvider = provider;
    cloudEditing = NEW_CLOUD_ENTRY;
  }
  type CloudRow = { kind: 'cloud'; entry: CloudMachineProvider | null };
  const cloudRows = $derived<CloudRow[]>(
    $cloudVisible$
      ? [
          ...$cloudEntries$.map((entry): CloudRow => ({ kind: 'cloud', entry })),
          ...(cloudEditing === NEW_CLOUD_ENTRY ? [{ kind: 'cloud', entry: null } as const] : []),
        ]
      : [],
  );
  const canAddCloud = $derived(
    $cloudVisible$ &&
      cloudEditing !== NEW_CLOUD_ENTRY &&
      ($cloudNamed$ ? $cloudEntries$.length < CLOUD_ENTRY_LIMIT : $cloudEntries$.length === 0),
  );
  type MachineRow = { kind: 'machine'; machine: RemoteMachine };
  type ListRowItem = { kind: 'device'; device: ConnectionRecord } | CloudRow | MachineRow;
  const rowKey = (row: ListRowItem) =>
    row.kind === 'device'
      ? row.device.id
      : row.kind === 'machine'
        ? `machine:${row.machine.id}`
        : `cloud:${row.entry?.id ?? NEW_CLOUD_ENTRY}`;
  const rowText = (row: ListRowItem) =>
    row.kind === 'device'
      ? row.device.label
      : row.kind === 'machine'
        ? row.machine.name
        : (row.entry?.name ?? cloudProviderName(newCloudProvider));
  // Machines the backend runs agents on that this app can't open (added from
  // an intent://node link): nodes, as far as this app is concerned.
  const remoteVisible$ = selectRemoteMachinesVisible();
  const remoteMachines$ = selectRemoteMachines();
  const localFingerprint$ = selectLocalMachineFingerprint();
  const unlinkedMachineRows = $derived<MachineRow[]>(
    $remoteVisible$
      ? $remoteMachines$
          .filter(
            (machine) => connectionForMachine(machine, $connections$, $localFingerprint$) === null,
          )
          .map((machine) => ({ kind: 'machine', machine }))
      : [],
  );
  // Nodes only run agents for other backends: listed apart, never a backend.
  const nodeRows = $derived<ListRowItem[]>([
    ...rows
      .filter((device) => device.daemonMode === 'node')
      .map((device): ListRowItem => ({ kind: 'device', device })),
    ...unlinkedMachineRows,
    ...($cloudNamed$ ? cloudRows : []),
  ]);
  const highlightId$ = selectHighlightedConnectionId();
  // `machineOrder: 1`: one ordered list of every place the backend runs agents
  // replaces Nodes and "Machines <backend> can run agents on". Saved
  // connections it doesn't name (not exposed to the backend) stay above.
  const orderVisible$ = selectMachineOrderVisible();
  const order$ = selectMachineOrder();
  const orderSaving$ = selectMachineOrderSaving();
  const canAdminister$ = selectCanAdministerHost();
  const backendLabel$ = selectCurrentBackendLabel();
  /**
   * Saved connection id of each exposed machine (this computer's own daemon,
   * exposed to another host, is one of them). A saved host stays under Hosts
   * and gets a plain runner row; only a runner-only node moves into the list.
   */
  const exposedConnectionIds = $derived(
    new Map(
      $remoteMachines$.flatMap((machine) => {
        const id = connectionForMachine(machine, $connections$, $localFingerprint$);
        return id ? [[machine.id, id] as const] : [];
      }),
    ),
  );
  const exposedIds = $derived(new Set(exposedConnectionIds.values()));
  // Hosts stay in the hosts list even when they also run agents for the
  // current host; only a runner-only node moves into the runner list.
  const listRows = $derived<ListRowItem[]>(
    $orderVisible$
      ? [
          ...rows
            .filter((device) => device.daemonMode !== 'node' || !exposedIds.has(device.id))
            .map((device): ListRowItem => ({ kind: 'device', device })),
          // Without named entries the single E2B row has no row in the order.
          ...($cloudNamed$ ? [] : cloudRows),
        ]
      : [
          ...machineRows.map((device): ListRowItem => ({ kind: 'device', device })),
          ...($cloudNamed$ ? [] : cloudRows),
        ],
  );
  const newCloudRow = $derived(
    $cloudNamed$ ? (cloudRows.find((row) => row.entry === null) ?? null) : null,
  );
  /**
   * The saved node connection behind an ordered runner row, when this app has
   * one. A saved host is listed under Hosts, so its runner row is a plain one.
   */
  function orderedNode(nodeId: string): ConnectionRecord | null {
    const id = exposedConnectionIds.get(nodeId);
    const device = id ? $connections$.find((row) => row.id === id) : undefined;
    return device?.daemonMode === 'node' ? device : null;
  }
  const backendMode$ = selectBackendDaemonMode();
  const runnerRows = $derived(hostRunnerRows($order$, $backendMode$));

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
  // intent-web keeps its own connection list; elsewhere the sync row shows only where iCloud Keychain is supported.
  const hostManagesConnections$ = selectHostManagesConnections();
  const keychainSync$ = selectKeychainSyncState();
  onMount(() => {
    if (!$hostManagesConnections$) appStore.dispatch(loadKeychainSyncStateRequested());
  });
  $effect(() => {
    if ($workflow$?.outcome?.kind !== 'done') return;
    appStore.dispatch(connectionWorkflowCleared(consumerId));
    untrack(() => {
      if (activeDeviceId === removeTarget?.id) closePanel();
      removeTarget = null;
    });
  });

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

<div class="space-y-8">
  <section class="space-y-3" aria-labelledby="hosts-title" data-hosts-section>
    <div>
      <h2 id="hosts-title" class="type-title text-foreground">
        {m.settings_devices_hosts_title()}
      </h2>
      <p class="max-w-2xl type-body text-muted-foreground">
        {m.settings_devices_hosts_description()}
      </p>
    </div>

    <ListView
      virtualize={false}
      items={listRows}
      getKey={rowKey}
      getText={rowText}
      status={$loaded$ ? 'ready' : 'loading'}
      ariaLabel={m.settings_devices_hosts_title()}
      class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item, index })}
        {#if item.kind === 'device'}
          {@const device = item.device}
          <DeviceRow
            {device}
            last={index === listRows.length - 1}
            highlighted={$highlightId$ === device.id}
            panelMode={activeDeviceId === device.id ? activePanel : null}
            onOpenPanel={(panel) => openPanel(device.id, panel)}
            onClosePanel={closePanel}
            onRequestRemove={requestRemove}
          />
        {:else if item.kind === 'cloud'}
          {@render cloudRow(item, false, undefined, true)}
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
    {#if !$hostManagesConnections$ && $keychainSync$?.supported}
      <div id="backend-sync" class="scroll-mt-20 pt-2"><BackendSyncSettings /></div>
    {/if}
    <div class="flex justify-end">
      <Button
        variant="ghost"
        size="sm"
        class="-mr-2.5"
        data-testid="add-host"
        onclick={() => appStore.dispatch(machineSetupOpened('pick', 'host'))}
      >
        {@render addLabel(m.settings_devices_addHost_label())}
      </Button>
    </div>
  </section>

  {#if $orderVisible$}
    <OrderedMachinesList
      rows={runnerRows}
      backendLabel={$backendLabel$}
      owner={$canAdminister$}
      saving={$orderSaving$}
    >
      {#snippet machineRow(entry, order)}
        {@render orderedRow(entry, order)}
      {/snippet}
      {#snippet footer()}
        {#if newCloudRow}
          <div class="border-t border-border">{@render cloudRow(newCloudRow, true)}</div>
        {/if}
      {/snippet}
    </OrderedMachinesList>
  {:else if nodeRows.length > 0}
    <section class="space-y-3" aria-labelledby="nodes-title" data-nodes-section>
      <div>
        <h2 id="nodes-title" class="type-title text-foreground">{m.nodes_section_title()}</h2>
        <p class="max-w-2xl type-body text-muted-foreground">
          {m.nodes_section_description()}
        </p>
      </div>
      <ListView
        virtualize={false}
        items={nodeRows}
        getKey={rowKey}
        getText={rowText}
        status="ready"
        ariaLabel={m.nodes_section_title()}
        class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
      >
        {#snippet row({ item, index })}
          {#if item.kind === 'device'}
            {@const device = item.device}
            <DeviceRow
              {device}
              first={index === 0}
              last={index === nodeRows.length - 1}
              highlighted={$highlightId$ === device.id}
              panelMode={activeDeviceId === device.id ? activePanel : null}
              onOpenPanel={(panel) => openPanel(device.id, panel)}
              onClosePanel={closePanel}
              onRequestRemove={requestRemove}
            />
          {:else if item.kind === 'machine'}
            <RemoteMachineRow
              machine={item.machine}
              highlighted={$highlightId$ === item.machine.id}
              first={index === 0}
              last={index === nodeRows.length - 1}
            />
          {:else}
            {@render cloudRow(item, index === 0)}
          {/if}
        {/snippet}
      </ListView>
    </section>
  {/if}

  {#if !$orderVisible$}<RemoteMachinesSection />{/if}

  {#snippet addLabel(label: string)}
    <Fa icon={faPlus} class="mr-1.5" size="xs" />
    {label}
  {/snippet}

  {#if $remoteVisible$ || canAddCloud}
    <div class="-mt-5 flex justify-end" data-add-runner>
      {#if !canAddCloud}
        <Button
          variant="ghost"
          size="sm"
          class="-mr-2.5"
          data-testid="add-machine-menu"
          onclick={installRunner}
        >
          {@render addLabel(m.settings_devices_addRunner_label())}
        </Button>
      {:else}
        <Menu.Root bind:open={addMenuOpen}>
          <Menu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="sm"
                class="-mr-2.5"
                data-testid="add-machine-menu"
              >
                {@render addLabel(m.settings_devices_addRunner_label())}
              </Button>
            {/snippet}
          </Menu.Trigger>
          <Menu.Content align="end" class="w-56">
            {#if $remoteVisible$}
              <Menu.Item onSelect={installRunner} data-testid="add-machine-setup">
                {#snippet leading()}<Fa icon={faCirclePlus} />{/snippet}
                {m.machineSetup_pick_node_label()}
              </Menu.Item>
            {/if}
            {#if $cloudKinds$.length === 1}
              <Menu.Item onSelect={() => addCloud('e2b')} data-testid="add-cloud-e2b">
                {#snippet leading()}<Fa icon={faCloud} />{/snippet}
                {m.cloudMachines_addMenu_e2b_label()}
              </Menu.Item>
            {:else}
              <Menu.Sub bind:open={addCloudOpen}>
                <Menu.SubTrigger data-testid="add-cloud-machine">
                  {#snippet leading()}<Fa icon={faCloud} />{/snippet}
                  {m.cloudMachines_addMenu_cloud_label()}
                </Menu.SubTrigger>
                <Menu.SubContent class="w-56">
                  {#each $cloudKinds$ as kind (kind)}
                    <Menu.Item onSelect={() => addCloud(kind)} data-testid="add-cloud-{kind}">
                      {cloudProviderName(kind)}
                    </Menu.Item>
                  {/each}
                </Menu.SubContent>
              </Menu.Sub>
            {/if}
          </Menu.Content>
        </Menu.Root>
      {/if}
    </div>
  {/if}

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
</div>

{#snippet orderedRow(entry: MachineOrderRow, order: MachineOrderControls)}
  {@const machine =
    entry.kind === 'machine' ? $remoteMachines$.find((row) => row.id === entry.nodeId) : undefined}
  {@const device = entry.kind === 'machine' ? orderedNode(entry.nodeId) : null}
  {@const cloudEntry =
    entry.kind === 'cloud'
      ? $cloudEntries$.find((row) => row.id === entry.cloudMachineId)
      : undefined}
  {#if device}
    <DeviceRow
      {device}
      first
      highlighted={$highlightId$ === device.id}
      panelMode={activeDeviceId === device.id ? activePanel : null}
      onOpenPanel={(panel) => openPanel(device.id, panel)}
      onClosePanel={closePanel}
      onRequestRemove={requestRemove}
      {order}
    />
  {:else if machine}
    <RemoteMachineRow {machine} first highlighted={$highlightId$ === machine.id} {order} />
  {:else if cloudEntry}
    {@render cloudRow({ kind: 'cloud', entry: cloudEntry }, true, order)}
  {:else}
    <MachineOrderPlainRow row={entry} {order} />
  {/if}
{/snippet}

{#snippet cloudRow(item: CloudRow, first = false, order?: MachineOrderControls, statusDot = false)}
  {@const formKey = item.entry?.id ?? NEW_CLOUD_ENTRY}
  <CloudMachineRow
    entry={item.entry}
    newProvider={newCloudProvider}
    initialDraft={item.entry ? undefined : initialCloudDraft}
    {first}
    {order}
    {statusDot}
    editing={cloudEditing === formKey}
    onEdit={() => (cloudEditing = formKey)}
    onClose={() => {
      if (cloudEditing === formKey) cloudEditing = null;
    }}
  />
{/snippet}

<BulkActionConfirmDialog
  bind:open={removeDialogOpen}
  title={m.settings_devices_removeConfirm_title()}
  description={m.settings_devices_removeConfirm_description({ name: removeTarget?.label ?? '' })}
  confirmText={removing ? m.settings_devices_removing_label() : m.settings_devices_remove_label()}
  variant="destructive"
  onConfirm={() => removeDevice()}
/>
