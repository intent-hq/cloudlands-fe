/**
 * Workspace import-from-file — IPC registration (main process).
 *
 * Binds the import relay engine (`workspace-import-relay.ts`) to the Electron
 * IPC surface: `transfer:import-start` / `transfer:import-cancel` invokes,
 * progress pushed on `transfer:import-progress`. Production deps: the live
 * backend client as the TARGET, Electron's open dialog, and a plain fs file
 * handle for random-access archive reads.
 */

import { promises as fs } from 'node:fs';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  ImportProgressEvent,
  ImportStartParams,
} from '../../../shared/types/workspace-transfer';
import { getBackendClient } from './backend.ipc';
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
  const { filePaths, canceled } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Zip archive', extensions: ['zip'] }], // i18n-ignore (file-type filter name)
  });
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

function getRelay(): WorkspaceImportRelay {
  if (!relay) {
    relay = createWorkspaceImportRelay({
      getClient: () => getBackendClient(),
      showOpenDialog,
      openFile,
      broadcastProgress,
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

  ipcMain.handle(TRANSFER.IMPORT_START, async (_event, params?: ImportStartParams) => {
    return getRelay().start(params ?? {});
  });

  ipcMain.handle(TRANSFER.IMPORT_CANCEL, async () => {
    return getRelay().cancel();
  });
}
