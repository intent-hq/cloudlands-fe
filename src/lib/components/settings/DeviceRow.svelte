<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { onDestroy, untrack } from 'svelte';
  import WebSocketApiSettings from './WebSocketApiSettings.svelte';
  import {
    Button,
    Input,
    Label,
    Switch,
    Tooltip,
  } from '$lib/components/patterns/settings/custom-controls';
  import {
    ListRow,
    ListView,
    RowActions,
    type ActionDefinition,
  } from '$lib/components/patterns/collection';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import DeviceIconPicker from '$lib/components/DeviceIconPicker.svelte';
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
    selectCurrentConnectionId,
    selectKeychainSyncState,
    selectPinnedDaemonVersion,
    selectConnectionWorkflow,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    connectionWorkflowRequested,
    connectionWorkflowCleared,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    faArrowsRotate,
    faCopy,
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
  const pinnedVersion$ = selectPinnedDaemonVersion();
  const connectedIds$ = selectConnectedIds();
  const currentConnectionId$ = selectCurrentConnectionId();
  const syncState$ = selectKeychainSyncState();
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
  const consumerId = $props.id();
  const openConsumerId = `${consumerId}:open`;
  const daemonConsumerId = `${consumerId}:daemon`;
  const workflow$ = selectConnectionWorkflow(consumerId);
  const openWorkflow$ = selectConnectionWorkflow(openConsumerId);
  const daemonWorkflow$ = selectConnectionWorkflow(daemonConsumerId);
  const busy = $derived(
    $workflow$ && $workflow$.phase !== 'settled'
      ? $workflow$.kind === 'test'
        ? 'test'
        : 'update'
      : null,
  );
  const daemonUpdating = $derived(!!$daemonWorkflow$ && $daemonWorkflow$.phase !== 'settled');
  const connectionError = $derived($openWorkflow$?.outcome?.kind === 'error');
  const feedbackOperation = $derived($workflow$?.kind === 'test' ? 'test' : 'update');
  const pendingFingerprint = $derived.by(() => {
    const outcome = $workflow$?.outcome;
    return outcome?.kind === 'blocked' &&
      outcome.operation !== 'test' &&
      outcome.result.status === 'fingerprint-confirmation-required'
      ? {
          operation: outcome.operation,
          expected: outcome.result.expectedFingerprint,
          actual: outcome.result.actualFingerprint,
        }
      : null;
  });
  const feedback = $derived.by(
    (): { kind: 'success' | 'error' | 'progress'; message: string } | null => {
      const workflow = $workflow$;
      if (!workflow || workflow.kind === 'localIcon') return null;
      if (busy)
        return {
          kind: 'progress',
          message:
            workflow.phase === 'secret'
              ? m.settings_devices_replacingSecret_label()
              : workflow.phase === 'sync'
                ? m.settings_devices_enablingSync_label()
                : busy === 'test'
                  ? m.settings_devices_testing_label()
                  : m.settings_devices_updating_label(),
        };
      const outcome = workflow.outcome;
      if (outcome?.kind === 'tested')
        return { kind: 'success', message: m.settings_devices_testSuccess_label() };
      if (outcome?.kind === 'blocked')
        return { kind: 'error', message: blockedMessage(outcome.result) };
      if (outcome?.kind === 'syncError')
        return { kind: 'error', message: m.settings_devices_enableSync_error() };
      if (outcome?.kind === 'error')
        return {
          kind: 'error',
          message:
            workflow.kind === 'test'
              ? m.settings_devices_testFailed_error()
              : m.settings_devices_update_error(),
        };
      return null;
    },
  );
  onDestroy(() => {
    for (const id of [consumerId, openConsumerId, daemonConsumerId])
      appStore.dispatch(connectionWorkflowCleared(id));
  });
  $effect(() => {
    if ($workflow$?.secretReplaced) secret = '';
    const outcome = $workflow$?.outcome;
    if (outcome?.kind === 'done') {
      const close = $workflow$?.kind === 'save';
      appStore.dispatch(connectionWorkflowCleared(consumerId));
      if (close) untrack(closePanel);
    } else if (outcome?.kind === 'secretUnavailable') {
      appStore.dispatch(connectionWorkflowCleared(consumerId));
      untrack(openEditForSecretRecovery);
    } else if (outcome?.kind === 'error' && $workflow$?.kind === 'localIcon')
      localDeviceIcon = savedDeviceIcon;
    if ($openWorkflow$?.outcome?.kind === 'secretUnavailable') {
      appStore.dispatch(connectionWorkflowCleared(openConsumerId));
      untrack(openEditForSecretRecovery);
    }
    if ($daemonWorkflow$?.phase === 'settled')
      appStore.dispatch(connectionWorkflowCleared(daemonConsumerId));
  });
  let initializedPanel = $state<string | null>(null);
  let actionsButton: HTMLButtonElement | null = $state(null);
  let firstEditInput: HTMLInputElement | null = $state(null);
  let secretInput: HTMLInputElement | null = $state(null);
  let focusSecretOnEdit = $state(false);

  const savedAccent = $derived(
    device.accent === undefined ? DEFAULT_CONNECTION_ACCENT : device.accent,
  );
  const savedDeviceIcon = $derived(device.deviceIcon ?? 'auto');
  const accentOptions = $derived(connectionAccentOptions(savedAccent));
  const displayName = $derived(
    device.isLocal
      ? $currentConnectionId$ === device.id
        ? m.layout_daemonStatus_localConnection_label()
        : m.settings_devices_hostMachine_label()
      : formatConnectionLabel(device),
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
  const rowActions = $derived.by((): ActionDefinition[] => [
    ...(!device.isLocal
      ? [{ id: 'connect', label: m.settings_devices_connect_label(), icon: faPlug }]
      : []),
    ...(canUpdateDaemon
      ? [
          {
            id: 'update',
            label: daemonUpdating
              ? m.settings_devices_updating_label()
              : m.layout_daemonStatus_update_action(),
            icon: faArrowsRotate,
            disabled: daemonUpdating,
          },
        ]
      : []),
    { id: 'edit', label: m.settings_devices_edit_label(), icon: faPen },
    ...(!device.isLocal
      ? [
          {
            id: 'remove',
            label: m.settings_devices_remove_label(),
            icon: faTrash,
            destructive: true,
          },
        ]
      : []),
  ]);

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
    appStore.dispatch(connectionWorkflowCleared(consumerId));
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
    appStore.dispatch(connectionWorkflowCleared(consumerId));
    if (panelMode === 'edit') {
      requestAnimationFrame(() => secretInput?.focus());
    } else {
      focusSecretOnEdit = true;
      onOpenPanel('edit');
    }
  }

  function connectDevice() {
    appStore.dispatch(connectionWorkflowRequested(openConsumerId, { kind: 'open', id: device.id }));
  }

  function requestDaemonUpdate() {
    if (daemonUpdating) return;
    appStore.dispatch(
      connectionWorkflowRequested(daemonConsumerId, { kind: 'updateBackend', id: device.id }),
    );
  }

  function handleRowAction(id: string) {
    switch (id) {
      case 'connect':
        void connectDevice();
        break;
      case 'update':
        void requestDaemonUpdate();
        break;
      case 'edit':
        if (panelMode === 'edit') closePanel();
        else onOpenPanel('edit');
        break;
      case 'remove':
        onRequestRemove(device);
        break;
    }
  }

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
      ? 'bg-success'
      : status === 'connecting'
        ? 'bg-warning'
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
    appStore.dispatch(
      connectionWorkflowRequested(consumerId, {
        kind: 'localIcon',
        params: {
          id: device.id,
          label: device.label,
          accent: null,
          deviceIcon: nextDeviceIcon,
        },
      }),
    );
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
    // before the update promise settles.
    const enableSyncAfterUpdate = !savedPushToCloud && pushToCloud && !syncEnabled;
    const token = secret.trim();
    appStore.dispatch(
      connectionWorkflowRequested(consumerId, {
        kind: 'save',
        params: updateParams(confirmedFingerprint),
        enableSync: enableSyncAfterUpdate,
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
      }),
    );
  }

  function testDevice() {
    if (hostInvalid || portInvalid || busy) return;
    appStore.dispatch(
      connectionWorkflowRequested(consumerId, {
        kind: 'test',
        params: {
          id: device.id,
          host: trimmedHost,
          port: portNumber,
          ...(secret.trim() ? { token: secret.trim() } : {}),
        },
      }),
    );
  }

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
      const { notify } = await import('$lib/components/patterns/notify');
      notify.success(m.settings_devices_tcAddress_copied());
    } catch {
      const { notify } = await import('$lib/components/patterns/notify');
      notify.error(m.settings_devices_tcAddress_copyError());
    }
  }
