// Import EventEmitter - Node's for backend, browser version for frontend
// The build process should handle this correctly
import { EventEmitter } from 'events';
import { Logger } from '../../../../shared/logger';
import type { AgentSession, ProviderMessage, ToolCall } from '../../../../shared/types';

const logger = new Logger('BaseProvider');

// Re-export unified types
export type { ProviderMessage as AgentMessage, ToolCall } from '../../../../shared/types';

// Type alias for convenience in this file
type AgentMessage = ProviderMessage;

export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, any>;
}

export interface StreamOptions {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onComplete?: (message: AgentMessage) => void;
  onError?: (error: Error) => void;
  onChunk?: (chunk: any) => void;
  onContentBlocks?: (blocks: any[]) => void;
  frontendSessionId?: string; // Frontend's session ID for streaming
}

export interface AgentConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: Tool[];
  env?: Record<string, any>;

  // ACP-specific configuration
  id?: string;
  name?: string;
  workspaceId?: string;
  workspacePath?: string; // Path to the git worktree
  metadataPath?: string; // Path to workspace metadata directory (~/intent/{id}/.workspace)
  isRemote?: boolean; // Whether this is a remote workspace
  environmentConfig?: {
    // Remote environment configuration
    type: 'local' | 'remote';
    ssh?: {
      host: string;
      port?: number;
      user: string;
      password?: string;
      key_path?: string;
      use_agent?: boolean;
      transport?: 'ssh' | 'websocket';
      ws_url?: string;
    };
    workspace_path?: string;
  };
  acpConnection?: {
    type: 'stdio' | 'websocket' | 'tcp';
    command?: string;
    args?: string[];
    url?: string;
    host?: string;
    port?: number;
  };
  acpMode?: 'default' | 'readonly' | 'ask';
  acpPermissions?: {
    allowedTools?: string[];
    deniedTools?: string[];
    requireConfirmation?: string[];
    fileAccess?: {
      allowedPaths?: string[];
      deniedPaths?: string[];
      maxFileSize?: number;
    };
  };

  /**
   * If true, this is a simple background request that should:
   * - Use only the raw system prompt (no workspace context, tools info, etc.)
   * - Skip MCP server configuration
   * - Skip all extra context building
   */
  simpleRequest?: boolean;

  /**
   * Persisted backend/auggie session ID. Used to resume ACP sessions across
   * Intent restarts via session/load. Populated from AgentSession.backendSessionId
   * when creating a provider for an existing agent.
   */
  backendSessionId?: string;

  /**
   * ACP session UUID from the provider's session:created event.
   * Preferred over backendSessionId for session/load since it is never
   * overwritten by internal routing.
   */
  acpSessionId?: string;

  [key: string]: any; // Allow provider-specific config
}

// Use the shared AgentSession type from shared/types.ts
export type { AgentSession } from '../../../../shared/types';

/**
 * Base class for all AI agent providers
 */
export abstract class BaseAgentProvider extends EventEmitter {
  protected config: AgentConfig;
  protected tools: Map<string, Tool> = new Map();

  constructor(config: AgentConfig) {
    super();
    this.config = config;

    // Register tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }

  /**
   * Send a message to the agent and get a response
   */
  abstract sendMessage(messages: AgentMessage[], options?: StreamOptions): Promise<AgentMessage>;

  /**
   * Stream a response from the agent
   */
  abstract streamMessage(messages: AgentMessage[], options: StreamOptions): Promise<void>;

  /**
   * Check if the provider is available/configured
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get provider information
   */
  abstract getInfo(): {
    name: string;
    models: string[];
    capabilities: string[];
  };

  /**
   * Execute a tool call
   */
  protected async executeTool(toolCall: ToolCall): Promise<any> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      throw new Error(`Tool ${toolCall.name} not found`);
    }

