/**
 * RemoteRPCClient
 *
 * Typed JSON-RPC 2.0 client that communicates with the intent-server's RPC socket
 * on a remote host via SSH StreamLocal (Unix domain socket forwarding).
 *
 * Uses newline-delimited JSON (NDJSON) framing — each message is a JSON object
 * followed by `\n`. Supports request multiplexing: multiple concurrent requests
 * are tracked by auto-incrementing `id` and resolved/rejected when the matching
 * response arrives.
 */

import { Logger } from '../logger';
import { EventEmitter } from '../utils/event-emitter';
import type { SSHManager } from './ssh-manager';

const logger = new Logger('RemoteRPCClient');

// ---------------------------------------------------------------------------
// Types — params and return values for each RPC method
// ---------------------------------------------------------------------------

export interface ExecParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ReadFileParams {
  path: string;
  encoding?: 'utf-8' | 'base64';
  maxSize?: number;
}

export interface ReadFileResult {
  content: string;
  size: number;
  truncated: boolean;
}

export interface WriteFileParams {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  mkdirp?: boolean;
}

export interface FileExistsParams {
  path: string;
}

export interface FileExistsResult {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
}

export interface StatParams {
  path: string;
}

export interface StatResult {
  size: number;
  mtime: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: string;
}

export interface ListDirParams {
  path: string;
  includeHidden?: boolean;
}

export interface DirEntry {
  name: string;
  type: string;
  size: number;
  mtime: string;
}

export interface ListDirResult {
  entries: DirEntry[];
}

export interface SearchParams {
  query: string;
  path: string;
  options?: {
    caseSensitive?: boolean;
    regex?: boolean;
    maxResults?: number;
    includePattern?: string;
    excludePattern?: string;
    contextLines?: number;
  };
}

export interface SearchMatchContext {
  before: string[];
  after: string[];
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  match: string;
  context?: SearchMatchContext;
}

