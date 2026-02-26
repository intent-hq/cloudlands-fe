/**
 * CachedRemoteMetadataFS
 *
 * Write-through cache implementation of `IMetadataFS` for remote workspaces.
 *
 * - **Reads** (`readFile`, `readdir`, `access`, `stat`): Delegate to
 *   `LocalMetadataFS` for instant (<1ms) reads from the local cache.
 * - **Writes** (`writeFile`, `mkdir`, `unlink`, `rm`, `rename`): Write to
 *   the remote via `RemoteMetadataFS` first, then update the local cache
 *   via `LocalMetadataFS`. If the remote write fails, the error is thrown
 *   without touching the local cache — preventing divergent state.
 *
 * `MetadataSyncService` (already implemented) handles remote→local streaming
 * sync so the local cache stays fresh for reads.
 */

import { Logger } from '../../../shared/logger';
import type { IMetadataFS, MetadataDirent, MetadataStat } from './metadata-fs';
import { LocalMetadataFS } from './local-metadata-fs';
import { RemoteMetadataFS } from './remote-metadata-fs';

const logger = new Logger('CachedRemoteMetadataFS');

export interface CachedRemoteMetadataFSConfig {
  workspaceId: string;
  localBasePath: string;
  remoteBasePath: string;
}

export class CachedRemoteMetadataFS implements IMetadataFS {
  private readonly local: LocalMetadataFS;
  private readonly remote: RemoteMetadataFS;
  private readonly localBasePath: string;
  private readonly remoteBasePath: string;

  constructor(config: CachedRemoteMetadataFSConfig) {
    this.local = new LocalMetadataFS();
    this.remote = new RemoteMetadataFS(config.workspaceId);
    // Normalize: strip trailing slashes for consistent prefix matching
    this.localBasePath = config.localBasePath.replace(/\/+$/, '');
    this.remoteBasePath = config.remoteBasePath.replace(/\/+$/, '');
  }

  // ── Path translation ────────────────────────────────────────────────

  /**
   * Translate a local absolute path to the corresponding remote path.
   *
   * Strips the `localBasePath` prefix and prepends `remoteBasePath`.
   * If the path doesn't start with `localBasePath`, logs a warning and
   * passes it through unchanged.
   */
  private toRemotePath(localPath: string): string {
    const normalizedLocal = localPath.replace(/\/+$/, '');
    if (normalizedLocal.startsWith(this.localBasePath)) {
      const relativePath = normalizedLocal.slice(this.localBasePath.length);
      return this.remoteBasePath + relativePath;
    }
    logger.warn('Path does not start with localBasePath, passing through unchanged', {
      localPath,
      localBasePath: this.localBasePath,
    });
    return localPath;
  }

  // ── Read (delegate to local cache) ──────────────────────────────────

  async readFile(filePath: string, encoding: 'utf-8'): Promise<string> {
    return this.local.readFile(filePath, encoding);
  }

  async stat(filePath: string): Promise<MetadataStat> {
    return this.local.stat(filePath);
  }

  async access(filePath: string): Promise<void> {
    return this.local.access(filePath);
  }

  async readdir(
    dirPath: string,
    options: { withFileTypes: true },
  ): Promise<MetadataDirent[]> {
    return this.local.readdir(dirPath, options);
  }

  // ── Write (remote first, then local cache) ─────────────────────────

  async writeFile(filePath: string, content: string, encoding: 'utf-8'): Promise<void> {
    // Write to remote first — if this fails, don't update local cache
    await this.remote.writeFile(this.toRemotePath(filePath), content, encoding);
    // Remote succeeded — update local cache
    await this.local.writeFile(filePath, content, encoding);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await this.remote.mkdir(this.toRemotePath(dirPath), options);
    await this.local.mkdir(dirPath, options);
  }

  // ── Delete (remote first, then local cache) ────────────────────────

  async unlink(filePath: string): Promise<void> {
    await this.remote.unlink(this.toRemotePath(filePath));
    await this.local.unlink(filePath);
  }

  async rm(
    filePath: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    await this.remote.rm(this.toRemotePath(filePath), options);
    await this.local.rm(filePath, options);
  }

  // ── Move (remote first, then local cache) ──────────────────────────

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.remote.rename(this.toRemotePath(oldPath), this.toRemotePath(newPath));
    await this.local.rename(oldPath, newPath);
  }
}

