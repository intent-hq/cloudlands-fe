/**
 * Remote Change Detector (Stream-based)
 *
 * Detects file changes in remote workspaces by consuming a persistent
 * SSH stream from the remote `intent-server watch` command. Falls back
 * to polling-based hash comparison if the stream cannot be established.
 *
 * Emits proper `DiffChunk` objects (not `RemoteFileChange[]`), fixing
 * the type mismatch with `ChangeDetectorManagerImpl.handleChanges()`.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../../shared/logger';
import { sshManager } from '$shared/main/ssh-manager';
import type { SSHConnectionConfig } from '$shared/main/ssh-manager';
import { remoteRPCManager } from '$shared/main/remote-rpc-manager';
import { RemoteRPCError } from '$shared/main/remote-rpc-client';
import type { RemoteRPCClient, WatchChangeEvent } from '$shared/main/remote-rpc-client';
import { RemoteFileSystemService } from '../../remote-fs/main/remote-file-system.service';
import type { RemoteFileSystemConfig } from '../../remote-fs/main/remote-file-system.service';
import {
  createHash,
  randomUUID,
} from 'crypto';
import * as path from 'path';
import type {
  DiffChunk,
  FileChange,
  FileChangeAction,
} from '$shared/types/change-detector.types';
import {
  partitionDefaultFileTrackingExcludes,
  shouldExcludeFromDefaultFileTracking,
  summarizeDefaultFileTrackingExcludes,
} from '../../file-tracking/utils/tracking-excludes';

const logger = new Logger('RemoteChangeDetector');

/**
 * @deprecated Use `FileChange` from `change-detector.types.ts` instead.
 * Kept for backward compatibility only.
 */
export interface RemoteFileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  oldHash?: string;
  newHash?: string;
  timestamp: number;
}

export interface ChangeDetectorConfig extends RemoteFileSystemConfig {
  pollInterval?: number; // Base polling interval in ms
  adaptivePolling?: boolean; // Enable adaptive polling intervals
  maxPollInterval?: number; // Maximum polling interval when adaptive
  minPollInterval?: number; // Minimum polling interval when adaptive
  excludePatterns?: string[]; // Patterns to exclude from monitoring
  includePatterns?: string[]; // Patterns to include (if specified, only these are monitored)
  debounceDelay?: number; // Delay before emitting changes (ms)
  /** SSH config needed for the streaming watcher (spawnRemoteProcess). Not used by polling fallback. */
  sshConfig?: SSHConnectionConfig;
}

/** Active agent info for provenance tracking */
interface ActiveAgentInfo {
  name: string;
  id?: string;
}

export class RemoteChangeDetector extends EventEmitter {
  private config: ChangeDetectorConfig;
  private remoteFS: RemoteFileSystemService;
  private isMonitoring: boolean = false;

  // --- RPC-based watcher state ---
  private rpcClient: RemoteRPCClient | null = null;
  private watchSubscriptionId: string | null = null;
  private watchChangesHandler: ((event: WatchChangeEvent) => void) | null = null;
  private rpcCloseHandler: (() => void) | null = null;

  // --- SSH stream-based watcher state (legacy, kept for fallback) ---
  private watcherProcess: {
    write: (data: string) => void;
    kill: () => void;
    isAlive: () => boolean;
  } | null = null;
  private stdoutBuffer: string = '';
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private usingPollingFallback: boolean = false;

  // --- Polling fallback state (kept as safety net) ---
  private fileHashes: Map<string, string> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private currentPollInterval: number;
  private lastChangeTime: number = 0;
  private pendingChanges: Map<string, RemoteFileChange> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private gitIgnorePatterns: string[] = [];

  // --- Agent tracking ---
  private activeAgent: ActiveAgentInfo | null = null;

  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly MAX_RECONNECT_DELAY_MS = 30000;
  private static readonly READY_TIMEOUT_MS = 10000;

