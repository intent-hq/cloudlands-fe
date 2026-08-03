<script lang="ts">
  /**
   * Hardware / Creator Micro settings panel.
   *
   * Integration enable/disable toggle, interactive device graphic with
   * action-key mapping (live-updates the shared hardwareConsole.state
   * mapping via the action-key persistence middleware), prompt-picker limit
   * control, connection status line, and — on web builds where WebHID is
   * available — a user-gesture "Connect device" button.
   *
   * Connection details (transport/firmware/battery) are transient UI state
   * read from the shared manager (WebSocketApiSettings precedent); the
   * persisted settings live in Redux + the daemon bag.
   */
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { Select } from '$lib/components/ui/select';
  import Button from '$lib/components/ui/button/button.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import { store as appStore } from '$store/renderer/store';
  import {
    setActionKeyMapping,
    setCycleScope,
    setHardwareConsoleEnabled,
    setPromptPickerLimit,
  } from '$store/renderer/slices/hardware-console/hardware-console-slice';
  import {
    selectHardwareConsoleActionMappingsByModel,
    selectHardwareConsoleCycleScopes,
    selectHardwareConsoleEnabled,
    selectHardwareConsoleKeySlots,
    selectPromptPickerLimit,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { buildHardwareLedSnapshot } from '$features/hardware-console/led';
  import { ACTION_KEY_REGISTRY } from '$features/hardware-console/actions/action-key-registry';
  import {
    CODEX_MIC_LINKED_SLOT,
    getDefaultActionMapping,
    type ActionKeyActionId,
  } from '$features/hardware-console/actions/action-mapping';
  import {
    CYCLE_SCOPE_FAMILY_IDS,
    type CycleScopeFamilyId,
  } from '$features/hardware-console/actions/cycle-scope';
  import type { HardwareDeviceModel } from '$features/hardware-console/input/types';
  import { getHardwareConsoleManager } from '$features/hardware-console/instance';
  import type { HardwareConsoleStatus } from '$features/hardware-console/device/device-manager';
  import { getNavigatorHid } from '$features/hardware-console/device/platform';
  import {
    inferTransportFromCollectionCount,
    type HardwareConsoleTransport,
  } from '$features/hardware-console/device/transport-heuristic';
  import {
    probeConnectedDevice,
    type DeviceConnectionSnapshot,
  } from '$features/hardware-console/codex-probe';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { MAX_PROMPT_PICKER_LIMIT } from '$features/hardware-console/prompt-picker/curation';
  import HardwareConsoleDeviceSvg, { codexCapLabel } from './HardwareConsoleDeviceSvg.svelte';

  const enabled$ = selectHardwareConsoleEnabled();
  const promptPickerLimit$ = selectPromptPickerLimit();
  const actionMappingsByModel$ = selectHardwareConsoleActionMappingsByModel();
  const cycleScopes$ = selectHardwareConsoleCycleScopes();
  const keySlots$ = selectHardwareConsoleKeySlots();
  const workspaceItems$ = selectWorkspaceItems();

  // Cycle-scope checkbox rows: one per togglable family, labeled with the
  // family's action label from the registry (locale-reactive getter).
  const cycleScopeFamilies = CYCLE_SCOPE_FAMILY_IDS.map((familyId) => ({
    familyId,
    get label() {
      return ACTION_KEY_REGISTRY.find((entry) => entry.id === familyId)?.label ?? familyId;
    },
  }));

  // Web-build Connect button: only where WebHID exists and outside Electron
  // (Electron auto-grants; no user gesture is needed there).
  const webHidAvailable = getNavigatorHid() !== null;
  const showConnectButton = !isElectronPlatform() && webHidAvailable;

  let selectedSlot = $state<number | null>(null);
  let connectionStatus = $state<HardwareConsoleStatus>('unavailable');
  let deviceName = $state<string | null>(null);
  // Model whose mapping the panel edits: the connected device's (kept on
  // disconnect so mid-edit state survives), CM2 before any connection.
  let deviceModel = $state<HardwareDeviceModel>('creator-micro-2');
  let transport = $state<HardwareConsoleTransport>('unknown');
  let snapshot = $state<DeviceConnectionSnapshot | null>(null);
  let connecting = $state(false);
  let connectFailed = $state(false);

  const promptLimitOptions = Array.from({ length: MAX_PROMPT_PICKER_LIMIT }, (_, i) => i + 1);

  async function refreshConnectionDetails() {
    const manager = getHardwareConsoleManager();
    deviceName = manager.connectedDevice?.name ?? null;
    deviceModel = manager.connectedDevice?.model ?? 'creator-micro-2';
    const client = manager.client;
    if (!client) {
      transport = 'unknown';
      snapshot = null;
      return;
    }
    const [probed, collectionCount] = await Promise.all([
      probeConnectedDevice(client),
      manager.connectedCollectionCount().catch(() => 0),
    ]);
    if (manager.status !== 'connected') return;
    snapshot = probed;
    transport = inferTransportFromCollectionCount(collectionCount);
  }

  onMount(() => {
    const manager = getHardwareConsoleManager();
    connectionStatus = manager.status;
    if (manager.status === 'connected') void refreshConnectionDetails();
    return manager.onStatusChange((status) => {
      connectionStatus = status;
      if (status === 'connected') {
        connectFailed = false;
        void refreshConnectionDetails();
      } else {
        deviceName = null;
        transport = 'unknown';
        snapshot = null;
      }
    });
  });

  function handleEnabledChange(value: string | boolean) {
    appStore.dispatch(setHardwareConsoleEnabled(Boolean(value)));
  }

  function handleLimitChange(value: string) {
    const limit = Number(value);
    if (Number.isInteger(limit)) appStore.dispatch(setPromptPickerLimit(limit));
  }

  function handleActionChange(value: string) {
    if (selectedSlot === null) return;
    appStore.dispatch(setActionKeyMapping(deviceModel, selectedSlot, value as ActionKeyActionId));
  }

  function handleCycleScopeChange(familyId: CycleScopeFamilyId, includeSubAgents: boolean) {
    appStore.dispatch(setCycleScope(familyId, includeSubAgents ? 'all' : 'top-level'));
  }

  function handleResetMapping() {
    const current =
      selectHardwareConsoleActionMappingsByModel.select(appStore.state)[deviceModel] ?? [];
    getDefaultActionMapping(deviceModel).forEach((actionId, slot) => {
      if (current[slot] !== actionId) {
        appStore.dispatch(setActionKeyMapping(deviceModel, slot, actionId));
      }
    });
  }

  async function handleConnect() {
    connecting = true;
    connectFailed = false;
    try {
      const connected = await getHardwareConsoleManager().requestConnect();
      connectFailed = !connected;
    } catch {
      connectFailed = true;
    } finally {
      connecting = false;
    }
  }

  // Resolved agent-key slot assignments for the device graphic badges;
  // interactive only while a device is connected (same gating as the lists).
  const agentSlots = $derived(
    $keySlots$.map((workspaceId) => ({
      workspaceId,
      name:
        workspaceId === null
          ? null
          : ($workspaceItems$.find((workspace) => workspace.id === workspaceId)?.title ?? null),
    })),
  );
  const agentKeysInteractive = $derived(connectionStatus === 'connected');

  // Status line for the key's workspace-info popover: the same per-slot
  // state the LED engine surfaces (one-time read at popover open).
  function agentKeyStatusLabel(slot: number): string | null {
    switch (buildHardwareLedSnapshot(appStore.state).keys[slot]) {
      case 'idle':
        return m.settings_hardware_ledStatus_idle_label();
      case 'running':
        return m.settings_hardware_ledStatus_running_label();
      case 'complete':
        return m.settings_hardware_ledStatus_complete_label();
      case 'attention':
        return m.settings_hardware_ledStatus_attention_label();
      case 'failed':
        return m.settings_hardware_ledStatus_failed_label();
      default:
        return null;
    }
  }

  const actionMapping = $derived($actionMappingsByModel$[deviceModel] ?? []);
  const selectedActionId = $derived(
    selectedSlot === null ? null : (actionMapping[selectedSlot] ?? 'none'),
  );
  const isDefaultMapping = $derived(
    getDefaultActionMapping(deviceModel).every(
      (actionId, slot) => actionMapping[slot] === actionId,
    ),
  );
  const selectedActionLabel = $derived(
    ACTION_KEY_REGISTRY.find((entry) => entry.id === selectedActionId)?.label ?? '',
  );
  const selectedKeyLabel = $derived(
    selectedSlot === null
      ? ''
      : deviceModel === 'codex-micro'
        ? m.settings_hardware_codexActionKey_label({
            number: String(selectedSlot + 1),
            cap: codexCapLabel(selectedSlot),
          })
        : m.settings_hardware_actionKey_label({ number: String(selectedSlot + 1) }),
  );
  // Codex linked Mic pair: an action assigned to the second switch (ACT11)
  // only fires if the user re-caps the pair as two separate keys — warn
  // whenever that key's dropdown is open/selected.
  const showLinkedKeyWarning = $derived(
    deviceModel === 'codex-micro' && selectedSlot === CODEX_MIC_LINKED_SLOT,
  );

  const transportText = $derived(
    transport === 'usb'
      ? m.hardwareConsole_connectionToast_transportUsb_label()
      : transport === 'bluetooth'
        ? m.hardwareConsole_connectionToast_transportBluetooth_label()
        : null,
  );

  const statusDetails = $derived.by(() => {
    const parts: string[] = [];
    if (transportText) parts.push(transportText);
    if (snapshot?.firmwareVersion) {
      parts.push(
        m.hardwareConsole_connectionToast_firmware_description({
          version: snapshot.firmwareVersion,
        }),
      );
    }
    if (snapshot && snapshot.batteryPercent !== null) {
      const percent = formatNumber(snapshot.batteryPercent / 100, {
        style: 'percent',
        maximumFractionDigits: 0,
      });
      parts.push(
        snapshot.isCharging
          ? m.hardwareConsole_connectionToast_batteryCharging_description({ percent })
          : m.hardwareConsole_connectionToast_battery_description({ percent }),
      );
    }
    return parts.join(' · ');
  });
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <!-- Enable toggle -->
  <section class="px-6 py-5">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-foreground">{m.settings_hardware_enable_label()}</p>
        <p class="text-xs text-subtle mt-1">{m.settings_hardware_enable_description()}</p>
      </div>
      <Toggle
        pressed={$enabled$}
        onChange={handleEnabledChange}
        variant="indicator"
        size="xs"
        class="mb-auto"
        ariaLabel={m.settings_hardware_enable_label()}
      />
    </div>
  </section>

  {#if $enabled$}
    <!-- Connection status -->
    <section class="px-6 py-4">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-foreground">
            {m.settings_hardware_status_label()}
          </p>
          {#if connectionStatus === 'connected' && deviceName}
            <p class="text-xs text-subtle mt-0.5">
              <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 align-middle"
              ></span>{m.settings_hardware_status_connected_label({ name: deviceName })}
              {#if statusDetails}
                <!-- i18n-ignore (separator glyph) -->
                <span class="mx-1">·</span>{statusDetails}
              {/if}
            </p>
          {:else if connectionStatus === 'connecting'}
            <p class="text-xs text-subtle mt-0.5">
              {m.settings_hardware_status_connecting_label()}
            </p>
          {:else if connectionStatus === 'unavailable'}
            <p class="text-xs text-subtle mt-0.5">
              {m.settings_hardware_status_unavailable_label()}
            </p>
          {:else}
            <p class="text-xs text-subtle mt-0.5">
              {m.settings_hardware_status_disconnected_label()}
            </p>
          {/if}
          {#if connectFailed}
            <p class="text-xs text-amber-500/90 mt-1">
              {m.settings_hardware_connectFailed_error()}
            </p>
          {/if}
        </div>
        {#if showConnectButton && connectionStatus !== 'connected'}
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            disabled={connecting}
            onclick={handleConnect}
          >
            {m.settings_hardware_connect_button()}
          </Button>
        {/if}
      </div>
    </section>

    <!-- Action keys: device graphic + assignment dropdown -->
    <section class="px-6 py-5">
      <p class="text-sm font-medium text-foreground">{m.settings_hardware_actionKeys_label()}</p>
      <p class="text-xs text-subtle mt-1 mb-4">
        {m.settings_hardware_actionKeys_description()}
      </p>
      <div class="flex flex-col sm:flex-row gap-6 items-start">
        <HardwareConsoleDeviceSvg
          model={deviceModel}
          {selectedSlot}
          onSelectKey={(slot) => (selectedSlot = slot)}
          {agentSlots}
          {agentKeysInteractive}
          {agentKeyStatusLabel}
        />
        <div class="w-full sm:w-[240px] shrink-0">
          {#if selectedSlot !== null}
            <p class="text-xs font-medium text-muted-foreground mb-2">
              {selectedKeyLabel}
            </p>
            <Select.Root value={selectedActionId ?? 'none'} onchange={handleActionChange}>
              <Select.Trigger>
                <span class="truncate">{selectedActionLabel}</span>
              </Select.Trigger>
              <Select.Content portal class="max-h-[300px]">
                {#each ACTION_KEY_REGISTRY as entry (entry.id)}
                  <Select.Item value={entry.id}>
                    <span class="inline-flex items-center gap-2">
                      <Fa icon={entry.icon} size="sm" class="text-muted-foreground" />
                      <span class="truncate">{entry.label}</span>
                    </span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            {#if showLinkedKeyWarning}
              <p class="text-xs text-amber-500/90 mt-2">
                {m.settings_hardware_linkedKey_warning()}
              </p>
            {/if}
          {:else}
            <p class="text-xs text-subtle">
              {m.settings_hardware_actionKeys_selectPrompt()}
            </p>
          {/if}
        </div>
      </div>
      <div class="mt-4">
        <Button
          variant="ghost-light"
          size="xs"
          disabled={isDefaultMapping}
          onclick={handleResetMapping}
        >
          {m.settings_hardware_actionKeys_reset_button()}
        </Button>
      </div>
    </section>

    <!-- Cycle scope: which cycle actions include sub-agents -->
    <section class="px-6 py-5">
      <p class="text-sm font-medium text-foreground">
        {m.settings_hardware_cycleScope_label()}
      </p>
      <p class="text-xs text-subtle mt-1 mb-3">
        {m.settings_hardware_cycleScope_description()}
      </p>
      <div class="flex flex-col gap-2">
        {#each cycleScopeFamilies as family (family.familyId)}
          <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer w-fit">
            <Checkbox
              checked={$cycleScopes$[family.familyId] === 'all'}
              onCheckedChange={(checked) => handleCycleScopeChange(family.familyId, checked)}
              size="sm"
              ariaLabel={m.settings_hardware_cycleScope_include_ariaLabel({
                action: family.label,
              })}
            />
            <span>{family.label}</span>
          </label>
        {/each}
      </div>
    </section>

    <!-- Prompt picker limit -->
    <section class="px-6 py-5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-foreground">
            {m.settings_hardware_promptLimit_label()}
          </p>
          <p class="text-xs text-subtle mt-1">
            {m.settings_hardware_promptLimit_description()}
          </p>
        </div>
        <div class="w-[90px] flex-shrink-0">
          <Select.Root value={String($promptPickerLimit$)} onchange={handleLimitChange}>
            <Select.Trigger>
              <span>{$promptPickerLimit$}</span>
            </Select.Trigger>
            <Select.Content portal class="max-h-[300px] w-[90px]">
              {#each promptLimitOptions as option (option)}
                <Select.Item value={String(option)}>{option}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
    </section>
  {/if}
</div>
