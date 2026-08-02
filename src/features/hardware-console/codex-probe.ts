/**
 * Connect-time device snapshot + Codex-mode readiness probe.
 *
 * Uses only benign, read-only vendor RPC (cm2-probe README /
 * work-louder-oai PROTOCOL.md):
 *  - `sys.version` → `{version: "v0.6.0"}` for the toast's firmware line.
 *  - `device.status` → `{battery, is_charging, ...}` for the battery line.
 *  - `v.oai.thstatus` with an empty frame — acked `{ok:1}` on Codex-capable
 *    firmware (≥ v0.6.0 on the CM2); older firmware rejects it with
 *    "Method not found". Volatile: repaints an empty status frame, which the
 *    LED engine overwrites on connect.
 *  - `fs.read keymap.json` — the Codex layer maps controls to `KV_OAI_*`
 *    keycodes, so their absence from the keymap means vendor keys/LEDs
 *    cannot work. Read-only.
 *
 * Platform-neutral: talks through the minimal `HardwareRpcCaller` seam.
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('HardwareConsoleCodexProbe');

/** The slice of HardwareRpcClient the probe needs. */
export interface HardwareRpcCaller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export type CodexModeProbe = 'ready' | 'unsupported-firmware' | 'no-codex-layer' | 'unknown';

export interface DeviceConnectionSnapshot {
  /** Firmware version from `sys.version` (e.g. "v0.6.0"), or `null` on failure. */
  firmwareVersion: string | null;
  /** Battery percentage 0–100 from `device.status`, or `null` on failure. */
  batteryPercent: number | null;
  /** Charging flag from `device.status`; `false` when unavailable. */
  isCharging: boolean;
  codexMode: CodexModeProbe;
}

/** Marker keycode prefix the factory Codex layer uses in keymap.json. */
const CODEX_KEYCODE_MARKER = 'KV_OAI_';

function readVersion(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const version = (result as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : null;
}

function readBattery(result: unknown): { batteryPercent: number | null; isCharging: boolean } {
  if (typeof result !== 'object' || result === null) {
    return { batteryPercent: null, isCharging: false };
  }
  const record = result as Record<string, unknown>;
  const battery = record['battery'];
  return {
    batteryPercent: typeof battery === 'number' && Number.isFinite(battery) ? battery : null,
    isCharging: record['is_charging'] === true,
  };
}

function isMethodNotFound(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /method not found|-32601|404/i.test(text);
}

async function probeCodexMode(caller: HardwareRpcCaller): Promise<CodexModeProbe> {
  try {
    await caller.call('v.oai.thstatus', []);
  } catch (error) {
    if (isMethodNotFound(error)) return 'unsupported-firmware';
    logger.warn('Codex-mode probe (v.oai.thstatus) failed', { error: String(error) });
    return 'unknown';
  }
  try {
    const result = await caller.call<{ data?: unknown }>('fs.read', { file: 'keymap.json' });
    const data = typeof result?.data === 'string' ? result.data : null;
    if (data === null) return 'unknown';
    return data.includes(CODEX_KEYCODE_MARKER) ? 'ready' : 'no-codex-layer';
  } catch (error) {
    logger.warn('Codex-layer probe (fs.read keymap.json) failed', { error: String(error) });
    return 'unknown';
  }
}

/**
 * Gather the connect-toast snapshot. Each sub-call fails independently — a
 * partial snapshot (nulls / `codexMode: 'unknown'`) is still returned so the
 * toast can show whatever was readable.
 */
export async function probeConnectedDevice(
  caller: HardwareRpcCaller,
): Promise<DeviceConnectionSnapshot> {
  const [versionResult, statusResult, codexMode] = await Promise.all([
    caller.call('sys.version').catch((error: unknown) => {
      logger.warn('sys.version failed', { error: String(error) });
      return null;
    }),
    caller.call('device.status').catch((error: unknown) => {
      logger.warn('device.status failed', { error: String(error) });
      return null;
    }),
    probeCodexMode(caller),
  ]);
  return {
    firmwareVersion: readVersion(versionResult),
    ...readBattery(statusResult),
    codexMode,
  };
}
