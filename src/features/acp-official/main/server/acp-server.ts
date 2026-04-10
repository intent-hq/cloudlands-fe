/**
 * ACP Server Implementation
 *
 * Implements the server side of the Agent Client Protocol.
 * This server handles incoming JSON-RPC requests from agents and
 * provides the necessary client capabilities (file system, terminal, etc.).
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import type { AgentId } from '$shared/types/branded-ids';
import { JsonRpcErrorCode } from '../../types';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeRequest,
  InitializeResult,
  AuthenticateRequest,
  AuthenticateResult,
  NewSessionRequest,
  NewSessionResult,
  PromptRequest,
  PromptResult,
  LoadSessionRequest,
  LoadSessionResult,
  SetModeRequest,
  CancelNotification,
  SessionUpdateNotification,
  RequestPermissionRequest,
  RequestPermissionResult,
  ReadTextFileRequest,
  ReadTextFileResult,
  WriteTextFileRequest,
  WriteTextFileResult,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalOutputRequest,
  TerminalOutputResult,
  TerminalWaitForExitRequest,
  TerminalWaitForExitResult,
  ClientInfo,
  AgentInfo,
  SessionUpdateParams,
} from '../../types';
import { SessionManager } from './session-manager';
import { FileSystemHandler } from './handlers/file-system';
import { TerminalHandler } from './handlers/terminal';
import { Logger } from '../../../../shared/logger';
import { permissionManager } from '../../permissions/permission-manager';
import { planManager } from '../../plans/plan-manager';

const logger = new Logger('ACPServer');

export interface ACPServerConfig {
  clientInfo: ClientInfo;
  workspacePath: string;
  workspaceId: string;
  scope?: string; // Optional relative path within workspacePath (e.g., "apps/web")
  capabilities?: {
    fileSystem?: boolean;
    terminal?: boolean;
    permissions?: boolean;
  };
}

export class ACPServer extends EventEmitter {
  private sessionManager: SessionManager;
  private fileSystemHandler: FileSystemHandler;
  private terminalHandler: TerminalHandler;
  private _initialized = false;
  private _agentInfo?: AgentInfo;
  private config: ACPServerConfig;

  constructor(config: ACPServerConfig) {
    super();
    this.config = config;
    this.sessionManager = new SessionManager();
    this.fileSystemHandler = new FileSystemHandler(config.workspacePath, config.scope);
    this.terminalHandler = new TerminalHandler(config.workspacePath, config.scope);
  }

  /**
   * Handle incoming JSON-RPC message
   */
  async handleMessage(message: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(message);

      // Check if it's a notification (no id field)
      if (!('id' in parsed)) {
        await this.handleNotification(parsed as JsonRpcNotification);
        return null; // Notifications don't get responses
      }

      // It's a request
      const request = parsed as JsonRpcRequest;
      const response = await this.handleRequest(request);
      return JSON.stringify(response);
    } catch (error) {
      logger.error('Failed to handle message', error as Error);

      // If we can't parse the message, return a parse error
      const errorResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.ParseError,
          message: 'Parse error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: null as any,
      };
      return JSON.stringify(errorResponse);
    }
  }

  /**
   * Handle JSON-RPC request
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      // Route to appropriate handler based on method
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request as InitializeRequest);

        case 'authenticate':
          return this.handleAuthenticate(request as AuthenticateRequest);

        case 'session/new':
          return this.handleNewSession(request as NewSessionRequest);

        case 'session/prompt':
          return this.handlePrompt(request as PromptRequest);

        case 'session/load':
          return this.handleLoadSession(request as LoadSessionRequest);

        case 'session/set_mode':
          return this.handleSetMode(request as SetModeRequest);

        case 'session/request_permission':
          return this.handleRequestPermission(request as RequestPermissionRequest);

        case 'fs/read_text_file':
          return this.handleReadTextFile(request as ReadTextFileRequest);

        case 'fs/write_text_file':
          return this.handleWriteTextFile(request as WriteTextFileRequest);

        case 'terminal/create':
          return this.handleTerminalCreate(request as TerminalCreateRequest);

        case 'terminal/output':
          return this.handleTerminalOutput(request as TerminalOutputRequest);

        case 'terminal/wait_for_exit':
          return this.handleTerminalWaitForExit(request as TerminalWaitForExitRequest);

        default:
          return {
            jsonrpc: '2.0',
            error: {
              code: JsonRpcErrorCode.MethodNotFound,
              message: `Method not found: ${request.method}`,
            },
            id: request.id,
          };
      }
    } catch (error) {
      logger.error(`Error handling request ${request.method}`, error as Error);
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.InternalError,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  /**
   * Handle JSON-RPC notification
   */
  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    try {
      switch (notification.method) {
        case 'session/cancel':
          await this.handleCancel(notification as CancelNotification);
          break;

        case 'session/update':
          // This is sent BY agents, not TO them
          // NORMALIZE: Auggie sends 'update' but ACP spec says 'sessionUpdate' - normalize to 'sessionUpdate' here
          // so all downstream code can use the spec-compliant property name
          const rawUpdateParams = (notification as SessionUpdateNotification).params as any;
          const normalizedUpdateParams: SessionUpdateParams = {
            ...rawUpdateParams,
            sessionUpdate: rawUpdateParams.update || rawUpdateParams.sessionUpdate,
          };
          // Remove the non-standard 'update' property after normalization
          delete (normalizedUpdateParams as any).update;

          this.emit('session:update', normalizedUpdateParams);

          // Handle plan updates
          if (
            normalizedUpdateParams.sessionUpdate &&
            'sessionUpdate' in normalizedUpdateParams.sessionUpdate
          ) {
            const sessionUpdate = normalizedUpdateParams.sessionUpdate as any;
            if (sessionUpdate.sessionUpdate === 'plan' && sessionUpdate.entries) {
              planManager.updatePlan(normalizedUpdateParams.sessionId, sessionUpdate.entries);
            }
          }
          break;

        default:
          logger.warn(`Unknown notification method: ${notification.method}`);
      }
    } catch (error) {
      logger.error(`Error handling notification ${notification.method}`, error as Error);
    }
  }

  // ============================================================================
  // Method Handlers
  // ============================================================================

  private async handleInitialize(request: InitializeRequest): Promise<JsonRpcResponse> {
    const result: InitializeResult = {
      protocolVersion: 1,
      agentInfo: {
        name: 'Intent',
        version: '1.0.0',
        description: 'ACP server for Intent application',
      },
      promptCapabilities: {
        audio: false,
        embeddedContext: true,
        image: true,
      },
      sessionCapabilities: {
        modes: true,
        models: false,
        slashCommands: false,
      },
    };

    this._initialized = true;
    this._agentInfo = request.params.clientInfo as any; // Store agent info

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handleAuthenticate(request: AuthenticateRequest): Promise<JsonRpcResponse> {
    // For now, we don't require authentication
    const result: AuthenticateResult = {};

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handleNewSession(request: NewSessionRequest): Promise<JsonRpcResponse> {
    const session = this.sessionManager.createSession(request.params.metadata);

    const result: NewSessionResult = {
      sessionId: session.id,
      // Note: modeState is not provided - modes are not supported
    };

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handlePrompt(request: PromptRequest): Promise<JsonRpcResponse> {
    // This would be implemented by forwarding to the actual agent
    // For now, we'll emit an event that can be handled by the integration layer
    this.emit('prompt', request.params);

    const result: PromptResult = {
      stopReason: 'end_turn',
    };

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handleLoadSession(request: LoadSessionRequest): Promise<JsonRpcResponse> {
    const session = this.sessionManager.getSession(request.params.sessionId);

    if (!session) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.SessionNotFound,
          message: 'Session not found',
        },
        id: request.id,
      };
    }

    const result: LoadSessionResult = {
      messages: session.messages,
    };

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handleSetMode(request: SetModeRequest): Promise<JsonRpcResponse> {
    // Modes are not supported - return an error
    return {
      jsonrpc: '2.0',
      error: {
        code: JsonRpcErrorCode.MethodNotFound,
        message: 'Session modes are not supported',
      },
      id: request.id,
    };
  }

  private async handleRequestPermission(
    request: RequestPermissionRequest,
  ): Promise<JsonRpcResponse> {
    const { sessionId, title, description, options } = request.params;

    // Use permission manager to handle the request
    const outcome = await permissionManager.requestPermission(
      sessionId,
      title,
      description,
      options,
      {
        agentName: this.config.clientInfo.name,
      },
    );

    const result: RequestPermissionResult = {
      outcome,
    };

    return {
      jsonrpc: '2.0',
      result,
      id: request.id,
    };
  }

  private async handleReadTextFile(request: ReadTextFileRequest): Promise<JsonRpcResponse> {
    try {
      const content = await this.fileSystemHandler.readTextFile(request.params.path);

      const result: ReadTextFileResult = {
        content,
      };

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.ResourceNotFound,
          message: 'File not found',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private async handleWriteTextFile(request: WriteTextFileRequest): Promise<JsonRpcResponse> {
    try {
      await this.fileSystemHandler.writeTextFile(request.params.path, request.params.content);

      const result: WriteTextFileResult = {};

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.InternalError,
          message: 'Failed to write file',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private async handleTerminalCreate(request: TerminalCreateRequest): Promise<JsonRpcResponse> {
    try {
      const terminalId = await this.terminalHandler.createTerminal(
        request.params.command,
        request.params.args,
        request.params.cwd,
        request.params.env,
      );

      const result: TerminalCreateResult = {
        terminalId,
      };

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.InternalError,
          message: 'Failed to create terminal',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private async handleTerminalOutput(request: TerminalOutputRequest): Promise<JsonRpcResponse> {
    try {
      await this.terminalHandler.writeToTerminal(request.params.terminalId, request.params.data);

      const result: TerminalOutputResult = {};

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.ResourceNotFound,
          message: 'Terminal not found',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private async handleTerminalWaitForExit(
    request: TerminalWaitForExitRequest,
  ): Promise<JsonRpcResponse> {
    try {
      const exitStatus = await this.terminalHandler.waitForExit(request.params.terminalId);

      const result: TerminalWaitForExitResult = {
        exitStatus,
      };

      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: JsonRpcErrorCode.ResourceNotFound,
          message: 'Terminal not found',
          data: error instanceof Error ? error.message : 'Unknown error',
        },
        id: request.id,
      };
    }
  }

  private async handleCancel(notification: CancelNotification): Promise<void> {
    const session = this.sessionManager.getSession(notification.params.sessionId);
    if (session) {
      session.cancelled = true;
      this.emit('session:cancelled', notification.params.sessionId);
    }
  }

  /**
   * Send a session update notification to the agent
   */
  sendSessionUpdate(sessionId: AgentId, update: any): void {
    const notification: SessionUpdateNotification = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        sessionUpdate: update,
      },
    };

    this.emit('send', JSON.stringify(notification));
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.terminalHandler.dispose();
    this.sessionManager.clearAllSessions();
    permissionManager.clearDecisions();
    this.removeAllListeners();
  }
}