  constructor(config: ChangeDetectorConfig) {
    super();
    this.config = {
      pollInterval: 2000,
      adaptivePolling: true,
      maxPollInterval: 10000,
      minPollInterval: 1000,
      debounceDelay: 500,
      ...config,
    };

    this.currentPollInterval = this.config.pollInterval || 2000;
    this.remoteFS = new RemoteFileSystemService(config);
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Start monitoring for changes.
   * Attempts to connect to the remote watcher stream first;
   * falls back to polling if the stream cannot be established.
   */
  async start(): Promise<void> {
    if (this.isMonitoring) return;

    logger.info('[RemoteChangeDetector] Starting change detection...', {
      basePath: this.config.basePath,
      workspaceId: this.config.workspaceId,
    });

    this.isMonitoring = true;

    try {
      await this.startWatcherStream();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        '[RemoteChangeDetector] Failed to start watcher stream, falling back to polling',
        {
          error: err.message,
          workspaceId: this.config.workspaceId,
        },
      );
      await this.startPollingFallback();
    }

    this.emit('started');
  }

  /**
   * Stop monitoring for changes.
   */
  async stop(): Promise<void> {
    if (!this.isMonitoring) return;

    logger.info('[RemoteChangeDetector] Stopping change detection...', {
      basePath: this.config.basePath,
    });

    this.isMonitoring = false;

    // Clean up watcher stream
    this.killWatcherProcess();

    // Clean up reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clean up polling fallback
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Disconnect remote FS if we were using polling
    if (this.usingPollingFallback) {
      await this.remoteFS.disconnect();
    }

    this.emit('stopped');
  }

  /**
   * Set the active agent for provenance tracking.
   */
  setActiveAgent(name: string, id?: string): void {
    this.activeAgent = { name, id };
    logger.debug('[RemoteChangeDetector] Active agent set', { name, id });
  }

  /**
   * Clear the active agent.
   */
  clearActiveAgent(): void {
    this.activeAgent = null;
    logger.debug('[RemoteChangeDetector] Active agent cleared');
  }

  /**
   * Force a manual check for changes (triggers immediate poll or no-op for stream).
   */
  async forceCheck(): Promise<void> {
    if (this.usingPollingFallback) {
      await this.pollCheckForChanges();
    }
    // For stream mode, changes arrive automatically — nothing to do.
  }

  /**
   * Trigger an immediate check (compatibility with ChangeDetectorManagerImpl).
   */

  async triggerImmediateCheck(_reason?: string): Promise<void> {
    await this.forceCheck();
  }

