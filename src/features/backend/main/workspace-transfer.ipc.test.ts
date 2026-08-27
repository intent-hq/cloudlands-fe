/**
 * Handler-level tests for the workspace-transfer IPC registration
 * (monorepo#3519): every lifecycle handler must resolve the invoking
 * window from `event.sender` — the source client per start (fe#1716) and
 * the owning-window id on start/finalize/cancel — instead of acting on the
 * singleton relay session blindly. The relay engine itself is mocked; its
 * ownership semantics are covered in workspace-transfer-relay.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, webContents } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const start = vi.fn();
const finalize = vi.fn();
const cancel = vi.fn();
const createWorkspaceTransferRelay = vi.fn(() => ({ start, finalize, cancel }));
vi.mock('./workspace-transfer-relay', () => ({
  createWorkspaceTransferRelay: (deps: unknown) => createWorkspaceTransferRelay(deps),
}));

const getBackendClientForIpcEvent = vi.fn();
vi.mock('./backend.ipc', () => ({
  buildConfigForConnection: vi.fn(),
  getBackendClientForIpcEvent: (event: unknown) => getBackendClientForIpcEvent(event),
}));

vi.mock('./json-rpc-client', () => ({ JsonRpcClient: vi.fn() }));
vi.mock('./client-identity', () => ({ getOrCreateClientId: vi.fn(async () => 'client-1') }));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showSaveDialog: vi.fn() },
  webContents: { fromId: vi.fn() },
}));

const TRANSFER = IPC_CHANNELS.TRANSFER;

async function getHandler(channel: string): Promise<Function> {
  const mod = await import('./workspace-transfer.ipc');
  mod.registerWorkspaceTransferHandlers();
  const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
  const entry = calls.find(([c]) => c === channel);
  expect(entry, `handler for ${channel} must be registered`).toBeDefined();
  return entry![1];
}

function event(senderId: number) {
  return { sender: { id: senderId } } as any;
}

beforeEach(() => {
  start.mockReset().mockResolvedValue({ success: true });
  finalize.mockReset().mockResolvedValue({ success: true });
  cancel.mockReset().mockResolvedValue({ success: true });
  getBackendClientForIpcEvent.mockReset();
});

describe('workspace-transfer IPC — per-window affinity wiring', () => {
  const PARAMS = { workspaceId: 'ws-1', destination: { kind: 'download' as const } };

  it('START resolves the source from the invoking event and passes its sender id', async () => {
    const handler = await getHandler(TRANSFER.START);
    const client = { request: vi.fn() };
    getBackendClientForIpcEvent.mockReturnValue({ client });

    const invoking = event(7);
    await handler(invoking, PARAMS);

    expect(getBackendClientForIpcEvent).toHaveBeenCalledWith(invoking);
    expect(start).toHaveBeenCalledWith(PARAMS, client, 7);
  });

  it('START from a second window carries that window sender id', async () => {
    const handler = await getHandler(TRANSFER.START);
    const client = { request: vi.fn() };
    getBackendClientForIpcEvent.mockReturnValue({ client });

    await handler(event(42), PARAMS);
    expect(start).toHaveBeenCalledWith(PARAMS, client, 42);
  });

  it('START surfaces a client-resolution failure without touching the relay', async () => {
    const handler = await getHandler(TRANSFER.START);
    getBackendClientForIpcEvent.mockImplementation(() => {
      throw new Error('no backend for window');
    });

    const result = await handler(event(7), PARAMS);
    expect(result).toEqual({ success: false, error: 'no backend for window' });
    expect(start).not.toHaveBeenCalled();
  });

  it('FINALIZE passes the invoking sender id to the relay', async () => {
    const handler = await getHandler(TRANSFER.FINALIZE);
    const params = { archiveSource: true };
    await handler(event(9), params);
    expect(finalize).toHaveBeenCalledWith(params, 9);
  });

  it('CANCEL passes the invoking sender id to the relay', async () => {
    const handler = await getHandler(TRANSFER.CANCEL);
    await handler(event(11));
    expect(cancel).toHaveBeenCalledWith(11);
  });

  it('wires isOwnerGone to webContents liveness (missing or destroyed ⇒ gone)', async () => {
    const handler = await getHandler(TRANSFER.CANCEL);
    await handler(event(1)); // force lazy relay creation
    const deps = createWorkspaceTransferRelay.mock.calls[0][0] as {
      isOwnerGone(ownerId: number): boolean;
    };

    (webContents.fromId as any).mockReturnValue(undefined);
    expect(deps.isOwnerGone(5)).toBe(true);

    (webContents.fromId as any).mockReturnValue({ isDestroyed: () => true });
    expect(deps.isOwnerGone(5)).toBe(true);

    (webContents.fromId as any).mockReturnValue({ isDestroyed: () => false });
    expect(deps.isOwnerGone(5)).toBe(false);
  });
});
