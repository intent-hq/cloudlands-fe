/**
 * Shutdown lighting clear: sends the off-frame (`v.oai.thstatus` with all 6
 * slots unassigned + `v.oai.rgbcfg` dark) to a connected console so the
 * firmware does not stay frozen at the last-sent frame after the app quits.
 *
 * Main broadcasts `hardware-console:clear-lighting` early in graceful
 * shutdown; the renderer listener installed here disposes the LED-engine
 * wiring first (so no pending coalesced repaint can overwrite the off-frame),
 * runs the clear helper, and always acks with
 * `hardware-console:clear-lighting-done` — main proceeds on the first ack or
 * its own overall timeout, so the whole path is fail-soft.
 */

import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { Logger } from '../../../shared/logger';
import type { HardwareConsoleManager } from '../device/device-manager';
import {
  AGENT_KEY_LED_COUNT,
  buildRgbcfgParams,
  buildThStatusParams,
  type AgentKeyLedState,
} from './frames';

const logger = new Logger('HardwareConsoleClearLighting');

/** Renderer-side send budget; well under main's 750 ms overall ack timeout. */
export const DEFAULT_CLEAR_LIGHTING_TIMEOUT_MS = 500;

const OFF_KEYS: readonly AgentKeyLedState[] = Array.from(
  { length: AGENT_KEY_LED_COUNT },
  () => 'unassigned' as const,
);

export interface ClearHardwareConsoleLightingOptions {
  timeoutMs?: number;
}

/**
 * Send the lighting off-frame to a connected console. Resolves immediately
 * when no device is connected, swallows (and logs) RPC failures, and never
 * takes longer than `timeoutMs` — shutdown must not hang on the device.
 */
export async function clearHardwareConsoleLighting(
  manager: HardwareConsoleManager,
  options: ClearHardwareConsoleLightingOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLEAR_LIGHTING_TIMEOUT_MS;
  const client = manager.status === 'connected' ? manager.client : null;
  if (!client) return;

  const sends = Promise.all([
    client.call('v.oai.thstatus', buildThStatusParams(OFF_KEYS)).catch((error: unknown) => {
      logger.warn('v.oai.thstatus off-frame failed', { error: String(error) });
    }),
    client.call('v.oai.rgbcfg', buildRgbcfgParams({ kind: 'dark' })).catch((error: unknown) => {
      logger.warn('v.oai.rgbcfg off-frame failed', { error: String(error) });
    }),
  ]);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([sends, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Minimal preload-bridge surface used by the listener (window.electronAPI). */
export interface ClearLightingIpcLike {
  on(channel: string, handler: (...args: unknown[]) => void): string;
  send(channel: string, ...args: unknown[]): void;
}

export interface ClearLightingListenerDeps {
  /**
   * Tears down the LED status wiring (store subscription + engine dispose)
   * before the off-frame is sent, so a pending coalesced engine flush cannot
   * repaint over it. In-flight RPCs are harmless: they reached the device
   * before the off-frame, which the firmware processes last.
   */
  disposeLedWiring?: () => void;
  /** Clear implementation override for tests. */
  clear?: (manager: HardwareConsoleManager) => Promise<void>;
  /** IPC bridge override for tests. Defaults to `window.electronAPI`. */
  ipc?: ClearLightingIpcLike | null;
}

/**
 * Listen for main's `hardware-console:clear-lighting` broadcast, run the
 * clear helper, and always send the `clear-lighting-done` ack — even on
 * error or with no device connected. No-op outside Electron (no preload
 * bridge). Listeners persist for the renderer's lifetime (menu-ipc pattern).
 */
export function installHardwareConsoleClearLightingListener(
  manager: HardwareConsoleManager,
  deps: ClearLightingListenerDeps = {},
): void {
  const ipc =
    deps.ipc !== undefined
      ? deps.ipc
      : ((globalThis as { electronAPI?: ClearLightingIpcLike }).electronAPI ?? null);
  if (!ipc) return;
  const clear = deps.clear ?? ((target: HardwareConsoleManager) => clearHardwareConsoleLighting(target));
  ipc.on(IPC_CHANNELS.HARDWARE_CONSOLE.CLEAR_LIGHTING, () => {
    void (async () => {
      try {
        deps.disposeLedWiring?.();
        await clear(manager);
      } catch (error) {
        logger.warn('Failed to clear hardware-console lighting', { error: String(error) });
      } finally {
        ipc.send(IPC_CHANNELS.HARDWARE_CONSOLE.CLEAR_LIGHTING_DONE);
      }
    })();
  });
}
