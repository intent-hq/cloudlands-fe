/**
 * Remote Executor
 *
 * Executes tool operations on a remote system via RPC.
 */

import type {
  IExecutor,
  RemoteExecutorConfig,
  FileInfo,
  FileStats,
  ExecuteOptions,
  CommandResult,
} from '../../types';
import { remoteRPCManager } from '../../../../shared/main/remote-rpc-manager';
import type { RemoteRPCClient } from '../../../../shared/main/remote-rpc-client';
import { hostExec } from '../../../../shared/main/host-exec';
import { Logger } from '../../../../shared/logger';
import * as path from 'path';

const logger = new Logger('RemoteExecutor');

export class RemoteExecutor implements IExecutor {
  readonly type = 'remote' as const;

  constructor(
    public config: RemoteExecutorConfig,
    private workspaceId: string,
  ) {
    logger.debug('RemoteExecutor initialized', {
      host: config.host,
      workspaceId,
    });
  }

  /**
   * Get RPC client for this workspace
   */
  private async getRPCClient(): Promise<RemoteRPCClient> {
    return remoteRPCManager.getClient(this.workspaceId);
  }

  /**
   * Resolve a path relative to the remote workspace
   */
  private resolvePath(filePath: string): string {
    // If absolute path, ensure it's within workspace
    if (path.isAbsolute(filePath)) {
      if (!filePath.startsWith(this.config.workspacePath)) {
        throw new Error(`Path outside workspace: ${filePath}`);
      }
      return filePath;
    }

    // Resolve relative to workspace
    return path.posix.join(this.config.workspacePath, filePath);
  }

  async readFile(filePath: string): Promise<string> {
    try {
      const fullPath = this.resolvePath(filePath);
      const rpcClient = await this.getRPCClient();

      logger.debug('Reading remote file', { path: fullPath });

      const result = await rpcClient.readFile({ path: fullPath });
      return result.content;
    } catch (error) {
      logger.error('Failed to read remote file', error as Error, { path: filePath });
      throw new Error(`Failed to read file ${filePath}: ${(error as Error).message}`);
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(filePath);
      const rpcClient = await this.getRPCClient();

      logger.debug('Writing remote file', {
        path: fullPath,
        size: content.length,
      });

      await rpcClient.writeFile({ path: fullPath, content, mkdirp: true });
    } catch (error) {
      logger.error('Failed to write remote file', error as Error, { path: filePath });
      throw new Error(`Failed to write file ${filePath}: ${(error as Error).message}`);
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(filePath);

      logger.debug('Deleting remote file', { path: fullPath });

      await hostExec('rm', {
        args: ['-f', fullPath],
        cwd: this.config.workspacePath,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error('Failed to delete remote file', error as Error, { path: filePath });
      throw new Error(`Failed to delete file ${filePath}: ${(error as Error).message}`);
    }
  }

  async listFiles(directory: string): Promise<FileInfo[]> {
    try {
      const fullPath = this.resolvePath(directory);
      const rpcClient = await this.getRPCClient();

      logger.debug('Listing remote files', { path: fullPath });

      const result = await rpcClient.listDir({ path: fullPath });

      const files: FileInfo[] = result.entries.map((entry) => ({
        name: entry.name,
        path: path.posix.join(directory, entry.name),
        type: entry.type === 'directory' ? 'directory' : entry.type === 'symlink' ? 'symlink' : 'file',
        size: entry.size,
        modified: new Date(entry.mtime),
      }));

      return files;
    } catch (error) {
      logger.error('Failed to list remote files', error as Error, { directory });
      throw new Error(`Failed to list files in ${directory}: ${(error as Error).message}`);
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(filePath);
      const rpcClient = await this.getRPCClient();

      const result = await rpcClient.fileExists({ path: fullPath });
      return result.exists;
    } catch {
      return false;
    }
  }

  async getFileStats(filePath: string): Promise<FileStats> {
    try {
      const fullPath = this.resolvePath(filePath);
      const rpcClient = await this.getRPCClient();

      const result = await rpcClient.stat({ path: fullPath });

      return {
        size: result.size,
        created: new Date(result.mtime), // RPC stat doesn't expose ctime/atime separately
        modified: new Date(result.mtime),
        accessed: new Date(result.mtime),
        isFile: result.isFile,
        isDirectory: result.isDirectory,
        isSymlink: result.isSymlink,
        permissions: result.permissions,
      };
    } catch (error) {
      logger.error('Failed to get remote file stats', error as Error, { path: filePath });
      throw new Error(`Failed to get stats for ${filePath}: ${(error as Error).message}`);
    }
  }

  async execute(command: string, options?: ExecuteOptions): Promise<CommandResult> {
    try {
      const cwd = options?.cwd ? this.resolvePath(options.cwd) : this.config.workspacePath;

      // SECURITY WARNING: This executes arbitrary commands on the remote host
      // (via the daemon's host.exec seam). Ensure all input is properly
      // validated before calling this method.
      logger.warn('Executing remote command - ensure input is trusted', {
        command: command.substring(0, 100),
        cwd,
        host: this.config.host,
        user: this.config.username,
      });

      // Preserve the historical shell-string interface by forwarding through
      // /bin/sh -c so `cmd1 && cmd2`-style callers keep working; the daemon
      // owns the actual spawn (argv-only, no interpolation on its side).
      const result = await hostExec('/bin/sh', {
        args: ['-c', command],
        cwd,
        env: options?.env,
        timeoutMs: options?.timeout,
        workspaceId: this.workspaceId,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    } catch (error) {
      // Security: Sanitize error messages to prevent information disclosure
      logger.error('Failed to execute remote command', error as Error, {
        command: command.substring(0, 100),
        host: this.config.host,
      });
      throw new Error(
        `Failed to execute command: ${(error as Error).message?.substring(0, 200) || 'Unknown error'}`,
      );
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(dirPath);

      logger.debug('Creating remote directory', { path: fullPath });

      await hostExec('mkdir', {
        args: ['-p', fullPath],
        cwd: this.config.workspacePath,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error('Failed to create remote directory', error as Error, { path: dirPath });
      throw new Error(`Failed to create directory ${dirPath}: ${(error as Error).message}`);
    }
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      const fullPath = this.resolvePath(dirPath);

      logger.debug('Deleting remote directory', { path: fullPath });

      await hostExec('rm', {
        args: ['-rf', fullPath],
        cwd: this.config.workspacePath,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error('Failed to delete remote directory', error as Error, { path: dirPath });
      throw new Error(`Failed to delete directory ${dirPath}: ${(error as Error).message}`);
    }
  }

  async dispose(): Promise<void> {
    // RPC client lifecycle is managed by remoteRPCManager - no cleanup needed here
    logger.debug('RemoteExecutor disposed');
  }
}
