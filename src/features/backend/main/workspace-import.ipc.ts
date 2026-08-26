/**
 * Workspace import-from-file — IPC registration (main process).
 *
 * Binds the import relay engine (`workspace-import-relay.ts`) to the Electron
 * IPC surface: `transfer:import-start` / `transfer:import-cancel` invokes,
 * progress pushed on `transfer:import-progress`. Production deps: the
 * invoking window's backend client as the TARGET (resolved per start from the
 * IPC event sender), Electron's open dialog, and a plain fs file handle for
 * random-access archive reads.
 */

import { promises as fs } from 'node:fs';
import { BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  ImportProgressEvent,
  ImportStartParams,
} from '../../../shared/types/workspace-transfer';
import { getBackendClientForIpcEvent } from './backend.ipc';
import type { JsonRpcClient } from './json-rpc-client';
import {
  createWorkspaceImportRelay,
  type ImportFileSource,
  type WorkspaceImportRelay,
} from './workspace-import-relay';

const logger = new Logger('WorkspaceImportIPC');
const TRANSFER = IPC_CHANNELS.TRANSFER;

let handlersRegistered = false;
let relay: WorkspaceImportRelay | null = null;

function broadcastProgress(event: ImportProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(TRANSFER.IMPORT_PROGRESS, event);
    } catch (error) {
      logger.warn('Failed to broadcast import progress', {
        windowId: win.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function showOpenDialog(): Promise<string | undefined> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Zip archive', extensions: ['zip'] }], // i18n-ignore (file-type filter name)
  };
  // Window-modal when possible so the wizard underneath stays inert.
  const win = BrowserWindow.getFocusedWindow();
  const { filePaths, canceled } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return canceled || filePaths.length === 0 ? undefined : filePaths[0];
}

async function openFile(filePath: string): Promise<ImportFileSource> {
  const handle = await fs.open(filePath, 'r');
  return {
    async size(): Promise<number> {
      const stat = await handle.stat();
      return stat.size;
    },
    async read(offset: number, length: number): Promise<Buffer> {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) {
        throw new Error(`short read at ${offset}: got ${bytesRead}, wanted ${length}`);
      }
      return buffer;
    },
    async close(): Promise<void> {
      await handle.close();
    },
  };
}

/** A session owner is gone once its WebContents no longer exists (window
 * closed) — its leftover session is then released for other windows. */
function isOwnerGone(ownerId: number): boolean {
  const contents = webContents.fromId(ownerId);
  return !contents || contents.isDestroyed();
}

function getRelay(): WorkspaceImportRelay {
  if (!relay) {
    relay = createWorkspaceImportRelay({
      showOpenDialog,
      openFile,
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

/** Register the workspace-import IPC handlers (idempotent). */
export function registerWorkspaceImportHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(TRANSFER.IMPORT_START, async (event, params?: ImportStartParams) => {
    // The TARGET is the backend bound to the invoking window — not the global
    // primary client, which may point at a different daemon.
    let client: JsonRpcClient;
    try {
      client = getBackendClientForIpcEvent(event).client;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    return getRelay().start(params ?? {}, client, event.sender.id);
  });

  ipcMain.handle(TRANSFER.IMPORT_CANCEL, async (event) => {
    return getRelay().cancel(event.sender.id);
  });
}
