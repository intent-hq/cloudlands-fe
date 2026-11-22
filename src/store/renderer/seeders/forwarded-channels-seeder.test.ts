import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test-setup stubs the bridge globally; the probe needs seeders to see the
// real bridge (e.g. `isElectron()` reads `window.electronAPI`).
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

import './index';
import { mockInvoke } from '$shared/ipc-mock-router';
import { FORWARDED_IPC_CHANNELS, IPC_CHANNELS, forwarded } from '$shared/ipc-registry';
import {
  probeSeederForwarding,
  withElectronUserAgent,
} from '../../../test/ipc-seeder-forward-probe';

const { CONNECTIONS, MACHINE_SETUP } = IPC_CHANNELS;
type BridgeWindow = { electronAPI?: unknown };

describe('channels marked forwarded in the IPC registry', () => {
  it('marks the main-owned channels', () => {
    expect(FORWARDED_IPC_CHANNELS.has(CONNECTIONS.WORKSPACE_CARDS)).toBe(true);
    expect(FORWARDED_IPC_CHANNELS.has(MACHINE_SETUP.SSH_START)).toBe(true);
  });

  it('forward verbatim to main, and no custom seeder replaces the stand-in', async () => {
    const notVerbatim = await withElectronUserAgent(async () => {
      const failed: string[] = [];
      for (const channel of FORWARDED_IPC_CHANNELS.keys()) {
        if (!(await probeSeederForwarding(channel)).verbatim) failed.push(channel);
      }
      return failed;
    });
    expect(
      notVerbatim,
      'A channel marked `forwarded(...)` in src/shared/ipc-registry.ts must not also be ' +
        'registered by a hand-written seeder: drop the custom handler, or drop the mark.',
    ).toEqual([]);
  });

  it('rejects marking one channel twice', () => {
    expect(() => forwarded(CONNECTIONS.WORKSPACE_CARDS, () => null)).toThrow(
      /already marked forwarded/,
    );
  });

  describe('without a desktop bridge', () => {
    let saved: unknown;
    beforeEach(() => {
      saved = (window as unknown as BridgeWindow).electronAPI;
      delete (window as unknown as BridgeWindow).electronAPI;
    });
    afterEach(() => {
      (window as unknown as BridgeWindow).electronAPI = saved;
    });

    it('every marked channel resolves instead of rejecting', async () => {
      const rejected: string[] = [];
      for (const channel of FORWARDED_IPC_CHANNELS.keys()) {
        await mockInvoke(channel, {}).catch(() => rejected.push(channel));
      }
      expect(rejected).toEqual([]);
    });

    it.each([
      [CONNECTIONS.OPEN, { id: 'm1' }, { status: 'opened', id: 'm1' }],
      [CONNECTIONS.WORKSPACE_CARDS, { id: 'm1' }, { status: 'unknown-backend' }],
      [CONNECTIONS.PAIR_LINK_INSPECT, { uri: 'x' }, { ok: false, code: 'failed' }],
      [CONNECTIONS.PAIR_LINK_COMMIT, { pendingId: 'p' }, { ok: false, code: 'failed' }],
      [CONNECTIONS.PAIR_LINK_DISCARD, { pendingId: 'p' }, { ok: true }],
      [MACHINE_SETUP.SSH_DEFAULTS, undefined, { agent: false }],
      [MACHINE_SETUP.SSH_START, {}, { ok: false, code: 'busy' }],
      [IPC_CHANNELS.RECENT_AGENTS.LIST, undefined, []],
    ])('%s answers the browser fallback', async (channel, arg, expected) => {
      await expect(mockInvoke(channel, arg)).resolves.toEqual(expected);
    });

    it('returns a fresh fallback each call', async () => {
      const first = await mockInvoke(IPC_CHANNELS.MACHINE_RAIL.GET_STATE);
      (first as { machineIds: string[] }).machineIds.push('mutated');
      const second = await mockInvoke(IPC_CHANNELS.MACHINE_RAIL.GET_STATE);
      expect((second as { machineIds: string[] }).machineIds).not.toContain('mutated');
    });
  });
});