</script>

<article
  class={cn('group/collection-row', !device.isLocal && 'border-t border-border')}
  aria-labelledby={`device-${device.id}-name`}
  aria-busy={busy !== null}
>
  <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
    {#snippet leading()}
      <span class="flex items-center gap-3">
        <span
          class={cn(
            'size-2.5 rounded-full ring-2 ring-background outline outline-1 outline-border',
            statusClass(openStatus),
          )}
          role="status"
          aria-label={m.settings_devices_status_ariaLabel({ status: statusLabel(openStatus) })}
        ></span>
        <DeviceIcon record={device} size={20} class="text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}<span id={`device-${device.id}-name`}>{displayName}</span>{/snippet}
    {#snippet meta()}
      {#if openStatus === 'connected' && device.intentdVersion}
        {#if daemonBehindTooltip}
          <Tooltip content={daemonBehindTooltip} class="rounded-sm text-warning-ink">
            <span>{device.intentdVersion}</span>
          </Tooltip>
        {:else}
          <span>{device.intentdVersion}</span>
        {/if}
      {/if}
    {/snippet}
    {#snippet trailing()}
      <RowActions
        alwaysVisible
        actions={rowActions}
        onAction={handleRowAction}
        visibleCount={0}
        overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name: displayName })}
        bind:overflowTriggerRef={actionsButton}
      />
    {/snippet}
  </ListRow>

  {#if connectionError}
    <p class="px-4 pb-3 type-body text-danger sm:px-5" role="alert">
      {m.settings_devices_connectFailed_error()}
    </p>
  {/if}

  {#if device.isLocal}
    <div
      class="px-4 pb-4 sm:px-5"
      hidden={$currentConnectionId$ !== device.id && panelMode !== 'edit'}
    >
      <WebSocketApiSettings expanded={panelMode === 'edit'} onEnabled={() => onOpenPanel('edit')}>
        <SettingsFieldRow id="local-device-icon" label={m.settings_devices_icon_label()}>
          {#snippet control()}
            <DeviceIconPicker
              record={device}
              bind:value={localDeviceIcon}
              disabled={busy !== null}
              portal={true}
              onchange={(value) => void updateLocalDeviceIcon(value)}
            />
          {/snippet}
        </SettingsFieldRow>
      </WebSocketApiSettings>
    </div>
  {/if}

  {#if panelMode === 'edit' && !device.isLocal}
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
            {#if nameInvalid}<p class="type-body text-danger">
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
              {#if hostInvalid}<p class="type-body text-danger">
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
              {#if portInvalid}<p class="type-body text-danger">
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
                  type="button"
                  variant="ghost-light"
                  size="icon-xs"
                  onclick={() => void copyTcAddress()}
                  class="size-5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  aria-label={m.settings_devices_tcAddress_copy()}
                >
                  <Fa icon={faCopy} class="size-3" />
                </Button>
              </dd>
            </div>
          {/if}
        </dl>
        <div class="space-y-3">
          <SettingsFieldRow
            id={`device-${device.id}-detect-hosts-field`}
            compact
            label={m.modals_connect_detectHosts_label()}
            description={m.modals_connect_detectHosts_description()}
          >
            <Switch
              id={`device-${device.id}-detect-hosts`}
              size="sm"
              bind:checked={detectHosts}
              disabled={busy !== null}
              ariaLabelledby={`device-${device.id}-detect-hosts-field-label`}
            />
          </SettingsFieldRow>
          <SettingsFieldRow
            id={`device-${device.id}-push-to-cloud-field`}
            compact
            label={m.settings_devices_pushToCloud_label()}
            description={syncSupported
              ? m.settings_devices_pushToCloud_description()
              : m.settings_backendSync_unsupported_description()}
          >
            <Switch
              id={`device-${device.id}-push-to-cloud`}
              size="sm"
              bind:checked={() => pushToCloud, setPushToCloud}
              disabled={busy !== null || !syncSupported}
              ariaLabelledby={`device-${device.id}-push-to-cloud-field-label`}
            />
          </SettingsFieldRow>
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
          <p class="type-body text-muted-foreground">
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
          <p class="type-body text-muted-foreground">
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
            <Button
              variant="ghost-light"
              size="sm"
              onclick={() => appStore.dispatch(connectionWorkflowCleared(consumerId))}
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
