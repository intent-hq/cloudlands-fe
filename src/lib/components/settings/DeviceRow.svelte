<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import { CONNECTION_ACCENT_CLASSES } from '$lib/utils/connection-accents';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CONNECTION_ACCENTS,
    DEFAULT_CONNECTION_ACCENT,
    type ConnectionAccent,
    type ConnectionOpenStatus,
    type ConnectionRecord,
    type ConnectionValidationBlockedResult,
    type UpdateConnectionParams,
  } from '$shared/types/connections';
  import { store as appStore } from '$store/renderer/store';
  import {
    openConnectionRequested,
    rotateConnectionSecretRequested,
    testConnectionRequested,
    updateConnectionRequested,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    faEllipsisVertical,
    faKey,
    faPen,
    faPlug,
    faTrash,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  export type DevicePanelMode = 'edit' | 'secret' | null;

  interface Props {
    device: ConnectionRecord;
    panelMode: DevicePanelMode;
    onOpenPanel: (panel: Exclude<DevicePanelMode, null>) => void;
    onClosePanel: () => void;
    onRequestRemove: (device: ConnectionRecord) => void;
  }

  let { device, panelMode, onOpenPanel, onClosePanel, onRequestRemove }: Props = $props();
  let name = $state('');
  let host = $state('');
  let port = $state('');
  let accent = $state<ConnectionAccent>(DEFAULT_CONNECTION_ACCENT);
  let secret = $state('');
  let busy = $state<'update' | 'test' | 'secret' | null>(null);
  let feedback = $state<{ kind: 'success' | 'error' | 'progress'; message: string } | null>(null);
  let connectionError = $state(false);
  let pendingFingerprint = $state<{
    operation: 'update' | 'secret';
    expected: string;
    actual: string;
  } | null>(null);
  let initializedPanel = $state<string | null>(null);
  let actionsButton: HTMLButtonElement | null = $state(null);
  let firstEditInput: HTMLInputElement | null = $state(null);
  let secretInput: HTMLInputElement | null = $state(null);

  const savedAccent = $derived(device.accent ?? DEFAULT_CONNECTION_ACCENT);
  const address = $derived(`${device.host ?? ''}:${device.port ?? ''}`);
  const displayName = $derived(device.label.trim() || address);
  const displayHostname = $derived.by(() => {
    const hostname = device.hostname?.trim();
    return hostname && hostname !== displayName ? hostname : null;
  });
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
  const secretInvalid = $derived(secret.trim().length === 0);

  function resetPanel() {
    name = device.label;
    host = device.host ?? '';
    port = device.port == null ? '' : String(device.port);
    accent = savedAccent;
    secret = '';
    busy = null;
    feedback = null;
    pendingFingerprint = null;
  }

  $effect(() => {
    const panelKey = panelMode ? `${device.id}:${panelMode}` : null;
    if (panelKey === initializedPanel) return;
    initializedPanel = panelKey;
    untrack(resetPanel);
    if (panelMode) {
      requestAnimationFrame(() => (panelMode === 'edit' ? firstEditInput : secretInput)?.focus());
    }
  });

  function closePanel() {
    onClosePanel();
    queueMicrotask(() => actionsButton?.focus());
  }

  async function connectDevice() {
    connectionError = false;
    try {
      const action = openConnectionRequested(device.id);
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') onOpenPanel('secret');
    } catch {
      connectionError = true;
    }
  }

  function accentLabel(value: ConnectionAccent): string {
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

  async function updateDevice(confirmedFingerprint?: string) {
    if (editInvalid || busy) return;
    busy = 'update';
    feedback = { kind: 'progress', message: m.settings_devices_updating_label() };
    pendingFingerprint = null;
    try {
      const action = updateConnectionRequested(updateParams(confirmedFingerprint));
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'updated') {
        closePanel();
      } else if (result.status === 'secret-unavailable') {
        onOpenPanel('secret');
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
    pendingFingerprint = null;
    feedback = { kind: 'progress', message: m.settings_devices_testing_label() };
    try {
      const action = testConnectionRequested({
        id: device.id,
        host: trimmedHost,
        port: portNumber,
      });
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') {
        onOpenPanel('secret');
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

  async function replaceSecret(confirmedFingerprint?: string) {
    const token = secret.trim();
    if (!token || busy) return;
    busy = 'secret';
    feedback = { kind: 'progress', message: m.settings_devices_replacingSecret_label() };
    pendingFingerprint = null;
    try {
      const action = rotateConnectionSecretRequested({
        id: device.id,
        token,
        ...(confirmedFingerprint ? { confirmedFingerprint } : {}),
      });
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'updated') {
        secret = '';
        feedback = { kind: 'success', message: m.settings_devices_secretReplaced_label() };
      } else if (result.status === 'fingerprint-confirmation-required') {
        pendingFingerprint = {
          operation: 'secret',
          expected: result.expectedFingerprint,
          actual: result.actualFingerprint,
        };
        feedback = { kind: 'error', message: blockedMessage(result) };
      } else {
        feedback = { kind: 'error', message: blockedMessage(result) };
      }
    } catch {
      feedback = { kind: 'error', message: m.settings_devices_replaceSecret_error() };
    } finally {
      busy = null;
    }
  }

  function confirmFingerprint() {
    if (!pendingFingerprint) return;
    const { operation, actual } = pendingFingerprint;
    if (operation === 'update') void updateDevice(actual);
    else void replaceSecret(actual);
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
      <p id={`device-${device.id}-name`} class="truncate text-sm font-medium text-foreground">
        {displayName}
      </p>
      {#if displayHostname}
        <p class="truncate text-xs text-muted-foreground">{displayHostname}</p>
      {/if}
      {#if openStatus === 'connected' && device.intentdVersion}
        <p class="truncate text-xs text-muted-foreground">
          {m.settings_devices_version_label({ version: device.intentdVersion })}
        </p>
      {/if}
    </div>
    <DropdownMenu align="end" contentClass="p-0!">
      {#snippet trigger({ props })}
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
      {#snippet content({ close }: { close: () => void })}
        <div class="w-44 py-1">
          <Menu.Item
            onclick={() => {
              close();
              void connectDevice();
            }}
          >
            <Fa icon={faPlug} class="size-3.5 text-muted-foreground" />
            {m.settings_devices_connect_label()}
          </Menu.Item>
          <Menu.Item
            onclick={() => {
              close();
              onOpenPanel('edit');
            }}
          >
            <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
            {m.settings_devices_edit_label()}
          </Menu.Item>
          <Menu.Item
            onclick={() => {
              close();
              onOpenPanel('secret');
            }}
          >
            <Fa icon={faKey} class="size-3.5 text-muted-foreground" />
            {m.settings_devices_replaceSecret_label()}
          </Menu.Item>
          <Menu.Item
            destructive
            onclick={() => {
              close();
              onRequestRemove(device);
            }}
          >
            <Fa icon={faTrash} class="size-3.5 text-muted-foreground" />
            {m.settings_devices_remove_label()}
          </Menu.Item>
        </div>
      {/snippet}
    </DropdownMenu>
  </div>

  {#if connectionError}
    <p class="px-4 pb-3 text-sm text-error-foreground sm:px-5" role="alert">
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
            {#if nameInvalid}<p class="text-xs text-error-foreground">
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
              {#if hostInvalid}<p class="text-xs text-error-foreground">
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
              {#if portInvalid}<p class="text-xs text-error-foreground">
                  {m.settings_devices_portInvalid_error()}
                </p>{/if}
            </div>
          </div>
        </div>
        <fieldset class="space-y-2" disabled={busy !== null}>
          <legend class="text-sm font-medium text-foreground"
            >{m.settings_devices_accent_label()}</legend
          >
          <div class="flex flex-wrap gap-2">
            {#each CONNECTION_ACCENTS as option}
              <button
                type="button"
                class={cn(
                  'flex size-7 cursor-pointer items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  option === accent
                    ? cn('border-transparent', CONNECTION_ACCENT_CLASSES[option])
                    : 'border-border/60 bg-transparent hover:border-border hover:bg-muted/30',
                )}
                aria-label={m.settings_devices_accentOption_ariaLabel({
                  color: accentLabel(option),
                })}
                aria-pressed={option === accent}
                onclick={() => (accent = option)}
              >
                {#if option !== accent}
                  <span
                    class={cn('size-3.5 rounded-full', CONNECTION_ACCENT_CLASSES[option])}
                    aria-hidden="true"
                  ></span>
                {/if}
              </button>
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
      {:else if feedback}
        <p
          class={feedback.kind === 'error'
            ? 'text-sm text-error-foreground'
            : feedback.kind === 'success'
              ? 'text-sm text-success-foreground'
              : 'text-sm text-muted-foreground'}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      {/if}

      <div class="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || hostInvalid || portInvalid}
          loading={busy === 'test'}
          onclick={() => void testDevice()}>{m.settings_devices_test_label()}</Button
        >
        <Button type="button" variant="ghost-light" disabled={busy !== null} onclick={closePanel}
          >{m.settings_devices_cancel_label()}</Button
        >
        <Button
          type="submit"
          disabled={busy !== null || editInvalid || !editChanged}
          loading={busy === 'update'}>{m.settings_devices_update_label()}</Button
        >
      </div>
    </form>
  {:else if panelMode === 'secret'}
    <form
      class="space-y-4 border-t border-border bg-muted/20 px-4 py-4 sm:px-5"
      aria-label={m.settings_devices_secretForm_ariaLabel({ name: displayName })}
      onsubmit={(event) => {
        event.preventDefault();
        void replaceSecret();
      }}
    >
      <div class="space-y-1">
        <Label for={`device-${device.id}-secret`}>{m.settings_devices_newSecret_label()}</Label>
        <p class="text-xs text-muted-foreground">{m.settings_devices_newSecret_description()}</p>
        <Input
          id={`device-${device.id}-secret`}
          bind:ref={secretInput}
          bind:value={secret}
          type="password"
          autocomplete="new-password"
          disabled={busy !== null}
        />
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
      {:else if feedback}
        <p
          class={feedback.kind === 'error'
            ? 'text-sm text-error-foreground'
            : feedback.kind === 'success'
              ? 'text-sm text-success-foreground'
              : 'text-sm text-muted-foreground'}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost-light" disabled={busy !== null} onclick={closePanel}
          >{m.settings_devices_cancel_label()}</Button
        >
        <Button type="submit" disabled={busy !== null || secretInvalid} loading={busy === 'secret'}
          >{m.settings_devices_replaceSecret_label()}</Button
        >
      </div>
    </form>
  {/if}
</article>
