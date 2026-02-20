/**
 * MCP Server Implementation
 *
 * Handles MCP protocol communication and tool execution
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import {
  MCPRequest,
  MCPResponse,
  MCPNotification,
  Tool,
  ToolCall,
  ToolCallContext,
  createResponse,
  createError,
  createNotification,
} from './protocol';
import { IMCPTool } from './tool';
import { Logger } from '$shared/logger';

export interface MCPServerOptions {
  name: string;
  version: string;
}

export class MCPServer extends EventEmitter {
  private name: string;
  private version: string;
  private tools: Map<string, IMCPTool> = new Map();
  private requestId: number = 0;
  private logger: Logger = new Logger('MCPServer');
  private initializeCount: number = 0; // Track initialize calls for deduped logging

  constructor(options: MCPServerOptions) {
    super();
    this.name = options.name;
    this.version = options.version;
  }

  /**
   * Register a tool with the server
   */
  registerTool(tool: IMCPTool): void {
    const definition = tool.getDefinition();
    this.tools.set(definition.name, tool);
    this.logger.debug(`Registered tool: ${definition.name}`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
    this.logger.debug(`Unregistered tool: ${name}`);
  }

  /**
   * Get all registered tools
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values()).map((tool) => tool.getDefinition());
  }

  // Current tool call context (set by HTTP bridge before handling message)
  private currentContext: ToolCallContext | undefined;

  /**
   * Set the context for the next tool call
   * This should be called by the HTTP bridge before handleMessage
   */
  setToolCallContext(context: ToolCallContext): void {
    this.currentContext = context;
  }

  /**
   * Clear the tool call context
   */
  clearToolCallContext(): void {
    this.currentContext = undefined;
  }

  /**
   * Handle an incoming MCP message
   */
  async handleMessage(message: any): Promise<MCPResponse | MCPNotification | null> {
    // Only log non-initialize/tools-list messages to reduce noise
    // Initialize and tools/list are called frequently by each agent connection
    const isRoutineMessage =
      message?.method === 'initialize' ||
      message?.method === 'tools/list' ||
      message?.method === 'notifications/initialized';

    if (!isRoutineMessage) {
      this.logger.debug('handleMessage called', {
        method: message?.method,
        id: message?.id,
        hasParams: !!message?.params,
      });
    }

    try {
      // Parse message if it's a string
      const msg = typeof message === 'string' ? JSON.parse(message) : message;

      if (msg.method) {
        if (msg.id !== undefined) {
          // Request
          if (!isRoutineMessage) {
            this.logger.debug('Processing request', { method: msg.method });
          }
          const response = await this.handleRequest(msg as MCPRequest);
          if (!isRoutineMessage) {
            this.logger.debug('Request response', {
              id: response?.id,
              hasResult: !!response?.result,
              hasError: !!response?.error,
              error: response?.error,
            });
          }
          return response;
        } else {
          // Notification
          if (!isRoutineMessage) {
            this.logger.debug('Processing notification', { method: msg.method });
          }
          await this.handleNotification(msg as MCPNotification);
          return null;
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Error handling message:', error as Error);
      return null;
    }
  }

  /**
   * Handle an MCP request
   */
  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    this.logger.debug(`Handling request: ${request.method}`);

    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);
        case 'tools/list':
          return this.handleListTools(request);
        case 'tools/call':
          return await this.handleCallTool(request);
        default:
          return createError(request.id, -32601, `Unknown method: ${request.method}`);
      }
    } catch (error) {
      this.logger.error(`Error handling request ${request.method}:`, error as Error);
      return createError(request.id, -32603, (error as Error).message || 'Internal server error');
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(request: MCPRequest): MCPResponse {
    return createResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          // listChanged is false because the HTTP bridge transport cannot push
          // notifications to agents. Agents re-fetch tools/list on each turn,
          // so dynamic tool changes (e.g., PR tools) are picked up automatically.
          listChanged: false,
        },
      },
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    });
  }

  /**
   * Handle list tools request
   */
  private handleListTools(request: MCPRequest): MCPResponse {
    const allTools = this.getTools();

    this.logger.debug('Returning tools list', {
      totalTools: allTools.length,
    });

    return createResponse(request.id, {
      tools: allTools,
      // MCP spec expects nextCursor to be a string or undefined, not null
      // Auggie's validation expects a string, so we'll omit it when there's no pagination
    });
  }

  /**
   * Handle call tool request
   */
  private async handleCallTool(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params || {};

    if (!name) {
      return createError(request.id, -32602, 'Missing tool name');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return createError(request.id, -32602, `Tool not found: ${name}`);
    }

    try {
      const toolCall: ToolCall = {
        name,
        arguments: args || {},
        context: this.currentContext,
      };

      const result = await tool.execute(toolCall);

      // If the tool returned an error, convert it to an MCP error response
      if (result.isError) {
        const errorMessage = result.content
          .filter((item) => item.type === 'text')
          .map((item) => (item as any).text)
          .join('\n');
        return createError(request.id, -32603, errorMessage || 'Tool execution failed');
      }

      // Debug logging for content types being returned
      const contentTypes = result.content.map((item) => item.type);
      const imageCount = result.content.filter((item) => item.type === 'image').length;
      if (imageCount > 0) {
        this.logger.debug('Tool returning image content items', {
          toolName: name,
          contentTypes,
          imageCount,
          totalItems: result.content.length,
        });
      }

      return createResponse(request.id, {
        content: result.content,
        isError: false,
      });
    } catch (error) {
      this.logger.error(`Tool execution error for ${name}:`, error as Error);
      return createError(request.id, -32603, `Tool execution failed: ${(error as Error).message}`);
    }
  }

  /**
   * Handle a notification
   */
  private async handleNotification(notification: MCPNotification): Promise<void> {
    this.logger.debug(`Handling notification: ${notification.method}`);

    switch (notification.method) {
      case 'notifications/initialized':
        this.emit('initialized');
        break;
      default:
        this.logger.debug(`Unknown notification: ${notification.method}`);
    }
  }

  /**
   * Send a notification to the client
   */
  sendNotification(method: string, params?: Record<string, any>): void {
    const notification = createNotification(method, params);
    this.emit('notification', notification);
  }

  /**
   * Notify that the tool list has changed due to mode change.
   *
   * Note: The current HTTP-based MCP bridge architecture doesn't support pushing
   * notifications to the agent. However, this is logged for debugging and could
   * be wired up in the future with SSE or WebSocket.
   *
   * In practice, tool access is enforced at two levels:
   * 1. tools/list filtering - agent only sees allowed tools
   * 2. tools/call blocking - blocked even if agent somehow calls a restricted tool
   */
  notifyToolsListChanged(): void {
    this.logger.info('Tool list changed (notification logged, not pushed to agent)', {
      note: 'Agent will get filtered list on next tools/list call',
    });
    // Emit for any local listeners (even though HTTP bridge cannot push to agent)
    this.sendNotification('notifications/tools/list_changed', {});
  }

  /**
   * Generate a unique request ID
   */
  generateRequestId(): number {
    return ++this.requestId;
  }
}
