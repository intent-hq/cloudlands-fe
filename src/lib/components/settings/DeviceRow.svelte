<script lang="ts">
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListView } from '$lib/components/patterns/collection';
  import { notify } from '$lib/components/patterns/notify';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import DeviceIconPicker from '$lib/components/DeviceIconPicker.svelte';
  import {
    Input,
    Label,
    Menu,
    Switch,
    Tooltip,
  } from '$lib/components/patterns/settings/custom-controls';
  import { cn } from '$lib/utils';
  import {
    CONNECTION_ACCENT_CLASSES,
    CONNECTION_ACCENT_COLORS,
    connectionAccentOptions,
  } from '$lib/utils/connection-accents';
  import { formatConnectionLabel } from '$lib/utils/connection-label';
  import { canRequestDeviceUpdate, isDaemonBehindPin } from '$lib/utils/device-update-eligibility';
  import { m } from '$shared/paraglide/messages.js';
  import {
    DEFAULT_CONNECTION_ACCENT,
    type ConnectionAccent,
    type DeviceIconChoice,
    type ConnectionOpenStatus,
    type ConnectionRecord,
    type ConnectionValidationBlockedResult,
    type UpdateConnectionParams,
  } from '$shared/types/connections';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectConnectedIds,
    selectKeychainSyncState,
    selectKeychainSyncWriteOperation,
    selectOpenConnectionOperation,
    selectPinnedDaemonVersion,
    selectSaveConnectionOperation,
    selectTestConnectionOperation,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    openConnectionRequested,
    saveConnectionRequested,
    setKeychainSyncEnabledRequested,
    testConnectionRequested,
    updateBackendRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    faArrowsRotate,
    faCopy,
    faEllipsisVertical,
    faPen,
    faPlug,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  export type DevicePanelMode = 'edit' | null;

  interface Props {
    device: ConnectionRecord;
    panelMode: DevicePanelMode;
    onOpenPanel: (panel: Exclude<DevicePanelMode, null>) => void;
    onClosePanel: () => void;
    onRequestRemove: (device: ConnectionRecord) => void;
  }

  let { device, panelMode, onOpenPanel, onClosePanel, onRequestRemove }: Props = $props();
  const deviceId$ = toStore(() => device.id);
  const initialDeviceId = untrack(() => device.id);
  const pinnedVersion$ = selectPinnedDaemonVersion();
  const connectedIds$ = selectConnectedIds();
  const syncState$ = selectKeychainSyncState();
  const syncWriteOperation$ = selectKeychainSyncWriteOperation();
  const openOperation$ = selectOpenConnectionOperation(deviceId$);
  const saveOperation$ = selectSaveConnectionOperation(deviceId$);
  const testOperation$ = selectTestConnectionOperation(deviceId$);
  let name = $state('');
  let host = $state('');
  let port = $state('');
  let accent = $state<ConnectionAccent>(DEFAULT_CONNECTION_ACCENT);
  let deviceIcon = $state<DeviceIconChoice>('auto');
  let localDeviceIcon = $state<DeviceIconChoice>('auto');
  let secret = $state('');
  let detectHosts = $state(true);
  let pushToCloud = $state(true);
  // Turning cloud push OFF removes the synced copy from the keychain (and
  // the user's other devices), so the first Update after the flip asks for
  // confirmation instead of submitting; `cloudRemovalConfirmed` lets the
  // confirmed submit (and any fingerprint re-submit) proceed.
  let cloudRemovalPending = $state(false);
  let cloudRemovalConfirmed = $state(false);
  let enableSyncAfterUpdate = false;
  let busy = $state<'update' | 'test' | null>(null);
  let daemonUpdating = $state(false);
  let feedbackOperation = $state<'update' | 'test' | null>(null);
  let feedback = $state<{ kind: 'success' | 'error' | 'progress'; message: string } | null>(null);
  let connectionError = $state(false);
  let pendingFingerprint = $state<{
    operation: 'update' | 'secret';
    expected: string;
    actual: string;
  } | null>(null);
  let initializedPanel = $state<string | null>(null);
  let actionsButton: HTMLButtonElement | null = $state(null);
  let actionsMenuOpen = $state(false);
  let firstEditInput: HTMLInputElement | null = $state(null);
  let secretInput: HTMLInputElement | null = $state(null);
  let focusSecretOnEdit = $state(false);
  let handledOpenVersion = $state(
    selectOpenConnectionOperation.select(appStore.state, initialDeviceId).version,
  );
  let pendingOpenRequestId = $state<string | null>(null);
  let pendingLocalIconUpdate = $state(false);
  let pendingSaveRequestId = $state<string | null>(null);
  let pendingSyncRequestId = $state<string | null>(null);
  let handledSaveVersion = $state(
    selectSaveConnectionOperation.select(appStore.state, initialDeviceId).version,
  );
  let handledTestVersion = $state(
    selectTestConnectionOperation.select(appStore.state, initialDeviceId).version,
  );

  const savedAccent = $derived(
    device.accent === undefined ? DEFAULT_CONNECTION_ACCENT : device.accent,
  );
  const savedDeviceIcon = $derived(device.deviceIcon ?? 'auto');
  const accentOptions = $derived(connectionAccentOptions(savedAccent));
  // Shared with the daemon-status menu: the local entry gets the fixed
  // "This machine (local)" label; for remotes the Name wins outright, with
  // hostname → address fallbacks for unmigrated records.
  const displayName = $derived(
    device.isLocal ? m.layout_daemonStatus_localConnection_label() : formatConnectionLabel(device),
  );
  const openStatus = $derived(device.status ?? 'not-open');
  const trimmedName = $derived(name.trim());
  const trimmedHost = $derived(host.trim());
  const portNumber = $derived(Number(port.trim()));
  const nameInvalid = $derived(trimmedName.length === 0);
  const hostInvalid = $derived(trimmedHost.length === 0);
  const portInvalid = $derived(
    !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535,
  );
  const editInvalid = $derived(nameInvalid || hostInvalid || portInvalid);
  const savedDetectHosts = $derived(device.detectHosts !== false);
  const savedPushToCloud = $derived(device.syncExcluded !== true);
  // `supported` is the platform gate (macOS only) from main — the renderer
  // never sniffs the platform itself; `enabled` is the machine-global pref
  // that must be on for a re-included record to actually reach the keychain.
  const syncSupported = $derived($syncState$?.supported ?? false);
  const syncEnabled = $derived($syncState$?.enabled ?? false);
  // Candidate hosts as the store reports them (primary first, then detected
  // extras); records predating the field are equivalent to `[host]`.
  const detectedHosts = $derived(
    device.hosts && device.hosts.length > 0 ? device.hosts : device.host ? [device.host] : [],
  );
  const editChanged = $derived(
    trimmedName !== device.label ||
      trimmedHost !== device.host ||
      portNumber !== device.port ||
      accent !== savedAccent ||
      deviceIcon !== savedDeviceIcon ||
      detectHosts !== savedDetectHosts ||
      pushToCloud !== savedPushToCloud,
  );
  // Warning eligibility reflects the last captured daemonVersion; the view
  // attaches it only to a displayed connected version. The message prepends "v" — strip any
  // daemon-reported prefix so a valid v-prefixed version never renders "vv".
  const daemonBehindTooltip = $derived.by(() => {
    const pinnedVersion = $pinnedVersion$;
    if (!isDaemonBehindPin(device, pinnedVersion) || !device.daemonVersion || !pinnedVersion)
      return null;
    return m.settings_devices_daemonBehind_tooltip({
      daemonVersion: device.daemonVersion.replace(/^v/, ''),
      pinnedVersion: pinnedVersion.replace(/^v/, ''),
    });
  });
  const canUpdateDaemon = $derived(canRequestDeviceUpdate(device, $connectedIds$, $pinnedVersion$));

  function resetPanel() {
    name = device.label;
    host = device.host ?? '';
    port = device.port == null ? '' : String(device.port);
    accent = savedAccent;
    deviceIcon = savedDeviceIcon;
    secret = '';
    detectHosts = savedDetectHosts;
    pushToCloud = savedPushToCloud;
    cloudRemovalPending = false;
    cloudRemovalConfirmed = false;
    busy = null;
    feedbackOperation = null;
    feedback = null;
    pendingFingerprint = null;
  }

  $effect(() => {
    localDeviceIcon = savedDeviceIcon;
  });

  $effect(() => {
    const panelKey = panelMode ? `${device.id}:${panelMode}` : null;
    if (panelKey === initializedPanel) return;
    initializedPanel = panelKey;
    untrack(resetPanel);
    if (panelMode === 'edit') {
      requestAnimationFrame(() => {
        if (focusSecretOnEdit) {
          focusSecretOnEdit = false;
          secretInput?.focus();
        } else {
          firstEditInput?.focus();
        }
      });
    }
  });

  function closePanel() {
    onClosePanel();
    queueMicrotask(() => actionsButton?.focus());
  }

  function openEditForSecretRecovery() {
    feedback = null;
    pendingFingerprint = null;
    if (panelMode === 'edit') {
      requestAnimationFrame(() => secretInput?.focus());
    } else {
      focusSecretOnEdit = true;
      onOpenPanel('edit');
    }
  }

  function connectDevice() {
    connectionError = false;
    handledOpenVersion = $openOperation$.version;
    const request = openConnectionRequested(device.id);
    pendingOpenRequestId = request.payload[1];
    appStore.dispatch(request);
  }

  async function requestDaemonUpdate() {
    if (daemonUpdating) return;
    daemonUpdating = true;
    try {
      const action = updateBackendRequested(device.id);
      appStore.dispatch(action);
      await action.promise;
    } catch {
      // Outcomes (success and every failure mode) surface as saga-owned
      // toasts; nothing more to do here.
    } finally {
      daemonUpdating = false;
    }
  }

  $effect(() => {
    const operation = $openOperation$;
    if (
      !pendingOpenRequestId ||
      operation.requestId !== pendingOpenRequestId ||
      operation.version <= handledOpenVersion ||
      operation.status === 'loading'
    )
      return;
    handledOpenVersion = operation.version;
    pendingOpenRequestId = null;
    if (operation.status === 'error') connectionError = true;
    else if (operation.result?.status === 'secret-unavailable') openEditForSecretRecovery();
  });

  function accentLabel(value: Exclude<ConnectionAccent, null>): string {
    return {
      blue: m.settings_devices_accentBlue_label(),
      indigo: m.settings_devices_accentIndigo_label(),
      violet: m.settings_devices_accentViolet_label(),
      rose: m.settings_devices_accentRose_label(),
      orange: m.settings_devices_accentOrange_label(),
      emerald: m.settings_devices_accentEmerald_label(),
      teal: m.settings_devices_accentTeal_label(),
    }[value];
  }

  function selectedAccentStyle(value: Exclude<ConnectionAccent, null>): string {
    return `outline: 2px solid color-mix(in srgb, ${CONNECTION_ACCENT_COLORS[value]} 45%, transparent); outline-offset: 3px;`;
  }

  function statusLabel(status: ConnectionOpenStatus): string {
    return {
      connecting: m.settings_devices_statusConnecting_label(),
      connected: m.settings_devices_statusConnected_label(),
      disconnected: m.settings_devices_statusDisconnected_label(),
      'not-open': m.settings_devices_statusNotOpen_label(),
    }[status];
  }

  function statusClass(status: ConnectionOpenStatus): string {
    return status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-500'
        : 'bg-muted-foreground/50';
  }

  function blockedMessage(result: ConnectionValidationBlockedResult): string {
    if (result.status === 'secret-unavailable') {
      return m.settings_devices_replaceSecret_error();
    }
    if (result.status === 'authentication-rejected') {
      return result.statusCode === 403
        ? m.settings_devices_wsApiDisabled_error()
        : m.settings_devices_authRejected_error();
    }
    if (result.status === 'fingerprint-confirmation-required') {
      return m.settings_devices_fingerprintChanged_error();
    }
    return {
      'no-certificate': m.settings_devices_noCertificate_error(),
      'connect-failed': m.settings_devices_connectFailed_error(),
      timeout: m.settings_devices_timeout_error(),
    }[result.reason];
  }

  function updateParams(confirmedFingerprint?: string): UpdateConnectionParams {
    return {
      id: device.id,
      label: trimmedName,
      accent,
      ...(deviceIcon !== savedDeviceIcon ? { deviceIcon } : {}),
      host: trimmedHost,
      port: portNumber,
      ...(confirmedFingerprint ? { confirmedFingerprint } : {}),
      ...(detectHosts !== savedDetectHosts ? { detectHosts } : {}),
      ...(pushToCloud !== savedPushToCloud ? { syncExcluded: !pushToCloud } : {}),
    };
  }

  function updateLocalDeviceIcon(nextDeviceIcon: DeviceIconChoice) {
    if (!device.isLocal || busy) return;
    busy = 'update';
    pendingLocalIconUpdate = true;
    handledSaveVersion = $saveOperation$.version;
    const request = saveConnectionRequested({
      update: {
        id: device.id,
        label: device.label,
        accent: null,
        deviceIcon: nextDeviceIcon,
      },
    });
    pendingSaveRequestId = request.payload[1];
    appStore.dispatch(request);
  }

  // Any change of the switch invalidates the removal prompt and an earlier
  // confirmation: a failed submit must not carry consent into a later
  // off-flip, and flipping back on dismisses the pending prompt.
  function setPushToCloud(next: boolean) {
    pushToCloud = next;
    cloudRemovalPending = false;
    cloudRemovalConfirmed = false;
  }

  function cancelCloudRemoval() {
    setPushToCloud(savedPushToCloud);
  }

  function confirmCloudRemoval() {
    cloudRemovalPending = false;
    cloudRemovalConfirmed = true;
    void updateDevice();
  }

  function updateDevice(confirmedFingerprint?: string, confirmedSecretFingerprint?: string) {
    if (editInvalid || busy) return;
    if (savedPushToCloud && !pushToCloud && !cloudRemovalConfirmed) {
      cloudRemovalPending = true;
      return;
    }
    // Captured up front: the connections broadcast can refresh `device`
    // before the correlated save result settles.
    enableSyncAfterUpdate = !savedPushToCloud && pushToCloud && !syncEnabled;
    busy = 'update';
    feedbackOperation = 'update';
    feedback = { kind: 'progress', message: m.settings_devices_updating_label() };
    pendingFingerprint = null;
    const token = secret.trim();
    if (token) feedback = { kind: 'progress', message: m.settings_devices_replacingSecret_label() };
    handledSaveVersion = $saveOperation$.version;
    const request = saveConnectionRequested({
      update: updateParams(confirmedFingerprint),
      ...(token
        ? {
            secret: {
              id: device.id,
              token,
              ...(confirmedSecretFingerprint
                ? { confirmedFingerprint: confirmedSecretFingerprint }
                : {}),
            },
          }
        : {}),
    });
    pendingSaveRequestId = request.payload[1];
    appStore.dispatch(request);
  }

  function finishSuccessfulUpdate() {
    if (!enableSyncAfterUpdate) {
      closePanel();
      return;
    }
    feedback = { kind: 'progress', message: m.settings_devices_enablingSync_label() };
    const request = setKeychainSyncEnabledRequested(true);
    pendingSyncRequestId = request.payload[1];
    appStore.dispatch(request);
  }

  $effect(() => {
    const operation = $syncWriteOperation$;
    if (!pendingSyncRequestId || operation.requestId !== pendingSyncRequestId) return;
    if (operation.status !== 'error' && operation.status !== 'success') return;
    pendingSyncRequestId = null;
    if (operation.status === 'error') {
      feedback = { kind: 'error', message: m.settings_devices_enableSync_error() };
    } else {
      closePanel();
    }
  });

  $effect(() => {
    const operation = $saveOperation$;
    if (!pendingSaveRequestId || operation.requestId !== pendingSaveRequestId) return;
    if (operation.version <= handledSaveVersion || operation.status === 'loading') return;
    handledSaveVersion = operation.version;
    pendingSaveRequestId = null;
    busy = null;
    if (pendingLocalIconUpdate) {
      pendingLocalIconUpdate = false;
      if (
        operation.status === 'error' ||
        !operation.result ||
        operation.result.stage !== 'update' ||
        operation.result.result.status !== 'updated'
      ) {
        localDeviceIcon = savedDeviceIcon;
        notify.error(m.settings_devices_update_error());
      }
      return;
    }
    if (operation.status === 'error' || !operation.result) {
      feedback = { kind: 'error', message: m.settings_devices_update_error() };
      return;
    }
    const { stage, result } = operation.result;
    if (stage === 'secret') {
      if (result.status === 'updated') {
        finishSuccessfulUpdate();
        return;
      } else if (result.status === 'secret-unavailable') {
        openEditForSecretRecovery();
      } else if (result.status === 'fingerprint-confirmation-required') {
        pendingFingerprint = {
          operation: 'secret',
          expected: result.expectedFingerprint,
          actual: result.actualFingerprint,
        };
      }
      feedback = { kind: 'error', message: blockedMessage(result) };
      return;
    }
    secret = '';
    if (result.status === 'updated') {
      finishSuccessfulUpdate();
    } else if (result.status === 'secret-unavailable') {
      openEditForSecretRecovery();
    } else if (result.status === 'fingerprint-confirmation-required') {
      pendingFingerprint = {
        operation: 'update',
        expected: result.expectedFingerprint,
        actual: result.actualFingerprint,
      };
      feedback = { kind: 'error', message: blockedMessage(result) };
    } else {
      feedback = { kind: 'error', message: blockedMessage(result) };
    }
  });

  function testDevice() {
    if (hostInvalid || portInvalid || busy) return;
    busy = 'test';
    feedbackOperation = 'test';
    pendingFingerprint = null;
    feedback = { kind: 'progress', message: m.settings_devices_testing_label() };
    handledTestVersion = $testOperation$.version;
    appStore.dispatch(
      testConnectionRequested({
        id: device.id,
        host: trimmedHost,
        port: portNumber,
        ...(secret.trim() ? { token: secret.trim() } : {}),
      }),
    );
  }

  $effect(() => {
    const operation = $testOperation$;
    if (operation.version <= handledTestVersion || operation.status === 'loading') return;
    handledTestVersion = operation.version;
    busy = null;
    const result = operation.result;
    if (operation.status === 'error' || !result) {
      feedback = { kind: 'error', message: m.settings_devices_testFailed_error() };
    } else if (result.status === 'secret-unavailable') {
      openEditForSecretRecovery();
    } else {
      feedback =
        result.status === 'success'
          ? { kind: 'success', message: m.settings_devices_testSuccess_label() }
          : { kind: 'error', message: blockedMessage(result) };
    }
  });

  function confirmFingerprint() {
    if (!pendingFingerprint) return;
    const { operation, actual } = pendingFingerprint;
    if (operation === 'update') void updateDevice(actual);
    else void updateDevice(undefined, actual);
  }

  async function copyTcAddress() {
    if (!device.tcAddress) return;
    try {
      await navigator.clipboard.writeText(device.tcAddress);
      notify.success(m.settings_devices_tcAddress_copied());
    } catch {
      notify.error(m.settings_devices_tcAddress_copyError());
    }
  }
