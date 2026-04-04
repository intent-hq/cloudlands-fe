/**
 * RemoteMetadataFS
 *
 * Implementation of `IMetadataFS` that routes all operations through
 * `RemoteRPCClient` to the `intent-server.cjs` running on the remote host.
 *
 * Used for SSH workspaces where `.workspace/` metadata lives on the remote.
 */

import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import type { RemoteRPCClient } from '../../../shared/main/remote-rpc-client';
import type { IMetadataFS, MetadataDirent, MetadataStat } from './metadata-fs';

export class RemoteMetadataFS implements IMetadataFS {
  constructor(private readonly workspaceId: string) {}

  private async getClient(): Promise<RemoteRPCClient> {
    return remoteRPCManager.getClient(this.workspaceId);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readFile(filePath: string, _encoding: 'utf-8'): Promise<string> {
    const client = await this.getClient();
    const result = await client.readFile({ path: filePath, encoding: 'utf-8' });
    return result.content;
  }

  async stat(filePath: string): Promise<MetadataStat> {
    const client = await this.getClient();
    const result = await client.stat({ path: filePath });
    return {
      size: result.size,
      mtime: new Date(result.mtime),
      isFile: () => result.isFile,
      isDirectory: () => result.isDirectory,
    };
  }

  async access(filePath: string): Promise<void> {
    const client = await this.getClient();
    const result = await client.fileExists({ path: filePath });
    if (!result.exists) {
      // Mimic ENOENT error from fs.access
      const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      err.errno = -2;
      throw err;
    }
  }

  async readdir(
    dirPath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: { withFileTypes: true },
  ): Promise<MetadataDirent[]> {
    const client = await this.getClient();
    // includeHidden: true because .meta/ directories start with a dot
    const result = await client.listDir({ path: dirPath, includeHidden: true });
    return result.entries.map((entry) => ({
      name: entry.name,
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'directory',
    }));
  }

  // ── Write ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async writeFile(filePath: string, content: string, _encoding: 'utf-8'): Promise<void> {
    const client = await this.getClient();
    await client.writeFile({ path: filePath, content, encoding: 'utf-8', mkdirp: true });
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const client = await this.getClient();
    const flags = options?.recursive ? '-p' : '';
    const result = await client.exec({
      command: `mkdir ${flags} ${escapeRemotePath(dirPath)}`,
    });
    if (result.exitCode !== 0 && !result.stderr.includes('File exists')) {
      throw new Error(`Failed to create remote directory: ${result.stderr}`);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────

  async unlink(filePath: string): Promise<void> {
    const client = await this.getClient();
    const result = await client.exec({
      command: `rm ${escapeRemotePath(filePath)}`,
    });
    if (result.exitCode !== 0) {
      const err = new Error(
        `ENOENT: no such file or directory, unlink '${filePath}'`,
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
  }

  async rm(
    filePath: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    const client = await this.getClient();
    let flags = '';
    if (options?.recursive) flags += 'r';
    if (options?.force) flags += 'f';
    const flagStr = flags ? `-${flags} ` : '';
    const result = await client.exec({
      command: `rm ${flagStr}${escapeRemotePath(filePath)}`,
    });
    // When force is set, ignore errors (matches fs.rm behaviour)
    if (result.exitCode !== 0 && !options?.force) {
      throw new Error(`Failed to remove remote path: ${result.stderr}`);
    }
  }

  // ── Move ──────────────────────────────────────────────────────────────

  async rename(oldPath: string, newPath: string): Promise<void> {
    const client = await this.getClient();
    const result = await client.exec({
      command: `mv ${escapeRemotePath(oldPath)} ${escapeRemotePath(newPath)}`,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to rename remote path: ${result.stderr}`);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Escape a string for safe use as a single-quoted shell argument.
 * Follows the same pattern as `RemoteFileSystemService.escapeShellArg`.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a remote path for shell use, preserving tilde expansion.
 *
 * When a path starts with `~/`, the tilde must stay **outside** quotes so
 * the remote shell can expand it to `$HOME`.  Single-quoting the entire
 * path (as `escapeShellArg` does) turns `~` into a literal character,
 * which causes `mkdir`, `rm`, `mv`, etc. to operate on a wrong path.
 *
 * See also: `ssh-manager.ts` which documents the same pattern.
 */
function escapeRemotePath(remotePath: string): string {
  if (remotePath.startsWith('~/')) {
    // ~/'rest/of/path' – shell expands ~ and quotes protect the rest.
    return '~/' + escapeShellArg(remotePath.slice(2));
  }
  return escapeShellArg(remotePath);
}

