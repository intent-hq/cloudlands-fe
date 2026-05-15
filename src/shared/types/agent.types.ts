/**
 * Agent System Type Definitions
 *
 * Comprehensive type definitions for the agent system.
 * These types ensure type safety across all agent-related operations.
 */

// Import consolidated types from main types.ts to avoid duplication
// These are the single source of truth for these types
import type {
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolCall,
  AgentMessage,
  ProviderMessage,
  MessageRole,
  ToolResult,
  MessageMetadata,
  AgentMetadata,
} from '../types';

// Import ContentBlock utilities
import {
  isContentBlock,
  normalizeContentBlock,
} from './content-block';
import type {
  isTextBlock,
  isCodeBlock,
  isToolUseBlock,
  isToolResultBlock,
  isThinkingBlock,
  isImageBlock,
  isAudioBlock,
  hasTextContent,
  getTextContent,
  isErrorBlock,
  isToolBlock,
  isMediaBlock,
} from './content-block.guards';
import {
  migrateFromLegacy,
  convertFromACP,
  convertToACP,
  migrateContentBlocks,
} from './content-block.migration';

// Re-export them for convenience
export type {
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolCall,
  AgentMessage,
  ProviderMessage,
  MessageRole,
  ToolResult,
  MessageMetadata,
  AgentMetadata,
};

// Re-export ContentBlock utilities
export {
  isContentBlock,
  normalizeContentBlock,
  isTextBlock,
  isCodeBlock,
  isToolUseBlock,
  isToolResultBlock,
  isThinkingBlock,
  isImageBlock,
  isAudioBlock,
  hasTextContent,
  getTextContent,
  isErrorBlock,
  isToolBlock,
  isMediaBlock,
  migrateFromLegacy,
  convertFromACP,
  convertToACP,
  migrateContentBlocks,
};

// Agent Status enum for use in code
export enum AgentStatus {
  // Current values
  Pending = 'pending',
  Active = 'active',
  Error = 'error',
  Deleted = 'deleted',
  // Legacy values for backward compatibility
  Idle = 'Idle',
  Waiting = 'Waiting',
  Completed = 'Completed',
  Processing = 'Processing',
}

// ModelId is intentionally `string` because models can be user-provided/custom.
// Common model IDs include: 'sonnet4.5', 'opus4.5', 'haiku4.5', 'gemini25-pro', etc.
// See MODEL_IDS in constants/agent-services.ts for the full list.
export type ModelId = string;
export type AgentProvider = 'augment'; // Only ACP for now
export type StreamEventType = 'chunk' | 'complete' | 'error' | 'tool_call' | 'content_block';

/**
 * Core agent configuration
 */
export interface AgentConfig {
  id: string;
  name: string;
  model: ModelId;
  systemPrompt?: string;
  workspaceId: string;
  provider: AgentProvider;
  status: AgentStatus;
  metadata?: AgentMetadata;
  createdAt: string;
  updatedAt: string;
}

// AgentMetadata is defined in types.ts to avoid circular dependency

/**
 * Context reference for agent
 *
 * @deprecated Use ContextReference from '$features/agent/agent-context' instead.
 * This is a subset of the full interface. The canonical definition is in agent-context.ts
 * which supports additional types like 'spec', 'code_chunk' and has richer metadata.
 */
export interface ContextReference {
  type: 'file' | 'selection' | 'task' | 'note';
  filePath?: string;
  selectedText?: string;
  taskText?: string;
  codeChunk?: string;
  lineNumber?: number;
  surroundingContext?: string;
  taskPosition?: number;
  taskChecked?: boolean;
  noteId?: string;
}

// AgentMessage, MessageMetadata, ToolCall, and related types are now consolidated in types.ts and re-exported above

/**
 * Stream event for real-time updates
 */
export interface StreamEvent {
  type: StreamEventType;
  data: string | ContentBlock | ToolCall | Error;
  timestamp: number;
  sessionId: string;
  agentId: string;
}

/**
 * Valid agent type identifiers
 * These correspond to instruction files in src/features/agent/instructions/
 *
 * This is a string literal union type that provides compile-time validation
 * and IDE autocomplete for agent type IDs.
 */
export type AgentTypeId =
  | 'chat'
  | 'code-walkthrough'
  | 'common'
  | 'debug'
  | 'workspace'
  | 'setup-script-generator'
  | 'task-breakdown'
  | 'task-debug'
  | 'task-focused'
  | 'task-loop'
  | 'ralph-loop'
  | 'workspace-agent'
  | 'code-review'
  | 'commit-message'
  | 'pr-description';

/**
 * All valid agent type IDs as an array for runtime validation
 */
export const AGENT_TYPE_IDS: readonly AgentTypeId[] = [
  'chat',
  'code-walkthrough',
  'common',
  'debug',
  'workspace',
  'setup-script-generator',
  'task-breakdown',
  'task-debug',
  'task-focused',
  'task-loop',
  'ralph-loop',
  'workspace-agent',
  'code-review',
  'commit-message',
  'pr-description',
] as const;

/**
 * Check if a string is a valid AgentTypeId
 */
export function isValidAgentTypeId(id: string): id is AgentTypeId {
  return AGENT_TYPE_IDS.includes(id as AgentTypeId);
}

/**
 * Create a typed AgentTypeId from a string literal
 * This provides compile-time validation of agent type IDs
 *
 * @param id - Must be one of the valid agent type IDs
 * @returns The same ID, typed as AgentTypeId
 *
 * @example
 * const agentType = createAgentTypeId('commit-message'); // ✅ Valid
 * const invalid = createAgentTypeId('invalid-type'); // ❌ Compile error
 */
