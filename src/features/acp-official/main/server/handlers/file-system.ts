/**
 * File System Handler for ACP Server
 *
 * Handles file system operations within the workspace.
 * All paths are resolved relative to the workspace root for security.
 */

import * as fs from 'fs/promises';
import { Stats } from 'fs';
import * as path from 'path';
import { Logger } from '../../../../../shared/logger';
import { fsyncFile } from '../../../../../shared/main/file-sync-utils';

const logger = new Logger('ACPFileSystemHandler');

export class FileSystemHandler {
  constructor(private workspacePath: string, private scope?: string) {}

  /**
   * Resolve and validate a file path
   * Ensures the path is within the workspace directory (or scoped subdirectory if scope is set)
   */
  private resolvePath(filePath: string): string {
    // Determine the effective base path (apply scope if present)
    const basePath = this.scope
      ? path.join(this.workspacePath, this.scope)
      : this.workspacePath;

    // If path is already absolute, ensure it's within the effective base
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(basePath, filePath);

    // Security check: ensure path is within the scoped workspace
    const relative = path.relative(basePath, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path is outside workspace scope: ${filePath}`);
    }

    return resolvedPath;
  }

  /**
   * Read a text file
   */
  async readTextFile(filePath: string): Promise<string> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      logger.debug('Reading file', { path: resolvedPath });

      const content = await fs.readFile(resolvedPath, 'utf-8');
      return content;
    } catch (error) {
      logger.error('Failed to read file', error as Error, { path: filePath });
      throw error;
    }
  }

  /**
   * Write a text file
   */
  async writeTextFile(filePath: string, content: string): Promise<void> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      logger.debug('Writing file', { path: resolvedPath });

      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolvedPath, content, 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(resolvedPath);
    } catch (error) {
      logger.error('Failed to write file', error as Error, { path: filePath });
      throw error;
    }
  }

  /**
   * Check if a file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file stats
   */
  async getStats(filePath: string): Promise<Stats> {
    const resolvedPath = this.resolvePath(filePath);
    return await fs.stat(resolvedPath);
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      const resolvedPath = this.resolvePath(dirPath);
      const entries = await fs.readdir(resolvedPath);
      return entries;
    } catch (error) {
      logger.error('Failed to list directory', error as Error, { path: dirPath });
      throw error;
    }
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    try {
      const resolvedPath = this.resolvePath(dirPath);
      await fs.mkdir(resolvedPath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create directory', error as Error, { path: dirPath });
      throw error;
    }
  }

  /**
   * Delete a file or directory
   */
  async delete(filePath: string): Promise<void> {
    try {
      const resolvedPath = this.resolvePath(filePath);
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        await fs.rm(resolvedPath, { recursive: true, force: true });
      } else {
        await fs.unlink(resolvedPath);
      }
    } catch (error) {
      logger.error('Failed to delete', error as Error, { path: filePath });
      throw error;
    }
  }

  /**
   * Move/rename a file or directory
   */
  async move(oldPath: string, newPath: string): Promise<void> {
    try {
      const resolvedOldPath = this.resolvePath(oldPath);
      const resolvedNewPath = this.resolvePath(newPath);

      // Ensure destination directory exists
      const destDir = path.dirname(resolvedNewPath);
      await fs.mkdir(destDir, { recursive: true });

      await fs.rename(resolvedOldPath, resolvedNewPath);
    } catch (error) {
      logger.error('Failed to move', error as Error, { from: oldPath, to: newPath });
      throw error;
    }
  }

  /**
   * Copy a file
   */
  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    try {
      const resolvedSourcePath = this.resolvePath(sourcePath);
      const resolvedDestPath = this.resolvePath(destPath);

      // Ensure destination directory exists
      const destDir = path.dirname(resolvedDestPath);
      await fs.mkdir(destDir, { recursive: true });

      await fs.copyFile(resolvedSourcePath, resolvedDestPath);
    } catch (error) {
      logger.error('Failed to copy file', error as Error, { from: sourcePath, to: destPath });
      throw error;
    }
  }
}
