/**
 * Agent System Type Definitions
 *
 * Comprehensive type definitions for the agent system.
 * These types ensure type safety across all agent-related operations.
 */

// Agent Status enum for use in code
export enum AgentStatus {
  // Current values
  Pending = 'pending',
  Active = 'active',
  // App-level runtime events (including Chief) can persist lowercase idle;
  // keep it valid so save/load round-trips do not repair or rewrite it.
  RuntimeIdle = 'idle',
  Error = 'error',
  Deleted = 'deleted',
  // Legacy values for backward compatibility
  Idle = 'Idle',
  Waiting = 'Waiting',
  Completed = 'Completed',
  Processing = 'Processing',
}

/**
 * Valid agent type identifiers
 * These correspond to instruction files in src/features/agent/main/instructions/
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
  | 'workspace-agent'
  | 'code-review'
  | 'commit-message'
  | 'pr-description';

/**
 * All valid agent type IDs as an array for runtime validation
 */
const AGENT_TYPE_IDS: readonly AgentTypeId[] = [
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
  'workspace-agent',
  'code-review',
  'commit-message',
  'pr-description',
] as const;

/**
 * Check if a string is a valid AgentTypeId
 */
function isValidAgentTypeId(id: string): id is AgentTypeId {
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

// Workspace type is imported from main types.ts file
// to avoid duplication and conflicts

// Re-export AgentSession for backward compatibility

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

  /**
   * Whether `name` was explicitly chosen by the user. Pass `false` when the
   * caller supplies a generated placeholder name so the daemon keeps the
   * session self-renameable (wire `nameExplicitlySet`, PROTOCOL §5.5).
   * Omitted, the daemon treats any supplied name as explicitly set.
   */
  nameExplicitlySet?: boolean;

  // Optional
  id?: string; // Allow passing in a pre-generated agent ID
  model?: string; // Bare model id (no provider prefix) — see ModelTriple in $shared/types/model-triple
  provider?: string; // Provider ID (e.g., 'auggie', 'claude-code', 'codex') - from activeProviderStore.activeProviderId
  /**
   * Reasoning-effort level for the model (the triple's optional third leg;
   * provider-interpreted string, e.g. "low"/"medium"/"high"). Omitted ⇒ the
   * model's default effort.
   */
  reasoningEffort?: string;
  systemPrompt?: string; // System prompt for the agent (built from agentType)
  initialMessage?: string;
  /**
   * Caller-owned logical app-message id for the initial user message. When the
   * caller stages its own optimistic message before invoking the factory, this
   * keeps the wire send and the staged message on one identity so appMessageId
   * dedup collapses them (duplicate-first-message guard).
   */
  appMessageId?: string;
  /** Frontend createSession sends the initial prompt after backend creation. */
  skipInitialPrompt?: boolean;
  contextReferences?: any[];
  imageBlocks?: Array<{ type: 'image'; data?: string; mimeType?: string; attachmentId?: string }>;
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
