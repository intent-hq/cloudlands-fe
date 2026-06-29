/**
 * File IPC
 *
 * IPC layer for file operations.
 */

import { ipcMain } from 'electron';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { Logger } from '../../../shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';
import {
  isBinaryExtension,
  detectBinaryContent,
  KNOWN_TEXT_EXTENSIONS,
  getExtension,
} from '../../../shared/binary-file-extensions';
import { FILE_CHANNELS } from '$shared/ipc/channels';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  type IpcResponse,
  FileIpc,
} from '$shared/ipc';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  FileReadSchema,
  FileWriteSchema,
  FileDeleteSchema,
  FileListSchema,
  FileReadBatchSchema,
  FileExistsSchema,
  FileReadDirWithStatsSchema,
  FileGetGitignorepatternsSchema,
  FileGetGitStatusSchema,
  FileMkdirSchema,
  FileMoveSchema,
  FileCopySchema,
  FileGetTreeWithSizesSchema,
  FileGetDirectoryStatusSchema,
} from '../../../main/ipc-schemas';
import { execAsync } from '../../../shared/git/git-env';
import { renameWithRetry } from '../../../shared/main/file-sync-utils';
import { getWorkspaceGitInfo } from '../../git/main/git-router';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { RemoteRPCError } from '../../../shared/main/remote-rpc-client';
import type { RemoteRPCClient } from '../../../shared/main/remote-rpc-client';
import { trackMain } from '$lib/services/analytics/main';
import { getFileExtension } from '$lib/services/analytics/utils';

const logger = new Logger('FileIPC');

/**
 * Maximum file size for reading (10MB)
 * Files larger than this will be rejected to prevent memory issues
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Maximum file size for preview/mention context (1MB)
 * Used when maxSize option is passed
 */


/**
 * Expand tilde (~) to home directory
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Get a RemoteRPCClient for the given workspace, or null if the workspace is local.
 */
async function getRemoteRPCClient(workspaceId?: string): Promise<RemoteRPCClient | null> {
  if (!workspaceId) return null;

  const gitInfo = await getWorkspaceGitInfo(workspaceId);
  if (!gitInfo?.isRemote || !gitInfo.sshConfig) return null;

  return remoteRPCManager.getClient(workspaceId);
}

