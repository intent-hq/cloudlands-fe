/**
 * Agent Types
 *
 * Shared type definitions for agent-related functionality.
 * These types are safe to use in both browser and Node.js environments.
 */

// Import shared types for use in this file

/**
 * Tool definition for agent capabilities
 */
interface Tool {
  /** Unique name identifier for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema or parameter definitions for the tool */
  parameters?: Record<string, unknown>;
  /** Execute the tool with given parameters */
  execute: (params: unknown) => Promise<unknown>;
}

/**
 * Configuration for creating and managing an agent instance.
 * Supports multiple providers with provider-specific options.
 */
export interface AgentConfig {
  /** The provider to use (e.g., 'acp', 'openai', 'anthropic') */
  provider: string;
  /** Model identifier for the provider */
  model?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Base URL for API endpoints */
  baseUrl?: string;
  /** Temperature for response generation (0-1) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** System prompt to set agent behavior */
  systemPrompt?: string;
  /** Available tools the agent can use */
  tools?: Tool[];

  // ACP-specific configuration
  id?: string;
  name?: string;
  workspaceId?: string;
  command?: string;
  args?: string[];
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

  // Allow provider-specific configuration with proper typing
  [key: string]:
    | string
    | number
    | boolean
    | string[]
    | Tool[]
    | undefined
    | {
        type?: 'stdio' | 'websocket' | 'tcp';
        command?: string;
        args?: string[];
        url?: string;
        host?: string;
        port?: number;
      }
    | {
        allowedTools?: string[];
        deniedTools?: string[];
        requireConfirmation?: string[];
        fileAccess?: {
          allowedPaths?: string[];
          deniedPaths?: string[];
          maxFileSize?: number;
        };
      };
}
