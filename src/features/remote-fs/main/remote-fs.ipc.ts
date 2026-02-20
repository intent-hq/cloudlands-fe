/**
 * Remote File System IPC Handlers
 *
 * Provides IPC endpoints for remote file system operations.
 * These handlers bridge the renderer process with the remote file system service.
 */

import { ipcMain } from 'electron';
import { RemoteFileSystemService } from './remote-file-system.service';
import type { RemoteFileSystemConfig } from './remote-file-system.service';
import { Logger } from '../../../shared/logger';
import { REMOTE_FS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  RemoteFSInitializeSchema,
  RemoteFSReadFileSchema,
  RemoteFSWriteFileSchema,
  RemoteFSAppendFileSchema,
  RemoteFSDeleteFileSchema,
  RemoteFSReaddirSchema,
  RemoteFSMkdirSchema,
  RemoteFSRmdirSchema,
  RemoteFSExistsSchema,
  RemoteFSStatSchema,
  RemoteFSCopySchema,
  RemoteFSMoveSchema,
  RemoteFSFindSchema,
  RemoteFSGrepSchema,
  RemoteFSDisconnectSchema,
  RemoteFSStatusSchema,
  RemoteFSClearCacheSchema,
} from '../../../main/ipc-schemas';

// Store active remote file system instances per workspace
const remoteFileSystems = new Map<string, RemoteFileSystemService>();
const logger = new Logger('RemoteFS-IPC');

export function setupRemoteFileSystemIPC() {
  /**
   * Initialize a remote file system connection for a workspace
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.INITIALIZE,
    createSafeValidatedHandler(
      RemoteFSInitializeSchema,
      async (_event, validated) => {
        try {
          // Check if already initialized
          if (remoteFileSystems.has(validated.workspaceId)) {
            return { success: true, message: 'Already connected' };
          }

          const remoteFS = new RemoteFileSystemService(validated as RemoteFileSystemConfig);
          await remoteFS.initialize();

          remoteFileSystems.set(validated.workspaceId, remoteFS);

          return { success: true };
        } catch (error) {
          logger.error('Failed to initialize', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.INITIALIZE,
    ),
  );

  /**
   * Read a remote file
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.READ_FILE,
    createSafeValidatedHandler(
      RemoteFSReadFileSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const content = await remoteFS.readFile(
            validated.path,
            (validated.encoding || 'utf-8') as BufferEncoding,
          );
          return { success: true, data: content };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.READ_FILE,
    ),
  );

  /**
   * Write to a remote file
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.WRITE_FILE,
    createSafeValidatedHandler(
      RemoteFSWriteFileSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.writeFile(
            validated.path,
            validated.content,
            (validated.encoding || 'utf-8') as BufferEncoding,
          );
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.WRITE_FILE,
    ),
  );

  /**
   * Append to a remote file
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.APPEND_FILE,
    createSafeValidatedHandler(
      RemoteFSAppendFileSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.appendFile(validated.path, validated.content);
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.APPEND_FILE,
    ),
  );

  /**
   * Delete a remote file
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.DELETE_FILE,
    createSafeValidatedHandler(
      RemoteFSDeleteFileSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.deleteFile(validated.path);
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.DELETE_FILE,
    ),
  );

  /**
   * List directory contents
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.READDIR,
    createSafeValidatedHandler(
      RemoteFSReaddirSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const files = await remoteFS.readdir(validated.path);
          return { success: true, data: files };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.READDIR,
    ),
  );

  /**
   * Create a directory
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.MKDIR,
    createSafeValidatedHandler(
      RemoteFSMkdirSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.mkdir(validated.path, validated.recursive ?? true);
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.MKDIR,
    ),
  );

  /**
   * Remove a directory
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.RMDIR,
    createSafeValidatedHandler(
      RemoteFSRmdirSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.rmdir(validated.path, validated.recursive ?? false);
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.RMDIR,
    ),
  );

  /**
   * Check if a file or directory exists
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.EXISTS,
    createSafeValidatedHandler(
      RemoteFSExistsSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const exists = await remoteFS.exists(validated.path);
          return { success: true, data: exists };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.EXISTS,
    ),
  );

  /**
   * Get file or directory stats
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.STAT,
    createSafeValidatedHandler(
      RemoteFSStatSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const stats = await remoteFS.stat(validated.path);
          return { success: true, data: stats };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.STAT,
    ),
  );

  /**
   * Copy a file or directory
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.COPY,
    createSafeValidatedHandler(
      RemoteFSCopySchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.copy(
            validated.source,
            validated.destination,
            validated.recursive ?? false,
          );
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.COPY,
    ),
  );

  /**
   * Move/rename a file or directory
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.MOVE,
    createSafeValidatedHandler(
      RemoteFSMoveSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          await remoteFS.move(validated.source, validated.destination);
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.MOVE,
    ),
  );

  /**
   * Search for files matching a pattern
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.FIND,
    createSafeValidatedHandler(
      RemoteFSFindSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const files = await remoteFS.find(validated.pattern, validated.dirPath);
          return { success: true, data: files };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.FIND,
    ),
  );

  /**
   * Execute grep search on remote files
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.GREP,
    createSafeValidatedHandler(
      RemoteFSGrepSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            throw new Error('Remote file system not initialized');
          }

          const results = await remoteFS.grep(
            validated.pattern,
            validated.filePath,
            validated.options,
          );
          return { success: true, data: results };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.GREP,
    ),
  );

  /**
   * Disconnect a remote file system
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.DISCONNECT,
    createSafeValidatedHandler(
      RemoteFSDisconnectSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (remoteFS) {
            await remoteFS.disconnect();
            remoteFileSystems.delete(validated.workspaceId);
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.DISCONNECT,
    ),
  );

  /**
   * Get connection status
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.STATUS,
    createSafeValidatedHandler(
      RemoteFSStatusSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (!remoteFS) {
            return { success: true, data: { connected: false } };
          }

          return {
            success: true,
            data: {
              connected: remoteFS.getConnectionStatus(),
            },
          };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.STATUS,
    ),
  );

  /**
   * Clear file cache for a workspace
   */
  ipcMain.handle(
    REMOTE_FS_CHANNELS.CLEAR_CACHE,
    createSafeValidatedHandler(
      RemoteFSClearCacheSchema,
      async (_event, validated) => {
        try {
          const remoteFS = remoteFileSystems.get(validated.workspaceId);
          if (remoteFS) {
            remoteFS.clearCache();
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      REMOTE_FS_CHANNELS.CLEAR_CACHE,
    ),
  );

  // Clean up on app quit
  process.on('beforeExit', async () => {
    for (const [id, remoteFS] of remoteFileSystems) {
      try {
        await remoteFS.disconnect();
      } catch (error) {
        logger.error('Failed to disconnect remote FS', error as Error, { workspaceId: id });
      }
    }
    remoteFileSystems.clear();
  });
}
