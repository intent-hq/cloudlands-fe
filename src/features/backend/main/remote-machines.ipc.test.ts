/**
 * Handler-level tests for the remote-machines IPC registration: the current
 * backend is the invoking window's daemon, its `remoteMachines` capability
 * gates the relay, and only owner-registry machines count as owned.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const expose = vi.fn();
const unexpose = vi.fn();
const machineFingerprint = vi.fn();
let relayDeps: any;
vi.mock('./remote-machine-relay', () => ({
  createRemoteMachineRelay: (deps: unknown) => {
    relayDeps = deps;
    return { expose, unexpose, machineFingerprint };
  },
}));

const backendClient = { getNodeCapabilities: vi.fn(), request: vi.fn() };
const resolveBackendRecord = vi.fn();
vi.mock('./backend.ipc', () => ({
  getBackendClientForIpcEvent: () => ({ backendId: 'build-box', client: backendClient }),
  getBackendClientForConnection: vi.fn(),
  getLocalBackendClient: vi.fn(),
  resolveBackendRecord: (id: string) => resolveBackendRecord(id),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;

async function handler(channel: string): Promise<Function> {
  const mod = await import('./remote-machines.ipc');
  mod.registerRemoteMachinesHandlers();
  const entry = (ipcMain.handle as any).mock.calls.find(([c]: [string]) => c === channel);
  expect(entry, `handler for ${channel}`).toBeDefined();
  return entry[1];
}

beforeEach(() => {
  expose.mockReset().mockResolvedValue({ success: true });
  unexpose.mockReset().mockResolvedValue({ success: true, revoked: true });
  backendClient.getNodeCapabilities.mockReset();
  resolveBackendRecord.mockReset();
});

describe('remote-machines IPC', () => {
  it('passes the invoking window backend and its remoteMachines capability to expose', async () => {
    backendClient.getNodeCapabilities.mockReturnValue({ remoteMachines: 1 });
    const h = await handler(CHANNELS.EXPOSE);
    await h({}, { machineConnectionId: 'mac', enableListener: 'bogus' });
    expect(expose).toHaveBeenCalledWith(
      { machineConnectionId: 'mac' },
      { connectionId: 'build-box', client: backendClient, supportsRemoteMachines: true },
    );
  });

  it('reports the backend unsupported when the capability is absent', async () => {
    backendClient.getNodeCapabilities.mockReturnValue({ remoteMachines: 0 });
    const h = await handler(CHANNELS.EXPOSE);
    await h({}, { machineConnectionId: 'local', enableListener: 'tailcat' });
    expect(expose.mock.calls[0][0]).toEqual({
      machineConnectionId: 'local',
      enableListener: 'tailcat',
    });
    expect(expose.mock.calls[0][1].supportsRemoteMachines).toBe(false);
  });

  it('rejects malformed params without calling the relay', async () => {
    const h = await handler(CHANNELS.UNEXPOSE);
    expect(await h({}, {})).toMatchObject({ success: false, code: 'failed' });
    expect(unexpose).not.toHaveBeenCalled();
  });

  it('forwards only known unexpose fields', async () => {
    backendClient.getNodeCapabilities.mockReturnValue({ remoteMachines: 1 });
    const h = await handler(CHANNELS.UNEXPOSE);
    await h({}, { machineId: 'd-mac', machineConnectionId: 'mac', stopAgents: 'yes', token: 'x' });
    expect(unexpose.mock.calls[0][0]).toEqual({ machineId: 'd-mac', machineConnectionId: 'mac' });
  });

  it('treats only the local machine and owner-registry records as owned', async () => {
    await handler(CHANNELS.EXPOSE);
    expect(await relayDeps.isOwnerConnection('local')).toBe(true);
    resolveBackendRecord.mockResolvedValueOnce({ kind: 'guest' });
    expect(await relayDeps.isOwnerConnection('guest-1')).toBe(false);
    resolveBackendRecord.mockResolvedValueOnce({ kind: 'owner' });
    expect(await relayDeps.isOwnerConnection('mac')).toBe(true);
    resolveBackendRecord.mockResolvedValueOnce(null);
    expect(await relayDeps.isOwnerConnection('gone')).toBe(false);
  });
});
