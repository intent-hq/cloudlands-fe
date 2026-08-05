/**
 * Codex-mode probe tests: snapshot assembly from sys.version /
 * device.status and the thstatus + keymap.json readiness ladder, including
 * partial failure (each sub-call degrades independently).
 */
import { describe, expect, it } from 'vitest';

import { probeConnectedDevice, type HardwareRpcCaller } from '../codex-probe';

const CODEX_KEYMAP = JSON.stringify({ layers: [['KC_A'], ['KV_OAI_AGENT_1']] });
const PLAIN_KEYMAP = JSON.stringify({ layers: [['KC_A'], ['KC_B']] });

function makeCaller(handlers: Record<string, (params: unknown) => unknown>): HardwareRpcCaller & {
  calls: { method: string; params: unknown }[];
} {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    call<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) return Promise.reject(new Error(`Method not found: ${method}`));
      try {
        return Promise.resolve(handler(params) as T);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

describe('probeConnectedDevice', () => {
  it('returns a full snapshot on a Codex-ready device', async () => {
    const caller = makeCaller({
      'sys.version': () => ({ version: 'v0.6.0' }),
      'device.status': () => ({ battery: 87, is_charging: true }),
      'v.oai.thstatus': () => ({ ok: 1 }),
      'fs.read': () => ({ data: CODEX_KEYMAP }),
    });
    await expect(probeConnectedDevice(caller)).resolves.toEqual({
      firmwareVersion: 'v0.6.0',
      batteryPercent: 87,
      isCharging: true,
      codexMode: 'ready',
    });
    expect(caller.calls.find((c) => c.method === 'fs.read')?.params).toEqual({
      file: 'keymap.json',
    });
  });

  it('reports unsupported-firmware when thstatus is method-not-found', async () => {
    const caller = makeCaller({
      'sys.version': () => ({ version: 'v0.4.0' }),
      'device.status': () => ({ battery: 50, is_charging: false }),
    });
    const snapshot = await probeConnectedDevice(caller);
    expect(snapshot.codexMode).toBe('unsupported-firmware');
    expect(caller.calls.map((c) => c.method)).not.toContain('fs.read');
  });

  it('reports no-codex-layer when the keymap lacks KV_OAI_ keycodes', async () => {
    const caller = makeCaller({
      'sys.version': () => ({ version: 'v0.6.0' }),
      'device.status': () => ({ battery: 60 }),
      'v.oai.thstatus': () => ({ ok: 1 }),
      'fs.read': () => ({ data: PLAIN_KEYMAP }),
    });
    const snapshot = await probeConnectedDevice(caller);
    expect(snapshot.codexMode).toBe('no-codex-layer');
  });

  it('degrades each sub-probe independently on failure', async () => {
    const caller = makeCaller({
      'v.oai.thstatus': () => ({ ok: 1 }),
      'fs.read': () => {
        throw new Error('fs busy');
      },
    });
    await expect(probeConnectedDevice(caller)).resolves.toEqual({
      firmwareVersion: null,
      batteryPercent: null,
      isCharging: false,
      codexMode: 'unknown',
    });
  });

  it('treats non-method-not-found thstatus failures as unknown', async () => {
    const caller = makeCaller({
      'sys.version': () => ({ version: 'v0.6.0' }),
      'device.status': () => ({ battery: 42 }),
      'v.oai.thstatus': () => {
        throw new Error('timed out after 200ms');
      },
    });
    const snapshot = await probeConnectedDevice(caller);
    expect(snapshot.codexMode).toBe('unknown');
    expect(snapshot.firmwareVersion).toBe('v0.6.0');
    expect(snapshot.batteryPercent).toBe(42);
  });

  it('ignores malformed version and battery payloads', async () => {
    const caller = makeCaller({
      'sys.version': () => ({ version: 42 }),
      'device.status': () => ({ battery: 'full', is_charging: 'yes' }),
      'v.oai.thstatus': () => ({ ok: 1 }),
      'fs.read': () => ({ data: CODEX_KEYMAP }),
    });
    await expect(probeConnectedDevice(caller)).resolves.toEqual({
      firmwareVersion: null,
      batteryPercent: null,
      isCharging: false,
      codexMode: 'ready',
    });
  });
});
