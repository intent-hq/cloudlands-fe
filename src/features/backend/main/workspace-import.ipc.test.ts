/**
 * Handler-level tests for the workspace-import IPC registration
 * (monorepo#3519): both handlers must resolve the invoking window from
 * `event.sender` — the target client per start (fe#1716) and the
 * owning-window id on start/cancel — instead of acting on the singleton
 * relay session blindly. The relay engine itself is mocked; its ownership
 * semantics are covered in workspace-import-relay.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, webContents } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const start = vi.fn();
const cancel = vi.fn();
const createWorkspaceImportRelay = vi.fn(() => ({ start, cancel }));
vi.mock('./workspace-import-relay', () => ({
  createWorkspaceImportRelay: (deps: unknown) => createWorkspaceImportRelay(deps),
}));

const getBackendClientForIpcEvent = vi.fn();
vi.mock('./backend.ipc', () => ({
  getBackendClientForIpcEvent: (event: unknown) => getBackendClientForIpcEvent(event),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
  webContents: { fromId: vi.fn() },
}));

const TRANSFER = IPC_CHANNELS.TRANSFER;

async function getHandler(channel: string): Promise<Function> {
  const mod = await import('./workspace-import.ipc');
  mod.registerWorkspaceImportHandlers();
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
  cancel.mockReset().mockResolvedValue({ success: true });
  getBackendClientForIpcEvent.mockReset();
});

describe('workspace-import IPC — per-window affinity wiring', () => {
  it('IMPORT_START resolves the target from the invoking event and passes its sender id', async () => {
    const handler = await getHandler(TRANSFER.IMPORT_START);
    const client = { request: vi.fn() };
    getBackendClientForIpcEvent.mockReturnValue({ client });

    const invoking = event(7);
    await handler(invoking, { reuseLastFile: true });

    expect(getBackendClientForIpcEvent).toHaveBeenCalledWith(invoking);
    expect(start).toHaveBeenCalledWith({ reuseLastFile: true }, client, 7);
  });

  it('IMPORT_START defaults missing params and still carries the sender id', async () => {
    const handler = await getHandler(TRANSFER.IMPORT_START);
    const client = { request: vi.fn() };
    getBackendClientForIpcEvent.mockReturnValue({ client });

    await handler(event(42), undefined);
    expect(start).toHaveBeenCalledWith({}, client, 42);
  });

  it('IMPORT_START surfaces a client-resolution failure without touching the relay', async () => {
    const handler = await getHandler(TRANSFER.IMPORT_START);
    getBackendClientForIpcEvent.mockImplementation(() => {
      throw new Error('no backend for window');
    });

    const result = await handler(event(7), {});
    expect(result).toEqual({ success: false, error: 'no backend for window' });
    expect(start).not.toHaveBeenCalled();
  });

  it('IMPORT_CANCEL passes the invoking sender id to the relay', async () => {
    const handler = await getHandler(TRANSFER.IMPORT_CANCEL);
    await handler(event(11));
    expect(cancel).toHaveBeenCalledWith(11);
  });

  it('wires isOwnerGone to webContents liveness (missing or destroyed ⇒ gone)', async () => {
    const handler = await getHandler(TRANSFER.IMPORT_CANCEL);
    await handler(event(1)); // force lazy relay creation
    const deps = createWorkspaceImportRelay.mock.calls[0][0] as {
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
