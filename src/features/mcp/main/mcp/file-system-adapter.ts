/**
 * File System Adapter
 *
 * Provides a unified interface for local workspace file operations used by
 * MCP tools.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

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
}

/**
 * Local file system adapter
 */
export class LocalFileSystemAdapter implements IFileSystemAdapter {
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