export function createAgentTypeId(id: AgentTypeId): AgentTypeId {
  return id;
}

/**
 * Parse a string as an AgentTypeId with runtime validation
 * Use this when you have a dynamic string that needs to be validated
 *
 * @param id - A string that should be a valid agent type ID
 * @returns The AgentTypeId if valid, or undefined if invalid
 *
 * @example
 * const agentType = parseAgentTypeId(someString);
 * if (agentType) {
 *   // agentType is AgentTypeId
 * }
 */
export function parseAgentTypeId(id: string): AgentTypeId | undefined {
  return isValidAgentTypeId(id) ? id : undefined;
}

/**
 * Assert a string as an AgentTypeId (throws if invalid)
 * Use this when you're confident the string is valid
 *
 * @param id - A string that should be a valid agent type ID
 * @returns The AgentTypeId
 * @throws Error if the string is not a valid agent type ID
 */
export function assertAgentTypeId(id: string): AgentTypeId {
  if (!isValidAgentTypeId(id)) {
    throw new Error(`Invalid agent type ID: ${id}. Valid types: ${AGENT_TYPE_IDS.join(', ')}`);
  }
  return id;
}

/**
 * Options for creating an agent
 *
 * IMPORTANT: Use agentType (branded AgentTypeId) to let the backend build the system prompt
 * from InstructionService.
 *
 * DO NOT pass systemPrompt - it is DEPRECATED and ignored.
 * The backend builds the complete system prompt from agentType.
 */
export interface CreateAgentOptions {
  id?: string;
  agentId?: string; // Optional pre-generated ID (alias for id)
  name?: string; // Made optional to support legacy code paths
  model?: ModelId;
  runtimeContext?: string; // Runtime context (e.g., selected text, file content, task details)
  initialMessage?: string;
  metadata?: AgentMetadata;
  agentType?: AgentTypeId; // Use createAgentTypeId() to create - backend builds system prompt from this
  isBackground?: boolean; // Create as background agent
  triggerType?: string; // Type of trigger for background agents
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  modelId?: ModelId;
  contextReferences?: ContextReference[];
  stream?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Recovery state for crash recovery
 */
export interface RecoveryState {
  agentId: string;
  lastMessage: string;
  lastMessageId: string;
  timestamp: number;
  turnNumber: number;
  isStreaming: boolean;
  partialContent?: string;
}

/**
 * Agent list item for UI
 */
export interface AgentListItem {
  id: string;
  name: string;
  status: AgentStatus;
  lastMessage?: string;
  lastActivity?: string;
  messageCount: number;
  isStreaming?: boolean;
  metadata?: AgentMetadata;
}

/**
 * Streaming handler configuration
 */
export interface StreamHandlerConfig {
  batchInterval?: number; // ms
  maxBatchSize?: number;
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

// Workspace type is imported from main types.ts file
// to avoid duplication and conflicts

// Re-export AgentSession for backward compatibility
export type { AgentSession } from './agent-session';

// Import branded ID types needed by UnifiedAgentConfig / CreateAgentResult
import type { AgentId, WorkspaceId as BrandedWorkspaceId } from './branded-ids';
import type { AgentSession } from './agent-session';

/**
 * Unified agent creation configuration.
 *
 * Moved here from `agent-factory.ts` so that both renderer and main-process
 * code can reference the type without pulling in renderer-only modules.
 *
 * The backend builds the complete system prompt from agentType via InstructionService.
 *
 * Agent naming follows the VS Code webview pattern:
 * - If `name` is provided, it's used (with sanitization)
 * - If `name` is empty but `initialMessage` is present, name is derived from the message
 * - Otherwise, a default name is generated based on workspace title
 */
export interface UnifiedAgentConfig {
  // Required
  workspaceId: BrandedWorkspaceId;

  // Optional - name is derived from initialMessage if not provided
  name?: string;

  // Optional
  id?: string; // Allow passing in a pre-generated agent ID
  model?: string;
  provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - from activeProviderStore.activeProviderId
  systemPrompt?: string; // System prompt for the agent (built from agentType)
  initialMessage?: string;
  /** Frontend createSession sends the initial prompt after backend creation. */
  skipInitialPrompt?: boolean;
  contextReferences?: any[];
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  metadata?: Record<string, any>;
  messages?: any[]; // For resuming existing sessions with message history

  // Behavior configuration
  behaviorPrompt?: string; // Custom behavior instructions for the agent (from specialist)

  // Background flag — marks automated/background agents (e.g., commit-message, PR-description generators)
  isBackground?: boolean;

  // Workspace context (open panels + linked references)
  workspaceContext?: {
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{
      type: string;
      title: string;
      identifier?: string;
      url?: string;
    }>;
  };

  // Source tracking
  source?:
    | 'workspace-initializer'
    | 'contextual-menu'
    | 'chat-panel'
    | 'api'
    | 'background-agent-trigger'
    | 'workspace-page'
    | 'workspace-sidebar'
    | 'error-console'
    | 'error-notification'
    | 'agent-launch-menu'
    | 'bubble-menu'
    | 'specialist-picker'
    | string; // Allow any string for flexibility
  agentType?: AgentTypeId; // Must be branded type
}

/**
 * Result of agent creation
 * Note: streamId is no longer included - agentId is the canonical key for streams
 */
export interface CreateAgentResult {
  success: boolean;
  agent?: AgentSession;
  error?: string;
  agentId?: AgentId;
  sessionId?: AgentId;
}
