/**
 * File IPC
 *
 * IPC layer for file operations.
 */

import { ipcMain, dialog } from 'electron';
import { promises as fs, createReadStream } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { homedir } from 'os';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { getBackendClientForIpcEvent } from '../../backend/main/backend.ipc';
import {
  isBinaryExtension,
  detectBinaryContent,
  KNOWN_TEXT_EXTENSIONS,
  getExtension,
} from '../../../shared/binary-file-extensions';
import { FILE_CHANNELS } from '$shared/ipc/channels';
import { type IpcResponse, FileIpc } from '$shared/ipc';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  FileReadSchema,
  FileReadChunkSchema,
  FileHashSchema,
  FileListSchema,
  FileReadBatchSchema,
  FileReadDirWithStatsSchema,
  FileGetGitignorepatternsSchema,
  FileGetGitStatusSchema,
  FileMkdirSchema,
  FileGetTreeWithSizesSchema,
  FileDownloadSchema,
  FileDownloadAttachmentSchema,
} from '../../../main/ipc-schemas';
import { execAsync } from '../../../shared/git/git-env';
import { renameWithRetry } from '../../../shared/main/file-sync-utils';
import { createZipFromPaths } from '../../debug-export/main/zip-utils';
import {
  shouldUseTransferConnection,
  withTransferConnection,
} from '../../backend/main/transfer-connections';

const logger = new Logger('FileIPC');

/**
 * Maximum file size for reading (10MB)
 * Files larger than this will be rejected to prevent memory issues
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Bytes requested per `file.readChunk` call in the attachment download loop
 * — the daemon's per-call cap (READ_CHUNK_MAX_BYTES, PROTOCOL §5.9), so big
 * attachments take the fewest round trips without ever tripping -32602.
 */
const DOWNLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

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

// Remote-workspace file IPC branches retired in P3-5.1; handlers below run
// against the local filesystem only. Remote-configured workspaces surface
// underlying fs errors through the existing try/catch → { success: false }
// contract rather than routing through the legacy remote stack.

