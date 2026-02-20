import { sshManager } from './ssh-manager';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export enum SyncDirection {
  Upload = 'upload',
  Download = 'download',
  Bidirectional = 'bidirectional',
}

export interface SyncOptions {
  exclude?: string[];
  includeHidden?: boolean;
  dryRun?: boolean;
  onProgress?: (file: string, progress: number) => void;
}

export interface SyncResult {
  filesTransferred: number;
  bytesTransferred: number;
  errors: string[];
  skipped: string[];
}

export class FileSync {
  /**
   * Sync files between local and remote directories
   */
  async syncDirectory(
    connectionId: string,
    localPath: string,
    remotePath: string,
    direction: SyncDirection,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    const result: SyncResult = {
      filesTransferred: 0,
      bytesTransferred: 0,
      errors: [],
      skipped: [],
    };

    try {
      switch (direction) {
        case SyncDirection.Upload:
          await this.uploadDirectory(connectionId, localPath, remotePath, result, options);
          break;
        case SyncDirection.Download:
          await this.downloadDirectory(connectionId, remotePath, localPath, result, options);
          break;
        case SyncDirection.Bidirectional:
          await this.syncBidirectional(connectionId, localPath, remotePath, result, options);
          break;
      }
    } catch (error) {
      result.errors.push(`Sync failed: ${(error as Error).message}`);
    }

    return result;
  }