    try {
      const result = await tool.execute(toolCall.arguments);
      toolCall.result = result;
      return result;
    } catch (error) {
      toolCall.result = { error: (error as Error).message };
      throw error;
    }
  }

  /**
   * Format messages for the provider's API
   */
  protected abstract formatMessages(messages: AgentMessage[]): any;

  /**
   * Parse response from the provider's API
   */
  protected abstract parseResponse(response: any): AgentMessage;

  /**
   * Get available models for this provider
   */
  abstract getAvailableModels(): Promise<string[]>;

  /**
   * Validate configuration
   */
  validateConfig(): boolean {
    if (!this.config.provider) {
      throw new Error('Provider is required');
    }

    // Provider-specific validation
    return this.validateProviderConfig();
  }

  /**
   * Provider-specific configuration validation
   */
  protected abstract validateProviderConfig(): boolean;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };

    // Re-register tools if updated
    if (config.tools) {
      this.tools.clear();
      for (const tool of config.tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Add a tool
   */
  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get all tools
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get the current session ID (if applicable)
   * Used to synchronize session state after loading from disk
   */
  getSessionId(): string | undefined {
    // Default implementation - providers that don't use sessions return undefined
    return undefined;
  }

  /**
   * Create a system prompt with tool descriptions
   */
  protected createSystemPrompt(): string {
    let prompt = this.config.systemPrompt || 'You are a helpful AI assistant.';

    if (this.tools.size > 0) {
      prompt += '\n\nYou have access to the following tools:\n';
      for (const tool of this.tools.values()) {
        prompt += `\n- ${tool.name}: ${tool.description}`;
        if (tool.parameters) {
          prompt += `\n  Parameters: ${JSON.stringify(tool.parameters, null, 2)}`;
        }
      }
      prompt += '\n\nTo use a tool, respond with a JSON object in the format:\n';
      prompt += '{"tool": "tool_name", "arguments": {...}}';
    }

    return prompt;
  }

  /**
   * Handle streaming response
   */
  protected handleStream(stream: any, options: StreamOptions): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      let fullContent = '';
      const toolCalls: ToolCall[] = [];

      stream.on('data', (chunk: any) => {
        try {
          const token = this.extractToken(chunk);
          if (token) {
            fullContent += token;
            if (options.onToken) {
              options.onToken(token);
            }
          }

          // Check for tool calls
          const toolCall = this.extractToolCall(chunk);
          if (toolCall) {
            toolCalls.push(toolCall);
            if (options.onToolCall) {
              options.onToolCall(toolCall);
            }
          }
        } catch (error) {
          logger.error('Error processing stream chunk:', error as Error);
        }
      });

      stream.on('end', () => {
        // Note: AgentMessage here is aliased to ProviderMessage which doesn't have id/timestamp
        // The caller is responsible for adding those fields when needed
        const message: AgentMessage = {
          role: 'assistant',
          contentBlocks: fullContent ? [{ type: 'text' as const, text: fullContent }] : [],
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };

        if (options.onComplete) {
          options.onComplete(message);
        }

        resolve(message);
      });

      stream.on('error', (error: Error) => {
        if (options.onError) {
          options.onError(error);
        }
        reject(error);
      });
    });
  }

  /**
   * Extract token from stream chunk (provider-specific)
   */
  protected abstract extractToken(chunk: any): string | null;

  /**
   * Extract tool call from stream chunk (provider-specific)
   */
  protected abstract extractToolCall(chunk: any): ToolCall | null;

  /**
   * Check if the provider's underlying process/connection is healthy.
   * Override in providers that manage a child process or remote connection.
   * Returns true by default (stateless providers are always "healthy").
   */
  isHealthy(): boolean {
    return true;
  }

  /**
   * Whether the last protocol initialization used session/load to restore
   * an existing session. When true, the agent already has conversation
   * context and a full history resend is unnecessary.
   * Override in providers that support session/load (e.g., AcpProvider).
   */
  didUseSessionLoad(): boolean {
    return false;
  }

  /**
   * Stop/interrupt the current execution
   * Override in providers that support interruption
   */
  async stop(): Promise<void> {
    // Default implementation does nothing
    // Providers that support interruption should override this
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.removeAllListeners();
    this.tools.clear();
  }
}
