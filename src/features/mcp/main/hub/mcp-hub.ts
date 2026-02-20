/**
 * MCP Hub
 *
 * Central orchestrator for MCP servers. Manages server lifecycle,
 * routes requests, and handles health monitoring.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { ServerManager } from './server-manager';
import { HealthMonitor } from './health-monitor';
import { McpBridge } from '../bridge/mcp-bridge';
import {
  McpEventType,
  createServerLifecycleEvent,
  createToolExecutionEvent,
  type McpEvent,
  type McpActor,
} from '../../types/events';
import { TOOL_SCHEMAS, type ToolName } from '../../types/schemas';
import type { BrowserWindow } from 'electron';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('McpHub');

export interface McpHubOptions {
  maxRetries?: number;
  retryDelay?: number;
  healthCheckInterval?: number;
  requestTimeout?: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'workspace' | 'notes' | 'git' | 'note-comments';
  workspaceId?: string;
  workspacePath?: string;
  metadataPath?: string;
}

export interface McpRequest {
  id: string | number;
  method: string;
  params?: any;
}

export interface McpResponse {
  id: string | number;
  result?: any;
  error?: any;
}

export class McpHub extends EventEmitter {
  private serverManager: ServerManager;
  private healthMonitor: HealthMonitor;
  private bridge: McpBridge;
  private servers: Map<string, McpServerConfig> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private options: Required<McpHubOptions>;
  private requestHandlers: Map<string, (request: McpRequest) => Promise<McpResponse>> = new Map();

  constructor(options: McpHubOptions = {}) {
    super();

    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      healthCheckInterval: options.healthCheckInterval ?? 30000,
      requestTimeout: options.requestTimeout ?? 30000,
    };

    this.serverManager = new ServerManager({
      maxRetries: this.options.maxRetries,
      retryDelay: this.options.retryDelay,
    });

    this.healthMonitor = new HealthMonitor({
      interval: this.options.healthCheckInterval,
    });

    this.bridge = new McpBridge();

    this.setupEventHandlers();
  }

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Setup event handlers for server and health events
   */
  private setupEventHandlers(): void {
    // Forward server lifecycle events
    this.serverManager.on('server:started', (config: McpServerConfig) => {
      const event = createServerLifecycleEvent(
        McpEventType.SERVER_STARTED,
        config.id,
        config.name,
        config.workspaceId,
      );
      this.emitEvent(event);
    });

    this.serverManager.on('server:stopped', (config: McpServerConfig) => {
      const event = createServerLifecycleEvent(
        McpEventType.SERVER_STOPPED,
        config.id,
        config.name,
        config.workspaceId,
      );
      this.emitEvent(event);
    });

    this.serverManager.on('server:error', (config: McpServerConfig, error: Error) => {
      const event = createServerLifecycleEvent(
        McpEventType.SERVER_ERROR,
        config.id,
        config.name,
        config.workspaceId,
        error.message,
      );
      this.emitEvent(event);
    });

    this.serverManager.on('server:restarting', (config: McpServerConfig) => {
      const event = createServerLifecycleEvent(
        McpEventType.SERVER_RESTARTING,
        config.id,
        config.name,
        config.workspaceId,
      );
      this.emitEvent(event);
    });

    // Forward events from servers (including note-comments-updated)
    this.serverManager.on('server:event', (serverId: string, event: any) => {
      logger.info(`[McpHub] Received server:event from ${serverId}:`, {
        type: event?.type,
        hasData: !!event?.data,
      });

      // If it's a note-comments-updated event, forward it to workspace windows
      if (event.type === 'note-comments-updated') {
        logger.info('[McpHub] Processing note-comments-updated event', event);
        const serverConfig = this.servers.get(serverId);
        const workspaceId = serverConfig?.workspaceId || event.data?.workspaceId;
        try {
          sendToWorkspaceWindows(workspaceId, 'note-comments-updated', event.data);
          logger.info('[McpHub] Successfully sent note-comments-updated to workspace windows');
        } catch (error) {
          logger.error('[McpHub] Failed to send note-comments-updated:', error as Error);
        }
      } else {
        // For other events, emit them normally
        this.emitEvent(event);
      }
    });

    // Forward health check failures
    this.healthMonitor.on('health:failed', (serverId: string, error: Error) => {
      const config = this.servers.get(serverId);
      if (config) {
        logger.error(`Health check failed for server ${serverId}:`, error);
        // Trigger restart
        this.serverManager.restartServer(serverId);
      }
    });

    // Forward bridge events (workspace updates, etc.)
    this.bridge.on('event', (event: McpEvent) => {
      this.emitEvent(event);
    });
  }

  /**
   * Start a new MCP server
   */
  async startServer(config: McpServerConfig): Promise<void> {
    try {
      logger.info(`Starting MCP server: ${config.name} (${config.id})`);

      // Store server config
      this.servers.set(config.id, config);

      // Start the server process
      await this.serverManager.startServer(config);

      // Register with health monitor
      this.healthMonitor.registerServer(config.id, async () =>
        this.serverManager.pingServer(config.id),
      );

      // Register request handler for this server's tools
      this.registerServerTools(config);

      logger.info(`MCP server started: ${config.name} (${config.id})`);
    } catch (error) {
      logger.error(
        `Failed to start MCP server ${config.id}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Stop an MCP server
   */
  async stopServer(serverId: string): Promise<void> {
    try {
      logger.info(`Stopping MCP server: ${serverId}`);

      // Unregister from health monitor
      this.healthMonitor.unregisterServer(serverId);

      // Stop the server process
      await this.serverManager.stopServer(serverId);

      // Remove server config
      this.servers.delete(serverId);

      // Unregister request handlers
      this.unregisterServerTools(serverId);

      logger.info(`MCP server stopped: ${serverId}`);
    } catch (error) {
      logger.error(
        `Failed to stop MCP server ${serverId}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Stop all MCP servers
   */
  async stopAllServers(): Promise<void> {
    const serverIds = Array.from(this.servers.keys());
    await Promise.all(serverIds.map((id) => this.stopServer(id)));
  }

  /**
   * Call a tool on the appropriate server
   */
  async callTool(toolName: ToolName, params: any, actor: McpActor): Promise<any> {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    try {
      // Emit tool called event
      const callEvent = createToolExecutionEvent(
        McpEventType.TOOL_CALLED,
        toolName,
        params.workspaceId,
        actor,
        requestId,
      );
      this.emitEvent(callEvent);

      // Validate params against schema
      const schema = TOOL_SCHEMAS[toolName];
      if (schema) {
        const result = schema.safeParse(params);
        if (!result.success) {
          throw new Error(`Invalid params for ${toolName}: ${result.error.message}`);
        }
      }

      // Route to appropriate server based on tool name
      const serverType = this.getServerTypeForTool(toolName);
      const serverId = this.findServerForWorkspace(params.workspaceId, serverType);

      if (!serverId) {
        throw new Error(`No ${serverType} server available for workspace ${params.workspaceId}`);
      }

      // Call the tool through the server
      const response = await this.serverManager.callTool(serverId, toolName, params);

      // Emit tool completed event
      const duration = Date.now() - startTime;
      const completeEvent = createToolExecutionEvent(
        McpEventType.TOOL_COMPLETED,
        toolName,
        params.workspaceId,
        actor,
        requestId,
        duration,
      );
      this.emitEvent(completeEvent);

      return response;
    } catch (error) {
      // Emit tool failed event
      const duration = Date.now() - startTime;
      const failEvent = createToolExecutionEvent(
        McpEventType.TOOL_FAILED,
        toolName,
        params.workspaceId,
        actor,
        requestId,
        duration,
        (error as Error).message,
      );
      this.emitEvent(failEvent);

      throw error;
    }
  }

  /**
   * Get server type for a tool
   */
  private getServerTypeForTool(toolName: string): McpServerConfig['type'] {
    const [prefix] = toolName.split('.');
    switch (prefix) {
      case 'workspace':
        return 'workspace';
      case 'notes':
        return 'notes';
      case 'git':
      case 'fs':
        return 'git';
      default:
        throw new Error(`Unknown tool prefix: ${prefix}`);
    }
  }

  /**
   * Find server for workspace
   */
  private findServerForWorkspace(
    workspaceId: string,
    type: McpServerConfig['type'],
  ): string | null {
    for (const [serverId, config] of this.servers) {
      if (config.workspaceId === workspaceId && config.type === type) {
        return serverId;
      }
    }
    return null;
  }

  /**
   * Register tools for a server
   */
  private registerServerTools(config: McpServerConfig): void {
    // Tool registration handled by server type
    logger.info(`Registered tools for server ${config.id}`);
  }

  /**
   * Unregister tools for a server
   */
  private unregisterServerTools(serverId: string): void {
    // Tool unregistration
    logger.info(`Unregistered tools for server ${serverId}`);
  }

  /**
   * Emit event to renderer
   */
  private emitEvent(event: McpEvent): void {
    this.emit('event', event);

    // Send to workspace windows if event has workspace context, otherwise to mainWindow
    const workspaceId = (event as any).workspaceId;
    if (workspaceId) {
      sendToWorkspaceWindows(workspaceId, 'mcp:event', event);
    } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mcp:event', event);
    }
  }

  /**
   * Get server status
   */
  getServerStatus(): Map<string, any> {
    return this.serverManager.getServerStatus();
  }

  /**
   * Shutdown the hub
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down MCP Hub');

    // Stop health monitoring
    this.healthMonitor.stop();

    // Stop all servers
    await this.stopAllServers();

    // Cleanup
    this.removeAllListeners();

    logger.info('MCP Hub shutdown complete');
  }
}
