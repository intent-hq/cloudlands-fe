import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import './pair-link-bridge-seeder';

const { CONNECTIONS } = IPC_CHANNELS;
type BridgeWindow = { electronAPI?: unknown };

afterEach(() => {
  delete (window as unknown as BridgeWindow).electronAPI;
});

describe('pair link mock bridge', () => {
  it('forwards each channel verbatim to the main process when the bridge exists', async () => {
    const invoke = vi.fn(async () => 'from-main');
    (window as unknown as BridgeWindow).electronAPI = { invoke };
    await expect(mockInvoke(CONNECTIONS.PAIR_LINK_INSPECT, { uri: 'intent://pair' })).resolves.toBe(
      'from-main',
    );
    await expect(mockInvoke(CONNECTIONS.PAIR_LINK_COMMIT, { pendingId: 'p' })).resolves.toBe(
      'from-main',
    );
    await expect(mockInvoke(CONNECTIONS.PAIR_LINK_DISCARD, { pendingId: 'p' })).resolves.toBe(
      'from-main',
    );
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      CONNECTIONS.PAIR_LINK_INSPECT,
      CONNECTIONS.PAIR_LINK_COMMIT,
      CONNECTIONS.PAIR_LINK_DISCARD,
    ]);
  });

  it('fails without a main process and keeps nothing', async () => {
    await expect(mockInvoke(CONNECTIONS.PAIR_LINK_INSPECT, { uri: 'x' })).resolves.toEqual({
      ok: false,
      code: 'failed',
    });
    await expect(mockInvoke(CONNECTIONS.PAIR_LINK_COMMIT, { pendingId: 'p' })).resolves.toEqual({
      ok: false,
      code: 'failed',
    });
  });
});
