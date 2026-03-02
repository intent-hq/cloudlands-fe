/**
 * Server Manager
 *
 * Manages MCP server processes - spawning, monitoring, and restarting.
 */

import { app } from 'electron';
import { EventEmitter } from '$shared/utils/event-emitter';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../../../../shared/logger';
import { killChildProcessTree } from '../../../../shared/main/process-tree-kill';
import type { McpServerConfig } from './mcp-hub';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('ServerManager');

interface ServerProcess {
  config: McpServerConfig;
  process: ChildProcess;
  restartCount: number;
  lastRestart: number;
  isHealthy: boolean;
  requestQueue: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
      timeout: NodeJS.Timeout;
    }
  >;
}

export interface ServerManagerOptions {
  maxRetries?: number;
  retryDelay?: number;
  requestTimeout?: number;
}

export class ServerManager extends EventEmitter {
  private servers: Map<string, ServerProcess> = new Map();
  private options: Required<ServerManagerOptions>;
  private restartTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: ServerManagerOptions = {}) {
    super();

    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      requestTimeout: options.requestTimeout ?? 30000,
    };
  }

  /**
   * Start a new server process
   */
  async startServer(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      throw new Error(`Server ${config.id} is already running`);
    }

    const serverPath = this.getServerPath(config.type);
    const args = this.getServerArgs(config);

    logger.info(`Spawning server process: ${serverPath} ${args.join(' ')}`);

    const nodeEnv = process.env.NODE_ENV || 'production';
    const processEnv = { ...process.env };

    // On Windows packaged apps, use Electron's embedded Node.js (ELECTRON_RUN_AS_NODE=1)
    // since 'node' may not be on the system PATH.
    const useElectronAsNode = process.platform === 'win32' && app.isPackaged;
    const command = useElectronAsNode ? process.execPath : 'node';

    logger.info(`Using command: ${command} (useElectronAsNode=${useElectronAsNode})`);

    const childProcess = spawn(command, [serverPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...processEnv,
        ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        NODE_ENV: nodeEnv,
        MCP_SERVER_ID: config.id,
        MCP_SERVER_TYPE: config.type,
        MCP_WORKSPACE_ID: config.workspaceId || '',
        MCP_WORKSPACE_PATH: config.workspacePath || '',
        MCP_METADATA_PATH: config.metadataPath || '',
      },
      windowsHide: true,
    });

    const serverProcess: ServerProcess = {
      config,
      process: childProcess,
      restartCount: 0,
      lastRestart: Date.now(),
      isHealthy: true,
      requestQueue: new Map(),
    };

    this.setupProcessHandlers(serverProcess);
    this.servers.set(config.id, serverProcess);

    // Wait for server to be ready
    await this.waitForServerReady(config.id);

    this.emit('server:started', config);
  }

  /**
   * Stop a server process
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    // CRITICAL: Remove from servers map BEFORE killing the process.
    // The exit handler checks this.servers.has(config.id) to decide whether to restart.
    // If we kill first, the exit handler fires while the server is still in the map,
    // triggering an unwanted restartServer() that creates a zombie server process.
    this.servers.delete(serverId);

    // Cancel any pending restart
    const restartTimer = this.restartTimers.get(serverId);
    if (restartTimer) {
      clearTimeout(restartTimer);
      this.restartTimers.delete(serverId);
    }

    // Reject all pending requests
    for (const [, request] of server.requestQueue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Server is shutting down'));
    }
    server.requestQueue.clear();

    // Kill the process tree
    if (!server.process.killed) {
      await killChildProcessTree(server.process);

      // Give it time to shutdown gracefully
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force kill if still running
      if (!server.process.killed) {
        await killChildProcessTree(server.process, 'SIGKILL');
      }
    }

    this.emit('server:stopped', server.config);
  }

  /**
   * Restart a server
   */
  async restartServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      return;
    }

    // Check restart limits
    const now = Date.now();
    const timeSinceLastRestart = now - server.lastRestart;

    if (timeSinceLastRestart < 60000) {
      // Within 1 minute
      server.restartCount++;
    } else {
      server.restartCount = 1;
    }

    if (server.restartCount > this.options.maxRetries) {
      logger.error(`Server ${serverId} exceeded max restart attempts`);
      this.emit('server:error', server.config, new Error('Max restart attempts exceeded'));
      await this.stopServer(serverId);
      return;
    }

    // Calculate backoff delay
    const delay = this.options.retryDelay * Math.pow(2, server.restartCount - 1);

    logger.info(
      `Scheduling restart for server ${serverId} in ${delay}ms (attempt ${server.restartCount})`,
    );

    this.emit('server:restarting', server.config);

    // Schedule restart
    const timer = setTimeout(async () => {
      this.restartTimers.delete(serverId);

      const config = server.config;
      await this.stopServer(serverId);
      await this.startServer(config);
    }, delay);

    this.restartTimers.set(serverId, timer);
  }

  /**
   * Call a tool on a server
   */
  async callTool(serverId: string, toolName: string, params: any): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (!server.isHealthy) {
      throw new Error(`Server ${serverId} is not healthy`);
    }

    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        server.requestQueue.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, this.options.requestTimeout);

      // Store request handler
      server.requestQueue.set(requestId, { resolve, reject, timeout });

      // Send request to server
      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: params,
        },
      };

      server.process.send(request);
    });
  }

  /**
   * Ping a server for health check
   */
  async pingServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server || !server.isHealthy) {
      return false;
    }

    try {
      const response = await this.sendRequest(serverId, 'ping', {});
      return response === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * Send a request to a server
   */
  private async sendRequest(serverId: string, method: string, params: any): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.requestQueue.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, 5000); // Short timeout for internal requests

      server.requestQueue.set(requestId, { resolve, reject, timeout });

      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params,
      };

      server.process.send(request);
    });
  }

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(server: ServerProcess): void {
    const { process, config } = server;

    // Handle messages from server
    process.on('message', (message: any) => {
      if (message.id && server.requestQueue.has(message.id)) {
        const request = server.requestQueue.get(message.id)!;
        server.requestQueue.delete(message.id);
        clearTimeout(request.timeout);

        if (message.error) {
          request.reject(new Error(message.error.message || 'Unknown error'));
        } else {
          request.resolve(message.result);
        }
      } else if (message.type === 'event') {
        // Forward events from server
        logger.info(`[ServerManager] Received event from server ${config.id}:`, message.event);
        logger.info(`[ServerManager] Emitting server:event for ${config.id}`);
        this.emit('server:event', config.id, message.event);
        logger.info(`[ServerManager] Emitted server:event for ${config.id}`);
      }
    });

    // Handle stdout
    process.stdout?.on('data', (data) => {
      logger.debug(`[${config.id}] ${data.toString()}`);
    });

    // Handle stderr
    process.stderr?.on('data', (data) => {
      logger.error(`[${config.id}] ${data.toString()}`);
    });

    // Handle process exit
    process.on('exit', (code, signal) => {
      logger.info(`Server ${config.id} exited with code ${code} signal ${signal}`);
      server.isHealthy = false;

      // Reject all pending requests
      for (const [, request] of server.requestQueue) {
        clearTimeout(request.timeout);
        request.reject(new Error('Server process exited'));
      }
      server.requestQueue.clear();

      // Attempt restart if not intentionally stopped
      if (this.servers.has(config.id)) {
        this.restartServer(config.id);
      }
    });

    // Handle process error
    process.on('error', (error) => {
      logger.error(`Server ${config.id} process error:`, error);
      server.isHealthy = false;
      this.emit('server:error', config, error);
    });
  }

  /**
   * Wait for server to be ready
   */
  private async waitForServerReady(serverId: string, maxWait = 10000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const ready = await this.pingServer(serverId);
        if (ready) {
          return;
        }
      } catch {
        // Ignore errors during startup
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Server ${serverId} failed to become ready`);
  }

  /**
   * Get server executable path
   */
  private getServerPath(type: McpServerConfig['type']): string {
    // __dirname is dist/features/mcp/main/hub, servers are at dist/features/mcp/servers
    const serverDir = path.join(__dirname, '..', '..', 'servers');

    let serverPath: string;
    switch (type) {
      case 'workspace':
        serverPath = path.join(serverDir, 'workspace', 'index.js');
        break;
      case 'notes':
        serverPath = path.join(serverDir, 'notes', 'index.js');
        break;
      case 'git':
        serverPath = path.join(serverDir, 'git', 'index.js');
        break;
      default:
        throw new Error(`Unknown server type: ${type}`);
    }

    // In packaged app, files in asarUnpack are placed in app.asar.unpacked.
    // Node cannot execute scripts directly from inside the asar archive.
    if (app.isPackaged) {
      const unpackedPath = serverPath.replace('app.asar', 'app.asar.unpacked');

      logger.info('Server path resolution (packaged)', {
        isPackaged: true,
        serverPath,
        unpackedPath,
        unpackedPathExists: fs.existsSync(unpackedPath),
      });

      if (fs.existsSync(unpackedPath)) {
        return unpackedPath;
      }

      // Fallback to original path if unpacked doesn't exist
      logger.warn('Unpacked server path not found, falling back to original', {
        unpackedPath,
        serverPath,
      });
    }

    return serverPath;
  }

  /**
   * Get server arguments
   */
  private getServerArgs(config: McpServerConfig): string[] {
    const args: string[] = [];

    if (config.workspaceId) {
      args.push('--workspace-id', config.workspaceId);
    }

    if (config.workspacePath) {
      args.push('--workspace-path', config.workspacePath);
    }

    if (config.metadataPath) {
      args.push('--metadata-path', config.metadataPath);
    }

    return args;
  }

  /**
   * Get server status
   */
  getServerStatus(): Map<string, any> {
    const status = new Map();

    for (const [id, server] of this.servers) {
      status.set(id, {
        id,
        type: server.config.type,
        workspaceId: server.config.workspaceId,
        isHealthy: server.isHealthy,
        restartCount: server.restartCount,
        pendingRequests: server.requestQueue.size,
      });
    }

    return status;
  }
}
