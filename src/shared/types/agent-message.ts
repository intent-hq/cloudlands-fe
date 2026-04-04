/**
 * Unified AgentMessage Type Definition
 *
 * Single source of truth for all agent message types across the application.
 * Consolidates definitions from:
 * - src/shared/types.ts (main definition)
 * - src/lib/types/agent.ts (legacy)
 * - src/features/agent/agent-types.ts (provider version)
 * - src/features/agent/agent-providers/base-provider.ts (provider variant)
 *
 * Supports both core messages (with full metadata) and provider messages (simplified).
 */

import type { ContentBlock } from './content-block';
import type { AgentId } from './branded-ids';

/**
 * Message role type
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'error';

/**
 * Tool call information
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  result?: any;
  error?: string;
  timestamp?: string;

  // Optional fields for backward compatibility and extended tracking
  toolName?: string; // Alias for name
  parameters?: any; // Alias for arguments
  status?: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
}

/**
 * Tool result information
 */
export interface ToolResult {
  toolCallId: string;
  content: any;
  isError?: boolean;
  timestamp?: string;
}

/**
 * Message metadata containing operational information
 */
export interface MessageMetadata {
  // Model information
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  duration_ms?: number;
  total_cost_usd?: number;

  // Streaming metadata
  chunksReceived?: number;
  firstChunkTime?: number;
  lastChunkTime?: number;

  // Error recovery
  isError?: boolean;
  errorCode?: string;
  recoverable?: boolean;
  recovered?: boolean;
  recoveredAt?: string;
  originalMessageId?: string;

  // Message state
  isInitialMessage?: boolean;
  streamComplete?: boolean;
  action?: string;
  interrupted?: boolean;

  // Merging
  merged?: boolean;
  mergedCount?: number;

  // Streaming
  stopReason?: string;
  sessionId?: string;
  frontendSessionId?: string;
  streamId?: string;
  auggieSessionId?: string; // Raw auggie session ID (UUID format without prefix)

  // Context
  contextReferences?: any[];

  // Allow additional properties
  [key: string]: any;
}

/**
 * Core AgentMessage type - comprehensive message with all fields
 * Used throughout the application for message handling
 */
export interface AgentMessage {
  // Identifiers
  id: string;
  agentId?: AgentId;

  // Core content
  role: MessageRole;
  contentBlocks?: ContentBlock[];

  // Timing
  timestamp: string | Date;
  turnNumber?: number;

  // Tool interactions
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];

  // Error handling
  error?: string;
  errorCode?: string;

  // Streaming state
  isStreaming?: boolean;
  streamingComplete?: boolean;

  // Metadata
  metadata?: MessageMetadata;
}

/**
 * Simplified provider message type
 * Used for provider communication (no id, no timestamp)
 */
export interface ProviderMessage {
  role: MessageRole;
  contentBlocks?: ContentBlock[];
  toolCalls?: ToolCall[];
  metadata?: Record<string, any>;
}