export function setupFileIPC() {
  // Read file
  ipcMain.handle(
    FILE_CHANNELS.READ,
    createSafeValidatedHandler(
      FileReadSchema,
      async (_, validated): Promise<IpcResponse<FileIpc.ReadResponse>> => {
        try {
          // Check for remote workspace
          const rpcClient = await getRemoteRPCClient(validated.workspaceId);
          if (rpcClient) {
            const effectiveMaxSize = validated.maxSize ?? MAX_FILE_SIZE;

            // Check if binary by extension
            const isBinary = isBinaryExtension(validated.path);

            // Get file size via RPC stat
            const statResult = await rpcClient.stat({ path: validated.path });
            const fileSize = statResult.size;

            if (fileSize > effectiveMaxSize && !validated.truncateIfLarge) {
              return {
                success: false,
                error: {
                  code: 'FILE_TOO_LARGE',
                  message: `File is too large (${Math.round(fileSize / 1024)}KB). Maximum size is ${Math.round(effectiveMaxSize / 1024)}KB.`,
                },
                data: {
                  content: '',
                  stats: { size: fileSize, modified: statResult.mtime },
                  isBinary: false,
                  truncated: false,
                },
              };
            }

            // Read file content via RPC
            const readResult = await rpcClient.readFile({
              path: validated.path,
              encoding: isBinary ? 'base64' : 'utf-8',
              maxSize: effectiveMaxSize,
            });

            let content = readResult.content;
            let truncated = readResult.truncated;

            if (validated.truncateIfLarge && content.length > effectiveMaxSize) {
              content = content.substring(0, effectiveMaxSize);
              truncated = true;
            }

            return {
              success: true,
              data: {
                content,
                stats: { size: fileSize, modified: statResult.mtime },
                isBinary,
                truncated,
              },
            };
          }

          // Local workspace - existing code path
          const expandedPath = expandPath(validated.path);

          // Check if this is a directory - can't read directories as files
          const stats = await fs.stat(expandedPath);
          if (stats.isDirectory()) {
            logger.warn('Attempted to read a directory as a file', { path: validated.path });
            return {
              success: false,
              error: {
                code: 'IS_DIRECTORY',
                message: `Cannot read directory as file: ${validated.path}`,
              },
            };
          }

          // Determine effective max size (use provided maxSize, or default MAX_FILE_SIZE)
          const effectiveMaxSize = validated.maxSize ?? MAX_FILE_SIZE;

          // Check file size before reading to prevent memory issues
          if (stats.size > effectiveMaxSize) {
            if (validated.truncateIfLarge) {
              logger.debug('File exceeds max size, will truncate', {
                path: validated.path,
                size: stats.size,
                maxSize: effectiveMaxSize,
              });
            } else {
              logger.warn('File too large to read', {
                path: validated.path,
                size: stats.size,
                maxSize: effectiveMaxSize,
              });
              return {
                success: false,
                error: {
                  code: 'FILE_TOO_LARGE',
                  message: `File is too large (${Math.round(stats.size / 1024)}KB). Maximum size is ${Math.round(effectiveMaxSize / 1024)}KB.`,
                },
                data: {
                  content: '',
                  stats: {
                    size: stats.size,
                    modified: stats.mtime.toISOString(),
                  },
                  isBinary: false,
                  truncated: false,
                },
              };
            }
          }

          // Check if this is a binary file based on extension
          const ext = getExtension(expandedPath);
          const isBinaryByExtension = isBinaryExtension(expandedPath);

          // Known text extensions that should never be treated as binary
          // even if content detection thinks they might be (e.g., SVG with special chars)
          const isKnownTextExtension = KNOWN_TEXT_EXTENSIONS.has(ext);

          // Read file as buffer first to detect binary content
          const buffer = await fs.readFile(expandedPath);

          // Check for binary content beyond just file extension
          // But skip binary detection for known text extensions
          const isBinaryByContent =
            !isBinaryByExtension && !isKnownTextExtension && detectBinaryContent(buffer);
          const isBinary = isBinaryByExtension || isBinaryByContent;

          if (isBinaryByContent) {
            logger.debug('Detected binary content in text file', {
              path: validated.path,
              extension: ext,
            });
          }

          let content: string;
          let truncated = false;

          if (isBinary) {
            // For binary files, convert to base64
            // Apply truncation if needed for binary files
            if (validated.truncateIfLarge && buffer.length > effectiveMaxSize) {
              content = buffer.subarray(0, effectiveMaxSize).toString('base64');
              truncated = true;
            } else {
              content = buffer.toString('base64');
            }
          } else {
            // For text files, decode as UTF-8
            content = buffer.toString('utf-8');

            // Apply truncation if needed
            if (validated.truncateIfLarge && content.length > effectiveMaxSize) {
              content = content.substring(0, effectiveMaxSize);
              truncated = true;
            }
          }

          // Reuse the stats from earlier check
          return {
            success: true,
            data: {
              content,
              stats: {
                size: stats.size,
                modified: stats.mtime.toISOString(),
              },
              isBinary,
              truncated,
            },
          };
        } catch (error) {
          logger.error('Failed to read file', error as Error, { path: validated.path });
          return {
            success: false,
            error: {
              code: 'FILE_READ_FAILED',
              message: error instanceof Error ? error.message : 'Failed to read file',
            },
          };
        }
      },
      FILE_CHANNELS.READ,
    ),
  );

  // Batch read files
  ipcMain.handle(
    FILE_CHANNELS.READ_BATCH,
    createSafeValidatedHandler(
      FileReadBatchSchema,
      async (_, validated) => {
        try {
          // PERF: Changed from INFO to DEBUG - called for every batch read
          logger.debug('Batch reading files', { count: validated.requests.length });

          // Check for remote workspace
          const rpcClient = await getRemoteRPCClient(validated.workspaceId);

          const results = await Promise.all(
            validated.requests.map(async ({ path: filePath }) => {
              try {
                if (rpcClient) {
                  // Remote: read via RPC
                  const result = await rpcClient.readFile({ path: filePath });
                  return { success: true, data: result.content, path: filePath };
                }
                // Local: read from filesystem
                const expandedPath = expandPath(filePath);
                const content = await fs.readFile(expandedPath, 'utf-8');
                return { success: true, data: content, path: filePath };
              } catch (error) {
                return { success: false, error: (error as Error).message, path: filePath };
              }
            }),
          );

          return { success: true, data: results };
        } catch (error) {
          logger.error('Batch read failed', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.READ_BATCH,
    ),
  );

  // Write file
  ipcMain.handle(
    FILE_CHANNELS.WRITE,
    createSafeValidatedHandler(
      FileWriteSchema,
      async (_, validated): Promise<IpcResponse<FileIpc.WriteResponse>> => {
        try {
          // Check for remote workspace
          const rpcClient = await getRemoteRPCClient(validated.workspaceId);
          if (rpcClient) {
            // Check if file exists before writing (to track creation vs modification)
            let remoteFileExisted = false;
            try {
              const existsResult = await rpcClient.fileExists({ path: validated.path });
              remoteFileExisted = existsResult.exists;
            } catch {
              // Assume file doesn't exist if check fails
              remoteFileExisted = false;
            }

            // Write file content via RPC (mkdirp handles directory creation)
            await rpcClient.writeFile({
              path: validated.path,
              content: validated.content,
              encoding: validated.encoding === 'base64' ? 'base64' : 'utf-8',
              mkdirp: true,
            });

            logger.debug('Remote file written successfully', { filePath: validated.path });

            // Track file creation if this is a new file
            if (!remoteFileExisted && validated.workspaceId) {
              trackMain('Created File', {
                workspace_id: validated.workspaceId,
                file_extension: getFileExtension(validated.path),
              });
            }

            // Emit file change event for immediate UI update
            if (validated.workspaceId) {
              try {
                sendToWorkspaceWindows(validated.workspaceId, 'file:content-changed', {
                  workspaceId: validated.workspaceId,
                  path: validated.path,
                  relativePath: validated.path,
                  content: validated.content,
                  source: 'user',
                });

                sendToWorkspaceWindows(
                  validated.workspaceId,
                  IPC_CHANNELS.FILE_TRACKING.AGENT_FILE_CHANGED,
                  {
                    workspaceId: validated.workspaceId,
                    filePath: validated.path,
                    source: 'user',
                  },
                );
              } catch (emitError) {
                logger.warn('Failed to emit file change event', {
                  error: (emitError as Error).message,
                });
              }
            }

            return {
              success: true,
              data: {
                bytesWritten: validated.content.length,
              },
            };
          }

          // Local workspace - existing code path
          const expandedPath = expandPath(validated.path);

          // Check if file exists before writing (to track creation vs modification)
          let fileExisted = false;
          try {
            await fs.access(expandedPath);
            fileExisted = true;
          } catch {
            // File doesn't exist, will be created
            fileExisted = false;
          }

          // Create directory if it doesn't exist
          const dir = path.dirname(expandedPath);
          logger.debug('Creating directory if needed', { dir });
          await fs.mkdir(dir, { recursive: true });

          // Use atomic write: write to temp file, then rename
          // This ensures the file is either fully written or not written at all
          // Use Date.now() + random suffix to avoid collisions in high-concurrency scenarios
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const tempPath = `${expandedPath}.${Date.now()}-${randomSuffix}.tmp`;
          logger.debug('Writing file atomically', {
            filePath: expandedPath,
            tempPath,
            contentLength: validated.content.length,
          });

          try {
            // Handle different encodings
            if (validated.encoding === 'base64') {
              // Decode base64 content to binary buffer
              const buffer = Buffer.from(validated.content, 'base64');
              await fs.writeFile(tempPath, buffer);
            } else {
              // Default to UTF-8 text
              await fs.writeFile(tempPath, validated.content, 'utf-8');
            }
            await renameWithRetry(tempPath, expandedPath);
            // PERF: Changed from INFO to DEBUG - called for every file write
            logger.debug('File written successfully', { filePath: expandedPath });

            // Refresh backend specialist cache immediately for specialist file saves
            if (expandedPath.includes('.augment/specialists/') && expandedPath.endsWith('.md')) {
              try {
                const { refreshSpecialistsFromFiles } = await import('../../agent/main/specialists.service');
                const specialistDirIndex = expandedPath.indexOf('.augment/specialists/');
                const workspacePath = specialistDirIndex > 0 ? expandedPath.substring(0, specialistDirIndex) : undefined;
                await refreshSpecialistsFromFiles(workspacePath);
              } catch (e) {
                logger.warn('Failed to refresh specialist cache after file save', { error: (e as Error).message });
              }
            }

            // Track file creation if this is a new file
            if (!fileExisted && validated.workspaceId) {
              trackMain('Created File', {
                workspace_id: validated.workspaceId,
                file_extension: getFileExtension(validated.path),
              });
            }

            // Emit file change event for immediate UI update if workspaceId provided
            if (validated.workspaceId) {
              try {
                sendToWorkspaceWindows(validated.workspaceId, 'file:content-changed', {
                  workspaceId: validated.workspaceId,
                  path: validated.path,
                  relativePath: validated.path,
                  content: validated.content,
                  source: 'user',
                });

                sendToWorkspaceWindows(
                  validated.workspaceId,
                  IPC_CHANNELS.FILE_TRACKING.AGENT_FILE_CHANGED,
                  {
                    workspaceId: validated.workspaceId,
                    filePath: validated.path,
                    source: 'user',
                  },
                );
              } catch (emitError) {
                logger.warn('Failed to emit file change event', {
                  error: (emitError as Error).message,
                });
              }
            }

            return {
              success: true,
              data: {
                bytesWritten: validated.content.length,
              },
            };
          } catch (writeError) {
            // Clean up temp file if it exists
            try {
              await fs.unlink(tempPath);
            } catch  {
              // Ignore unlink errors
            }
            throw writeError;
          }
        } catch (error) {
          const errnoError = error as NodeJS.ErrnoException;
          logger.error('Failed to write file', error as Error, {
            filePath: validated.path,
            errorCode: errnoError.code,
            errorPath: errnoError.path,
          });
          return {
            success: false,
            error: {
              code: 'FILE_WRITE_FAILED',
              message: error instanceof Error ? error.message : 'Failed to write file',
              details: {
                errorCode: errnoError.code,
                errorPath: errnoError.path,
              },
            },
          };
        }
      },
      FILE_CHANNELS.WRITE,
    ),
  );

  // Check if file exists
  ipcMain.handle(
    FILE_CHANNELS.EXISTS,
    createSafeValidatedHandler(
      FileExistsSchema,
      async (_, validated) => {
        try {
          // Check for remote workspace
          const rpcClient = await getRemoteRPCClient(validated.workspaceId);
          if (rpcClient) {
            const result = await rpcClient.fileExists({ path: validated.path });
            return { success: true, exists: result.exists, data: result.exists };
          }

          // Local: existing code path
          const expandedPath = expandPath(validated.path);
          // ASYNC: Check file existence without blocking
          const exists = await fs
            .access(expandedPath)
            .then(() => true)
            .catch(() => false);
          return { success: true, exists, data: exists };
        } catch (error) {
          return { success: false, exists: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.EXISTS,
    ),
  );

  // List directory
  ipcMain.handle(
    FILE_CHANNELS.LIST,
    createSafeValidatedHandler(
      FileListSchema,
      async (_, validated) => {
        try {
          const expandedPath = expandPath(validated.path);

          // If recursive is requested, walk the directory tree
          if (validated.recursive) {
            const allFiles: any[] = [];

            async function walkDir(dirPath: string) {
              const entries = await fs.readdir(dirPath, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                allFiles.push({
                  name: entry.name,
                  path: fullPath,
                  isDirectory: entry.isDirectory(),
                  isFile: entry.isFile(),
                });

                // Recursively walk subdirectories
                if (entry.isDirectory()) {
                  try {
                    await walkDir(fullPath);
                  } catch  {
                    // Skip directories we can't read
                    logger.debug(`[FileIPC] Skipping unreadable directory: ${fullPath}`);
                  }
                }
              }
            }

            await walkDir(expandedPath);
            return { success: true, data: allFiles };
          } else {
            // Non-recursive: just list immediate directory
            const entries = await fs.readdir(expandedPath, { withFileTypes: true });
            const files = entries.map((entry) => ({
              name: entry.name,
              path: path.join(expandedPath, entry.name),
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile(),
            }));
            return { success: true, data: files };
          }
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.LIST,
    ),
  );

  // Delete file
  ipcMain.handle(
    FILE_CHANNELS.DELETE,
    createSafeValidatedHandler(
      FileDeleteSchema,
      async (_, validated) => {
        try {
          const expandedPath = expandPath(validated.path);
          await fs.unlink(expandedPath);

          // Track file deletion
          if (validated.workspaceId) {
            trackMain('Deleted File', {
              workspace_id: validated.workspaceId,
              file_extension: getFileExtension(validated.path),
            });
          }

          return { success: true, data: undefined };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.DELETE,
    ),
  );

  // Create directory
  ipcMain.handle(
    FILE_CHANNELS.MKDIR,
    createSafeValidatedHandler(
      FileMkdirSchema,
      async (_, validated) => {
        try {
          const expandedPath = expandPath(validated.path);
          await fs.mkdir(expandedPath, { recursive: true });
          return { success: true, data: undefined };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.MKDIR,
    ),
  );

  // Move/rename file or directory
  ipcMain.handle(
    FILE_CHANNELS.MOVE,
    createSafeValidatedHandler(
      FileMoveSchema,
      async (_, validated) => {
        try {
          const expandedOldPath = expandPath(validated.oldPath);
          const expandedNewPath = expandPath(validated.newPath);

          // Check if source exists
          await fs.access(expandedOldPath);

          // Create parent directory if it doesn't exist
          const parentDir = path.dirname(expandedNewPath);
          await fs.mkdir(parentDir, { recursive: true });

          // Rename/move the file or directory
          await fs.rename(expandedOldPath, expandedNewPath);

          logger.info('File moved successfully', {
            from: validated.oldPath,
            to: validated.newPath,
          });

          return { success: true, data: undefined };
        } catch (error) {
          logger.error('Failed to move file', error as Error, {
            from: validated.oldPath,
            to: validated.newPath,
          });
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.MOVE,
    ),
  );

  // Copy file or directory (recursive for directories)
  ipcMain.handle(
    FILE_CHANNELS.COPY,
    createSafeValidatedHandler(
      FileCopySchema,
      async (_, validated) => {
        try {
          const expandedSourcePath = expandPath(validated.sourcePath);
          const expandedDestinationPath = expandPath(validated.destinationPath);

          // Check if source exists and determine if it's a directory
          const sourceStats = await fs.stat(expandedSourcePath);
          const isDirectory = sourceStats.isDirectory();

          // Create parent directory if it doesn't exist
          const parentDir = path.dirname(expandedDestinationPath);
          await fs.mkdir(parentDir, { recursive: true });

          if (isDirectory) {
            // Use fs.cp for recursive directory copy (Node.js 16.7+)
            await fs.cp(expandedSourcePath, expandedDestinationPath, { recursive: true });
            logger.info('Directory copied recursively', {
              from: validated.sourcePath,
              to: validated.destinationPath,
            });
          } else {
            // Copy the file
            await fs.copyFile(expandedSourcePath, expandedDestinationPath);
            logger.info('File copied successfully', {
              from: validated.sourcePath,
              to: validated.destinationPath,
            });
          }

          return { success: true, data: { isDirectory } };
        } catch (error) {
          logger.error('Failed to copy file/directory', error as Error, {
            from: validated.sourcePath,
            to: validated.destinationPath,
          });
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.COPY,
    ),
  );

  // Read directory with stats
  ipcMain.handle(
    FILE_CHANNELS.READ_DIR_WITH_STATS,
    createSafeValidatedHandler(
      FileReadDirWithStatsSchema,
      async (_, validated) => {
        try {
          // PERF: Changed from INFO to DEBUG - called for every directory read
          logger.debug('Reading directory with stats', {
            dirPath: validated.path,
            type: typeof validated.path,
            exists: validated.path ? 'yes' : 'no',
          });

          // Expand tilde in path for consistency
          const expandedPath = expandPath(validated.path);

          // Check if directory exists
          try {
            await fs.access(expandedPath);
            // PERF: Changed from INFO to DEBUG - called for every directory read
            logger.debug('Directory is accessible', { dirPath: expandedPath });
          } catch (accessError) {
            logger.error('Directory does not exist or is not accessible', accessError as Error, {
              dirPath: expandedPath,
            });
            return { success: false, error: `Directory not accessible: ${expandedPath}` };
          }

          const entries = await fs.readdir(expandedPath, { withFileTypes: true });
          logger.debug('Found entries in directory', {
            dirPath: expandedPath,
            count: entries.length,
          });

          const entriesWithStats = await Promise.all(
            entries.map(async (entry) => {
              const fullPath = path.join(expandedPath, entry.name);
              try {
                const stats = await fs.stat(fullPath);
                return {
                  name: entry.name,
                  isDirectory: entry.isDirectory(),
                  isFile: entry.isFile(),
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                };
              } catch  {
                // If we can't stat the file, return basic info
                return {
                  name: entry.name,
                  isDirectory: entry.isDirectory(),
                  isFile: entry.isFile(),
                  size: 0,
                  modified: new Date().toISOString(),
                };
              }
            }),
          );

          logger.debug('Successfully read directory with stats', {
            dirPath: expandedPath,
            entriesCount: entriesWithStats.length,
          });

          return { success: true, data: entriesWithStats };
        } catch (error) {
          logger.error('Failed to read directory with stats', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      FILE_CHANNELS.READ_DIR_WITH_STATS,
    ),
  );

  // Get gitignore patterns
  ipcMain.handle(
    FILE_CHANNELS.GET_GITIGNORE_PATTERNS,
    createSafeValidatedHandler(
      FileGetGitignorepatternsSchema,
      async (_, validated) => {
        try {
          const expandedPath = expandPath(validated.workspacePath);
          const gitignorePath = path.join(expandedPath, '.gitignore');
          const content = await fs.readFile(gitignorePath, 'utf-8');
          const patterns = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
          return { success: true, data: patterns };
        } catch  {
          // If no .gitignore file, return empty array
          return { success: true, data: [] };
        }
      },
      FILE_CHANNELS.GET_GITIGNORE_PATTERNS,
    ),
  );

  // Get git status for files
  ipcMain.handle(
    FILE_CHANNELS.GET_GIT_STATUS,
    createSafeValidatedHandler(
      FileGetGitStatusSchema,
      async (_, validated) => {
        try {
          // Check for remote workspace
          const rpcClient = await getRemoteRPCClient(validated.workspaceId);
          if (rpcClient) {
            // Get git status via RPC exec
            const statusResult = await rpcClient.exec({
              command: `cd '${validated.workspacePath}' && git status --porcelain -uall`,
              timeout: 10000,
            });

            const fileStatuses: Record<string, string> = {};
            const fileChanges: Record<string, { additions: number; deletions: number }> = {};

            if (statusResult.stdout) {
              // IMPORTANT: Use trimEnd() not trim() - git porcelain format is "XY filename"
              // where X can be a space for unstaged changes (e.g., " M README.md").
              // Using trim() would strip the leading space, corrupting the parsing.
              const lines = statusResult.stdout.trimEnd().split('\n').filter(Boolean);
              for (const line of lines) {
                if (line.length < 3) continue;
                const status = line.substring(0, 2);
                const filePath = line.substring(3);
                fileStatuses[filePath] = status;
              }
            }

            // Get diff stats via RPC exec
            try {
              const unstagedResult = await rpcClient.exec({
                command: `cd '${validated.workspacePath}' && git diff --numstat`,
                timeout: 10000,
              });

              if (unstagedResult.stdout) {
                const statLines = unstagedResult.stdout.trim().split('\n').filter(Boolean);
                for (const statLine of statLines) {
                  const [additions, deletions, filePath] = statLine.split('\t');
                  if (filePath) {
                    fileChanges[filePath] = {
                      additions: parseInt(additions) || 0,
                      deletions: parseInt(deletions) || 0,
                    };
                  }
                }
              }

              const stagedResult = await rpcClient.exec({
                command: `cd '${validated.workspacePath}' && git diff --cached --numstat`,
                timeout: 10000,
              });

              if (stagedResult.stdout) {
                const statLines = stagedResult.stdout.trim().split('\n').filter(Boolean);
                for (const statLine of statLines) {
                  const [additions, deletions, filePath] = statLine.split('\t');
                  if (filePath && !fileChanges[filePath]) {
                    fileChanges[filePath] = {
                      additions: parseInt(additions) || 0,
                      deletions: parseInt(deletions) || 0,
                    };
                  }
                }
              }

              // Handle untracked/new files - count lines via RPC exec wc -l
              for (const [filePath, status] of Object.entries(fileStatuses)) {
                if ((status === '??' || status.startsWith('A')) && !fileChanges[filePath]) {
                  try {
                    const wcResult = await rpcClient.exec({
                      command: `wc -l < '${validated.workspacePath}/${filePath}'`,
                      timeout: 5000,
                    });
                    const lineCount = parseInt(wcResult.stdout.trim()) || 0;
                    fileChanges[filePath] = {
                      additions: lineCount,
                      deletions: 0,
                    };
                  } catch  {
                    fileChanges[filePath] = {
                      additions: 0,
                      deletions: 0,
                    };
                  }
                }
              }
            } catch (err) {
              // For non-zero exit codes from git diff, extract stdout if available
              if (err instanceof RemoteRPCError && err.data) {
                logger.debug('Git diff returned non-zero exit code', { error: err.message });
              }
              // Otherwise ignore errors from git diff
            }

            return {
              success: true,
              data: {
                fileStatuses,
                fileChanges,
              },
            };
          }

          // Local workspace - existing code path
          // Expand tilde in path for consistency
          const expandedPath = expandPath(validated.workspacePath);

          // ASYNC: Get git status without blocking the main process
          // Use -uall to list individual files within untracked directories
          // instead of just showing the directory name (e.g., "src/stores/theme.ts" instead of "src/stores/")
          const { stdout: statusOutput } = await execAsync('git status --porcelain -uall', {
            cwd: expandedPath,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: 5000, // 5 second timeout
          });

          const fileStatuses: Record<string, string> = {};
          const fileChanges: Record<string, { additions: number; deletions: number }> = {};

          // Parse status output
          // IMPORTANT: Use trimEnd() not trim() - git porcelain format is "XY filename"
          // where X can be a space for unstaged changes (e.g., " M README.md").
          // Using trim() would strip the leading space, corrupting the parsing.
          const lines = statusOutput.trimEnd().split('\n').filter(Boolean);
          for (const line of lines) {
            if (line.length < 3) continue;
            const status = line.substring(0, 2);
            const filePath = line.substring(3);
            fileStatuses[filePath] = status;
          }

          // Get additions/deletions using git diff --numstat (ASYNC)
          try {
            // Get unstaged changes
            const { stdout: unstagedStats } = await execAsync('git diff --numstat', {
              cwd: expandedPath,
              encoding: 'utf-8',
              maxBuffer: 10 * 1024 * 1024,
              timeout: 5000,
            });

            if (unstagedStats) {
              const statLines = unstagedStats.trim().split('\n').filter(Boolean);
              for (const statLine of statLines) {
                const [additions, deletions, filePath] = statLine.split('\t');
                if (filePath) {
                  fileChanges[filePath] = {
                    additions: parseInt(additions) || 0,
                    deletions: parseInt(deletions) || 0,
                  };
                }
              }
            }

            // Get staged changes (ASYNC)
            const { stdout: stagedStats } = await execAsync('git diff --cached --numstat', {
              cwd: expandedPath,
              encoding: 'utf-8',
              maxBuffer: 10 * 1024 * 1024,
              timeout: 5000,
            });

            if (stagedStats) {
              const statLines = stagedStats.trim().split('\n').filter(Boolean);
              for (const statLine of statLines) {
                const [additions, deletions, filePath] = statLine.split('\t');
                if (filePath && !fileChanges[filePath]) {
                  fileChanges[filePath] = {
                    additions: parseInt(additions) || 0,
                    deletions: parseInt(deletions) || 0,
                  };
                }
              }
            }

            // Handle new/untracked files (status ??) - Process in parallel for performance
            const fileReadPromises = [];
            for (const [filePath, status] of Object.entries(fileStatuses)) {
              if (status === '??' && !fileChanges[filePath]) {
                fileReadPromises.push(
                  fs
                    .readFile(path.join(expandedPath, filePath), 'utf-8')
                    .then((fileContent) => {
                      const lineCount = fileContent.split('\n').length;
                      fileChanges[filePath] = {
                        additions: lineCount,
                        deletions: 0,
                      };
                    })
                    .catch(() => {
                      // If we can't read the file, default to 0
                      fileChanges[filePath] = {
                        additions: 0,
                        deletions: 0,
                      };
                    }),
                );
              }
              // Handle newly added files (status A )
              else if (status.startsWith('A') && !fileChanges[filePath]) {
                fileReadPromises.push(
                  fs
                    .readFile(path.join(expandedPath, filePath), 'utf-8')
                    .then((fileContent) => {
                      const lineCount = fileContent.split('\n').length;
                      fileChanges[filePath] = {
                        additions: lineCount,
                        deletions: 0,
                      };
                    })
                    .catch(() => {
                      fileChanges[filePath] = {
                        additions: 0,
                        deletions: 0,
                      };
                    }),
                );
              }
            }

            // Wait for all file reads to complete
            await Promise.all(fileReadPromises);
          } catch  {
            // Ignore errors from git diff (might happen if no changes)
          }

          return {
            success: true,
            data: {
              fileStatuses,
              fileChanges,
            },
          };
        } catch (error) {
          logger.error('Failed to get git status', error as Error);
          return {
            success: true,
            data: {
              fileStatuses: {},
              fileChanges: {},
            },
          };
        }
      },
      FILE_CHANNELS.GET_GIT_STATUS,
    ),
  );

  // Get file tree with sizes for visualization
  ipcMain.handle(
    FILE_CHANNELS.GET_TREE_WITH_SIZES,
    createSafeValidatedHandler(
      FileGetTreeWithSizesSchema,
      async (_, validated): Promise<IpcResponse<any>> => {
        try {
          const expandedPath = expandPath(validated.path);
          // Schema has defaults (30 for maxDepth), but provide fallbacks for type safety
          const maxDepth = validated.maxDepth ?? 50;
          const excludePatterns = validated.excludePatterns ?? [];

          interface FileTreeNode {
            name: string;
            path: string;
            size?: number;
            children?: FileTreeNode[];
          }

          async function buildTree(
            dirPath: string,
            relativePath: string,
            currentDepth: number,
          ): Promise<FileTreeNode | null> {
            try {
              const stats = await fs.stat(dirPath);
              const name = path.basename(dirPath);

              // Check if should be excluded
              if (
                excludePatterns.some(
                  (pattern) => name === pattern || relativePath.includes(pattern),
                )
              ) {
                return null;
              }

              if (stats.isDirectory()) {
                if (currentDepth >= maxDepth) {
                  return { name, path: relativePath };
                }

                const entries = await fs.readdir(dirPath);
                const children: FileTreeNode[] = [];

                for (const entry of entries) {
                  const childPath = path.join(dirPath, entry);
                  const childRelativePath = relativePath ? `${relativePath}/${entry}` : entry;
                  const child = await buildTree(childPath, childRelativePath, currentDepth + 1);
                  if (child) {
                    children.push(child);
                  }
                }

                return { name, path: relativePath, children };
              } else {
                return { name, path: relativePath, size: stats.size };
              }
            } catch  {
              // Skip files/dirs we can't access
              return null;
            }
          }

          const tree = await buildTree(expandedPath, '', 0);

          return {
            success: true,
            data: tree,
          };
        } catch (error) {
          logger.error('Failed to get file tree with sizes', error as Error);
          return {
            success: false,
            error: {
              code: 'FILE_TREE_FAILED',
              message: error instanceof Error ? error.message : 'Failed to get file tree',
            },
          };
        }
      },
      FILE_CHANNELS.GET_TREE_WITH_SIZES,
    ),
  );

  // Get directory status — delegated to the daemon host. The BE mirrors the
  // worktree-aware .git detection and parent-git-root walk, so the IPC
  // response shape ({ exists, isDirectory, isEmpty, isGitRepo, parentGitRoot?,
  // relativePathFromGitRoot?, isSubdirectoryOfGitRepo, path }) is preserved.
  ipcMain.handle(
    FILE_CHANNELS.GET_DIRECTORY_STATUS,
    createSafeValidatedHandler(
      FileGetDirectoryStatusSchema,
      async (_, validated) => {
        try {
          const result = await getBackendClient().request<{
            exists: boolean;
            isDirectory: boolean;
            isEmpty: boolean;
            isGitRepo: boolean;
            parentGitRoot?: string;
            relativePathFromGitRoot?: string;
            isSubdirectoryOfGitRepo: boolean;
            path: string;
          }>('host.directoryStatus', { path: validated.path });
          return { success: true, data: result };
        } catch (error) {
          logger.error('Failed to get directory status', error as Error);
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      FILE_CHANNELS.GET_DIRECTORY_STATUS,
    ),
  );
}
