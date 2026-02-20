/**
 * Local Executor
 *
 * Executes tool operations on the local file system.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IExecutor, FileInfo, FileStats, ExecuteOptions, CommandResult } from '../../types';
import { Logger } from '../../../../shared/logger';
import { execAsync } from '../../../../shared/git/git-env';

const logger = new Logger('LocalExecutor');

export class LocalExecutor implements IExecutor {
  readonly type = 'local' as const;

  constructor(private workspacePath: string) {
    logger.debug('LocalExecutor initialized', { workspacePath });
  }

  /**
   * Resolve a path relative to the workspace
   */
  private resolvePath(filePath: string): string {
    // If absolute path, ensure it's within workspace
    if (path.isAbsolute(filePath)) {
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(this.workspacePath)) {
        throw new Error(`Path outside workspace: ${filePath}`);
      }
      return resolved;
    }

    // Resolve relative to workspace
    const resolved = path.resolve(this.workspacePath, filePath);

    // Prevent directory traversal
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    return resolved;
  }

  async readFile(filePath: string): Promise<string> {
    try {
      const fullPath = this.resolvePath(filePath);
      logger.debug('Reading file', { path: fullPath });

      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      logger.error('Failed to read file', error as Error, { path: filePath });
      throw new Error(`Failed to read file ${filePath}: ${(error as Error).message}`);
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(filePath);
      logger.debug('Writing file', { path: fullPath, size: content.length });

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      logger.error('Failed to write file', error as Error, { path: filePath });
      throw new Error(`Failed to write file ${filePath}: ${(error as Error).message}`);
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(filePath);
      logger.debug('Deleting file', { path: fullPath });

      await fs.unlink(fullPath);
    } catch (error) {
      logger.error('Failed to delete file', error as Error, { path: filePath });
      throw new Error(`Failed to delete file ${filePath}: ${(error as Error).message}`);
    }
  }

  async listFiles(directory: string): Promise<FileInfo[]> {
    try {
      const fullPath = this.resolvePath(directory);
      logger.debug('Listing files', { path: fullPath });

      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);

        files.push({
          name: entry.name,
          path: path.relative(this.workspacePath, entryPath),
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stats.size,
          modified: stats.mtime,
          permissions: stats.mode.toString(8).slice(-3),
        });
      }

      return files;
    } catch (error) {
      logger.error('Failed to list files', error as Error, { directory });
      throw new Error(`Failed to list files in ${directory}: ${(error as Error).message}`);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileStats(filePath: string): Promise<FileStats> {
    try {
      const fullPath = this.resolvePath(filePath);
      const stats = await fs.stat(fullPath);

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymlink: stats.isSymbolicLink(),
        permissions: stats.mode.toString(8).slice(-3),
      };
    } catch (error) {
      logger.error('Failed to get file stats', error as Error, { path: filePath });
      throw new Error(`Failed to get stats for ${filePath}: ${(error as Error).message}`);
    }
  }

  async execute(command: string, options?: ExecuteOptions): Promise<CommandResult> {
    try {
      const cwd = options?.cwd ? this.resolvePath(options.cwd) : this.workspacePath;

      logger.debug('Executing command', {
        command: command.substring(0, 100),
        cwd,
      });

      const execOptions = {
        cwd,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout || 30000,
        maxBuffer: options?.maxBuffer || 1024 * 1024 * 10, // 10MB
        shell: options?.shell || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash')),
      };

      try {
        const { stdout, stderr } = await execAsync(command, execOptions);

        return {
          stdout,
          stderr,
          exitCode: 0,
        };
      } catch (error) {
        // Command failed but we still have output
        const execError = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          signal?: string;
          killed?: boolean;
        };
        return {
          stdout: execError.stdout || '',
          stderr: execError.stderr || '',
          exitCode: execError.code || 1,
          signal: execError.signal,
          timedOut: execError.killed && execError.signal === 'SIGTERM',
        };
      }
    } catch (error) {
      logger.error('Failed to execute command', error as Error, { command });
      throw new Error(`Failed to execute command: ${(error as Error).message}`);
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(dirPath);
      logger.debug('Creating directory', { path: fullPath });

      await fs.mkdir(fullPath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create directory', error as Error, { path: dirPath });
      throw new Error(`Failed to create directory ${dirPath}: ${(error as Error).message}`);
    }
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(dirPath);
      logger.debug('Deleting directory', { path: fullPath });

      await fs.rm(fullPath, { recursive: true, force: true });
    } catch (error) {
      logger.error('Failed to delete directory', error as Error, { path: dirPath });
      throw new Error(`Failed to delete directory ${dirPath}: ${(error as Error).message}`);
    }
  }

  async dispose(): Promise<void> {
    // Nothing to clean up for local executor
    logger.debug('LocalExecutor disposed');
  }
}
