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
  import RemoteMachineRow from '$features/remote-machines/RemoteMachineRow.svelte';
  import {
    selectLocalMachineFingerprint,
    selectRemoteMachines,
    selectRemoteMachinesVisible,
  } from '$features/remote-machines/remote-machines-selectors';
  import { connectionForMachine } from '$features/remote-machines/remote-machines-utils';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import BackendsWithAccessSection from '$features/remote-machines/BackendsWithAccessSection.svelte';
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
  import { faCloud, faDesktop, faLaptop, faLink } from '$lib/icons/phosphor-icons';
  import PairLinkPaste from '$features/nodes/PairLinkPaste.svelte';
  import { selectHighlightedConnectionId } from '$features/nodes/nodes-selectors';
  import { pasteLinkRequested } from '$features/nodes/nodes-slice';
  import LocalPairingSection from '$features/local-pairing/LocalPairingSection.svelte';
  import LocalIntentAdd from '$features/local-pairing/add/LocalIntentAdd.svelte';
  import {
    localIntentAddClosed,
    localIntentAddOpened,
  } from '$features/local-pairing/add/local-intent-add-slice';
  import { selectLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';

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

  // Labs: Add machine → Intent on this computer (local code pairing, requester
  // side). Desktop only: the main process reads the discovery folder and redeems.
  const labsLocalPairing$ = selectLabsLocalPairingEnabled();
  const canAddLocalIntent = $derived($labsLocalPairing$ && isElectronPlatform());
  // Leaving Settings → Machines closes the form and stops reading the folder.
  onDestroy(() => appStore.dispatch(localIntentAddClosed()));

  // Full ordered list (local first) drives the rows AND the empty state (the
  // always-present local row and the "no devices" box must not render
  // together); the remote-only list keeps driving accent cycling.
  const connections$ = selectConnections();
  const devices$ = selectRemoteConnections();
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
  const listRows = $derived<ListRowItem[]>([
    ...machineRows.map((device): ListRowItem => ({ kind: 'device', device })),
    ...($cloudNamed$ ? [] : cloudRows),
  ]);

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
    getKey={rowKey}
    getText={rowText}
    status={$loaded$ ? 'ready' : 'loading'}
    ariaLabel={m.settings_devices_title()}
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
        {@render cloudRow(item)}
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

  {#if nodeRows.length > 0}
    <section class="space-y-3" aria-labelledby="nodes-title" data-nodes-section>
      <div>
        <h3 id="nodes-title" class="type-title text-foreground">{m.nodes_section_title()}</h3>
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

  <PairLinkPaste />

  {#if canAddLocalIntent}
    <LocalIntentAdd />
  {/if}

  <div class="flex justify-end">
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
        <Menu.Item
          onSelect={() => appStore.dispatch(pasteLinkRequested())}
          data-testid="add-machine-paste-link"
        >
          {#snippet leading()}<Fa icon={faLink} />{/snippet}
          <span class="flex min-w-0 flex-col">
            <span>{m.nodes_addMenu_paste_label()}</span>
            <span class="type-caption text-muted-foreground"
              >{m.nodes_addMenu_paste_description()}</span
            >
          </span>
        </Menu.Item>
        {#if canAddLocalIntent}
          <Menu.Item
            onSelect={() => appStore.dispatch(localIntentAddOpened())}
            data-testid="add-machine-local-intent"
          >
            {#snippet leading()}<Fa icon={faLaptop} />{/snippet}
            <span class="flex min-w-0 flex-col">
              <span>{m.localPairing_addMenu_label()}</span>
              <span class="type-caption text-muted-foreground"
                >{m.localPairing_addMenu_description()}</span
              >
            </span>
          </Menu.Item>
        {/if}
        {#if canAddCloud && $cloudKinds$.length === 1}
          <Menu.Item onSelect={() => addCloud('e2b')} data-testid="add-cloud-e2b">
            {#snippet leading()}<Fa icon={faCloud} />{/snippet}
            <span class="flex min-w-0 flex-col">
              <span>{m.cloudMachines_addMenu_e2b_label()}</span>
              <span class="type-caption text-muted-foreground"
                >{m.cloudMachines_addMenu_e2b_description()}</span
              >
            </span>
          </Menu.Item>
        {:else if canAddCloud}
          <Menu.Sub bind:open={addCloudOpen}>
            <Menu.SubTrigger data-testid="add-cloud-machine">
              {#snippet leading()}<Fa icon={faCloud} />{/snippet}
              <span class="flex min-w-0 flex-col">
                <span>{m.cloudMachines_addMenu_cloud_label()}</span>
                <span class="type-caption text-muted-foreground"
                  >{m.cloudMachines_addMenu_cloud_description()}</span
                >
              </span>
            </Menu.SubTrigger>
            <Menu.SubContent class="w-80">
              {#each $cloudKinds$ as kind (kind)}
                <Menu.Item onSelect={() => addCloud(kind)} data-testid="add-cloud-{kind}">
                  <span class="flex min-w-0 flex-col">
                    <span>{cloudProviderName(kind)}</span>
                    <span class="type-caption text-muted-foreground"
                      >{kind === 'northflank'
                        ? m.cloudMachines_addMenu_northflank_description()
                        : m.cloudMachines_addMenu_e2b_description()}</span
                    >
                  </span>
                </Menu.Item>
              {/each}
            </Menu.SubContent>
          </Menu.Sub>
        {/if}
      </Menu.Content>
    </Menu.Root>
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

  <LocalPairingSection />
  <RemoteMachinesSection />
  <BackendsWithAccessSection />
</div>

{#snippet cloudRow(item: CloudRow, first = false)}
  {@const formKey = item.entry?.id ?? NEW_CLOUD_ENTRY}
  <CloudMachineRow
    entry={item.entry}
    newProvider={newCloudProvider}
    initialDraft={item.entry ? undefined : initialCloudDraft}
    {first}
    editing={cloudEditing === formKey}
    onEdit={() => (cloudEditing = formKey)}
    onClose={() => {
      if (cloudEditing === formKey) cloudEditing = null;
    }}
  />
{/snippet}

<ConnectBackendModal bind:open={connectModalOpen} {defaultAccent} />

<BulkActionConfirmDialog
  bind:open={removeDialogOpen}
  title={m.settings_devices_removeConfirm_title()}
  description={m.settings_devices_removeConfirm_description({ name: removeTarget?.label ?? '' })}
  confirmText={removing ? m.settings_devices_removing_label() : m.settings_devices_remove_label()}
  variant="destructive"
  onConfirm={() => removeDevice()}
/>
