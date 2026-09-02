<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Menu from '$lib/components/ui/menu';
  import { Tooltip } from '$lib/components/ui/tooltip';
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
    type ConnectionOpenStatus,
    type ConnectionRecord,
    type ConnectionValidationBlockedResult,
    type UpdateConnectionParams,
  } from '$shared/types/connections';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectConnectedIds,
    selectPinnedDaemonVersion,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    openConnectionRequested,
    rotateConnectionSecretRequested,
    testConnectionRequested,
    updateBackendRequested,
    updateConnectionRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    faArrowsRotate,
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
  const pinnedVersion$ = selectPinnedDaemonVersion();
  const connectedIds$ = selectConnectedIds();
  let name = $state('');
  let host = $state('');
  let port = $state('');
  let accent = $state<ConnectionAccent>(DEFAULT_CONNECTION_ACCENT);
  let secret = $state('');
  let busy = $state<'update' | 'test' | null>(null);
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

  const savedAccent = $derived(
    device.accent === undefined ? DEFAULT_CONNECTION_ACCENT : device.accent,
  );
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
  const editChanged = $derived(
    trimmedName !== device.label ||
      trimmedHost !== device.host ||
      portNumber !== device.port ||
      accent !== savedAccent,
  );
  // Behind-pin marker: reflects the last captured daemonVersion, so it shows
  // even while disconnected. The i18n message prepends "v" — strip any
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
    secret = '';
    busy = null;
    feedbackOperation = null;
    feedback = null;
    pendingFingerprint = null;
  }

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

  async function connectDevice() {
    connectionError = false;
    try {
      const action = openConnectionRequested(device.id);
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') openEditForSecretRecovery();
    } catch {
      connectionError = true;
    }
  }

  async function requestDaemonUpdate() {
    try {
      const action = updateBackendRequested(device.id);
      appStore.dispatch(action);
      await action.promise;
    } catch {
      // Outcomes (success and every failure mode) surface as saga-owned
      // toasts; nothing more to do here.
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
      host: trimmedHost,
      port: portNumber,
      ...(confirmedFingerprint ? { confirmedFingerprint } : {}),
    };
  }

  async function updateDevice(confirmedFingerprint?: string, confirmedSecretFingerprint?: string) {
    if (editInvalid || busy) return;
    busy = 'update';
    feedbackOperation = 'update';
    feedback = { kind: 'progress', message: m.settings_devices_updating_label() };
    pendingFingerprint = null;
    try {
      const token = secret.trim();
      if (token) {
        feedback = { kind: 'progress', message: m.settings_devices_replacingSecret_label() };
        const rotateAction = rotateConnectionSecretRequested({
          id: device.id,
          token,
          ...(confirmedSecretFingerprint
            ? { confirmedFingerprint: confirmedSecretFingerprint }
            : {}),
        });
        appStore.dispatch(rotateAction);
        const rotateResult = await rotateAction.promise;
        if (rotateResult.status === 'fingerprint-confirmation-required') {
          pendingFingerprint = {
            operation: 'secret',
            expected: rotateResult.expectedFingerprint,
            actual: rotateResult.actualFingerprint,
          };
          feedback = { kind: 'error', message: blockedMessage(rotateResult) };
          return;
        }
        if (rotateResult.status !== 'updated') {
          feedback = { kind: 'error', message: blockedMessage(rotateResult) };
          return;
        }
        secret = '';
        feedback = { kind: 'progress', message: m.settings_devices_updating_label() };
      }
      const action = updateConnectionRequested(updateParams(confirmedFingerprint));
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'updated') {
        closePanel();
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
    } catch {
      feedback = { kind: 'error', message: m.settings_devices_update_error() };
    } finally {
      busy = null;
    }
  }

  async function testDevice() {
    if (hostInvalid || portInvalid || busy) return;
    busy = 'test';
    feedbackOperation = 'test';
    pendingFingerprint = null;
    feedback = { kind: 'progress', message: m.settings_devices_testing_label() };
    try {
      const action = testConnectionRequested({
        id: device.id,
        host: trimmedHost,
        port: portNumber,
        ...(secret.trim() ? { token: secret.trim() } : {}),
      });
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') {
        openEditForSecretRecovery();
      } else {
        feedback =
          result.status === 'success'
            ? { kind: 'success', message: m.settings_devices_testSuccess_label() }
            : { kind: 'error', message: blockedMessage(result) };
      }
    } catch {
      feedback = { kind: 'error', message: m.settings_devices_testFailed_error() };
    } finally {
      busy = null;
    }
  }

  function confirmFingerprint() {
    if (!pendingFingerprint) return;
    const { operation, actual } = pendingFingerprint;
    if (operation === 'update') void updateDevice(actual);
    else void updateDevice(undefined, actual);
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
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <p
          id={`device-${device.id}-name`}
          class="min-w-0 truncate text-sm font-medium text-foreground"
        >
          {displayName}
        </p>
        {#if openStatus === 'connected' && device.intentdVersion}
          <p class="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {device.intentdVersion}
          </p>
        {/if}
        {#if daemonBehindTooltip}
          <!-- The Tooltip trigger wrapper gives this non-interactive dot a tab
               stop, so the explanation is reachable by keyboard focus too. -->
          <Tooltip content={daemonBehindTooltip} class="shrink-0 self-center">
            <span
              class="block size-2 rounded-full bg-yellow-500"
              role="img"
              aria-label={daemonBehindTooltip}
            ></span>
          </Tooltip>
        {/if}
      </div>
    </div>
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
                onclick={() => {
                  actionsMenuOpen = false;
                  void requestDaemonUpdate();
                }}
              >
                <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
                {m.layout_daemonStatus_update_action()}
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
    <p class="px-4 pb-3 text-sm text-danger sm:px-5" role="alert">
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
            {#if nameInvalid}<p class="text-xs text-danger">
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
              {#if hostInvalid}<p class="text-xs text-danger">
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
              {#if portInvalid}<p class="text-xs text-danger">
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
        <fieldset class="space-y-1" disabled={busy !== null}>
          <legend class="text-sm font-medium text-foreground"
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
      </div>

      {#if pendingFingerprint}
        <div
          class="space-y-2 rounded-md border border-warning-foreground/30 bg-warning/10 p-3"
          role="alert"
        >
          <p class="text-sm font-medium text-foreground">
            {m.settings_devices_confirmFingerprint_title()}
          </p>
          <p class="text-xs text-muted-foreground">
            {m.settings_devices_confirmFingerprint_description()}
          </p>
          <dl class="grid gap-2 text-xs sm:grid-cols-2">
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
            ? 'text-sm text-danger'
            : feedback.kind === 'success'
              ? 'text-sm text-success-foreground'
              : 'text-sm text-muted-foreground'}
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
                ? 'text-right text-sm text-danger'
                : feedback.kind === 'success'
                  ? 'text-right text-sm text-success'
                  : 'text-right text-sm text-muted-foreground'}
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
