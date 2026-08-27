/**
 * Workspace transfer relay — IPC registration (main process).
 *
 * Binds the relay engine (`workspace-transfer-relay.ts`) to the Electron IPC
 * surface: `transfer:start` / `transfer:finalize` / `transfer:cancel`
 * invokes, progress pushed on `transfer:progress`. Production deps: the
 * invoking window's backend client as the SOURCE (resolved per start from the
 * IPC event sender), a fresh short-lived JsonRpcClient per TARGET
 * (built from the connections store via `buildConfigForConnection`, disposed
 * after use), Electron's save dialog, and a plain fs write stream for the
 * download destination.
 */

import { createWriteStream, promises as fs } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  TransferFinalizeParams,
  TransferProgressEvent,
  TransferStartParams,
} from '../../../shared/types/workspace-transfer';
import { buildConfigForConnection, getBackendClientForIpcEvent } from './backend.ipc';
import { JsonRpcClient } from './json-rpc-client';
import { getOrCreateClientId } from './client-identity';
import {
  createWorkspaceTransferRelay,
  type FileSink,
  type TargetClientHandle,
  type WorkspaceTransferRelay,
} from './workspace-transfer-relay';

const logger = new Logger('WorkspaceTransferIPC');
const TRANSFER = IPC_CHANNELS.TRANSFER;

let handlersRegistered = false;
let relay: WorkspaceTransferRelay | null = null;

function broadcastProgress(event: TransferProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(TRANSFER.PROGRESS, event);
    } catch (error) {
      logger.warn('Failed to broadcast transfer progress', {
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Build a short-lived JsonRpcClient pinned to the chosen target connection.
 * No heartbeat (the relay's own requests detect a dead link), but the same
 * §5.17 stable identity handshake as the primary client so the target daemon
 * scopes state consistently. Always disposed by the relay.
 */
async function createTargetClient(connectionId: string): Promise<TargetClientHandle> {
  const { config } = await buildConfigForConnection(connectionId);
  const client = new JsonRpcClient({
    config,
    helloParams: async () => ({ clientId: await getOrCreateClientId() }),
  });
  client.on('error', (error: Error) => {
    logger.warn('Transfer target client transport error', { error: error.message });
  });
  client.start();
  return { client, dispose: () => client.dispose() };
}

async function showSaveDialog(defaultFileName: string): Promise<string | undefined> {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: defaultFileName,
    filters: [{ name: 'Zip archive', extensions: ['zip'] }], // i18n-ignore (file-type filter name)
  });
  return canceled || !filePath ? undefined : filePath;
}

async function openFileSink(filePath: string): Promise<FileSink> {
  const stream: WriteStream = createWriteStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve());
    stream.once('error', reject);
  });
  return {
    write(bytes: Buffer): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.write(bytes, (error) => (error ? reject(error) : resolve()));
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
    },
    async discard(): Promise<void> {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
      await fs.unlink(filePath).catch(() => undefined);
    },
  };
}

/** A session owner is gone once its WebContents no longer exists (window
 * closed) — its leftover session is then released for other windows. */
function isOwnerGone(ownerId: number): boolean {
  const contents = webContents.fromId(ownerId);
  return !contents || contents.isDestroyed();
}

function getRelay(): WorkspaceTransferRelay {
  if (!relay) {
    relay = createWorkspaceTransferRelay({
      createTargetClient,
      showSaveDialog,
      openFileSink,
      broadcastProgress,
      isOwnerGone,
      logger: {
        info: (msg, meta) => logger.info(msg, meta),
        warn: (msg, meta) => logger.warn(msg, meta),
      },
    });
  }
  return relay;
}

/** Register the workspace-transfer IPC handlers (idempotent). */
export function registerWorkspaceTransferHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(TRANSFER.START, async (event, params: TransferStartParams) => {
    if (!params || typeof params.workspaceId !== 'string' || !params.destination) {
      return { success: false, error: 'workspaceId and destination are required' };
    }
    // The SOURCE is the backend bound to the invoking window — not the global
    // primary client, which may point at a different daemon.
    let source: JsonRpcClient;
    try {
      source = getBackendClientForIpcEvent(event).client;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    return getRelay().start(params, source, event.sender.id);
  });

  ipcMain.handle(TRANSFER.FINALIZE, async (event, params: TransferFinalizeParams) => {
    if (!params || typeof params.archiveSource !== 'boolean') {
      return { success: false, error: 'archiveSource is required' };
    }
    return getRelay().finalize(params, event.sender.id);
  });

  ipcMain.handle(TRANSFER.CANCEL, async (event) => {
    return getRelay().cancel(event.sender.id);
  });
}