  /**
   * Get current monitoring status.
   */
  getStatus(): {
    isMonitoring: boolean;
    filesMonitored: number;
    currentPollInterval: number;
    lastChangeTime: number;
    usingPollingFallback: boolean;
    reconnectAttempts: number;
  } {
    return {
      isMonitoring: this.isMonitoring,
      filesMonitored: this.fileHashes.size,
      currentPollInterval: this.currentPollInterval,
      lastChangeTime: this.lastChangeTime,
      usingPollingFallback: this.usingPollingFallback,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Capture file snapshots for specific files (used by polling fallback).
   */
  async captureFileSnapshots(filePaths: string[]): Promise<void> {
    if (!this.usingPollingFallback) return;

    for (const filePath of filePaths) {
      if (!this.shouldMonitorFile(filePath)) continue;

      try {
        const hash = await this.getFileHash(filePath);
        this.fileHashes.set(filePath, hash);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        logger.warn(`[RemoteChangeDetector] Failed to capture snapshot for ${filePath}:`, {
          error: err,
        });
      }
    }
  }

  /**
   * Track changes made by an agent.
   * Returns a DiffChunk with the changes.
   */
  async trackAgentChanges(
    files: any[],
    agentName: string,
    messageId?: string,
    threadId?: string,
    turnNumber?: number,
    sessionId?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    model?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    temperature?: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    reasoning?: string,
  ): Promise<DiffChunk> {
    // Build a DiffChunk from the provided files
    const filePaths = files.map((f: any) => f.path || f);

    const fileChanges: FileChange[] = filePaths.map((p: string) => ({
      path: p,
      action: 'Modify' as FileChangeAction,
      additions: 0,
      deletions: 0,
      timestamp: new Date().toISOString(),
    }));

    return {
      id: randomUUID(),
      workspaceId: this.config.workspaceId,
      provenance: {
        source: 'agent',
        agentName,
        agentId: sessionId,
      },
      files: fileChanges,
      summary: {
        filesChanged: fileChanges.length,
        additions: 0,
        deletions: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current changes without triggering a new detection.
   */
  async getCurrentChanges(): Promise<DiffChunk | null> {
    let client = this.rpcClient;

    // If cached client is stale, try getting a fresh one from the manager
    if (!client || !client.isConnected()) {
      try {
        client = await remoteRPCManager.getClient(this.config.workspaceId);
      } catch {
        // Fall through to polling fallback check below
      }
    }

    if (client?.isConnected()) {
      try {
        return await this.getCurrentChangesViaRPC(client);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('[RemoteChangeDetector] Failed to get current changes via RPC', {
          error: err.message,
          workspaceId: this.config.workspaceId,
        });
        return null;
      }
    }

    // Polling fallback: return pending changes
    if (!this.usingPollingFallback) return null;

    const changes = Array.from(this.pendingChanges.values());
    if (changes.length === 0) return null;

    return this.buildDiffChunkFromPollingChanges(changes);
  }

  /**
   * Get current uncommitted changes via RPC by running git commands remotely.
   */
  private async getCurrentChangesViaRPC(rpcClient: RemoteRPCClient): Promise<DiffChunk | null> {
    const basePath = this.config.basePath;

    // Run git status --porcelain to get file statuses
    const statusResult = await this.execRPCCommand(
      rpcClient,
      `cd "${basePath}" && git status --porcelain`,
    );

    // IMPORTANT: Only trim trailing whitespace, NOT leading whitespace!
    // Git porcelain format is "XY filename" where X is index status and Y is worktree status.
    // For unstaged changes, X is a space (e.g., " M README.md").
    // Using .trim() would strip the leading space, corrupting the parsing.
    const statusOutput = statusResult.stdout.trimEnd();
    if (!statusOutput) return null;

    // Parse git status --porcelain output into FileChange[]
    const files: FileChange[] = [];
    const skippedDefaultExcludedUntracked: string[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line || line.length < 4) continue;

      const statusCode = line.substring(0, 2);
      let filePath = line.substring(3).trim();

      // Determine action from status code
      let action: FileChangeAction;
      if (statusCode === '??' || statusCode.includes('A')) {
        action = 'Create';
      } else if (statusCode.includes('D')) {
        action = 'Delete';
      } else if (statusCode.includes('R')) {
        action = 'Rename';
      } else {
        action = 'Modify';
      }

      // Handle rename: "R  old -> new"
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ')[1];
      }

      if (shouldExcludeFromDefaultFileTracking({ path: filePath, statusCode })) {
        skippedDefaultExcludedUntracked.push(filePath);
        continue;
      }

      files.push({
        path: filePath,
        action,
        additions: 0,
        deletions: 0,
        timestamp: new Date().toISOString(),
      });
    }

    if (skippedDefaultExcludedUntracked.length > 0) {
      logger.debug('[RemoteChangeDetector] Skipped default-excluded untracked RPC status files', {
        workspaceId: this.config.workspaceId,
        ...summarizeDefaultFileTrackingExcludes(skippedDefaultExcludedUntracked),
      });
    }

    if (files.length === 0) return null;

    // Try to get line stats from git diff --numstat
    try {
      const diffResult = await this.execRPCCommand(
        rpcClient,
        `cd "${basePath}" && git diff --numstat`,
      );

      const diffOutput = diffResult.stdout.trim();
      if (diffOutput) {
        for (const line of diffOutput.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
            const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
            const diffPath = parts[2];

            const fileChange = files.find((f) => f.path === diffPath);
            if (fileChange) {
              fileChange.additions = additions;
              fileChange.deletions = deletions;
            }
          }
        }
      }
    } catch {
      // Non-fatal: we still have file statuses without line counts
      logger.debug(
        '[RemoteChangeDetector] Failed to get diff numstat, continuing without line counts',
      );
    }

    return {
      id: randomUUID(),
      workspaceId: this.config.workspaceId,
      provenance: {
        source: this.activeAgent ? 'agent' : 'git',
        agentName: this.activeAgent?.name,
        agentId: this.activeAgent?.id,
      },
      files,
      summary: {
        filesChanged: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute a command via RPC, handling non-zero exit codes gracefully.
   */
  private async execRPCCommand(
    rpcClient: RemoteRPCClient,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      return await rpcClient.exec({ command, timeout: 30000 });
    } catch (error) {
      // RPC exec returns non-zero exit codes as JSON-RPC errors (code -32000)
      if (error instanceof RemoteRPCError && error.code === -32000) {
        const data = error.data as
          | { stdout?: string; stderr?: string; exitCode?: number }
          | undefined;
        return {
          stdout: data?.stdout ?? '',
          stderr: data?.stderr ?? (error as Error).message,
          exitCode: data?.exitCode ?? 1,
        };
      }
      throw error;
    }
  }

  // ─── Stream-based watcher ──────────────────────────────────────

  /**
   * Start the remote watcher via RPC subscription.
   * Calls `watchSubscribe` on the remote RPC server, then listens for
   * `watch/changes` notifications. Falls back to the legacy SSH stream
   * if the RPC call fails (e.g., old server version).
   */
  private async startWatcherStream(): Promise<void> {
    const { workspaceId, basePath } = this.config;

    logger.info('[RemoteChangeDetector] Starting RPC watcher subscription', {
      workspaceId,
      basePath,
    });

    try {
      // Get RPC client via the manager (handles SSH connection + socket forwarding)
      this.rpcClient = await remoteRPCManager.getClient(workspaceId);

      // Subscribe to file changes
      const result = await this.rpcClient.watchSubscribe({ basePath });
      this.watchSubscriptionId = result.subscriptionId;

      // Register notification handler
      this.watchChangesHandler = (event: WatchChangeEvent) => {
        this.handleWatcherChanges(event);
      };
      this.rpcClient.onWatchChanges(this.watchChangesHandler);

      // Register close handler to trigger reconnection when the RPC socket drops
      // (e.g., when serve daemon is killed and replaced by start daemon)
      this.rpcCloseHandler = () => {
        logger.warn('[RemoteChangeDetector] RPC client connection lost, scheduling reconnect', {
          workspaceId,
        });
        if (this.isMonitoring) {
          this.scheduleReconnect();
        }
      };
      this.rpcClient.onClose(this.rpcCloseHandler);

      this.reconnectAttempts = 0;
      this.usingPollingFallback = false;

      logger.info('[RemoteChangeDetector] RPC watcher subscription active', {
        workspaceId,
        subscriptionId: this.watchSubscriptionId,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('[RemoteChangeDetector] RPC watchSubscribe failed, falling back to SSH stream', {
        error: err.message,
        workspaceId,
      });

      // Fall back to legacy SSH stream-based watcher
      await this.startWatcherStreamLegacy();
    }
  }

  /**
   * Legacy: Start the remote watcher stream via SSH.
   * Spawns `intent-server watch` on the remote and waits for the "ready" message.
   * Kept as a fallback for older server versions that don't support watchSubscribe.
   */
  private async startWatcherStreamLegacy(): Promise<void> {
    const { workspaceId, basePath, sshConfig } = this.config;

    if (!sshConfig) {
      throw new Error('SSH config required for watcher stream');
    }

    // Ensure SSH connection is established (streaming watcher still uses SSH)
    if (!sshManager.isConnected(workspaceId)) {
      await sshManager.connect(workspaceId, sshConfig);
    }

    const watchCommand = `node ~/.intent-server/server.js watch --workspace ${this.escapeShellArg(workspaceId)} --base-path ${this.escapeShellArg(basePath)}`;

    logger.info('[RemoteChangeDetector] Starting legacy SSH watcher stream', {
      workspaceId,
      command: watchCommand,
    });

    // Reset stdout buffer
    this.stdoutBuffer = '';

    return new Promise<void>((resolve, reject) => {
      let readyResolved = false;

      // Timeout for the "ready" message
      const readyTimeout = setTimeout(() => {
        if (!readyResolved) {
          readyResolved = true;
          reject(new Error('Timed out waiting for remote watcher "ready" message'));
        }
      }, RemoteChangeDetector.READY_TIMEOUT_MS);

      sshManager
        .spawnRemoteProcess(workspaceId, watchCommand, {
          onStdout: (data: string) => {
            this.stdoutBuffer += data;
            this.processStdoutBuffer((parsed) => {
              if (!readyResolved && parsed.type === 'ready') {
                readyResolved = true;
                clearTimeout(readyTimeout);
                this.reconnectAttempts = 0;
                this.usingPollingFallback = false;
                logger.info('[RemoteChangeDetector] Remote watcher is ready', { workspaceId });
                resolve();
                return;
              }

              if (parsed.type === 'changes') {
                this.handleWatcherChanges(parsed);
              }
            });
          },
          onStderr: (data: string) => {
            const stderr = data.trim();
            if (stderr) {
              logger.warn('[RemoteChangeDetector] Remote watcher stderr', { stderr, workspaceId });
            }
          },
          onExit: (code: number) => {
            logger.warn('[RemoteChangeDetector] Remote watcher process exited', {
              code,
              workspaceId,
            });
            this.watcherProcess = null;

            if (!readyResolved) {
              readyResolved = true;
              clearTimeout(readyTimeout);
              reject(new Error(`Remote watcher exited with code ${code} before ready`));
              return;
            }

            // Unexpected exit while monitoring — attempt reconnection
            if (this.isMonitoring) {
              this.scheduleReconnect();
            }
          },
          onError: (error: Error) => {
            logger.error('[RemoteChangeDetector] Remote watcher process error', error, {
              workspaceId,
            });

            if (!readyResolved) {
              readyResolved = true;
              clearTimeout(readyTimeout);
              reject(error);
              return;
            }

            if (this.isMonitoring) {
              this.scheduleReconnect();
            }
          },
        })
        .then((handle) => {
          this.watcherProcess = handle;
        })
        .catch((err) => {
          if (!readyResolved) {
            readyResolved = true;
            clearTimeout(readyTimeout);
            reject(err);
          }
        });
    });
  }

  /**
   * Process the stdout buffer, splitting on newlines and parsing JSON.
   * Handles partial lines that may arrive across chunk boundaries.
   */
  private processStdoutBuffer(onMessage: (parsed: any) => void): void {
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.substring(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.substring(newlineIndex + 1);

      if (!line) continue;

      try {
        const parsed = JSON.parse(line);
        onMessage(parsed);
      } catch (parseError) {
        logger.warn('[RemoteChangeDetector] Failed to parse watcher JSON line', {
          line: line.substring(0, 200),
          error: (parseError as Error).message,
        });
      }
    }
  }

  /**
   * Handle a parsed "changes" message from the remote watcher.
   * Converts it to a DiffChunk and emits it.
   */
  private handleWatcherChanges(parsed: any): void {
    const mappedFiles: FileChange[] = (parsed.files || []).map((f: any) => ({
      path: f.path,
      action: (f.action || 'Modify') as FileChangeAction,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      stage: f.stage,
      timestamp: new Date().toISOString(),
    }));
    const { kept: files, skipped: skippedDefaultExcluded } = partitionDefaultFileTrackingExcludes(
      mappedFiles,
      (file) => ({
        path: file.path,
        action: file.action,
        stage: file.stage,
      }),
    );

    if (skippedDefaultExcluded.length > 0) {
      logger.debug('[RemoteChangeDetector] Skipped default-excluded untracked watcher files', {
        workspaceId: this.config.workspaceId,
        ...summarizeDefaultFileTrackingExcludes(skippedDefaultExcluded.map((file) => file.path)),
      });
    }

    if (files.length === 0) return;

    const diffChunk: DiffChunk = {
      id: randomUUID(),
      workspaceId: this.config.workspaceId,
      provenance: {
        source: this.activeAgent ? 'agent' : 'git',
        agentName: this.activeAgent?.name,
        agentId: this.activeAgent?.id,
      },
      files,
      summary: {
        filesChanged: files.length,
        additions: files.reduce((sum: number, f: FileChange) => sum + f.additions, 0),
        deletions: files.reduce((sum: number, f: FileChange) => sum + f.deletions, 0),
      },
      timestamp: new Date().toISOString(),
    };

    this.lastChangeTime = Date.now();

    logger.info(`[RemoteChangeDetector] Emitting DiffChunk with ${files.length} file(s)`, {
      fileCount: files.length,
      additions: diffChunk.summary.additions,
      deletions: diffChunk.summary.deletions,
      source: diffChunk.provenance.source,
    });

    this.emit('changes', diffChunk);

    // Emit file:content-changed events so editor tabs update without close/reopen.
    // Only when we have an RPC client (stream mode, not polling fallback).
    if (this.rpcClient) {
      this.emitFileContentChangedEvents(files).catch((err) => {
        logger.warn('[RemoteChangeDetector] Failed to emit file content changed events', {
          error: (err as Error).message,
        });
      });
    }
  }

  /**
   * Read changed file contents via RPC and emit file:content-changed events
   * to renderer processes so editor tabs update without requiring close/reopen.
   * Skips deleted files and limits to 10 files per batch to avoid flooding.
   */
  private async emitFileContentChangedEvents(files: FileChange[]): Promise<void> {
    const nonDeletedFiles = files.filter((f) => f.action !== 'Delete');
    const filesToEmit = nonDeletedFiles.slice(0, 10);

    if (filesToEmit.length === 0) return;

    const { sendToWorkspaceWindows } = require('../../system/main/system.ipc') as {
      sendToWorkspaceWindows: (
        workspaceId: string | undefined,
        channel: string,
        data: unknown,
      ) => void;
    };

    for (const file of filesToEmit) {
      try {
        const absolutePath = path.posix.join(this.config.basePath, file.path);
        const result = await this.rpcClient!.readFile({ path: absolutePath });

        sendToWorkspaceWindows(this.config.workspaceId, 'file:content-changed', {
          path: absolutePath,
          relativePath: file.path,
          content: result.content,
          source: 'external',
          workspaceId: this.config.workspaceId,
        });

        logger.debug('[RemoteChangeDetector] Emitted file:content-changed', {
          path: file.path,
          workspaceId: this.config.workspaceId,
        });
      } catch (error) {
        // File might be binary or unreadable — skip without blocking others
        logger.debug('[RemoteChangeDetector] Could not emit file:content-changed', {
          path: file.path,
          error: (error as Error).message,
        });
      }
    }

    if (nonDeletedFiles.length > 10) {
      logger.info('[RemoteChangeDetector] Skipped file:content-changed for overflow files', {
        total: nonDeletedFiles.length,
        emitted: 10,
        skipped: nonDeletedFiles.length - 10,
      });
    }
  }

  /**
   * Kill the remote watcher process / RPC subscription and clean up.
   */
  private killWatcherProcess(): void {
    // Clean up RPC close handler first to prevent double-reconnect
    if (this.rpcClient && this.rpcCloseHandler) {
      this.rpcClient.removeCloseListener(this.rpcCloseHandler);
      this.rpcCloseHandler = null;
    }

    // Clean up RPC-based watcher
    if (this.rpcClient && this.watchChangesHandler) {
      this.rpcClient.removeWatchChangesListener(this.watchChangesHandler);
      this.watchChangesHandler = null;
    }
    this.watchSubscriptionId = null;
    this.rpcClient = null;

    // Clean up legacy SSH-based watcher
    if (this.watcherProcess) {
      try {
        this.watcherProcess.kill();
      } catch (err) {
        logger.warn('[RemoteChangeDetector] Error killing watcher process', {
          error: (err as Error).message,
        });
      }
      this.watcherProcess = null;
    }
    this.stdoutBuffer = '';
  }

  // ─── Reconnection ─────────────────────────────────────────────

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * After MAX_RECONNECT_ATTEMPTS, falls back to polling.
   */
  private scheduleReconnect(): void {
    if (!this.isMonitoring) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > RemoteChangeDetector.MAX_RECONNECT_ATTEMPTS) {
      logger.warn(
        '[RemoteChangeDetector] Max reconnect attempts reached, falling back to polling',
        { attempts: this.reconnectAttempts, workspaceId: this.config.workspaceId },
      );
      this.startPollingFallback().catch((err) => {
        logger.error('[RemoteChangeDetector] Failed to start polling fallback', err as Error);
        this.emit('error', err);
      });
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      RemoteChangeDetector.MAX_RECONNECT_DELAY_MS,
    );

    logger.info('[RemoteChangeDetector] Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
      workspaceId: this.config.workspaceId,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isMonitoring) return;

      try {
        this.killWatcherProcess();
        await this.startWatcherStream();
        logger.info('[RemoteChangeDetector] Reconnected to watcher stream', {
          workspaceId: this.config.workspaceId,
        });

        // Catch-up sync: emit current state to populate Changes tab
        // with any changes that occurred during the disconnect window
        try {
          const catchUpChunk = await this.getCurrentChanges();
          if (catchUpChunk) {
            this.emit('changes', catchUpChunk);
          }
        } catch (err) {
          logger.warn('[RemoteChangeDetector] Catch-up sync after reconnect failed', {
            error: (err as Error).message,
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn('[RemoteChangeDetector] Reconnect attempt failed', {
          attempt: this.reconnectAttempts,
          error: err.message,
        });
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ─── Polling fallback ──────────────────────────────────────────

  /**
   * Start the polling-based fallback for change detection.
   * This is the old approach kept as a safety net.
   */
  private async startPollingFallback(): Promise<void> {
    this.usingPollingFallback = true;

    logger.info('[RemoteChangeDetector] Starting polling fallback', {
      basePath: this.config.basePath,
      workspaceId: this.config.workspaceId,
    });

    await this.remoteFS.initialize();
    await this.loadGitIgnore();
    await this.buildInitialHashMap();

    this.scheduleNextPoll();
  }

  /**
   * Load .gitignore patterns (used by polling fallback).
   */
  private async loadGitIgnore(): Promise<void> {
    try {
      const gitignorePath = path.posix.join(this.config.basePath, '.gitignore');
      const content = await this.remoteFS.readFile(gitignorePath);

      this.gitIgnorePatterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      logger.info(
        `[RemoteChangeDetector] Loaded ${this.gitIgnorePatterns.length} gitignore patterns`,
        { basePath: this.config.basePath },
      );
    } catch (error) {
      const err = error as any;
      const msg = typeof err?.message === 'string' ? err.message : String(err);
      const isNotFound =
        err?.code === 'ENOENT' ||
        msg.includes('ENOENT') ||
        msg.toLowerCase().includes('no such file');

      if (isNotFound) {
        logger.info('[RemoteChangeDetector] No .gitignore file found, monitoring all files', {
          basePath: this.config.basePath,
        });
      } else {
        logger.error('[RemoteChangeDetector] Failed to read .gitignore', err as Error, {
          basePath: this.config.basePath,
        });
      }
    }
  }

  /**
   * Build initial hash map of all files using a single SSH command.
   */
  private async buildInitialHashMap(): Promise<void> {
    logger.info('[RemoteChangeDetector] Building initial file hash map...', {
      basePath: this.config.basePath,
    });

    const allHashes = await this.remoteFS.getAllFileHashes(
      this.config.basePath,
      RemoteChangeDetector.SKIP_DIRS,
    );

    for (const [filePath, hash] of allHashes) {
      if (this.shouldMonitorFile(filePath)) {
        this.fileHashes.set(filePath, hash);
      }
    }

    logger.info(`[RemoteChangeDetector] Monitoring ${this.fileHashes.size} files`, {
      fileCount: this.fileHashes.size,
      basePath: this.config.basePath,
    });
  }

  /**
   * Directories to skip during file scanning.
   */
  private static readonly SKIP_DIRS = [
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    '.cache',
    'coverage',
    'bazel-out',
    'bazel-bin',
    'bazel-testlogs',
    '.worktrees',
    '__pycache__',
    '.bazel',
    '.tox',
    '.venv',
    'venv',
    '.mypy_cache',
  ];

  private shouldMonitorFile(filePath: string): boolean {
    if (this.config.excludePatterns) {
      for (const pattern of this.config.excludePatterns) {
        if (this.matchesPattern(filePath, pattern)) return false;
      }
    }

    if (this.config.includePatterns && this.config.includePatterns.length > 0) {
      let included = false;
      for (const pattern of this.config.includePatterns) {
        if (this.matchesPattern(filePath, pattern)) {
          included = true;
          break;
        }
      }
      if (!included) return false;
    }

    for (const pattern of this.gitIgnorePatterns) {
      if (this.matchesPattern(filePath, pattern)) return false;
    }

    return true;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    return regex.test(filePath) || regex.test(path.basename(filePath));
  }

  private async getFileHash(filePath: string): Promise<string> {
    const content = await this.remoteFS.readFile(filePath, 'utf-8');
    return createHash('sha1').update(content).digest('hex');
  }

  private scheduleNextPoll(): void {
    if (!this.isMonitoring || !this.usingPollingFallback) return;

    this.pollTimer = setTimeout(() => {
      this.pollCheckForChanges();
    }, this.currentPollInterval);
  }

  private async pollCheckForChanges(): Promise<void> {
    if (!this.isMonitoring || !this.usingPollingFallback) return;

    try {
      const changes = await this.detectPollingChanges();

      if (changes.length > 0) {
        this.handlePollingChanges(changes);

        if (this.config.adaptivePolling) {
          this.currentPollInterval = Math.max(
            this.config.minPollInterval || 1000,
            this.currentPollInterval * 0.8,
          );
        }
      } else {
        if (this.config.adaptivePolling) {
          const timeSinceLastChange = Date.now() - this.lastChangeTime;
          if (timeSinceLastChange > 30000) {
            this.currentPollInterval = Math.min(
              this.config.maxPollInterval || 10000,
              this.currentPollInterval * 1.2,
            );
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[RemoteChangeDetector] Error checking for changes:', err);
      this.emit('error', err);
    }

    this.scheduleNextPoll();
  }

  /**
   * Detect changes by comparing current state with cached hashes.
   */
  private async detectPollingChanges(): Promise<RemoteFileChange[]> {
    const changes: RemoteFileChange[] = [];
    const currentFiles = new Set<string>();

    this.remoteFS.clearCache();

    const currentHashes = await this.remoteFS.getAllFileHashes(
      this.config.basePath,
      RemoteChangeDetector.SKIP_DIRS,
    );

    for (const [filePath, currentHash] of currentHashes) {
      if (!this.shouldMonitorFile(filePath)) continue;

      currentFiles.add(filePath);
      const cachedHash = this.fileHashes.get(filePath);

      if (!cachedHash) {
        changes.push({
          path: filePath,
          type: 'added',
          newHash: currentHash,
          timestamp: Date.now(),
        });
        this.fileHashes.set(filePath, currentHash);
      } else if (cachedHash !== currentHash) {
        changes.push({
          path: filePath,
          type: 'modified',
          oldHash: cachedHash,
          newHash: currentHash,
          timestamp: Date.now(),
        });
        this.fileHashes.set(filePath, currentHash);
      }
    }

    for (const [filePath, hash] of this.fileHashes) {
      if (!currentFiles.has(filePath)) {
        changes.push({ path: filePath, type: 'deleted', oldHash: hash, timestamp: Date.now() });
        this.fileHashes.delete(filePath);
      }
    }

    return changes;
  }

  /**
   * Handle polling-detected changes: debounce and emit as DiffChunk.
   */
  private handlePollingChanges(changes: RemoteFileChange[]): void {
    const { kept: changesToTrack, skipped: skippedDefaultExcluded } =
      partitionDefaultFileTrackingExcludes(changes, (change) => ({
        path: change.path,
        action: this.mapPollingChangeAction(change.type),
      }));

    if (skippedDefaultExcluded.length > 0) {
      logger.debug('[RemoteChangeDetector] Skipped default-excluded untracked polling files', {
        workspaceId: this.config.workspaceId,
        ...summarizeDefaultFileTrackingExcludes(
          skippedDefaultExcluded.map((change) => change.path),
        ),
      });
    }

    for (const change of changesToTrack) {
      this.pendingChanges.set(change.path, change);
    }

    if (this.pendingChanges.size === 0) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const changesToEmit = Array.from(this.pendingChanges.values());
      this.pendingChanges.clear();

      if (changesToEmit.length > 0) {
        this.lastChangeTime = Date.now();
        logger.info(`[RemoteChangeDetector] Detected ${changesToEmit.length} changes (polling)`, {
          changeCount: changesToEmit.length,
          basePath: this.config.basePath,
        });

        const diffChunk = this.buildDiffChunkFromPollingChanges(changesToEmit);
        this.emit('changes', diffChunk);
      }
    }, this.config.debounceDelay);
  }

  /**
   * Convert polling-based RemoteFileChange[] into a proper DiffChunk.
   */
  private buildDiffChunkFromPollingChanges(changes: RemoteFileChange[]): DiffChunk {
    const files: FileChange[] = changes.map((c) => ({
      path: c.path,
      action: this.mapPollingChangeAction(c.type),
      additions: 0,
      deletions: 0,
      timestamp: new Date().toISOString(),
    }));

    return {
      id: randomUUID(),
      workspaceId: this.config.workspaceId,
      provenance: {
        source: this.activeAgent ? 'agent' : 'git',
        agentName: this.activeAgent?.name,
        agentId: this.activeAgent?.id,
      },
      files,
      summary: {
        filesChanged: files.length,
        additions: 0,
        deletions: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private mapPollingChangeAction(type: RemoteFileChange['type']): FileChangeAction {
    switch (type) {
      case 'added':
        return 'Create';
      case 'modified':
        return 'Modify';
      case 'deleted':
        return 'Delete';
      default:
        return 'Modify';
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