</script>

<article aria-labelledby={`device-${device.id}-name`} aria-busy={busy !== null}>
  <div class="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
    <span
      class={cn(
        'size-2.5 shrink-0 rounded-full ring-2 ring-background outline outline-1 outline-border',
        statusClass(openStatus),
      )}
      role="status"
      aria-label={m.settings_devices_status_ariaLabel({ status: statusLabel(openStatus) })}
    ></span>
    <DeviceIcon record={device} size={20} class="text-foreground" />
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <p
          id={`device-${device.id}-name`}
          class="min-w-0 truncate type-body font-medium text-foreground"
        >
          {displayName}
        </p>
        {#if openStatus === 'connected' && device.intentdVersion}
          {#if daemonBehindTooltip}
            <Tooltip content={daemonBehindTooltip} class="rounded-sm text-warning-ink">
              <span>{device.intentdVersion}</span>
            </Tooltip>
          {:else}
            <span class="shrink-0 whitespace-nowrap type-caption text-muted-foreground">
              {device.intentdVersion}
            </span>
          {/if}
        {/if}
      </div>
    </div>
    {#if device.isLocal}
      <DeviceIconPicker
        record={device}
        bind:value={localDeviceIcon}
        disabled={busy !== null}
        portal={true}
        class="w-48 shrink-0"
        onchange={(value) => void updateLocalDeviceIcon(value)}
      />
    {/if}
    <!-- The local row has no remote-only actions (Connect/Edit/Remove), so its
         menu only exists while the Update action is offered. -->
    {#if !device.isLocal || canUpdateDaemon}
      <Menu.Root bind:open={actionsMenuOpen}>
        <Menu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              bind:ref={actionsButton}
              variant="ghost-light"
              size="icon-xs"
              aria-label={m.settings_devices_actionsFor_ariaLabel({ name: displayName })}
            >
              <Fa icon={faEllipsisVertical} />
            </Button>
          {/snippet}
        </Menu.Trigger>
        <Menu.Content align="end" class="p-0!">
          <div class="w-44 py-1">
            {#if !device.isLocal}
              <Menu.Item
                onclick={() => {
                  actionsMenuOpen = false;
                  void connectDevice();
                }}
              >
                <Fa icon={faPlug} class="size-3.5 text-muted-foreground" />
                {m.settings_devices_connect_label()}
              </Menu.Item>
            {/if}
            {#if canUpdateDaemon}
              <Menu.Item
                disabled={daemonUpdating}
                onclick={() => {
                  actionsMenuOpen = false;
                  void requestDaemonUpdate();
                }}
              >
                <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
                {daemonUpdating
                  ? m.settings_devices_updating_label()
                  : m.layout_daemonStatus_update_action()}
              </Menu.Item>
            {/if}
            {#if !device.isLocal}
              <Menu.Item
                onclick={() => {
                  actionsMenuOpen = false;
                  onOpenPanel('edit');
                }}
              >
                <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
                {m.settings_devices_edit_label()}
              </Menu.Item>
              <Menu.Item
                destructive
                onclick={() => {
                  actionsMenuOpen = false;
                  onRequestRemove(device);
                }}
              >
                <Fa icon={faTrash} class="size-3.5 text-muted-foreground" />
                {m.settings_devices_remove_label()}
              </Menu.Item>
            {/if}
          </div>
        </Menu.Content>
      </Menu.Root>
    {/if}
  </div>

  {#if connectionError}
    <p class="px-4 pb-3 type-body text-danger sm:px-5" role="alert">
      {m.settings_devices_connectFailed_error()}
    </p>
  {/if}

  {#if panelMode === 'edit'}
    <form
      class="space-y-4 border-t border-border bg-muted/20 px-4 py-4 sm:px-5"
      aria-label={m.settings_devices_editForm_ariaLabel({ name: displayName })}
      onsubmit={(event) => {
        event.preventDefault();
        void updateDevice();
      }}
    >
      <div class="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
        <div class="space-y-3">
          <div class="space-y-1">
            <Label for={`device-${device.id}-edit-name`}>{m.settings_devices_name_label()}</Label>
            <Input
              id={`device-${device.id}-edit-name`}
              bind:ref={firstEditInput}
              bind:value={name}
              disabled={busy !== null}
              aria-invalid={nameInvalid || undefined}
            />
            {#if nameInvalid}<p class="type-caption text-danger">
                {m.settings_devices_nameRequired_error()}
              </p>{/if}
          </div>
          <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,10rem)]">
            <div class="space-y-1">
              <Label for={`device-${device.id}-edit-host`}>{m.settings_devices_host_label()}</Label>
              <Input
                id={`device-${device.id}-edit-host`}
                bind:value={host}
                disabled={busy !== null}
                aria-invalid={hostInvalid || undefined}
              />
              {#if hostInvalid}<p class="type-caption text-danger">
                  {m.settings_devices_hostRequired_error()}
                </p>{/if}
            </div>
            <div class="space-y-1">
              <Label for={`device-${device.id}-edit-port`}>{m.settings_devices_port_label()}</Label>
              <Input
                id={`device-${device.id}-edit-port`}
                bind:value={port}
                type="text"
                inputmode="numeric"
                disabled={busy !== null}
                aria-invalid={portInvalid || undefined}
              />
              {#if portInvalid}<p class="type-caption text-danger">
                  {m.settings_devices_portInvalid_error()}
                </p>{/if}
            </div>
          </div>
          <div class="space-y-1">
            <Label for={`device-${device.id}-edit-secret`}>
              {m.settings_devices_newSecret_label()}
            </Label>
            <Input
              id={`device-${device.id}-edit-secret`}
              bind:ref={secretInput}
              bind:value={secret}
              type="password"
              autocomplete="new-password"
              placeholder={m.settings_devices_secret_placeholder()}
              disabled={busy !== null}
            />
          </div>
        </div>
        <div class="space-y-4">
          <fieldset class="space-y-1" disabled={busy !== null}>
            <legend class="type-body font-medium text-foreground"
              >{m.settings_devices_accent_label()}</legend
            >
            <div class="flex flex-wrap gap-1">
              {#each accentOptions as option}
                <Button
                  type="button"
                  variant="plain"
                  class={cn(
                    'flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    option === accent
                      ? option === null
                        ? 'bg-muted/50'
                        : undefined
                      : 'hover:bg-muted/30',
                  )}
                  aria-label={option === null
                    ? m.settings_devices_accentBlank_ariaLabel()
                    : m.settings_devices_accentOption_ariaLabel({ color: accentLabel(option) })}
                  aria-pressed={option === accent}
                  onclick={() => (accent = option)}
                >
                  {#if option === null}
                    <span
                      class="relative size-3.5 rounded-full border border-muted-foreground/60"
                      aria-hidden="true"
                    >
                      <span
                        class="absolute left-0.5 top-1/2 h-px w-2.5 -translate-y-1/2 rotate-45 bg-muted-foreground/60"
                      ></span>
                    </span>
                  {:else}
                    <span
                      class={cn('size-2.5 rounded-full', CONNECTION_ACCENT_CLASSES[option])}
                      style={option === accent ? selectedAccentStyle(option) : undefined}
                      aria-hidden="true"
                    ></span>
                  {/if}
                </Button>
              {/each}
            </div>
          </fieldset>
          <DeviceIconPicker
            record={device}
            bind:value={deviceIcon}
            disabled={busy !== null}
            portal={true}
            class="w-full"
          />
        </div>
      </div>

      <div class="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <!-- Read-only network facts: the candidate hosts the connect race
             tries (refreshed from server.pairingInfo) and the tailcat tunnel
             address when the daemon reports one. -->
        <dl class="space-y-3 type-caption">
          <div class="space-y-1">
            <dt class="text-muted-foreground">
              {m.settings_devices_detectedAddresses_label()}
            </dt>
            <dd>
              {#if detectedHosts.length > 0}
                <ListView
                  items={detectedHosts}
                  getKey={(candidate) => candidate}
                  getText={(candidate) => candidate}
                  class="space-y-0.5 overflow-visible font-mono text-foreground"
                  ariaLabel={m.settings_devices_detectedAddresses_label()}
                >
                  {#snippet row({ item: candidate })}
                    <span class="block break-all">{candidate}</span>
                  {/snippet}
                </ListView>
              {/if}
            </dd>
          </div>
          {#if device.tcAddress}
            <div class="space-y-1">
              <dt class="text-muted-foreground">{m.settings_devices_tunnelAddress_label()}</dt>
              <dd class="flex items-center gap-1">
                <code class="min-w-0 break-all font-mono text-foreground">{device.tcAddress}</code>
                <Button
                  variant="plain"
                  size="icon-compact"
                  type="button"
                  onclick={() => void copyTcAddress()}
                  class="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label={m.settings_devices_tcAddress_copy()}
                >
                  <Fa icon={faCopy} class="size-3" />
                </Button>
              </dd>
            </div>
          {/if}
        </dl>
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p id={`device-${device.id}-detect-hosts-label`} class="type-body text-foreground">
                {m.modals_connect_detectHosts_label()}
              </p>
              <p class="type-caption text-muted-foreground">
                {m.modals_connect_detectHosts_description()}
              </p>
            </div>
            <Switch
              id={`device-${device.id}-detect-hosts`}
              size="sm"
              bind:checked={detectHosts}
              disabled={busy !== null}
              ariaLabelledby={`device-${device.id}-detect-hosts-label`}
            />
          </div>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p id={`device-${device.id}-push-to-cloud-label`} class="type-body text-foreground">
                {m.settings_devices_pushToCloud_label()}
              </p>
              <p class="type-caption text-muted-foreground">
                {syncSupported
                  ? m.settings_devices_pushToCloud_description()
                  : m.settings_backendSync_unsupported_description()}
              </p>
            </div>
            <Switch
              id={`device-${device.id}-push-to-cloud`}
              size="sm"
              bind:checked={() => pushToCloud, setPushToCloud}
              disabled={busy !== null || !syncSupported}
              ariaLabelledby={`device-${device.id}-push-to-cloud-label`}
            />
          </div>
        </div>
      </div>

      {#if cloudRemovalPending}
        <div
          class="space-y-2 rounded-md border border-warning-foreground/30 bg-warning/10 p-3"
          role="alert"
        >
          <p class="type-body font-medium text-foreground">
            {m.settings_devices_removeFromCloud_title()}
          </p>
          <p class="type-caption text-muted-foreground">
            {m.settings_devices_removeFromCloud_description()}
          </p>
          <div class="flex justify-end gap-2">
            <Button variant="ghost-light" size="sm" onclick={cancelCloudRemoval}
              >{m.settings_devices_cancel_label()}</Button
            >
            <Button variant="destructive" size="sm" onclick={confirmCloudRemoval}
              >{m.settings_devices_removeFromCloud_confirm()}</Button
            >
          </div>
        </div>
      {:else if pendingFingerprint}
        <div
          class="space-y-2 rounded-md border border-warning-foreground/30 bg-warning/10 p-3"
          role="alert"
        >
          <p class="type-body font-medium text-foreground">
            {m.settings_devices_confirmFingerprint_title()}
          </p>
          <p class="type-caption text-muted-foreground">
            {m.settings_devices_confirmFingerprint_description()}
          </p>
          <dl class="grid gap-2 type-caption sm:grid-cols-2">
            <div>
              <dt class="text-muted-foreground">
                {m.settings_devices_expectedFingerprint_label()}
              </dt>
              <dd class="break-all font-mono">{pendingFingerprint.expected}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">{m.settings_devices_actualFingerprint_label()}</dt>
              <dd class="break-all font-mono">{pendingFingerprint.actual}</dd>
            </div>
          </dl>
          <div class="flex justify-end gap-2">
            <Button variant="ghost-light" size="sm" onclick={() => (pendingFingerprint = null)}
              >{m.settings_devices_cancel_label()}</Button
            >
            <Button size="sm" onclick={confirmFingerprint}
              >{m.settings_devices_confirmFingerprint_label()}</Button
            >
          </div>
        </div>
      {:else if feedback && feedbackOperation === 'update'}
        <p
          class={feedback.kind === 'error'
            ? 'type-body text-danger'
            : feedback.kind === 'success'
              ? 'type-body text-success-foreground'
              : 'type-body text-muted-foreground'}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      {/if}

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex max-w-full flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || hostInvalid || portInvalid}
            loading={busy === 'test'}
            onclick={() => void testDevice()}>{m.settings_devices_test_label()}</Button
          >
          {#if feedback && feedbackOperation === 'test'}
            <p
              class={feedback.kind === 'error'
                ? 'text-right type-body text-danger'
                : feedback.kind === 'success'
                  ? 'text-right type-body text-success'
                  : 'text-right type-body text-muted-foreground'}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
            >
              {feedback.message}
            </p>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <Button type="button" variant="ghost-light" disabled={busy !== null} onclick={closePanel}
            >{m.settings_devices_cancel_label()}</Button
          >
          <Button
            type="submit"
            disabled={busy !== null || editInvalid || (!editChanged && !secret.trim())}
            loading={busy === 'update'}>{m.settings_devices_update_label()}</Button
          >
        </div>
      </div>
    </form>
  {/if}
</article>
