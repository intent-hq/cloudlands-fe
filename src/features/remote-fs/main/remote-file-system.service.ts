/**
 * Remote File System Service
 *
 * Provides comprehensive file system operations over RPC for remote workspaces.
 * This service acts as a bridge between the application and remote file systems,
 * offering the same interface as local file operations but executed remotely.
 */

import { EventEmitter } from 'events';
import { remoteRPCManager } from '$shared/main/remote-rpc-manager';
import { RemoteRPCError } from '$shared/main/remote-rpc-client';
import type { RemoteRPCClient } from '$shared/main/remote-rpc-client';
import * as path from 'path';
import { Logger } from '$shared/logger';
import { createCache, type Cache } from '../../../main/utils/cache';

const logger = new Logger('RemoteFileSystemService');

export interface RemoteFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink?: boolean;
  size: number;
  modified: Date;
  permissions?: string;
}

export interface RemoteFileSystemConfig {
  workspaceId: string;
  basePath: string; // Base path for all operations
}

export class RemoteFileSystemService extends EventEmitter {
  private config: RemoteFileSystemConfig;
  private isConnected: boolean = false;
  private fileCache: Cache<string, string> = createCache<string, string>({
    name: 'remote-fs:files',
    ttlMs: 5000,
    maxSize: 200,
  });

  constructor(config: RemoteFileSystemConfig) {
    super();
    this.config = config;
  }

  /**
   * Get the RPC client for this workspace
   */
  private async getRPCClient(): Promise<RemoteRPCClient> {
    return remoteRPCManager.getClient(this.config.workspaceId);
  }