export interface SearchResult {
  results: SearchMatch[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Watch subscription types
// ---------------------------------------------------------------------------

export interface WatchSubscribeParams {
  basePath: string;
}

export interface WatchSubscribeResult {
  subscriptionId: string;
}

export interface WatchChangeFileEntry {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  stage: string;
}

export interface WatchChangeEvent {
  subscriptionId: string;
  files: WatchChangeFileEntry[];
  summary: { filesChanged: number; additions: number; deletions: number };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Structured git types
// ---------------------------------------------------------------------------

export interface GitStatusParams {
  cwd: string;
}

export interface GitStatusFileEntry {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitStatusFileEntry[];
}

export interface GitDiffParams {
  cwd: string;
  cached?: boolean;
  path?: string;
}

export interface GitDiffFileEntry {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitDiffResult {
  files: GitDiffFileEntry[];
}

// ---------------------------------------------------------------------------
// Capability negotiation types
// ---------------------------------------------------------------------------

export interface InitializeResult {
  serverVersion: string;
  capabilities: {
    methods: string[];
  };
}

// ---------------------------------------------------------------------------
// Notification handler type
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotificationHandler = (params: any) => void;

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Error class for RPC failures
// ---------------------------------------------------------------------------

export class RemoteRPCError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RemoteRPCError';
  }
}

// ---------------------------------------------------------------------------
// Pending request tracking
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// ---------------------------------------------------------------------------
// Socket handle returned by connectToRemoteSocket
// ---------------------------------------------------------------------------

interface SocketHandle {
  write: (data: string) => void;
  kill: () => void;
  isAlive: () => boolean;
}

// ---------------------------------------------------------------------------
// RemoteRPCClient
// ---------------------------------------------------------------------------

/** Default per-request timeout in milliseconds. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class RemoteRPCClient {
  private socket: SocketHandle | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  private _sshConnectionId: string | null = null;
  private _socketPath: string | null = null;
  private readonly defaultTimeoutMs: number;
  /** Internal emitter for JSON-RPC notifications from the server. */
  private readonly notificationEmitter = new EventEmitter();

  constructor(
    private readonly sshManager: SSHManager,
    options?: { defaultTimeoutMs?: number },
  ) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Open a StreamLocal channel to the given Unix socket on the remote host.
   */
  async connect(sshConnectionId: string, socketPath: string): Promise<void> {
    if (this.socket?.isAlive()) {
      logger.warn('Already connected — disconnecting first', {
        sshConnectionId: this._sshConnectionId,
        socketPath: this._socketPath,
      });
      this.disconnect();
    }

    this._sshConnectionId = sshConnectionId;
    this._socketPath = socketPath;
    this.buffer = '';

    logger.info('Connecting to remote RPC socket', { sshConnectionId, socketPath });

    this.socket = await this.sshManager.connectToRemoteSocket(sshConnectionId, socketPath, {
      onData: (data: string) => this.handleData(data),
      onClose: () => this.handleClose(),
      onError: (error: Error) => this.handleError(error),
    });

    logger.info('Connected to remote RPC socket', { sshConnectionId, socketPath });
  }

  /**
   * Tear down the StreamLocal channel and reject any in-flight requests.
   */
  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.kill();
      } catch {
        // Socket may already be dead — ignore.
      }
      this.socket = null;
    }

    this.rejectAllPending(new Error('RemoteRPCClient disconnected'));
    this.notificationEmitter.removeAllListeners();
    this.buffer = '';
    this._sshConnectionId = null;
    this._socketPath = null;
  }

  /**
   * Whether the underlying StreamLocal channel is alive.
   */
  isConnected(): boolean {
    return this.socket?.isAlive() === true;
  }

  // -------------------------------------------------------------------------
  // Typed RPC methods
  // -------------------------------------------------------------------------

  async exec(params: ExecParams): Promise<ExecResult> {
    return this.call<ExecResult>('exec', params);
  }

  async readFile(params: ReadFileParams): Promise<ReadFileResult> {
    return this.call<ReadFileResult>('readFile', params);
  }

  async writeFile(params: WriteFileParams): Promise<void> {
    await this.call<void>('writeFile', params);
  }

  async fileExists(params: FileExistsParams): Promise<FileExistsResult> {
    return this.call<FileExistsResult>('fileExists', params);
  }

  async stat(params: StatParams): Promise<StatResult> {
    return this.call<StatResult>('stat', params);
  }

  async listDir(params: ListDirParams): Promise<ListDirResult> {
    return this.call<ListDirResult>('listDir', params);
  }

  async search(params: SearchParams): Promise<SearchResult> {
    return this.call<SearchResult>('search', params);
  }

  // -------------------------------------------------------------------------
  // Watch subscription
  // -------------------------------------------------------------------------

  async watchSubscribe(params: WatchSubscribeParams): Promise<WatchSubscribeResult> {
    return this.call<WatchSubscribeResult>('watchSubscribe', params);
  }

  /**
   * Register a handler for `watch/changes` notifications.
   */
  onWatchChanges(handler: (event: WatchChangeEvent) => void): void {
    this.onNotification('watch/changes', handler);
  }

  /**
   * Remove a previously registered `watch/changes` handler.
   */
  removeWatchChangesListener(handler: (event: WatchChangeEvent) => void): void {
    this.removeNotificationListener('watch/changes', handler);
  }

  /**
   * Register a handler that fires when the socket closes unexpectedly.
   * The handler is called *before* pending requests are rejected, so
   * connection metadata (sshConnectionId, socketPath) is still accessible.
   *
   * Handlers are automatically removed when `disconnect()` is called.
   */
  onClose(handler: () => void): void {
    this.notificationEmitter.on('__rpc_close__', handler);
  }

  /**
   * Remove a previously registered close handler.
   */
  removeCloseListener(handler: () => void): void {
    this.notificationEmitter.off('__rpc_close__', handler);
  }

  // -------------------------------------------------------------------------
  // Structured git methods
  // -------------------------------------------------------------------------

  async gitStatus(params: GitStatusParams): Promise<GitStatusResult> {
    return this.call<GitStatusResult>('gitStatus', params);
  }

  async gitDiff(params: GitDiffParams): Promise<GitDiffResult> {
    return this.call<GitDiffResult>('gitDiff', params);
  }

  // -------------------------------------------------------------------------
  // Capability negotiation
  // -------------------------------------------------------------------------

  async initialize(): Promise<InitializeResult> {
    return this.call<InitializeResult>('initialize');
  }

  // -------------------------------------------------------------------------
  // Notification listener management
  // -------------------------------------------------------------------------

  /**
   * Register a handler for a specific JSON-RPC notification method.
   */
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationEmitter.on(method, handler);
  }

  /**
   * Remove a previously registered notification handler.
   */
  removeNotificationListener(method: string, handler: NotificationHandler): void {
    this.notificationEmitter.off(method, handler);
  }

  // -------------------------------------------------------------------------
  // Core request / response plumbing
  // -------------------------------------------------------------------------

  /**
   * Send a JSON-RPC 2.0 request and wait for the matching response.
   */
  private call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.socket || !this.socket.isAlive()) {
      return Promise.reject(new Error('RemoteRPCClient is not connected'));
    }

    const id = ++this.requestId;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        logger.error('RPC request timed out', { method, id, timeoutMs: timeout });
        reject(new Error(`RPC request timed out: ${method} (id=${id})`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify(request) + '\n';
      try {
        this.socket!.write(payload);
      } catch (err) {
        // Write failed — clean up immediately.
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Incoming data handling (NDJSON parser)
  // -------------------------------------------------------------------------

  /**
   * Handle raw data arriving from the StreamLocal channel.
   * Data may arrive in arbitrary chunks — we buffer and split on `\n`.
   */
  private handleData(data: string): void {
    this.buffer += data;

    const lines = this.buffer.split('\n');
    // The last element is either an empty string (if data ended with \n)
    // or an incomplete line — keep it in the buffer.
    this.buffer = lines[lines.length - 1];

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;

      try {
        const message: JsonRpcResponse = JSON.parse(line);
        this.handleMessage(message);
      } catch (err) {
        logger.warn('Failed to parse NDJSON line from remote RPC socket', {
          line: line.substring(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Route a parsed JSON-RPC message — either a notification (no `id`)
   * or a response to a pending request.
   */
  private handleMessage(message: JsonRpcResponse): void {
    // JSON-RPC 2.0 notifications have `method` but no `id`.
    const asAny = message as unknown as { method?: string; params?: unknown };
    if (message.id === undefined && asAny.method) {
      logger.debug('Received JSON-RPC notification', { method: asAny.method });
      this.notificationEmitter.emit(asAny.method, asAny.params);
      return;
    }

    if (message.id === undefined) {
      // Malformed — no method and no id.
      logger.debug('Received JSON-RPC message without id or method — ignoring');
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      logger.warn('Received response for unknown request id', { id: message.id });
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(
        new RemoteRPCError(message.error.message, message.error.code, message.error.data),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  // -------------------------------------------------------------------------
  // Connection event handlers
  // -------------------------------------------------------------------------

  private handleClose(): void {
    logger.info('Remote RPC socket closed', {
      sshConnectionId: this._sshConnectionId,
      socketPath: this._socketPath,
    });
    // Emit close event before clearing state so handlers can still read
    // connection metadata (sshConnectionId, socketPath) for logging.
    this.notificationEmitter.emit('__rpc_close__');
    this.socket = null;
    this.rejectAllPending(new Error('Remote RPC socket closed'));
    this.buffer = '';
  }

  private handleError(error: Error): void {
    logger.error('Remote RPC socket error', error, {
      sshConnectionId: this._sshConnectionId,
      socketPath: this._socketPath,
    });
    this.socket = null;
    this.rejectAllPending(error);
    this.buffer = '';
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
