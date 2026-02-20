/**
 * Base MCP Server
 *
 * Base class for MCP server processes.
 * Handles IPC communication with the hub.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '$shared/logger';

export interface ServerConfig {
  id: string;
  type: string;
  workspaceId?: string;
  workspacePath?: string;
  metadataPath?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export abstract class BaseMcpServer extends EventEmitter {
  protected config: ServerConfig;
  protected tools: Map<string, ToolDefinition> = new Map();
  private isReady: boolean = false;
  protected logger: Logger;

  constructor() {
    super();

    // Parse config from environment
    this.config = {
      id: process.env.MCP_SERVER_ID || '',
      type: process.env.MCP_SERVER_TYPE || '',
      workspaceId: process.env.MCP_WORKSPACE_ID,
      workspacePath: process.env.MCP_WORKSPACE_PATH,
      metadataPath: process.env.MCP_METADATA_PATH,
    };

    this.logger = new Logger(`MCP-${this.config.type}`);

    // Setup IPC handlers
    this.setupIpcHandlers();

    // Initialize server
    this.initialize()
      .then(() => {
        this.isReady = true;
        this.logger.debug('Server ready');
      })
      .catch((error) => {
        this.logger.error('Failed to initialize', error as Error);
        process.exit(1);
      });
  }

  /**
   * Initialize the server (override in subclasses)
   */
  protected abstract initialize(): Promise<void>;

  /**
   * Register a tool
   */
  protected registerTool(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
    this.logger.debug('Registered tool', { toolName: definition.name });
  }

  /**
   * Handle a tool call (override in subclasses)
   */
  protected abstract handleToolCall(toolName: string, params: any): Promise<any>;

  /**
   * Setup IPC message handlers
   */
  private setupIpcHandlers(): void {
    if (!process.send) {
      this.logger.error('No IPC channel available', new Error('IPC not available'));
      process.exit(1);
    }

    process.on('message', async (message: any) => {
      try {
        const response = await this.handleMessage(message);
        if (response && process.send) {
          process.send(response);
        }
      } catch (error) {
        this.logger.error('Error handling message', error as Error);

        if (message.id && process.send) {
          process.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: (error as Error).message,
            },
          });
        }
      }
    });

    // Handle shutdown signals
    process.on('SIGTERM', () => {
      this.logger.debug('Received SIGTERM, shutting down');
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.logger.debug('Received SIGINT, shutting down');
      this.shutdown();
    });
  }

  /**
   * Handle an incoming message
   */
  private async handleMessage(message: any): Promise<any> {
    if (!message.method) {
      return null;
    }

    switch (message.method) {
      case 'ping':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: 'pong',
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: Array.from(this.tools.values()),
        };

      case 'tools/call':
        if (!this.isReady) {
          throw new Error('Server not ready');
        }

        const { name, arguments: args } = message.params;
        const result = await this.handleToolCall(name, args);

        return {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };

      default:
        throw new Error(`Unknown method: ${message.method}`);
    }
  }

  /**
   * Emit an event to the hub
   */
  protected emitEvent(event: any): void {
    if (process.send) {
      process.send({
        type: 'event',
        event,
      });
    }
  }

  /**
   * Shutdown the server
   */
  protected shutdown(): void {
    this.logger.debug('Shutting down');
    process.exit(0);
  }

  /**
   * Log a message
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    switch (level) {
      case 'info':
        this.logger.info(message, ...args);
        break;
      case 'warn':
        this.logger.warn(message, ...args);
        break;
      case 'error':
        this.logger.error(message, undefined, { args });
        break;
    }
  }
}
