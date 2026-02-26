/**
 * MetadataSyncService
 *
 * Keeps the local `.workspace/` cache in sync with the remote `.workspace/`
 * for SSH workspaces. Uses `watchDirectory` RPC for streaming sync and
 * performs a full copy on connect/reconnect.
 *
 * Follows the `RemoteChangeDetector` pattern for watch subscription,
 * reconnection, and exponential backoff.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '$shared/logger';
import { remoteRPCManager } from '$shared/main/remote-rpc-manager';
import type { RemoteRPCClient, DirectoryChangeEvent, DirectoryChangeEntry } from '$shared/main/remote-rpc-client';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('MetadataSyncService');

// ── Directories whose contents are synced from remote ───────────────────
// Only files under these top-level directories are candidates for sync
// (download from remote) and stale-file deletion. Everything else
// (workspace.json, events.jsonl, summary.json, file-tracking/, etc.)
// is left untouched.
const SYNCED_DIRECTORIES = new Set([
  'notes',
  'agents',
  'assets',
  'diffs',
  'cache',
  'browser-snapshots',
  'logs',
]);

// ── Local-only session files ────────────────────────────────────────────
// These files are written locally by EditEventsStore and
// LineAttributionService using direct `fs` (not IMetadataFS) and are
// never uploaded to the remote.  They must be excluded from stale-file
// deletion during full sync so they are not wiped out.
const LOCAL_SESSION_FILE_PATTERNS = [
  '.edits.jsonl',
  '.edits.meta.json',
  '.line-attribution.json',
];

export interface MetadataSyncConfig {
  workspaceId: string;
  /** Absolute path to the remote `.workspace/` directory. */
  remoteWorkspacePath: string;
  /** Absolute path to the local `.workspace/` cache directory. */
  localCachePath: string;
}

export type MetadataSyncEvent =
  | 'sync:started'
  | 'sync:complete'
  | 'sync:error'
  | 'sync:file-changed';

export class MetadataSyncService extends EventEmitter {
  private config: MetadataSyncConfig;
  private isRunning = false;

  // ── RPC watch state ─────────────────────────────────────────────────
  private rpcClient: RemoteRPCClient | null = null;
  private watchSubscriptionId: string | null = null;
  private directoryChangesHandler: ((event: DirectoryChangeEvent) => void) | null = null;
  private rpcCloseHandler: (() => void) | null = null;

  // ── Reconnection state ──────────────────────────────────────────────
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  private static readonly MAX_RECONNECT_DELAY_MS = 30_000;