export function setupFileIPC() {
  // Read file
  ipcMain.handle(
    FILE_CHANNELS.READ,
    createSafeValidatedHandler(
      FileReadSchema,
      async (_, validated): Promise<IpcResponse<FileIpc.ReadResponse>> => {
        try {
          // Local-only after P3-5.1; remote reads no longer route through RPC.
          const expandedPath = expandPath(validated.path);

          // Check if this is a directory - can't read directories as files
          const stats = await fs.stat(expandedPath);
          if (stats.isDirectory()) {
            logger.warn('Attempted to read a directory as a file', { path: validated.path });
            return {
              success: false,
              error: {
                code: 'IS_DIRECTORY',
                message: m.file_ipc_isDirectory_error({ path: validated.path }),
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
                  message: m.file_ipc_fileTooLarge_error({
                    sizeKb: Math.round(stats.size / 1024),
                    maxKb: Math.round(effectiveMaxSize / 1024),
                  }),
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
          // NOTE: `isBinary` reflects extension/content sniffing only. With an
          // explicit `encoding: 'base64'` request, `content` is base64 even when
          // `isBinary` is false — callers that passed an encoding must not use
          // `isBinary` to decide how to decode `content`.
          const isBinary = isBinaryByExtension || isBinaryByContent;

          if (isBinaryByContent) {
            logger.debug('Detected binary content in text file', {
              path: validated.path,
              extension: ext,
            });
          }

          let content: string;
          let truncated = false;

          if (validated.encoding === 'base64' || isBinary) {
            // Explicit base64 requests (e.g. attachment bytes for the remote
            // placeAttachment data arm) and binary files return base64.
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
              message: error instanceof Error ? error.message : m.file_ipc_readFailed_error(),
            },
          };
        }
      },
      FILE_CHANNELS.READ,
    ),
  );

  // Read one bounded slice of a file (base64). Used by the chunked remote
  // attachment upload (file.attachmentUpload.*, PROTOCOL §5.9) so gigabyte
  // files never get buffered whole in either process.
  ipcMain.handle(
    FILE_CHANNELS.READ_CHUNK,
    createSafeValidatedHandler(
      FileReadChunkSchema,
      async (_, validated): Promise<IpcResponse<FileIpc.ReadChunkResponse>> => {
        try {
          const expandedPath = expandPath(validated.path);
          const stats = await fs.stat(expandedPath);
          if (stats.isDirectory()) {
            return {
              success: false,
              error: {
                code: 'IS_DIRECTORY',
                message: m.file_ipc_isDirectory_error({ path: validated.path }),
              },
            };
          }
          const handle = await fs.open(expandedPath, 'r');
          try {
            const buffer = Buffer.alloc(validated.length);
            const { bytesRead } = await handle.read(buffer, 0, validated.length, validated.offset);
            return {
              success: true,
              data: {
                content: buffer.subarray(0, bytesRead).toString('base64'),
                bytesRead,
                size: stats.size,
              },
            };
          } finally {
            await handle.close();
          }
        } catch (error) {
          logger.error('Failed to read file chunk', error as Error, { path: validated.path });
          return {
            success: false,
            error: {
              code: 'FILE_READ_FAILED',
              message: error instanceof Error ? error.message : m.file_ipc_readFailed_error(),
            },
          };
        }
      },
      FILE_CHANNELS.READ_CHUNK,
    ),
  );

  // Streaming SHA-256 of a file (chunked remote attachment upload: the
  // daemon verifies the assembled payload against this checksum at commit).
  ipcMain.handle(
    FILE_CHANNELS.HASH,
    createSafeValidatedHandler(
      FileHashSchema,
      async (_, validated): Promise<IpcResponse<FileIpc.HashResponse>> => {
        try {
          const expandedPath = expandPath(validated.path);
          const stats = await fs.stat(expandedPath);
          if (stats.isDirectory()) {
            return {
              success: false,
              error: {
                code: 'IS_DIRECTORY',
                message: m.file_ipc_isDirectory_error({ path: validated.path }),
              },
            };
          }
          const sha256 = await new Promise<string>((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = createReadStream(expandedPath);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
          });
          return { success: true, data: { sha256, size: stats.size } };
        } catch (error) {
          logger.error('Failed to hash file', error as Error, { path: validated.path });
          return {
            success: false,
            error: {
              code: 'FILE_READ_FAILED',
              message: error instanceof Error ? error.message : m.file_ipc_readFailed_error(),
            },
          };
        }
      },
      FILE_CHANNELS.HASH,
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

          // Local-only after P3-5.1; remote batch reads no longer route through RPC.
          const results = await Promise.all(
            validated.requests.map(async ({ path: filePath }) => {
              try {
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
                  } catch {
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
            return {
              success: false,
              error: m.file_ipc_dirNotAccessible_error({ path: expandedPath }),
            };
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
              } catch {
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
        } catch {
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
          // Local-only after P3-5.1; remote git-status no longer routes through RPC.
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
          } catch {
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
            } catch {
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
              message: error instanceof Error ? error.message : m.file_ipc_fileTreeFailed_error(),
            },
          };
        }
      },
      FILE_CHANNELS.GET_TREE_WITH_SIZES,
    ),
  );

  // Download (save a copy of) a file, or a zip of a folder, to a user-chosen
  // location.
  ipcMain.handle(
    FILE_CHANNELS.DOWNLOAD,
    createSafeValidatedHandler(
      FileDownloadSchema,
      async (
        _,
        validated,
      ): Promise<IpcResponse<FileIpc.DownloadResponse> & { canceled?: boolean }> => {
        const expandedPath = expandPath(validated.path);

        let stats;
        try {
          stats = await fs.stat(expandedPath);
        } catch (error) {
          logger.warn('Download source path not found', {
            path: validated.path,
            error: (error as Error).message,
          });
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: m.file_ipc_downloadNotFound_error({ path: validated.path }),
            },
          };
        }

        try {
          const baseName = path.basename(expandedPath);

          if (stats.isDirectory()) {
            const { filePath, canceled } = await dialog.showSaveDialog({
              defaultPath: `${baseName}.zip`,
              filters: [{ name: m.dialog_zip_files_filter(), extensions: ['zip'] }],
            });
            if (canceled || !filePath) {
              return { success: false, canceled: true };
            }
            // Prefix entries with the folder name so the archive unpacks
            // into a folder rather than spilling its contents.
            await createZipFromPaths(expandedPath, filePath, baseName);
            logger.info('Folder downloaded as zip', { source: expandedPath, filePath });
            return { success: true, data: { filePath } };
          }

          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: baseName,
          });
          if (canceled || !filePath) {
            return { success: false, canceled: true };
          }
          await fs.copyFile(expandedPath, filePath);
          logger.info('File downloaded', { source: expandedPath, filePath });
          return { success: true, data: { filePath } };
        } catch (error) {
          logger.error('Failed to download path', error as Error, {
            path: validated.path,
            errorMsg: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            error: {
              code: 'DOWNLOAD_FAILED',
              message: m.file_ipc_downloadFailed_error({ path: validated.path }),
            },
          };
        }
      },
      FILE_CHANNELS.DOWNLOAD,
    ),
  );

  // Save an attachment to a user-chosen location (monorepo#2458). Unlike
  // `file:download` (host-local absolute paths), the source path here is
  // daemon-side workspace-relative, so the bytes are fetched through the
  // backend: a remote backend streams `file.readChunk` slices over a
  // per-transfer connection (no whole-file buffering, and the ~21 MiB
  // base64 frames never head-of-line-block the main channel); the local
  // UDS backend copies straight from the workspace path on disk.
  ipcMain.handle(
    FILE_CHANNELS.DOWNLOAD_ATTACHMENT,
    createSafeValidatedHandler(
      FileDownloadAttachmentSchema,
      async (
        event,
        validated,
      ): Promise<IpcResponse<FileIpc.DownloadAttachmentResponse> & { canceled?: boolean }> => {
        const { workspaceId, path: sourcePath, fileName } = validated;
        try {
          // Bind the source before the native dialog yields: changing the
          // window's connection must never retarget this download.
          const { backendId, client } = getBackendClientForIpcEvent(event);
          const config = client.getConfig();
          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: fileName,
          });
          if (canceled || !filePath) {
            return { success: false, canceled: true };
          }

          // Atomic write: stage into a temp file so a mid-transfer failure
          // never truncates or partially overwrites the chosen destination.
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const tempPath = `${filePath}.${Date.now()}-${randomSuffix}.tmp`;
          try {
            if (shouldUseTransferConnection('file.readChunk', config)) {
              await withTransferConnection(
                config,
                async (connection) => {
                  const handle = await fs.open(tempPath, 'w');
                  try {
                    let offset = 0;
                    for (;;) {
                      const chunk = await connection.request<FileIpc.ReadChunkResponse>(
                        'file.readChunk',
                        { workspaceId, path: sourcePath, offset, length: DOWNLOAD_CHUNK_BYTES },
                      );
                      // PROTOCOL §5.9 guarantees content decodes to bytesRead
                      // bytes; fail loudly rather than reassemble a corrupt
                      // file if they ever diverge.
                      const buffer = Buffer.from(chunk.content, 'base64');
                      if (buffer.length !== chunk.bytesRead) {
                        throw new Error(
                          `file.readChunk content/bytesRead mismatch (${buffer.length} vs ${chunk.bytesRead})`,
                        );
                      }
                      if (buffer.length > 0) {
                        // FileHandle.write() may complete a short write; loop
                        // until the whole chunk is on disk.
                        let written = 0;
                        while (written < buffer.length) {
                          const { bytesWritten } = await handle.write(buffer, written);
                          written += bytesWritten;
                        }
                        offset += buffer.length;
                      }
                      if (buffer.length < DOWNLOAD_CHUNK_BYTES || offset >= chunk.size) break;
                    }
                  } finally {
                    await handle.close();
                  }
                },
                backendId,
              );
            } else {
              // Same root resolution the daemon's file ops use: the worktree
              // when one exists, else the workspace path.
              const response = await client.request<{
                workspace?: { path?: string; worktreePath?: string };
              }>('workspace.get', { workspaceId });
              const workspacePath = response?.workspace?.worktreePath ?? response?.workspace?.path;
              if (!workspacePath) {
                throw new Error(`workspace ${workspaceId} has no path`);
              }
              // Mirror the daemon-side workspace containment the remote arm
              // gets from file.readChunk: reject paths escaping the root.
              const resolved = path.resolve(workspacePath, sourcePath);
              if (resolved !== workspacePath && !resolved.startsWith(workspacePath + path.sep)) {
                throw new Error(`attachment path escapes workspace root: ${sourcePath}`);
              }
              await fs.copyFile(resolved, tempPath);
            }
            await renameWithRetry(tempPath, filePath);
          } catch (error) {
            try {
              await fs.unlink(tempPath);
            } catch {
              // Ignore cleanup errors
            }
            throw error;
          }

          logger.info('Attachment downloaded', { workspaceId, source: sourcePath, filePath });
          return { success: true, data: { filePath } };
        } catch (error) {
          logger.error('Failed to download attachment', error as Error, {
            workspaceId,
            path: sourcePath,
            errorMsg: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            error: {
              code: 'DOWNLOAD_FAILED',
              message: m.file_ipc_downloadFailed_error({ path: fileName }),
            },
          };
        }
      },
      FILE_CHANNELS.DOWNLOAD_ATTACHMENT,
    ),
  );
}
