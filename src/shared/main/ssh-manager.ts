import {
  Client,
  ConnectConfig,
  SFTPWrapper,
} from 'ssh2';
import { EventEmitter } from 'events';
import * as fs from 'fs';

import * as net from 'net';
import * as crypto from 'crypto';
import { createRequire } from 'module';
import { promisify } from 'util';
import type { WebSocket as WebSocketType } from 'ws';
import type { Duplex, DuplexOptions } from 'stream';
import { Logger } from '../logger';
import { featureCodesService } from '../../features/feature-codes/main/feature-codes.service';

// Use createRequire for ws — the package is CommonJS and Node 24 tightened
// CJS-to-ESM interop, causing ESM imports to fail inside the packaged ASAR.
const require = createRequire(import.meta.url);
const { WebSocket, createWebSocketStream } = require('ws') as {
  WebSocket: typeof import('ws').WebSocket;
  createWebSocketStream: (websocket: WebSocketType, options?: DuplexOptions) => Duplex;
};

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SSHConnection {
  id: string;
  config: SSHConnectionConfig;
  client: Client;
  sftp?: SFTPWrapper;
  connected: boolean;
}

/**
 * Maximum number of concurrent SSH exec channels per connection.
 * OpenSSH defaults to MaxSessions=10; we use 5 to leave headroom for
 * SFTP, StreamLocal, and port-forward channels.
 */
const MAX_CONCURRENT_CHANNELS = 5;