  constructor(config: MetadataSyncConfig) {
    super();
    this.config = config;
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Start syncing: full sync from remote, then start streaming changes.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('[MetadataSyncService] Starting', {
      workspaceId: this.config.workspaceId,
      remoteWorkspacePath: this.config.remoteWorkspacePath,
    });

    try {
      await this.connectAndSync();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[MetadataSyncService] Failed to start', err, {
        workspaceId: this.config.workspaceId,
      });
      this.emit('sync:error', err);
      // Schedule reconnect even on initial failure
      this.scheduleReconnect();
    }
  }

  /**
   * Stop syncing: unsubscribe from watch, clean up timers.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    logger.info('[MetadataSyncService] Stopping', {
      workspaceId: this.config.workspaceId,
    });

    this.cleanup();
  }

  /**
   * Whether the service is currently running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  // ─── Core sync logic ──────────────────────────────────────────────

  /**
   * Connect to RPC, run full sync, then start streaming.
   */
  private async connectAndSync(): Promise<void> {
    const { workspaceId } = this.config;

    // 1. Get RPC client
    this.rpcClient = await remoteRPCManager.getClient(workspaceId);

    // 2. Full sync
    this.emit('sync:started');
    await this.performFullSync();
    this.emit('sync:complete');

    // 3. Start streaming
    await this.startWatching();

    // Reset reconnect counter on success
    this.reconnectAttempts = 0;

    logger.info('[MetadataSyncService] Connected and synced', { workspaceId });
  }

  /**
   * Full sync: recursively list remote files, read each, write to local.
   * Then delete local files not present on remote.
   */
  async performFullSync(): Promise<void> {
    const { workspaceId, remoteWorkspacePath, localCachePath } = this.config;

    logger.info('[MetadataSyncService] Starting full sync', { workspaceId });

    const client = this.rpcClient;
    if (!client) {
      throw new Error('No RPC client available for full sync');
    }

    // 1. List all remote files recursively
    const result = await client.listDir({
      path: remoteWorkspacePath,
      recursive: true,
      includeHidden: true,
    });

    // 2. Filter to files only, keeping only files inside synced directories
    const remoteFiles = result.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.name)
      .filter((name) => this.isSyncedPath(name));

    const remoteFileSet = new Set(remoteFiles);

    // 3. Read each remote file and write to local cache
    for (const relativePath of remoteFiles) {
      try {
        const remotePath = path.posix.join(remoteWorkspacePath, relativePath);
        const localPath = path.join(localCachePath, relativePath);

        const fileResult = await client.readFile({ path: remotePath, encoding: 'utf-8' });

        // Ensure parent directory exists
        const parentDir = path.dirname(localPath);
        await fs.mkdir(parentDir, { recursive: true });

        await fs.writeFile(localPath, fileResult.content, 'utf-8');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('[MetadataSyncService] Failed to sync file during full sync', {
          file: relativePath,
          error: err.message,
          workspaceId,
        });
      }
    }

    // 4. Delete local files not present on remote (only within synced directories)
    const localFiles = await this.walkLocalDirectory(localCachePath);
    for (const localRelativePath of localFiles) {
      if (!this.isSyncedPath(localRelativePath)) continue;
      if (MetadataSyncService.isLocalSessionFile(localRelativePath)) continue;
      if (!remoteFileSet.has(localRelativePath)) {
        try {
          const localPath = path.join(localCachePath, localRelativePath);
          await fs.unlink(localPath);
          logger.debug('[MetadataSyncService] Deleted stale local file', {
            file: localRelativePath,
            workspaceId,
          });
        } catch (error) {
          // File may already be gone — ignore
          const err = error instanceof Error ? error : new Error(String(error));
          if (!err.message.includes('ENOENT')) {
            logger.warn('[MetadataSyncService] Failed to delete stale local file', {
              file: localRelativePath,
              error: err.message,
            });
          }
        }
      }
    }

    logger.info('[MetadataSyncService] Full sync complete', {
      workspaceId,
      filesSynced: remoteFiles.length,
      localFilesDeleted: localFiles.filter(
        (f) => this.isSyncedPath(f) && !MetadataSyncService.isLocalSessionFile(f) && !remoteFileSet.has(f),
      ).length,
    });
  }

  // ─── Streaming sync ─────────────────────────────────────────────

  /**
   * Start watching the remote `.workspace/` directory for changes.
   */
  private async startWatching(): Promise<void> {
    const { workspaceId, remoteWorkspacePath } = this.config;
    const client = this.rpcClient;
    if (!client) {
      throw new Error('No RPC client available for watch');
    }

    // Subscribe to directory changes
    const result = await client.watchDirectory({
      basePath: remoteWorkspacePath,
      recursive: true,
      includeHidden: true,
    });
    this.watchSubscriptionId = result.subscriptionId;

    // Register change handler
    this.directoryChangesHandler = (event: DirectoryChangeEvent) => {
      this.handleDirectoryChanges(event);
    };
    client.onDirectoryChanges(this.directoryChangesHandler);

    // Register close handler for reconnection
    this.rpcCloseHandler = () => {
      logger.warn('[MetadataSyncService] RPC connection lost, scheduling reconnect', {
        workspaceId,
      });
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    };
    client.onClose(this.rpcCloseHandler);

    logger.info('[MetadataSyncService] Watch subscription active', {
      workspaceId,
      subscriptionId: this.watchSubscriptionId,
    });
  }

  /**
   * Handle incoming directory change events from the remote watcher.
   */
  private handleDirectoryChanges(event: DirectoryChangeEvent): void {
    // Ignore events from stale subscriptions (e.g., around reconnect)
    if (event.subscriptionId !== this.watchSubscriptionId) return;
    // Ignore if service is stopping
    if (!this.isRunning) return;

    for (const change of event.changes) {
      // Only process files inside synced directories
      if (!this.isSyncedPath(change.path)) continue;

      this.handleSingleChange(change).catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('[MetadataSyncService] Failed to handle change', {
          path: change.path,
          action: change.action,
          error: err.message,
        });
      });
    }
  }

  /**
   * Handle a single file change: create/modify → read from remote and write local.
   * Delete → remove from local.
   */
  private async handleSingleChange(change: DirectoryChangeEntry): Promise<void> {
    const { remoteWorkspacePath, localCachePath, workspaceId } = this.config;
    const client = this.rpcClient;

    if (change.action === 'delete') {
      const localPath = path.join(localCachePath, change.path);
      try {
        await fs.unlink(localPath);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (!err.message.includes('ENOENT')) {
          throw error;
        }
        // Already deleted — fine
      }
      this.emit('sync:file-changed', { path: change.path, action: 'delete' });
      return;
    }

    // create or modify — read from remote, write to local
    if (!client) return;

    const remotePath = path.posix.join(remoteWorkspacePath, change.path);
    const localPath = path.join(localCachePath, change.path);

    const fileResult = await client.readFile({ path: remotePath, encoding: 'utf-8' });

    const parentDir = path.dirname(localPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(localPath, fileResult.content, 'utf-8');

    this.emit('sync:file-changed', { path: change.path, action: change.action });

    logger.debug('[MetadataSyncService] Synced file change', {
      path: change.path,
      action: change.action,
      workspaceId,
    });
  }

  // ─── Reconnection ─────────────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Follows the RemoteChangeDetector pattern.
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) return;

    // Clean up current connection state before reconnecting
    this.cleanupWatchState();

    this.reconnectAttempts++;

    if (this.reconnectAttempts > MetadataSyncService.MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        '[MetadataSyncService] Max reconnect attempts reached, giving up',
        new Error('Max reconnect attempts exceeded'),
        { attempts: this.reconnectAttempts, workspaceId: this.config.workspaceId },
      );
      this.emit('sync:error', new Error('Max reconnect attempts exceeded'));
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      MetadataSyncService.MAX_RECONNECT_DELAY_MS,
    );

    logger.info('[MetadataSyncService] Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
      workspaceId: this.config.workspaceId,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isRunning) return;

      try {
        await this.connectAndSync();
        logger.info('[MetadataSyncService] Reconnected successfully', {
          workspaceId: this.config.workspaceId,
          attempt: this.reconnectAttempts,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('[MetadataSyncService] Reconnect attempt failed', {
          attempt: this.reconnectAttempts,
          error: err.message,
        });
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  /**
   * Clean up watch subscription and RPC handlers without stopping the service.
   */
  private cleanupWatchState(): void {
    // Remove close handler first to prevent double-reconnect
    if (this.rpcClient && this.rpcCloseHandler) {
      this.rpcClient.removeCloseListener(this.rpcCloseHandler);
      this.rpcCloseHandler = null;
    }

    // Remove directory changes handler
    if (this.rpcClient && this.directoryChangesHandler) {
      this.rpcClient.removeDirectoryChangesListener(this.directoryChangesHandler);
      this.directoryChangesHandler = null;
    }

    // Try to unsubscribe from watch (best-effort)
    if (this.rpcClient && this.watchSubscriptionId) {
      this.rpcClient
        .watchDirectoryUnsubscribe({ subscriptionId: this.watchSubscriptionId })
        .catch(() => {
          // Connection may already be dead — ignore
        });
    }

    this.watchSubscriptionId = null;
    this.rpcClient = null;
  }

  /**
   * Full cleanup: stop watching, clear timers.
   */
  private cleanup(): void {
    this.cleanupWatchState();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts = 0;
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Check if a relative path falls inside one of the synced directories.
   * Only paths whose first segment matches a SYNCED_DIRECTORIES entry are
   * eligible for download / deletion during sync.
   */
  private isSyncedPath(relativePath: string): boolean {
    const firstSegment = relativePath.split('/')[0];
    return SYNCED_DIRECTORIES.has(firstSegment);
  }

  /**
   * Check if a file is a local-only session file that should never be
   * deleted during sync (e.g. `.edits.jsonl`, `.line-attribution.json`).
   */
  private static isLocalSessionFile(relativePath: string): boolean {
    return LOCAL_SESSION_FILE_PATTERNS.some((pattern) => relativePath.endsWith(pattern));
  }

  /**
   * Recursively walk a local directory and return relative file paths.
   */
  private async walkLocalDirectory(dirPath: string, prefix = ''): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const subFiles = await this.walkLocalDirectory(
            path.join(dirPath, entry.name),
            relativePath,
          );
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!err.message.includes('ENOENT')) {
        logger.warn('[MetadataSyncService] Failed to walk local directory', {
          dirPath,
          error: err.message,
        });
      }
    }

    return files;
  }
}
