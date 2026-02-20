/**
 * File System Adapter
 *
 * Provides a unified interface for file operations that works with both
 * local and remote workspaces. This abstraction allows MCP tools to work
 * seamlessly regardless of whether the workspace is local or remote.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../../../shared/logger';
import type { EnvironmentConfig } from '../../../../shared/types';

const logger = new Logger('FileSystemAdapter');

/**
 * File system adapter interface
 */
export interface IFileSystemAdapter {
  /** Read file contents */
  readFile(filePath: string): Promise<string>;

  /** Write file contents */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Delete a file */
  deleteFile(filePath: string): Promise<void>;

  /** Rename/move a file */
  renameFile(oldPath: string, newPath: string): Promise<void>;

  /** Create a directory */
  createDirectory(dirPath: string): Promise<void>;

  /** List files in a directory */
  listFiles(dirPath: string): Promise<string[]>;

  /** Check if a path exists */
  exists(filePath: string): Promise<boolean>;

  /** Check if path is a directory */
  isDirectory(filePath: string): Promise<boolean>;

  /** Get file stats */
  stat(filePath: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }>;

  /** Resolve a path relative to workspace root */
  resolvePath(relativePath: string): string;

  /** Check if path is within workspace bounds */
  isWithinWorkspace(filePath: string): boolean;

  /** Whether this adapter is for a remote workspace */
  readonly isRemote: boolean;
}

/**
 * Local file system adapter
 */
export class LocalFileSystemAdapter implements IFileSystemAdapter {
  readonly isRemote = false;

  constructor(private workspacePath: string) {}

  resolvePath(relativePath: string): string {
    return path.resolve(this.workspacePath, relativePath);
  }

  isWithinWorkspace(filePath: string): boolean {
    const fullPath = this.resolvePath(filePath);
    return fullPath.startsWith(this.workspacePath);
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    return await fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    await fs.unlink(fullPath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const fullOldPath = this.resolvePath(oldPath);
    const fullNewPath = this.resolvePath(newPath);
    if (!this.isWithinWorkspace(oldPath) || !this.isWithinWorkspace(newPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullNewPath), { recursive: true });
    await fs.rename(fullOldPath, fullNewPath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    if (!this.isWithinWorkspace(dirPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    await fs.mkdir(fullPath, { recursive: true });
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const fullPath = this.resolvePath(dirPath);
    if (!this.isWithinWorkspace(dirPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    return await fs.readdir(fullPath);
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    try {
      const stats = await fs.stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
    const fullPath = this.resolvePath(filePath);
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const stats = await fs.stat(fullPath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      isDirectory: stats.isDirectory(),
    };
  }
}

/**
 * Remote file system adapter
 *
 * Uses RemoteFileSystemService to perform file operations on remote workspaces via RPC.
 */
export class RemoteFileSystemAdapter implements IFileSystemAdapter {
  readonly isRemote = true;
  private remoteFs: any; // RemoteFileSystemService instance
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private workspacePath: string,
    private workspaceId: string,
  ) {}

  /**
   * Get or create the remote file system service instance
   */
  private async getRemoteFs(): Promise<any> {
    if (!this.remoteFs) {
      // Dynamically import to avoid circular dependencies
      const { RemoteFileSystemService } =
        await import('../../../remote-fs/main/remote-file-system.service');

      this.remoteFs = new RemoteFileSystemService({
        workspaceId: this.workspaceId,
        basePath: this.workspacePath,
      });
    }

    // Initialize connection if not already done
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = this.remoteFs.initialize().then(() => {
          this.initialized = true;
        });
      }
      await this.initPromise;
    }

    return this.remoteFs;
  }

  resolvePath(relativePath: string): string {
    // For remote paths, use POSIX path joining
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    return this.workspacePath.endsWith('/')
      ? this.workspacePath + relativePath
      : `${this.workspacePath}/${relativePath}`;
  }

  isWithinWorkspace(filePath: string): boolean {
    const fullPath = this.resolvePath(filePath);
    return fullPath.startsWith(this.workspacePath);
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    // RemoteFileSystemService.readFile takes relative path and resolves it internally
    return await remoteFs.readFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    await remoteFs.writeFile(filePath, content);
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    await remoteFs.deleteFile(filePath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (!this.isWithinWorkspace(oldPath) || !this.isWithinWorkspace(newPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    // RemoteFileSystemService uses 'move' for rename operations
    await remoteFs.move(oldPath, newPath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isWithinWorkspace(dirPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    await remoteFs.mkdir(dirPath, true);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    if (!this.isWithinWorkspace(dirPath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    const files = await remoteFs.readdir(dirPath);
    return files.map((f: any) => f.name);
  }

  async exists(filePath: string): Promise<boolean> {
    const remoteFs = await this.getRemoteFs();
    return await remoteFs.exists(filePath);
  }

  async isDirectory(filePath: string): Promise<boolean> {
    try {
      const remoteFs = await this.getRemoteFs();
      const stat = await remoteFs.stat(filePath);
      return stat.isDirectory;
    } catch {
      return false;
    }
  }

  async stat(filePath: string): Promise<{ size: number; mtime: Date; isDirectory: boolean }> {
    if (!this.isWithinWorkspace(filePath)) {
      throw new Error('Access denied: path outside workspace');
    }
    const remoteFs = await this.getRemoteFs();
    const result = await remoteFs.stat(filePath);
    return {
      size: result.size,
      mtime: result.modified,
      isDirectory: result.isDirectory,
    };
  }
}

/**
 * Create a file system adapter for a workspace
 *
 * @param workspacePath - The workspace path (local or remote)
 * @param environmentConfig - Optional environment configuration for remote workspaces
 * @param workspaceId - Workspace ID (required for remote workspaces)
 * @returns A file system adapter appropriate for the workspace type
 */
export function createFileSystemAdapter(
  workspacePath: string,
  environmentConfig?: EnvironmentConfig,
  workspaceId?: string,
): IFileSystemAdapter {
  if (environmentConfig?.type === 'remote' && workspaceId) {
    logger.info('Creating remote file system adapter', {
      workspaceId,
      workspacePath,
    });
    return new RemoteFileSystemAdapter(workspacePath, workspaceId);
  }

  // Default to local file system adapter
  return new LocalFileSystemAdapter(workspacePath);
}