/**
 * Simple counting semaphore to limit concurrent operations.
 * When the limit is reached, callers queue and are resumed in FIFO order.
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}

  acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()!();
    }
  }
}

export class SSHManager extends EventEmitter {
  private connections: Map<string, SSHConnection> = new Map();
  private channelSemaphores: Map<string, Semaphore> = new Map();
  private logger = new Logger('SSHManager');

  constructor() {
    super();
    // Register a default no-op error listener to prevent ERR_UNHANDLED_ERROR.
    // Node.js EventEmitter throws if an 'error' event is emitted with no listeners.
    // The error is already logged at the emit site; this just prevents the crash.
    // Callers can still register their own 'error' listeners in addition to this one.
    this.on('error', () => {});
  }

  /**
   * Get (or lazily create) the channel semaphore for a connection.
   */
  private getChannelSemaphore(connectionId: string): Semaphore {
    let sem = this.channelSemaphores.get(connectionId);
    if (!sem) {
      sem = new Semaphore(MAX_CONCURRENT_CHANNELS);
      this.channelSemaphores.set(connectionId, sem);
    }
    return sem;
  }

  /**
   * Escape a string for safe use in shell commands.
   * Uses single quotes and escapes any embedded single quotes.
   */
  private escapeShellArg(arg: string): string {
    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Build a remote command with the user's environment properly loaded.
   *
   * When the remote-workspaces feature code is enabled, wraps the command in
   * `bash -l -c '...'` which sources login profiles (~/.bash_profile,
   * ~/.profile) for proper PATH setup.  The `-i` (interactive) flag is
   * intentionally omitted — it triggers tmux/screen in some `.bashrc`
   * files and produces "no job control" warnings on stderr.
   *
   * Without the flag, falls back to explicitly sourcing profile files
   * before the command (the original behaviour).
   */
  private buildRemoteCommand(
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
  ): string {
    const useInteractiveShell = featureCodesService.isFeatureEnabled('remote-workspaces');

    if (useInteractiveShell) {
      // ── flag-gated path: login shell (no -i to avoid tmux/screen) ──
      let innerCommand = command;

      if (options?.cwd) {
        innerCommand = `cd ${this.escapeShellArg(options.cwd)} && ${innerCommand}`;
      }

      if (options?.env) {
        const envVars = Object.entries(options.env)
          .map(([key, value]) => `export ${key}=${this.escapeShellArg(value)}`)
          .join('; ');
        innerCommand = `${envVars}; ${innerCommand}`;
      }

      return `bash -l -c ${this.escapeShellArg(innerCommand)}`;
    }

    // ── default path: source profile files inline (original behaviour) ──
    let fullCommand = command;

    fullCommand = `source ~/.bashrc 2>/dev/null || true; source ~/.profile 2>/dev/null || true; ${fullCommand}`;

    if (options?.cwd) {
      fullCommand = `cd ${this.escapeShellArg(options.cwd)} && ${fullCommand}`;
    }

    if (options?.env) {
      const envVars = Object.entries(options.env)
        .map(([key, value]) => `export ${key}=${this.escapeShellArg(value)}`)
        .join('; ');
      fullCommand = `${envVars}; ${fullCommand}`;
    }

    return fullCommand;
  }

  /**
   * Create a new SSH connection
   */
  async connect(id: string, config: SSHConnectionConfig): Promise<SSHConnection> {
    // Check if connection already exists
    if (this.connections.has(id)) {
      const existing = this.connections.get(id)!;
      if (existing.connected) {
        return existing;
      }
      // Disconnect and recreate if not connected
      await this.disconnect(id);
    }

    const client = new Client();
    const connection: SSHConnection = {
      id,
      config,
      client,
      connected: false,
    };

    // Track WebSocket instance for cleanup on close
    let wsInstance: WebSocketType | undefined;

    return new Promise((resolve, reject) => {
      client.on('ready', async () => {
        if (config.transport === 'websocket' && config.wsUrl) {
          this.logger.debug(`SSH connection established via WebSocket to ${config.wsUrl}`, {
            wsUrl: config.wsUrl,
          });
        } else {
          this.logger.debug(`SSH connection established to ${config.host}:${config.port}`, {
            host: config.host,
            port: config.port,
          });
        }
        connection.connected = true;

        // Initialize SFTP
        try {
          connection.sftp = await this.getSFTP(client);
        } catch (error) {
          this.logger.warn('Failed to initialize SFTP', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        this.connections.set(id, connection);
        this.emit('connected', id);
        resolve(connection);
      });

      client.on('error', (err) => {
        this.logger.error(
          `SSH connection error for ${id}`,
          err instanceof Error ? err : new Error(String(err)),
          { connectionId: id },
        );
        const connectionError = err instanceof Error ? err : new Error(String(err));
        (connectionError as any).connectionId = id;
        this.emit('error', connectionError);
        reject(err);
      });

      client.on('close', () => {
        this.logger.debug(`SSH connection closed for ${id}`, { connectionId: id });
        connection.connected = false;
        // Clean up WebSocket if it was used
        if (wsInstance) {
          try {
            wsInstance.close();
          } catch {
            // Ignore close errors
          }
          wsInstance = undefined;
        }
        this.emit('disconnected', id);
      });

      // Prepare connection config
      const connectConfig: ConnectConfig = {
        username: config.username,
      };

      // Debug: Log what auth method we're using
      this.logger.debug('Config received', {
        host: config.host,
        port: config.port,
        username: config.username,
        hasPassword: !!config.password,
        hasPrivateKey: !!config.privateKey,
        hasPrivateKeyPath: !!config.privateKeyPath,
        useAgent: config.useAgent,
        transport: config.transport,
        hasWsUrl: !!config.wsUrl,
      });

      // Add authentication
      if (config.password) {
        this.logger.debug('Using password authentication');
        connectConfig.password = config.password;
      } else if (config.privateKey) {
        connectConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }
      } else if (config.privateKeyPath) {
        try {
          connectConfig.privateKey = fs.readFileSync(config.privateKeyPath, 'utf8');
          if (config.passphrase) {
            connectConfig.passphrase = config.passphrase;
          }
        } catch (error) {
          reject(new Error(`Failed to read private key from ${config.privateKeyPath}: ${error}`));
          return;
        }
      } else if (config.useAgent) {
        // Use SSH agent
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      // Set up transport: WebSocket or TCP
      if (config.transport === 'websocket' && config.wsUrl) {
        // WebSocket transport: tunnel SSH over WebSocket
        const ws = new WebSocket(config.wsUrl);
        wsInstance = ws;

        const wsTimeout = setTimeout(() => {
          ws.close();
          client.end();
          reject(new Error(`WebSocket connection timed out to ${config.wsUrl}`));
        }, 30000);

        ws.on('open', () => {
          clearTimeout(wsTimeout);
          const duplex = createWebSocketStream(ws);
          // Handle errors on the duplex stream to prevent unhandled stream errors
          // (e.g. when the WebSocket closes unexpectedly after workspace deletion)
          duplex.on('error', (err) => {
            this.logger.error(
              `WebSocket duplex stream error for ${id}`,
              err instanceof Error ? err : new Error(String(err)),
              { connectionId: id },
            );
            const connectionError = err instanceof Error ? err : new Error(String(err));
            (connectionError as any).connectionId = id;
            this.emit('error', connectionError);
          });
          connectConfig.sock = duplex;
          // Don't set host/port — ssh2 ignores them when sock is provided
          client.connect(connectConfig);
        });

        ws.on('error', (err) => {
          clearTimeout(wsTimeout);
          reject(new Error(`WebSocket connection failed to ${config.wsUrl}: ${err.message}`));
        });
      } else {
        // Default TCP transport
        connectConfig.host = config.host;
        connectConfig.port = config.port;
        client.connect(connectConfig);
      }
    });
  }

  /**
   * Disconnect an SSH connection
   */
  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (connection) {
      connection.client.end();
      this.connections.delete(id);
      this.channelSemaphores.delete(id);
    }
  }

  /**
   * Execute a command on a remote server
   */
  async executeCommand(
    connectionId: string,
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      timeout?: number; // Timeout in milliseconds (default: 30 seconds)
      maxBuffer?: number; // Maximum combined stdout/stderr size before aborting
      rawCommand?: boolean; // If true, skip buildRemoteCommand() wrapper
    },
  ): Promise<CommandResult> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    const timeout = options?.timeout || 30000; // Default 30 second timeout

    // Acquire a channel semaphore permit before opening an exec channel
    const semaphore = this.getChannelSemaphore(connectionId);
    await semaphore.acquire();

    return new Promise<CommandResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let stream: any = null;
      const maxBuffer = options?.maxBuffer;

      const settle = (fn: typeof resolve | typeof reject, value: CommandResult | Error) => {
        if (!isResolved) {
          isResolved = true;
          semaphore.release();
          (fn as (v: any) => void)(value);
        }
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        // Kill the stream if it exists
        if (stream) {
          stream.close();
        }

        settle(
          reject,
          new Error(
            `Command timed out after ${timeout}ms. The command may be waiting for input or hanging.`,
          ),
        );
      }, timeout);

      const rejectForBufferOverflow = () => {
        if (stream) {
          try {
            stream.close();
          } catch {
            // Ignore stream close errors
          }
        }
        clearTimeout(timeoutId);
        const limit = typeof maxBuffer === 'number' ? maxBuffer : 0;
        settle(
          reject,
          new Error(
            limit > 0
              ? `Command output exceeded maximum buffer of ${limit} bytes.`
              : 'Command output exceeded configured maximum buffer.',
          ),
        );
      };

      const checkBufferLimit = () => {
        if (typeof maxBuffer === 'number' && maxBuffer > 0) {
          const totalLength = stdout.length + stderr.length;
          if (totalLength > maxBuffer) {
            rejectForBufferOverflow();
          }
        }
      };

      // Build command wrapped in a login shell for proper environment
      const fullCommand = options?.rawCommand ? command : this.buildRemoteCommand(command, options);

      connection.client.exec(fullCommand, (err, execStream) => {
        if (err) {
          clearTimeout(timeoutId);
          settle(reject, err);
          return;
        }

        stream = execStream;

        stream.on('close', (code: number) => {
          clearTimeout(timeoutId);
          settle(resolve, {
            stdout,
            stderr,
            exitCode: code || 0,
          });
        });

        stream.on('data', (data: Buffer) => {
          if (isResolved) {
            return;
          }
          const str = data.toString();
          stdout += str;
          checkBufferLimit();
          if (isResolved) {
            return;
          }
          if (options?.onStdout) {
            options.onStdout(str);
          }
          this.emit('stdout', { connectionId, data: str });
        });

        stream.stderr.on('data', (data: Buffer) => {
          if (isResolved) {
            return;
          }
          const str = data.toString();
          stderr += str;
          checkBufferLimit();
          if (isResolved) {
            return;
          }
          if (options?.onStderr) {
            options.onStderr(str);
          }
          this.emit('stderr', { connectionId, data: str });
        });

        stream.on('error', (err: Error) => {
          clearTimeout(timeoutId);
          settle(reject, err);
        });
      });
    });
  }

  /**
   * Execute a command with PTY support (for interactive commands)
   */
  async executeCommandWithPty(
    connectionId: string,
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      timeout?: number;
      cols?: number;
      rows?: number;
    },
  ): Promise<CommandResult> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    const timeout = options?.timeout || 30000;
    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    // Acquire a channel semaphore permit before opening an exec channel
    const semaphore = this.getChannelSemaphore(connectionId);
    await semaphore.acquire();

    return new Promise<CommandResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let stream: any = null;

      const settle = (fn: typeof resolve | typeof reject, value: CommandResult | Error) => {
        if (!isResolved) {
          isResolved = true;
          semaphore.release();
          (fn as (v: any) => void)(value);
        }
      };

      const timeoutId = setTimeout(() => {
        if (stream) {
          stream.close();
        }
        settle(reject, new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      // Build command wrapped in a login shell for proper environment
      const fullCommand = this.buildRemoteCommand(command, options);

      // Execute with PTY enabled
      connection.client.exec(fullCommand, { pty: { cols, rows } }, (err, execStream) => {
        if (err) {
          clearTimeout(timeoutId);
          settle(reject, err);
          return;
        }

        stream = execStream;

        stream.on('close', (code: number) => {
          clearTimeout(timeoutId);
          settle(resolve, {
            stdout,
            stderr,
            exitCode: code || 0,
          });
        });

        // With PTY, stdout and stderr are combined
        stream.on('data', (data: Buffer) => {
          const str = data.toString();
          stdout += str;
          if (options?.onStdout) {
            options.onStdout(str);
          }
          this.emit('stdout', { connectionId, data: str });
        });

        stream.stderr.on('data', (data: Buffer) => {
          const str = data.toString();
          stderr += str;
          if (options?.onStderr) {
            options.onStderr(str);
          }
          this.emit('stderr', { connectionId, data: str });
        });

        stream.on('error', (err: Error) => {
          clearTimeout(timeoutId);
          settle(reject, err);
        });
      });
    });
  }

  /**
   * Get SFTP client for file operations
   */
  private getSFTP(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
        } else {
          resolve(sftp);
        }
      });
    });
  }

  /**
   * Get a connected SSH connection, throwing if not found or disconnected.
   */
  private getActiveConnection(connectionId: string): SSHConnection {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }
    return connection;
  }

  /**
   * Ensure SFTP is initialized on the connection, re-initializing if needed.
   * Returns the SFTPWrapper.
   */
  private async ensureSFTP(connection: SSHConnection): Promise<SFTPWrapper> {
    if (connection.sftp) {
      return connection.sftp;
    }

    this.logger.debug('Re-initializing SFTP for connection', { connectionId: connection.id });
    try {
      connection.sftp = await this.getSFTP(connection.client);
      return connection.sftp;
    } catch (error) {
      throw new Error(
        `Failed to initialize SFTP for ${connection.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Resolve a remote path, expanding `~` to the user's home directory.
   * SFTP does not expand `~`, so we resolve it via the SFTP realpath for `.`
   * (which returns the home directory for the SSH user).
   */
  private async resolveRemotePath(connection: SSHConnection, remotePath: string): Promise<string> {
    if (!remotePath.startsWith('~')) {
      return remotePath;
    }

    const sftp = await this.ensureSFTP(connection);
    const realpath = promisify(sftp.realpath.bind(sftp));
    const homeDir = await realpath('.');
    return remotePath.replace(/^~/, homeDir);
  }

  /**
   * Read a remote file's contents via SFTP.
   * Returns the file content as a UTF-8 string, or null if the file does not exist.
   * Supports `~` in paths.
   */
  private async readRemoteFile(connection: SSHConnection, remotePath: string): Promise<string | null> {
    const sftp = await this.ensureSFTP(connection);
    const resolvedPath = await this.resolveRemotePath(connection, remotePath);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(resolvedPath, { encoding: 'utf8' });

      stream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      stream.on('error', (err: Error & { code?: number }) => {
        // SFTP error code 2 = SSH_FX_NO_SUCH_FILE
        if (err.code === 2 || err.message?.includes('No such file')) {
          resolve(null);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Write content to a remote file via SFTP.
   * Supports `~` in paths.
   */
  private async writeRemoteFile(connection: SSHConnection, remotePath: string, content: string): Promise<void> {
    const sftp = await this.ensureSFTP(connection);
    const resolvedPath = await this.resolveRemotePath(connection, remotePath);

    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(resolvedPath, { encoding: 'utf8' });

      stream.on('close', () => {
        resolve();
      });

      stream.on('error', (err: Error) => {
        reject(err);
      });

      stream.end(content, 'utf8');
    });
  }

  /**
   * Upload a file to remote server.
   * Re-initializes SFTP if not already available. Supports `~` in remote paths.
   */
  async uploadFile(connectionId: string, localPath: string, remotePath: string): Promise<void> {
    const connection = this.getActiveConnection(connectionId);
    const sftp = await this.ensureSFTP(connection);
    const resolvedPath = await this.resolveRemotePath(connection, remotePath);

    this.logger.debug('Uploading file', { connectionId, localPath, remotePath: resolvedPath });

    const fastPut = promisify(sftp.fastPut.bind(sftp));
    try {
      await fastPut(localPath, resolvedPath);
    } catch (error) {
      throw new Error(
        `Failed to upload ${localPath} to ${remotePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Download a file from remote server
   */
  async downloadFile(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected || !connection.sftp) {
      throw new Error(`No active SFTP connection for ${connectionId}`);
    }

    const fastGet = promisify(connection.sftp.fastGet.bind(connection.sftp));
    await fastGet(remotePath, localPath);
  }

  /**
   * List files in a remote directory
   */
  async listDirectory(connectionId: string, remotePath: string): Promise<any[]> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected || !connection.sftp) {
      throw new Error(`No active SFTP connection for ${connectionId}`);
    }

    const readdir = promisify(connection.sftp.readdir.bind(connection.sftp));
    return await readdir(remotePath);
  }

  /**
   * Ensure a remote directory exists, creating it recursively if needed.
   * Equivalent to `mkdir -p` on the remote host.
   */
  async ensureRemoteDirectory(connectionId: string, remotePath: string): Promise<void> {
    const connection = this.getActiveConnection(connectionId);

    this.logger.debug('Ensuring remote directory exists', { connectionId, remotePath });

    // Resolve ~ to the actual home directory before passing to the shell,
    // because escapeShellArg wraps the path in single quotes which prevents
    // bash tilde expansion (e.g. '~/.intent-server' is treated literally).
    let resolvedPath = remotePath;
    if (remotePath.startsWith('~')) {
      resolvedPath = await this.resolveRemotePath(connection, remotePath);
    }

    const result = await this.executeCommand(connectionId, `mkdir -p ${this.escapeShellArg(resolvedPath)}`);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create remote directory ${remotePath}: ${result.stderr || `exit code ${result.exitCode}`}`,
      );
    }
  }

  /**
   * Discover the absolute path to auggie on the remote host.
   *
   * Strategy: Run `node ~/.intent-server/server.js discover` on the remote host.
   * The intent-server discover command runs natively with full access to $SHELL,
   * HOME, and the filesystem — avoiding the shell-environment issues that plague
   * SSH exec channels (where $SHELL is unset and only minimal profiles are loaded).
   *
   * @param connectionId - The SSH connection to use
   * @param overridePath - Optional user-configured auggie path (skips discovery)
   * @returns The absolute path to auggie on the remote host
   */
  async discoverAuggiePath(connectionId: string, overridePath?: string): Promise<string> {
    const connection = this.getActiveConnection(connectionId);

    // If user provided an override, validate it exists and return
    if (overridePath) {
      // Resolve ~ to the remote home directory before escaping, because
      // escapeShellArg wraps the path in single quotes which prevents
      // the shell from expanding the tilde.
      let resolvedOverride = overridePath;
      if (overridePath.startsWith('~')) {
        resolvedOverride = await this.resolveRemotePath(connection, overridePath);
      }
      this.logger.debug('Using user-configured auggie path', { connectionId, overridePath: resolvedOverride });
      const checkResult = await this.executeCommand(connectionId, `test -x ${this.escapeShellArg(resolvedOverride)} && echo "ok"`, { timeout: 10000 });
      if (checkResult.exitCode !== 0 || !checkResult.stdout.includes('ok')) {
        throw new Error(
          `Configured auggie path does not exist or is not executable: ${overridePath}`,
        );
      }
      // Store the override in config
      await this.storeAuggieConfig(connection, resolvedOverride);
      return resolvedOverride;
    }

    this.logger.debug('Discovering auggie path on remote host via intent-server discover', { connectionId });

    let auggiePath: string | null = null;

    try {
      const result = await this.executeCommand(
        connectionId,
        'node ~/.intent-server/server.js discover',
        { timeout: 20000 },
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        try {
          const parsed = JSON.parse(result.stdout.trim());
          if (parsed.ok && parsed.auggiePath) {
            auggiePath = parsed.auggiePath;
          }
        } catch {
          this.logger.warn('intent-server discover returned non-JSON stdout', {
            connectionId,
            stdout: result.stdout,
          });
        }
      } else {
        this.logger.warn('intent-server discover returned non-zero exit code', {
          connectionId,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
    } catch (error) {
      this.logger.warn('intent-server discover failed', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!auggiePath) {
      throw new Error(
        'auggie not found on remote host. Install auggie or set the path in SSH host settings.',
      );
    }

    this.logger.info('Discovered auggie path on remote', { connectionId, auggiePath });

    // Store in config (backup cache on the client side)
    await this.storeAuggieConfig(connection, auggiePath);

    return auggiePath;
  }

  /**
   * Store the auggie path in ~/.intent-server/config.json on the remote host.
   */
  private async storeAuggieConfig(connection: SSHConnection, auggiePath: string): Promise<void> {
    try {
      await this.ensureRemoteDirectory(connection.id, '~/.intent-server');

      let config: Record<string, unknown> = {};

      // Try to read existing config
      const existingContent = await this.readRemoteFile(connection, '~/.intent-server/config.json');
      if (existingContent) {
        try {
          config = JSON.parse(existingContent);
        } catch {
          // Invalid JSON, start fresh
        }
      }

      config.auggiePath = auggiePath;

      await this.writeRemoteFile(
        connection,
        '~/.intent-server/config.json',
        JSON.stringify(config, null, 2) + '\n',
      );

      this.logger.debug('Stored auggie config on remote', { connectionId: connection.id, auggiePath });
    } catch (error) {
      // Non-fatal: log but don't throw since we already have the path
      this.logger.warn('Failed to store auggie config on remote', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if a connection is active
   */
  isConnected(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    return connection?.connected || false;
  }

  /**
   * Get all active connections
   */
  getConnections(): SSHConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Deploy intent-server.js to the remote host.
   *
   * Uploads the bundled intent-server.js to `~/.intent-server/server.js`.
   * Skips upload if the remote version matches (compared via SHA-256 hash stored
   * in `~/.intent-server/server.version`).
   *
   * @param connectionId - The SSH connection to use
   * @param localBundlePath - Local path to the intent-server.js bundle
   * @returns true if a new version was deployed, false if skipped (already up-to-date)
   */
  async deployIntentServer(connectionId: string, localBundlePath: string): Promise<boolean> {
    const connection = this.getActiveConnection(connectionId);

    this.logger.info('Deploying intent-server to remote', { connectionId, localBundlePath });

    // Compute local file hash
    const localContent = await fs.promises.readFile(localBundlePath);
    const localHash = crypto.createHash('sha256').update(localContent).digest('hex');

    // Check remote version hash
    const remoteHash = await this.readRemoteFile(connection, '~/.intent-server/server.version');
    if (remoteHash && remoteHash.trim() === localHash) {
      this.logger.info('intent-server already up-to-date on remote, skipping deployment', {
        connectionId,
        hash: localHash,
      });
      return false;
    }

    // Ensure directory exists
    await this.ensureRemoteDirectory(connectionId, '~/.intent-server');

    // Upload the bundle
    await this.uploadFile(connectionId, localBundlePath, '~/.intent-server/server.js');

    // Write the version hash
    await this.writeRemoteFile(connection, '~/.intent-server/server.version', localHash + '\n');

    // Make executable (not strictly needed for `node` but good practice)
    await this.executeCommand(connectionId, 'chmod +x ~/.intent-server/server.js', { timeout: 10000 });

    this.logger.info('intent-server deployed successfully', {
      connectionId,
      hash: localHash,
    });

    return true;
  }

  /**
   * Spawn a long-running process on remote server with bidirectional communication
   * Returns a handle to write to stdin and kill the process
   */
  async spawnRemoteProcess(
    connectionId: string,
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      onExit?: (code: number) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<{
    write: (data: string) => void;
    kill: () => void;
    isAlive: () => boolean;
  }> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    return new Promise((resolve, reject) => {
      // Build command wrapped in a login shell for proper environment
      const fullCommand = this.buildRemoteCommand(command, options);

      this.logger.info('Spawning remote process', {
        connectionId,
        command: fullCommand.substring(0, 200),
      });

      connection.client.exec(fullCommand, (err, stream) => {
        if (err) {
          this.logger.error('Failed to spawn remote process', err, { connectionId });
          reject(err);
          return;
        }

        let isAlive = true;

        stream.on('close', (code: number) => {
          isAlive = false;
          this.logger.info('Remote process exited', { connectionId, code });
          if (options?.onExit) {
            options.onExit(code);
          }
        });

        stream.on('data', (data: Buffer) => {
          const str = data.toString();
          if (options?.onStdout) {
            options.onStdout(str);
          }
          this.emit('stdout', { connectionId, data: str });
        });

        stream.stderr.on('data', (data: Buffer) => {
          const str = data.toString();
          if (options?.onStderr) {
            options.onStderr(str);
          }
          this.emit('stderr', { connectionId, data: str });
        });

        stream.on('error', (err: Error) => {
          isAlive = false;
          this.logger.error('Remote process error', err, { connectionId });
          if (options?.onError) {
            options.onError(err);
          }
        });

        // Return handle for bidirectional communication
        resolve({
          write: (data: string) => {
            if (isAlive && stream.writable) {
              stream.write(data);
            } else {
              this.logger.warn('Cannot write to remote process - stream not writable', {
                connectionId,
                isAlive,
                writable: stream.writable,
              });
            }
          },
          kill: () => {
            if (isAlive) {
              this.logger.info('Gracefully killing remote process', { connectionId });

              // Send SIGTERM signal via SSH channel for graceful shutdown
              // This allows the remote process to clean up before terminating
              try {
                // The ssh2 library supports sending signals via the 'signal' method
                stream.signal('TERM');
                this.logger.debug('Sent SIGTERM to remote process', { connectionId });

                // Give the process a chance to terminate gracefully
                setTimeout(() => {
                  if (isAlive) {
                    this.logger.info('Force closing remote process after timeout', {
                      connectionId,
                    });
                    stream.close();
                    isAlive = false;
                  }
                }, 3000); // Wait 3 seconds for graceful shutdown
              } catch {
                // If signal fails, just close the stream
                this.logger.warn('Failed to send signal, force closing', { connectionId });
                stream.close();
                isAlive = false;
              }
            }
          },
          isAlive: () => isAlive,
        });
      });
    });
  }

  /**
   * Connect to a Unix domain socket on the remote host.
   * Uses the OpenSSH `streamlocal` extension to open a direct connection
   * to a socket path on the remote server, returning a bidirectional handle.
   */
  async connectToRemoteSocket(
    connectionId: string,
    socketPath: string,
    options?: {
      onData?: (data: string) => void;
      onClose?: () => void;
      onError?: (error: Error) => void;
    },
  ): Promise<{
    write: (data: string) => void;
    kill: () => void;
    isAlive: () => boolean;
  }> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    if (typeof connection.client.openssh_forwardOutStreamLocal !== 'function') {
      throw new Error(
        'openssh_forwardOutStreamLocal is not available — the remote server may not support OpenSSH extensions',
      );
    }

    return new Promise((resolve, reject) => {
      this.logger.info('Connecting to remote Unix socket', {
        connectionId,
        socketPath,
      });

      connection.client.openssh_forwardOutStreamLocal(socketPath, (err, stream) => {
        if (err) {
          this.logger.error('Failed to connect to remote Unix socket', err, {
            connectionId,
            socketPath,
          });
          reject(err);
          return;
        }

        let isAlive = true;

        stream.on('close', () => {
          isAlive = false;
          this.logger.info('Remote Unix socket closed', { connectionId, socketPath });
          if (options?.onClose) {
            options.onClose();
          }
        });

        stream.on('data', (data: Buffer) => {
          const str = data.toString();
          if (options?.onData) {
            options.onData(str);
          }
        });

        stream.on('error', (err: Error) => {
          isAlive = false;
          this.logger.error('Remote Unix socket error', err, { connectionId, socketPath });
          if (options?.onError) {
            options.onError(err);
          }
        });

        this.logger.info('Connected to remote Unix socket', { connectionId, socketPath });

        resolve({
          write: (data: string) => {
            if (isAlive && stream.writable) {
              stream.write(data);
            } else {
              this.logger.warn('Cannot write to remote socket - stream not writable', {
                connectionId,
                socketPath,
                isAlive,
                writable: stream.writable,
              });
            }
          },
          kill: () => {
            if (isAlive) {
              this.logger.info('Closing remote Unix socket connection', {
                connectionId,
                socketPath,
              });
              stream.close();
              isAlive = false;
            }
          },
          isAlive: () => isAlive,
        });
      });
    });
  }

  /**
   * Set up reverse port forwarding (remote -> local)
   * Allows a remote process to connect to a local service via localhost on the remote.
   * Returns the remote port that can be used to connect.
   */
  async forwardRemotePort(
    connectionId: string,
    options: {
      remotePort: number; // Port on remote that will forward to local
      localHost: string; // Local host to forward to (usually 'localhost')
      localPort: number; // Local port to forward to
    },
  ): Promise<{ close: () => void }> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    return new Promise((resolve, reject) => {
      // Use forwardIn to set up remote -> local forwarding
      // This makes remotePort on the remote server forward to localPort on the local machine
      connection.client.forwardIn('127.0.0.1', options.remotePort, (err) => {
        if (err) {
          this.logger.error('Failed to set up reverse port forwarding', err, {
            connectionId,
            remotePort: options.remotePort,
            localPort: options.localPort,
          });
          reject(err);
          return;
        }

        this.logger.info('Reverse port forwarding established', {
          connectionId,
          remotePort: options.remotePort,
          localHost: options.localHost,
          localPort: options.localPort,
        });

        resolve({
          close: () => {
            try {
              connection.client.unforwardIn('127.0.0.1', options.remotePort, (err) => {
                if (err) {
                  this.logger.warn('Failed to close port forwarding', { error: err });
                }
              });
            } catch (err) {
              // unforwardIn throws synchronously if the SSH client is already disconnected
              this.logger.warn('Failed to call unforwardIn (client likely disconnected)', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          },
        });
      });

      // Handle incoming connections on the forwarded port
      connection.client.on('tcp connection', (info, accept) => {
        if (info.destPort === options.remotePort) {
          this.logger.debug('Incoming connection on forwarded port', { info });
          const stream = accept();
          const socket = net.connect(options.localPort, options.localHost, () => {
            this.logger.debug('Connected to local service', {
              localHost: options.localHost,
              localPort: options.localPort,
            });
          });

          stream.pipe(socket);
          socket.pipe(stream);

          stream.on('close', () => socket.end());
          socket.on('close', () => stream.close());
          stream.on('error', (err: Error) => {
            this.logger.warn('Stream error in port forwarding', { error: err.message });
            socket.end();
          });
          socket.on('error', (err: Error) => {
            this.logger.warn('Socket error in port forwarding', { error: err.message });
            stream.close();
          });
        }
      });
    });
  }

  /**
   * Open an interactive shell session with PTY support
   * This is used for terminal functionality in remote workspaces
   */
  async openInteractiveShell(
    connectionId: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
      onData?: (data: string) => void;
      onExit?: (code: number) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<{
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    close: () => void;
    isAlive: () => boolean;
  }> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.connected) {
      throw new Error(`No active connection for ${connectionId}`);
    }

    const cols = options?.cols || 80;
    const rows = options?.rows || 24;

    return new Promise((resolve, reject) => {
      // Request a shell with PTY
      connection.client.shell(
        {
          term: 'xterm-256color',
          cols,
          rows,
        },
        (err, stream) => {
          if (err) {
            this.logger.error('Failed to open interactive shell', err, { connectionId });
            reject(err);
            return;
          }

          let isAlive = true;

          // Set initial directory and environment if specified
          if (options?.cwd) {
            stream.write(`cd ${this.escapeShellArg(options.cwd)}\n`);
          }

          if (options?.env) {
            for (const [key, value] of Object.entries(options.env)) {
              stream.write(`export ${key}=${this.escapeShellArg(value)}\n`);
            }
          }

          // Clear the screen after setup to give a clean start
          stream.write('clear\n');

          stream.on('close', (code: number) => {
            isAlive = false;
            this.logger.info('Interactive shell closed', { connectionId, code });
            if (options?.onExit) {
              options.onExit(code || 0);
            }
          });

          stream.on('data', (data: Buffer) => {
            const str = data.toString();
            if (options?.onData) {
              options.onData(str);
            }
            this.emit('shell-data', { connectionId, data: str });
          });

          stream.on('error', (err: Error) => {
            isAlive = false;
            this.logger.error('Interactive shell error', err, { connectionId });
            if (options?.onError) {
              options.onError(err);
            }
          });

          this.logger.info('Interactive shell opened', { connectionId, cols, rows });

          resolve({
            write: (data: string) => {
              if (isAlive && stream.writable) {
                stream.write(data);
              } else {
                this.logger.warn('Cannot write to shell - stream not writable', {
                  connectionId,
                  isAlive,
                  writable: stream.writable,
                });
              }
            },
            resize: (newCols: number, newRows: number) => {
              if (isAlive) {
                stream.setWindow(newRows, newCols, 0, 0);
              }
            },
            close: () => {
              if (isAlive) {
                this.logger.info('Closing interactive shell', { connectionId });
                stream.end();
                isAlive = false;
              }
            },
            isAlive: () => isAlive,
          });
        },
      );
    });
  }

  /**
   * Detect environment on remote server
   */
  async detectEnvironment(connectionId: string): Promise<{
    os: string;
    languages: string[];
    tools: string[];
  }> {
    const checks = [
      { command: 'uname -s', name: 'OS', type: 'os' },
      { command: 'node --version', name: 'Node.js', type: 'language' },
      { command: 'python --version', name: 'Python', type: 'language' },
      { command: 'python3 --version', name: 'Python3', type: 'language' },
      { command: 'ruby --version', name: 'Ruby', type: 'language' },
      { command: 'go version', name: 'Go', type: 'language' },
      { command: 'cargo --version', name: 'Rust', type: 'language' },
      { command: 'java -version', name: 'Java', type: 'language' },
      { command: 'git --version', name: 'Git', type: 'tool' },
      { command: 'docker --version', name: 'Docker', type: 'tool' },
      { command: 'kubectl version --client', name: 'Kubernetes', type: 'tool' },
    ];

    const results = {
      os: 'Unknown',
      languages: [] as string[],
      tools: [] as string[],
    };

    for (const check of checks) {
      try {
        const result = await this.executeCommand(connectionId, check.command);
        if (result.exitCode === 0) {
          if (check.type === 'os') {
            results.os = result.stdout.trim();
          } else if (check.type === 'language') {
            results.languages.push(check.name);
          } else if (check.type === 'tool') {
            results.tools.push(check.name);
          }
        }
      } catch {
        // Command not found, skip
      }
    }

    return results;
  }
}

// Export singleton instance
export const sshManager = new SSHManager();