  /**
   * Helper to execute a command via RPC, handling non-zero exit codes
   */
  private async execCommand(
    command: string,
    options?: { timeout?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const rpcClient = await this.getRPCClient();
    try {
      const result = await rpcClient.exec({ command, timeout: options?.timeout });
      return result;
    } catch (error) {
      // RPC exec returns non-zero exit codes as JSON-RPC errors (code -32000)
      if (error instanceof RemoteRPCError && error.code === -32000) {
        const data = error.data as { stdout?: string; stderr?: string; exitCode?: number } | undefined;
        return {
          stdout: data?.stdout ?? '',
          stderr: data?.stderr ?? error.message,
          exitCode: data?.exitCode ?? 1,
        };
      }
      throw error;
    }
  }

  /**
   * Initialize the remote file system connection
   */
  async initialize(): Promise<void> {
    if (this.isConnected) return;

    try {
      // Verify RPC client is accessible
      await this.getRPCClient();
      this.isConnected = true;
      this.emit('connected');
      logger.debug('Connected to remote server via RPC', { workspaceId: this.config.workspaceId });
    } catch (error) {
      logger.error('Connection failed', error as Error);
      throw new Error(`Failed to connect to remote server: ${error}`);
    }
  }

  /**
   * Read a file from the remote system
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const fullPath = this.resolvePath(filePath);

    // Validate path to prevent directory traversal
    if (!this.isValidPath(fullPath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // Check cache first
    const cached = this.fileCache.get(fullPath);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const rpcClient = await this.getRPCClient();
      const result = await rpcClient.readFile({ path: fullPath });

      // Cache the content
      this.fileCache.set(fullPath, result.content);

      return result.content;
    } catch (error) {
      logger.error('Failed to read file', error as Error, { fullPath });
      throw new Error(`Failed to read remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Write content to a file on the remote system
   */
  async writeFile(
    filePath: string,
    content: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    // Validate path to prevent directory traversal
    if (!this.isValidPath(fullPath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    try {
      const rpcClient = await this.getRPCClient();
      await rpcClient.writeFile({ path: fullPath, content, mkdirp: true });

      // Invalidate cache
      this.fileCache.delete(fullPath);

      this.emit('fileWritten', fullPath);
      logger.debug('File written', { fullPath });
    } catch (error) {
      logger.error('Failed to write file', error as Error, { fullPath });
      throw new Error(`Failed to write remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Append content to a file
   */
  async appendFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    // Validate path to prevent directory traversal
    if (!this.isValidPath(fullPath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    try {
      // Use base64 encoding to safely transfer content without shell escaping issues
      const base64Content = Buffer.from(content, 'utf-8').toString('base64');
      const escapedPath = this.escapeShellArg(fullPath);

      // Use base64 decoding to append the file safely
      const command = `echo "${base64Content}" | base64 -d >> ${escapedPath}`;
      const result = await this.execCommand(command);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to append to file: ${result.stderr}`);
      }

      // Invalidate cache
      this.fileCache.delete(fullPath);
    } catch (error) {
      logger.error('Failed to append to file', error as Error, { fullPath });
      throw new Error(`Failed to append to remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a file from the remote system
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);

    try {
      const rpcClient = await this.getRPCClient();
      await rpcClient.exec({ command: `rm -f ${this.escapeShellArg(fullPath)}` });

      // Invalidate cache
      this.fileCache.delete(fullPath);

      this.emit('fileDeleted', fullPath);
      logger.debug('File deleted', { fullPath });
    } catch (error) {
      logger.error('Failed to delete file', error as Error, { fullPath });
      throw new Error(`Failed to delete remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Get all files recursively using a single RPC exec command.
   * This is much more efficient than calling readdir() for each directory,
   * reducing many requests to just one.
   *
   * @param dirPath - The directory to scan
   * @param excludeDirs - Directory names to skip (e.g., 'node_modules', '.git')
   * @returns Array of file paths (absolute)
   */
  async getAllFilesRecursive(dirPath: string, excludeDirs: string[] = []): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath);

    try {
      // Build find command with exclusions
      // Using -not -path to exclude directories, and -type f to get only files
      // Using -not -type l to exclude symlinks (matches local behavior)
      let findCommand = `find ${this.escapeShellArg(fullPath)} -type f -not -type l`;

      // Add exclusions for each directory
      for (const dir of excludeDirs) {
        // Escape special regex characters in directory name
        const escapedDir = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        findCommand += ` -not -path '*/${escapedDir}/*'`;
      }

      // Limit output to prevent memory issues with very large repos
      // 50000 files should be more than enough for change detection
      findCommand += ' 2>/dev/null | head -n 50000';

      const result = await this.execCommand(findCommand, { timeout: 60000 });

      if (result.exitCode !== 0 && result.stdout.trim() === '') {
        // Directory might not exist or other error
        logger.warn('getAllFilesRecursive failed', { fullPath, stderr: result.stderr });
        return [];
      }

      // Parse the output - each line is a file path
      const files = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      logger.debug('getAllFilesRecursive completed', { fullPath, fileCount: files.length });
      return files;
    } catch (error) {
      logger.error('Failed to get all files recursively', error as Error, { fullPath });
      // Return empty array instead of throwing to allow graceful degradation
      return [];
    }
  }

  /**
   * Get file hashes for all files in a directory using a single RPC exec command.
   * This computes hashes on the remote server instead of reading each file individually.
   *
   * @param dirPath - The directory to scan
   * @param excludeDirs - Directory names to skip (e.g., 'node_modules', '.git')
   * @returns Map of file path to SHA1 hash
   */
  async getAllFileHashes(
    dirPath: string,
    excludeDirs: string[] = [],
  ): Promise<Map<string, string>> {
    const fullPath = this.resolvePath(dirPath);
    const hashes = new Map<string, string>();

    try {
      // Build find command with exclusions
      // Using sha1sum to compute hashes on the remote server
      // This avoids reading each file individually
      let findCommand = `find ${this.escapeShellArg(fullPath)} -type f -not -type l`;

      // Add exclusions for each directory
      for (const dir of excludeDirs) {
        const escapedDir = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        findCommand += ` -not -path '*/${escapedDir}/*'`;
      }

      // Use find -exec with + to batch sha1sum calls efficiently
      // Limit to 10000 files to prevent timeout with very large repos
      findCommand += ' 2>/dev/null | head -n 10000';
      // Use while read loop to handle filenames with spaces correctly
      findCommand += ' | while IFS= read -r f; do sha1sum "$f" 2>/dev/null; done';

      const result = await this.execCommand(findCommand, { timeout: 120000 });

      // Parse the output - format is: "hash  filepath" per line
      // sha1sum outputs two spaces between hash and path
      const lines = result.stdout.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        // sha1sum format: "hash  filename" (two spaces)
        const match = line.match(/^([a-f0-9]{40})\s+(.+)$/);
        if (match) {
          const [, hash, filePath] = match;
          hashes.set(filePath, hash);
        }
      }

      logger.debug('getAllFileHashes completed', { fullPath, fileCount: hashes.size });
      return hashes;
    } catch (error) {
      logger.error('Failed to get all file hashes', error as Error, { fullPath });
      // Return empty map instead of throwing to allow graceful degradation
      return hashes;
    }
  }

  /**
   * List directory contents
   */
  async readdir(dirPath: string): Promise<RemoteFileInfo[]> {
    const fullPath = this.resolvePath(dirPath);

    try {
      const rpcClient = await this.getRPCClient();
      const result = await rpcClient.listDir({ path: fullPath });

      const files: RemoteFileInfo[] = [];
      for (const entry of result.entries) {
        // Skip . and .. entries
        if (entry.name === '.' || entry.name === '..') continue;

        const isSymlink = entry.type === 'symlink';
        files.push({
          name: entry.name,
          path: path.posix.join(fullPath, entry.name),
          isDirectory: entry.type === 'directory',
          isFile: entry.type === 'file',
          isSymlink,
          size: entry.size,
          modified: new Date(entry.mtime),
        });
      }

      return files;
    } catch (error) {
      logger.error('Failed to list directory', error as Error, { fullPath });
      throw new Error(`Failed to list remote directory: ${(error as Error).message}`);
    }
  }

  /**
   * Create a directory
   */
  async mkdir(dirPath: string, recursive: boolean = true): Promise<void> {
    const fullPath = this.resolvePath(dirPath);

    try {
      const flags = recursive ? '-p' : '';
      const result = await this.execCommand(
        `mkdir ${flags} ${this.escapeShellArg(fullPath)}`,
      );

      if (result.exitCode !== 0 && !result.stderr.includes('File exists')) {
        throw new Error(`Failed to create directory: ${result.stderr}`);
      }

      this.emit('directoryCreated', fullPath);
    } catch (error) {
      logger.error('Failed to create directory', error as Error, { fullPath });
      throw new Error(`Failed to create remote directory: ${(error as Error).message}`);
    }
  }

  /**
   * Remove a directory
   */
  async rmdir(dirPath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolvePath(dirPath);

    try {
      const escapedPath = this.escapeShellArg(fullPath);
      const command = recursive ? `rm -rf ${escapedPath}` : `rmdir ${escapedPath}`;
      const result = await this.execCommand(command);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to remove directory: ${result.stderr}`);
      }

      this.emit('directoryDeleted', fullPath);
    } catch (error) {
      logger.error('Failed to remove directory', error as Error, { fullPath });
      throw new Error(`Failed to remove remote directory: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a file or directory exists
   */
  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);

    try {
      const rpcClient = await this.getRPCClient();
      const result = await rpcClient.fileExists({ path: fullPath });
      return result.exists;
    } catch  {
      return false;
    }
  }

  /**
   * Get file or directory stats
   */
  async stat(filePath: string): Promise<RemoteFileInfo> {
    const fullPath = this.resolvePath(filePath);

    try {
      const rpcClient = await this.getRPCClient();
      const result = await rpcClient.stat({ path: fullPath });

      return {
        name: path.basename(fullPath),
        path: fullPath,
        isDirectory: result.isDirectory,
        isFile: result.isFile,
        isSymlink: result.isSymlink,
        size: result.size,
        modified: new Date(result.mtime),
        permissions: result.permissions,
      };
    } catch (error) {
      logger.error('Failed to stat', error as Error, { fullPath });
      throw new Error(`Failed to get remote file stats: ${(error as Error).message}`);
    }
  }

  /**
   * Copy a file or directory
   */
  async copy(source: string, destination: string, recursive: boolean = false): Promise<void> {
    const sourcePath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);

    try {
      const flags = recursive ? '-r' : '';
      const result = await this.execCommand(
        `cp ${flags} ${this.escapeShellArg(sourcePath)} ${this.escapeShellArg(destPath)}`,
      );

      if (result.exitCode !== 0) {
        throw new Error(`Failed to copy: ${result.stderr}`);
      }

      this.emit('fileCopied', { source: sourcePath, destination: destPath });
    } catch (error) {
      logger.error('Failed to copy', error as Error, { sourcePath, destPath });
      throw new Error(`Failed to copy remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Move/rename a file or directory
   */
  async move(source: string, destination: string): Promise<void> {
    const sourcePath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);

    try {
      const result = await this.execCommand(
        `mv ${this.escapeShellArg(sourcePath)} ${this.escapeShellArg(destPath)}`,
      );

      if (result.exitCode !== 0) {
        throw new Error(`Failed to move: ${result.stderr}`);
      }

      // Invalidate cache for both paths
      this.fileCache.delete(sourcePath);
      this.fileCache.delete(destPath);

      this.emit('fileMoved', { source: sourcePath, destination: destPath });
    } catch (error) {
      logger.error('Failed to move', error as Error, { sourcePath, destPath });
      throw new Error(`Failed to move remote file: ${(error as Error).message}`);
    }
  }

  /**
   * Search for files matching a pattern
   */
  async find(pattern: string, dirPath?: string): Promise<string[]> {
    const searchPath = dirPath ? this.resolvePath(dirPath) : this.config.basePath;

    try {
      const result = await this.execCommand(
        `find ${this.escapeShellArg(searchPath)} -name ${this.escapeShellArg(pattern)} 2>/dev/null`,
      );

      if (result.exitCode !== 0) {
        return [];
      }

      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.trim());
    } catch (error) {
      logger.error('Failed to find files matching pattern', error as Error, { pattern });
      return [];
    }
  }

  /**
   * Execute grep search on remote files
   */
  async grep(
    pattern: string,
    filePath: string,
    options?: { recursive?: boolean; ignoreCase?: boolean },
  ): Promise<string[]> {
    const fullPath = this.resolvePath(filePath);

    try {
      // Determine sensible defaults
      let recursive = !!options?.recursive;
      if (options?.recursive === undefined) {
        try {
          const info = await this.stat(fullPath);
          if (info.isDirectory) recursive = true;
        } catch {
          // ignore stat failures; fallback to non-recursive
        }
      }
      const ignoreCase = !!options?.ignoreCase;

      let flags = '';
      if (recursive) flags += 'r';
      if (ignoreCase) flags += 'i';
      if (flags) flags = `-${flags}`;

      const command = `grep ${flags} ${this.escapeShellArg(pattern)} ${this.escapeShellArg(fullPath)} 2>/dev/null`;
      const result = await this.execCommand(command);

      if (result.exitCode === 1) {
        // No matches found
        return [];
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`Grep failed: ${result.stderr}`);
      }

      return result.stdout.split('\n').filter((line) => line.trim());
    } catch (error) {
      logger.error('Failed to grep', error as Error, { pattern, fullPath });
      return [];
    }
  }

  /**
   * Watch a file or directory for changes (using polling)
   */
  async watch(
    filePath: string,
    callback: (event: string, filename: string) => void,
  ): Promise<() => void> {
    const fullPath = this.resolvePath(filePath);
    let lastModified: number = 0;
    let isWatching = true;

    const checkForChanges = async () => {
      if (!isWatching) return;

      try {
        const stats = await this.stat(fullPath);
        const currentModified = stats.modified.getTime();

        if (lastModified && currentModified !== lastModified) {
          callback('change', fullPath);
        }

        lastModified = currentModified;
      } catch  {
        // File might have been deleted
        if (lastModified) {
          callback('delete', fullPath);
          lastModified = 0;
        }
      }

      if (isWatching) {
        setTimeout(checkForChanges, 2000); // Poll every 2 seconds
      }
    };

    // Start watching
    checkForChanges();

    // Return stop function
    return () => {
      isWatching = false;
    };
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }

  /**
   * Resolve a path relative to the base path
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.posix.join(this.config.basePath, filePath);
  }

  /**
   * Validate a file path to prevent directory traversal attacks
   */
  private isValidPath(filePath: string): boolean {
    // Check for suspicious patterns BEFORE normalization
    if (filePath.includes('..') || filePath.includes('~')) {
      logger.warn('Suspicious file path - contains traversal patterns', { filePath });
      return false;
    }

    // Normalize the path
    const normalized = path.posix.normalize(filePath);

    // Ensure the normalized path is still within the base path
    if (this.config.basePath && !normalized.startsWith(this.config.basePath)) {
      logger.warn('Path escapes base directory', { filePath, basePath: this.config.basePath });
      return false;
    }

    return true;
  }

  /**
   * Properly escape shell arguments to prevent command injection
   */
  private escapeShellArg(arg: string): string {
    // Use single quotes and escape any single quotes in the argument
    // This is the safest way to escape shell arguments
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Disconnect from the remote server
   * Note: RPC lifecycle is managed by RemoteRPCManager, so we just clean up local state.
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      this.isConnected = false;
      this.fileCache.clear();
      this.emit('disconnected');
    }
  }

  /**
   * Check if connected to remote server
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}
