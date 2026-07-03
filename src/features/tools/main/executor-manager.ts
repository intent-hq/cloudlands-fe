/**
 * Executor Manager
 *
 * Manages cached executors (local/remote) for workspace operations.
 * Provides retry semantics and automatic cleanup of idle executors.
 */

import { LocalExecutor } from './executors/local-executor';
import { RemoteExecutor } from './executors/remote-executor';
import type {
  IExecutor,
  RemoteExecutorConfig,
  CommandResult,
  ExecuteOptions,
  FileInfo,
  FileStats,
} from '../types';
import { Logger } from '../../../shared/logger';

class RetryingExecutor implements IExecutor {
  type: 'local' | 'remote';
  constructor(
    private inner: IExecutor,
    private manager: ExecutorManager,
  ) {
    this.type = inner.type;
  }
  get config(): RemoteExecutorConfig | undefined {
    return this.inner.config;
  }
  readFile(path: string): Promise<string> {
    return this.manager.executeWithRetry(() => this.inner.readFile(path));
  }
  writeFile(path: string, content: string): Promise<void> {
    return this.manager.executeWithRetry(() => this.inner.writeFile(path, content));
  }
  deleteFile(path: string): Promise<void> {
    return this.manager.executeWithRetry(() => this.inner.deleteFile(path));
  }
  listFiles(directory: string): Promise<FileInfo[]> {
    return this.manager.executeWithRetry(() => this.inner.listFiles(directory));
  }
  fileExists(path: string): Promise<boolean> {
    return this.manager.executeWithRetry(() => this.inner.fileExists(path));
  }
  getFileStats(path: string): Promise<FileStats> {
    return this.manager.executeWithRetry(() => this.inner.getFileStats(path));
  }
  execute(command: string, options?: ExecuteOptions): Promise<CommandResult> {
    return this.manager.executeWithRetry(() => this.inner.execute(command, options));
  }
  createDirectory(path: string): Promise<void> {
    return this.manager.executeWithRetry(() => (this.inner as any).createDirectory(path));
  }
  deleteDirectory(path: string): Promise<void> {
    return this.manager.executeWithRetry(() => (this.inner as any).deleteDirectory(path));
  }
  dispose(): Promise<void> {
    // Do not remove from cache here; manager handles lifecycle/cleanup
    return this.inner.dispose();
  }
}

export class ExecutorManager {
  private logger = new Logger('ExecutorManager');
  private executors = new Map<string, { executor: IExecutor; lastUsed: number }>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.setupCleanup();
  }

  private keyFor(workspaceId: string, type: 'local' | 'remote'): string {
    return `${type}:${workspaceId}`;
  }

  getExecutor(params: {
    workspaceId: string;
    workspacePath: string;
    remote?: RemoteExecutorConfig | null;
  }): IExecutor {
    const { workspaceId, workspacePath, remote } = params;
    const type = remote ? 'remote' : 'local';
    const key = this.keyFor(workspaceId, type);

    let cached = this.executors.get(key);
    if (!cached) {
      const executor = remote
        ? new RemoteExecutor(remote, workspaceId)
        : new LocalExecutor(workspacePath, workspaceId);
      cached = { executor, lastUsed: Date.now() };
      this.executors.set(key, cached);
      this.logger.debug('Created executor', { workspaceId, type });
    } else {
      cached.lastUsed = Date.now();
    }
    // Always return a retrying wrapper so callers get retry semantics
    return new RetryingExecutor(cached.executor, this);
  }

  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        if (this.isNonRetryable(err)) throw err;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError || new Error('Operation failed');
  }

  private isNonRetryable(error: any): boolean {
    const message = String(error?.message || error);
    const code = (error && (error.code as string)) || '';
    return (
      code === 'ENOTFOUND' ||
      code === 'EACCES' ||
      code === 'EPERM' ||
      code === 'ENOENT' || // file/dir not found - will not succeed on retry
      message.includes('no such file or directory') ||
      message.includes('Permission denied') ||
      message.includes('not permitted')
    );
  }

  private setupCleanup(): void {
    // Clean idle executors after 5 minutes
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.executors) {
        if (now - value.lastUsed > 5 * 60 * 1000) {
          this.logger.debug('Disposing idle executor', { key });
          value.executor.dispose().catch(() => {});
          this.executors.delete(key);
        }
      }
    }, 60 * 1000);
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.all(
      Array.from(this.executors.values()).map(({ executor }) => executor.dispose().catch(() => {})),
    );
    this.executors.clear();
  }
}

export const executorManager = new ExecutorManager();
