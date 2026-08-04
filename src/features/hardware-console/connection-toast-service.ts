/**
 * Connection feedback toasts for the hardware console.
 *
 * On connect (USB or Bluetooth, initial or replug) shows a toast with the
 * device name, inferred transport, firmware version (`sys.version`) and
 * battery (`device.status`), plus a Configure action that opens the Hardware
 * section of the Settings page, then probes Codex-mode readiness (see
 * codex-probe.ts) and warns when the device is present but LEDs/vendor keys
 * cannot work. On disconnect shows a brief, non-sticky toast. All probing is
 * read-only vendor RPC — nothing here can trigger a macOS permission prompt.
 *
 * Dependency-light per AGENTS.md middleware conventions: no selector
 * imports; the toast lib is imported lazily and settings navigation goes
 * through the main-safe navigation.client seam.
 */

import type { StoreMiddleware } from '$lib/store-shim/types';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { m } from '$shared/paraglide/messages.js';
import { formatNumber } from '$lib/i18n/format';
import type { HardwareConsoleManager } from './device/device-manager';
import {
  inferTransportFromCollections,
  type HardwareConsoleTransport,
} from './device/transport-heuristic';
import { probeConnectedDevice, type DeviceConnectionSnapshot } from './codex-probe';
import { getHardwareConsoleManager } from './instance';

const logger = createLogger('HardwareConsoleConnectionToasts');

/** Shared id: a quick unplug/replug updates one toast instead of stacking. */
const CONNECTION_TOAST_ID = 'hardware-console-connection';
const CODEX_WARNING_TOAST_ID = 'hardware-console-codex-warning';
const CONNECT_TOAST_DURATION_MS = 6000;
const DISCONNECT_TOAST_DURATION_MS = 3000;
const CODEX_WARNING_DURATION_MS = 10000;

/** Lazily pull the toast lib so this middleware-reachable module stays light.
 *  The import promise is cached — concurrent events must not race two
 *  first-time dynamic imports of the same module. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

/** Mirrors SETTINGS_PREV_PATH_KEY in $lib/utils/workspace-navigation — that
 *  module is renderer-only ($app/* imports) and this middleware-reachable
 *  file is part of the main-process type-check, so it cannot be imported
 *  here (even dynamically). */
const SETTINGS_PREV_PATH_KEY = 'settings-previous-path';

/** Open Settings → General scrolled to the Hardware section via the
 *  main-safe navigation seam (same pattern as menu-ipc-service). */
function openHardwareSettings(): void {
  if (typeof sessionStorage !== 'undefined' && typeof window !== 'undefined') {
    sessionStorage.setItem(SETTINGS_PREV_PATH_KEY, window.location.pathname);
  }
  navigateToRoute('/settings?tab=general#hardware').catch((error: unknown) => {
    logger.error('Failed to open hardware settings from connect toast', error);
  });
}

function transportLabel(transport: HardwareConsoleTransport): string | null {
  if (transport === 'usb') return m.hardwareConsole_connectionToast_transportUsb_label();
  if (transport === 'bluetooth') return m.hardwareConsole_connectionToast_transportBluetooth_label();
  return null;
}

function describeSnapshot(snapshot: DeviceConnectionSnapshot): string | undefined {
  const parts: string[] = [];
  if (snapshot.firmwareVersion !== null) {
    parts.push(
      m.hardwareConsole_connectionToast_firmware_description({ version: snapshot.firmwareVersion }),
    );
  }
  if (snapshot.batteryPercent !== null) {
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
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

async function showCodexWarning(name: string, codexMode: 'unsupported-firmware' | 'no-codex-layer') {
  const toast = await getToast();
  const title =
    codexMode === 'unsupported-firmware'
      ? m.hardwareConsole_connectionToast_notCodexFirmware_message({ name })
      : m.hardwareConsole_connectionToast_noCodexLayer_message({ name });
  const description =
    codexMode === 'unsupported-firmware'
      ? m.hardwareConsole_connectionToast_notCodexFirmware_description()
      : m.hardwareConsole_connectionToast_noCodexLayer_description();
  toast.warning(title, {
    id: CODEX_WARNING_TOAST_ID,
    description,
    duration: CODEX_WARNING_DURATION_MS,
  });
}

async function handleConnected(manager: HardwareConsoleManager): Promise<void> {
  const device = manager.connectedDevice;
  const client = manager.client;
  if (!device || !client) return;
  const [snapshot, collections, toast] = await Promise.all([
    probeConnectedDevice(client),
    manager.connectedCollections().catch(() => []),
    getToast(),
  ]);
  // Unplugged while probing — the disconnect handler owns the toast now.
  if (manager.status !== 'connected') return;
  const transport = transportLabel(inferTransportFromCollections(collections));
  const title = transport
    ? m.hardwareConsole_connectionToast_connectedWithTransport_message({
        name: device.name,
        transport,
      })
    : m.hardwareConsole_connectionToast_connected_message({ name: device.name });
  toast.success(title, {
    id: CONNECTION_TOAST_ID,
    description: describeSnapshot(snapshot),
    duration: CONNECT_TOAST_DURATION_MS,
    action: {
      label: m.hardwareConsole_connectionToast_configure_label(),
      onClick: () => openHardwareSettings(),
    },
  });
  if (snapshot.codexMode === 'unsupported-firmware' || snapshot.codexMode === 'no-codex-layer') {
    await showCodexWarning(device.name, snapshot.codexMode);
  }
}

async function showDisconnectToast(name: string): Promise<void> {
  const toast = await getToast();
  toast.info(m.hardwareConsole_connectionToast_disconnected_message({ name }), {
    id: CONNECTION_TOAST_ID,
    duration: DISCONNECT_TOAST_DURATION_MS,
  });
}

/**
 * Subscribe connection toasts to a manager. Returns the unsubscribe
 * function. Survives reconnects (the status listener outlives connections).
 */
export function installHardwareConsoleConnectionToasts(manager: HardwareConsoleManager): () => void {
  let lastConnectedName: string | null = null;
  return manager.onStatusChange((status) => {
    if (status === 'connected') {
      lastConnectedName = manager.connectedDevice?.name ?? null;
      handleConnected(manager).catch((error: unknown) => {
        logger.error('Failed to show hardware-console connect toast', error);
      });
    } else if (status === 'disconnected' && lastConnectedName !== null) {
      const name = lastConnectedName;
      lastConnectedName = null;
      showDisconnectToast(name).catch((error: unknown) => {
        logger.error('Failed to show hardware-console disconnect toast', error);
      });
    }
  });
}

let installed = false;

/**
 * Lazily install on the first dispatched action (same pattern as
 * `createAgentFailureToastMiddleware`): starts the shared manager —
 * idempotent, a no-op without WebHID — and subscribes the toasts.
 */
export function createHardwareConsoleConnectionToastMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      const manager = getHardwareConsoleManager();
      installHardwareConsoleConnectionToasts(manager);
      void manager.start();
    }
    return next(action);
  };
}
