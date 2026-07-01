/**
 * Server Manager
 *
 * Thin registration shim over the daemon's `mcp.servers.*` surface
 * (PROTOCOL.md §5.22). The daemon owns the child process lifecycle;
 * this class translates the pre-existing `startServer` / `stopServer`
 * / `restartServer` calls from {@link McpHub} into `mcp.servers.create`
 * / `toggle` / `restart` / `getStatus` / `delete` JSON-RPC round-trips
 * and emits the same `server:started` / `server:stopped` / `server:error`
 * events its callers already listen for.
 */

import { app } from 'electron';
import { EventEmitter } from '$shared/utils/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../../../../shared/logger';
import { getBackendClient } from '../../../backend/main/backend.ipc';
import type { McpServerConfig } from './mcp-hub';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('ServerManager');

interface RegisteredServer {
  config: McpServerConfig;
  serverId: string;
}

export interface ServerManagerOptions {
  maxRetries?: number;
  retryDelay?: number;
  requestTimeout?: number;
}

export class ServerManager extends EventEmitter {
  private servers: Map<string, RegisteredServer> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private options: Required<ServerManagerOptions>;

  constructor(options: ServerManagerOptions = {}) {
    super();

    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      requestTimeout: options.requestTimeout ?? 30000,
    };
  }

  /**
   * Register `config` with the daemon and start it. The daemon owns the child
   * process; this call is idempotent — an existing daemon-side registration
   * for the same id is updated and restarted instead of re-created.
   */
  async startServer(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      throw new Error(`Server ${config.id} is already running`);
    }

    const wireConfig = this.buildWireConfig(config);
    logger.info(
      `Registering daemon-managed MCP server ${config.id}: ${wireConfig.command} ${(wireConfig.args as string[]).join(' ')}`,
    );

    const client = getBackendClient();

    try {
      try {
        await client.request('mcp.servers.create', { config: wireConfig });
      } catch (error) {
        // If a definition with this id already exists in the daemon's persistent
        // secret store (from a prior run), update it with the current command/env
        // so the FE stays authoritative for the bundled binaries.
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) throw error;
        await client.request('mcp.servers.update', {
          serverId: config.id,
          config: wireConfig,
        });
      }

      const toggleResult = (await client.request('mcp.servers.toggle', {
        serverId: config.id,
        enabled: true,
      })) as { status?: { state?: string; lastError?: string } } | undefined;

      const state = toggleResult?.status?.state;
      if (state === 'error') {
        const lastError = toggleResult?.status?.lastError ?? 'unknown error';
        throw new Error(`daemon reported error status: ${lastError}`);
      }

      this.servers.set(config.id, { config, serverId: config.id });
      this.emit('server:started', config);
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to register MCP server ${config.id}:`, wrapped);
      this.emit('server:error', config, wrapped);
      throw wrapped;
    }
  }

  /**
   * Ask the daemon to stop `serverId` and drop the registration from its
   * persistent settings.
   */
  async stopServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    this.servers.delete(serverId);

    const client = getBackendClient();
    try {
      await client.request('mcp.servers.toggle', { serverId, enabled: false });
    } catch (error) {
      logger.warn(`toggle(false) failed for ${serverId}: ${(error as Error).message}`);
    }
    try {
      await client.request('mcp.servers.delete', { serverId });
    } catch (error) {
      // NotFound is fine — the daemon may have never persisted a config for it.
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found/i.test(message)) {
        logger.warn(`delete failed for ${serverId}: ${message}`);
      }
    }

    this.emit('server:stopped', server.config);
  }

  /**
   * Ask the daemon to restart `serverId` (stop-then-start). Emits
   * `server:restarting` for observers and `server:error` when the daemon
   * reports the resulting status as `error`.
   */
  async restartServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    this.emit('server:restarting', server.config);

    try {
      const result = (await getBackendClient().request('mcp.servers.restart', {
        serverId,
      })) as { status?: { state?: string; lastError?: string } } | undefined;
      const state = result?.status?.state;
      if (state === 'error') {
        const lastError = result?.status?.lastError ?? 'unknown error';
        throw new Error(`daemon reported error status: ${lastError}`);
      }
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to restart MCP server ${serverId}:`, wrapped);
      this.emit('server:error', server.config, wrapped);
    }
  }

  /**
   * Not supported — the daemon owns the child and MCP tool calls do not
   * round-trip back through the FE. Kept on the class so existing
   * {@link McpHub} plumbing continues to typecheck; throws so any live caller
   * is exposed rather than silently no-op'd.
   */
  async callTool(serverId: string, _toolName: string, _params: unknown): Promise<never> {
    throw new Error(
      `ServerManager.callTool is not supported: server ${serverId} is daemon-managed. ` +
        `Route MCP tool calls through the daemon's MCP surface, not through the FE.`,
    );
  }

  /**
   * Point-read the daemon-reported status; treat `state === "running"` as
   * healthy. Kept as an async boolean so the {@link HealthMonitor} contract
   * (a `() => Promise<boolean>` check) stays unchanged.
   */
  async pingServer(serverId: string): Promise<boolean> {
    if (!this.servers.has(serverId)) return false;
    try {
      const result = (await getBackendClient().request('mcp.servers.getStatus', {
        serverId,
      })) as { status?: { state?: string } } | undefined;
      return result?.status?.state === 'running';
    } catch (error) {
      logger.debug(`getStatus(${serverId}) failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * A local snapshot of the servers this manager has registered with the
   * daemon. Runtime health is authoritative on the daemon side; consumers
   * that need live per-server state should subscribe to the
   * `mcp.servers:status-changed` event stream (§10).
   */
  getServerStatus(): Map<string, unknown> {
    const status = new Map<string, unknown>();
    for (const [id, server] of this.servers) {
      status.set(id, {
        id,
        type: server.config.type,
        workspaceId: server.config.workspaceId,
        isDaemonManaged: true,
      });
    }
    return status;
  }

  /**
   * Build a PROTOCOL §5.22 `McpServerConfig` from the FE-side hub config:
   * resolve the bundled binary path, mirror the arg/env layout the FE used
   * to spawn locally, and pin `transport: "stdio"` + `enabled: true` so the
   * subsequent `toggle` actually starts it.
   */
  private buildWireConfig(config: McpServerConfig): Record<string, unknown> {
    const serverPath = this.getServerPath(config.type);
    const args: string[] = [serverPath, ...this.getServerArgs(config)];

    // On Windows packaged apps Electron ships without a bare `node` on PATH,
    // so re-use its own binary via ELECTRON_RUN_AS_NODE (matches the previous
    // FE spawn strategy).
    const useElectronAsNode = process.platform === 'win32' && app.isPackaged;
    const command = useElectronAsNode ? process.execPath : 'node';

    const env: Record<string, string> = {
      NODE_ENV: process.env.NODE_ENV || 'production',
      MCP_SERVER_ID: config.id,
      MCP_SERVER_TYPE: config.type,
      MCP_WORKSPACE_ID: config.workspaceId || '',
      MCP_WORKSPACE_PATH: config.workspacePath || '',
      MCP_METADATA_PATH: config.metadataPath || '',
    };
    if (useElectronAsNode) env.ELECTRON_RUN_AS_NODE = '1';

    return {
      id: config.id,
      name: config.name,
      transport: 'stdio',
      command,
      args,
      env,
      enabled: true,
    };
  }

  /**
   * Locate the bundled server script on disk. Preserved from the previous
   * FE-spawn implementation so the daemon runs the exact same binary.
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
      if (fs.existsSync(unpackedPath)) return unpackedPath;
      logger.warn('Unpacked server path not found, falling back to original', {
        unpackedPath,
        serverPath,
      });
    }

    return serverPath;
  }

  /** CLI arg layout the bundled workspace/notes/git binaries expect. */
  private getServerArgs(config: McpServerConfig): string[] {
    const args: string[] = [];
    if (config.workspaceId) args.push('--workspace-id', config.workspaceId);
    if (config.workspacePath) args.push('--workspace-path', config.workspacePath);
    if (config.metadataPath) args.push('--metadata-path', config.metadataPath);
    return args;
  }
}