  /**
   * Upload a directory recursively
   */
  private async uploadDirectory(
    connectionId: string,
    localPath: string,
    remotePath: string,
    result: SyncResult,
    options: SyncOptions,
    basePath?: string,
  ): Promise<void> {
    const base = basePath || localPath;
    const files = await readdir(localPath);

    for (const file of files) {
      // Skip excluded files
      if (this.shouldExclude(file, options)) {
        result.skipped.push(file);
        continue;
      }

      const localFile = path.join(localPath, file);
      const remoteFile = path.posix.join(remotePath, file);
      const relativePath = path.relative(base, localFile);

      try {
        const stats = await stat(localFile);

        if (stats.isDirectory()) {
          // Create remote directory
          await sshManager.executeCommand(connectionId, `mkdir -p "${remoteFile}"`);

          // Recursively upload directory contents
          await this.uploadDirectory(connectionId, localFile, remoteFile, result, options, base);
        } else if (stats.isFile()) {
          // Upload file
          if (!options.dryRun) {
            await sshManager.uploadFile(connectionId, localFile, remoteFile);
            result.filesTransferred++;
            result.bytesTransferred += stats.size;
          }

          if (options.onProgress) {
            options.onProgress(relativePath, 100);
          }
        }
      } catch (error) {
        result.errors.push(`Failed to upload ${relativePath}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Download a directory recursively
   */
  private async downloadDirectory(
    connectionId: string,
    remotePath: string,
    localPath: string,
    result: SyncResult,
    options: SyncOptions,
    basePath?: string,
  ): Promise<void> {
    const base = basePath || localPath;

    // List remote directory
    const files = await sshManager.listDirectory(connectionId, remotePath);

    // Ensure local directory exists
    await mkdir(localPath, { recursive: true });

    for (const file of files) {
      // Skip excluded files
      if (this.shouldExclude(file.filename, options)) {
        result.skipped.push(file.filename);
        continue;
      }

      const remoteFile = path.posix.join(remotePath, file.filename);
      const localFile = path.join(localPath, file.filename);
      const relativePath = path.relative(base, localFile);

      try {
        if (file.attrs.isDirectory()) {
          // Recursively download directory
          await this.downloadDirectory(connectionId, remoteFile, localFile, result, options, base);
        } else {
          // Download file
          if (!options.dryRun) {
            await sshManager.downloadFile(connectionId, remoteFile, localFile);
            result.filesTransferred++;
            result.bytesTransferred += file.attrs.size;
          }

          if (options.onProgress) {
            options.onProgress(relativePath, 100);
          }
        }
      } catch (error) {
        result.errors.push(`Failed to download ${relativePath}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Sync bidirectionally based on timestamps
   */
  private async syncBidirectional(
    connectionId: string,
    localPath: string,
    remotePath: string,
    result: SyncResult,
    options: SyncOptions,
  ): Promise<void> {
    // Get local files with timestamps
    const localFiles = await this.getLocalFiles(localPath);

    // Get remote files with timestamps
    const remoteFiles = await this.getRemoteFiles(connectionId, remotePath);

    // Compare and sync
    for (const [relativePath, localInfo] of localFiles) {
      const remoteInfo = remoteFiles.get(relativePath);

      if (!remoteInfo) {
        // File only exists locally, upload it
        const localFile = path.join(localPath, relativePath);
        const remoteFile = path.posix.join(remotePath, relativePath);

        if (!options.dryRun) {
          await sshManager.uploadFile(connectionId, localFile, remoteFile);
          result.filesTransferred++;
          result.bytesTransferred += localInfo.size;
        }
      } else if (localInfo.mtime > remoteInfo.mtime) {
        // Local file is newer, upload it
        const localFile = path.join(localPath, relativePath);
        const remoteFile = path.posix.join(remotePath, relativePath);

        if (!options.dryRun) {
          await sshManager.uploadFile(connectionId, localFile, remoteFile);
          result.filesTransferred++;
          result.bytesTransferred += localInfo.size;
        }
      }
    }

    // Check for files that only exist remotely
    for (const [relativePath, remoteInfo] of remoteFiles) {
      const localInfo = localFiles.get(relativePath);

      if (!localInfo) {
        // File only exists remotely, download it
        const localFile = path.join(localPath, relativePath);
        const remoteFile = path.posix.join(remotePath, relativePath);

        if (!options.dryRun) {
          await sshManager.downloadFile(connectionId, remoteFile, localFile);
          result.filesTransferred++;
          result.bytesTransferred += remoteInfo.size;
        }
      } else if (remoteInfo.mtime > localInfo.mtime) {
        // Remote file is newer, download it
        const localFile = path.join(localPath, relativePath);
        const remoteFile = path.posix.join(remotePath, relativePath);

        if (!options.dryRun) {
          await sshManager.downloadFile(connectionId, remoteFile, localFile);
          result.filesTransferred++;
          result.bytesTransferred += remoteInfo.size;
        }
      }
    }
  }

  /**
   * Get local files with metadata
   */
  private async getLocalFiles(
    dirPath: string,
    basePath?: string,
    files: Map<string, any> = new Map(),
  ): Promise<Map<string, any>> {
    const base = basePath || dirPath;
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const relativePath = path.relative(base, fullPath);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await this.getLocalFiles(fullPath, base, files);
      } else {
        files.set(relativePath, {
          size: stats.size,
          mtime: stats.mtime.getTime(),
        });
      }
    }

    return files;
  }

  /**
   * Get remote files with metadata
   */
  private async getRemoteFiles(
    connectionId: string,
    dirPath: string,
    basePath?: string,
    files: Map<string, any> = new Map(),
  ): Promise<Map<string, any>> {
    const base = basePath || dirPath;
    const entries = await sshManager.listDirectory(connectionId, dirPath);

    for (const entry of entries) {
      const fullPath = path.posix.join(dirPath, entry.filename);
      const relativePath = path.posix.relative(base, fullPath);

      if (entry.attrs.isDirectory()) {
        await this.getRemoteFiles(connectionId, fullPath, base, files);
      } else {
        files.set(relativePath, {
          size: entry.attrs.size,
          mtime: entry.attrs.mtime * 1000, // Convert to milliseconds
        });
      }
    }

    return files;
  }

  /**
   * Check if a file should be excluded
   */
  private shouldExclude(filename: string, options: SyncOptions): boolean {
    // Skip hidden files unless specified
    if (!options.includeHidden && filename.startsWith('.')) {
      return true;
    }

    // Check exclude patterns
    if (options.exclude) {
      for (const pattern of options.exclude) {
        if (filename.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }
}

export const fileSync = new FileSync();
