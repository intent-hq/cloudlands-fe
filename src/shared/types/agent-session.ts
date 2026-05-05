/**
 * Unified AgentSession Type Definition
 *
 * This is the canonical definition of AgentSession, consolidating all previous
 * definitions from src/shared/types.ts, src/shared/types/agent.types.ts, and
 * src/lib/types/agent.ts.
 *
 * Key naming convention:
 * - `id`: The agent's unique identifier (AgentId)
 * - `backendSessionId`: The backend/Auggie session ID (AgentId | null)
 *
 * This eliminates confusion between agent ID and session ID.
 */

import type { AgentId, WorkspaceId } from './branded-ids';
import { parseCompoundModelId } from '$shared/config/provider-config';
import type { AgentMessage } from './agent-message';
import { AgentStatus } from './agent.types';
import type { AgentMetadata } from '../types';

/**
 * Context item attached to a message
 * Re-exported here to avoid circular dependencies
 */
export interface QueuedMessageContextItem {
  id: string;
  type: 'selection' | 'file' | 'note' | 'memory' | 'rule' | string;
  label?: string;
  content?: string;
  path?: string;
}

/**
 * A message queued to be sent to an agent.
 * Stored in backend to survive workspace switches.
 */
export interface QueuedMessage {
  /** Unique identifier for this queued message */
  id: string;
  /** Stable app-owned logical ID for the user message created from this queue entry */
  appMessageId?: string;
  /** The message content */
  content: string;
  /** When the message was queued */
  queuedAt: string;
  /** Optional context items attached to the message */
  contextItems?: QueuedMessageContextItem[];
  /** Optional image blocks attached to the message */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  /** Position in queue (0 = next to be sent) */
  position: number;
}

/**
 * Agent activation state machine
 * Tracks the lifecycle of agent activation from pending to active
 */
export enum AgentActivationState {
  PENDING = 'pending',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  ERROR = 'error',
}

/**
 * Canonical AgentSession interface
 *
 * Represents a runtime session for an agent within a workspace.
 * Consolidates all fields from previous definitions.
 *
 * MIGRATION NOTE: The old `sessionId` field has been renamed to `backendSessionId`
 * for clarity. Use `backendSessionId` for new code.
 */
export interface AgentSession {
  // ========== Primary Identifiers ==========
  /** The agent's unique identifier */
  id: AgentId;

  /** Backend/Auggie session ID (null until first message) */
  backendSessionId: AgentId | null;

  /** ACP session UUID from the provider's session:created event.
   *  Written ONLY by the session:created listener — never overwritten by internal routing.
   *  Used to resume sessions via session/load across Intent restarts. */
  acpSessionId?: string;

  /** Workspace this agent belongs to */
  workspaceId: WorkspaceId;

  /** Optional thread ID for conversation threading */
  threadId?: string;

  // ========== Basic Information ==========
  /** Display name for the agent */
  name: string;

  /** Whether the name was explicitly set via setAgentName API */
  nameExplicitlySet?: boolean;

  /** Model identifier (e.g., "sonnet-3.5", "gpt-4") */
  model?: string;

  /** ACP provider ID (e.g., "auggie", "claude-code", "opencode"). Mutable only until first real session use, then locked. */
  provider?: string;

  /** System prompt for the agent */
  systemPrompt?: string;

  // ========== State ==========
  /** Current status of the agent */
  status: AgentStatus;

  /** Activation state (pending/activating/active/error) */
  activationState?: AgentActivationState;

  /** Last activation error if activation failed */
  lastActivationError?: string;

  /** Number of activation attempts */
  activationAttempts?: number;

  /** Messages in this session */
  messages: AgentMessage[];

  /** Whether the agent is currently streaming */
  isStreaming?: boolean;

  /** Whether the agent is processing a request */
  isProcessing?: boolean;

  // ========== Message Queue ==========
  /** Messages queued to be sent when agent finishes current response */
  queuedMessages?: QueuedMessage[];

  // ========== Timestamps ==========
  /** When the session was created */
  createdAt: Date | string;

  /** When the session was last updated */
  updatedAt: Date | string;

  /** When the session last had activity */
  lastActivity?: Date | string;

  /** When the session started (if applicable) */
  startedAt?: Date | string;

  /** When the session ended (if applicable) */
  endedAt?: Date | string;

  // ========== Flags ==========
  /** True if this agent was created with the workspace */
  isInitialAgent?: boolean;

  /** True if this is a background agent */
  isBackground?: boolean;

  /** Current turn number for this session */
  currentTurnNumber?: number;

  // ========== Unread Tracking ==========
  /** Whether the agent has unread messages (new responses since last viewed) */
  hasUnread?: boolean;

  /** When the user last viewed this agent's messages */
  lastViewedAt?: Date | string;

  // ========== UI State ==========
  /** Current user message being composed */
  currentUserMessage?: string;

  /** Last user message sent */
  lastUserMessage?: string;

  /** Last agent response */
  lastAgentResponse?: string;

  /** Whether the agent is currently responding */
  isResponding?: boolean;

  // ========== Metadata & Progress ==========
  /** Session metadata */
  metadata?: AgentMetadata;

  /** Agent metadata (alternative location) */
  agentMetadata?: AgentMetadata;

  /** Agent info */
  agentInfo?: {
    id: AgentId;
    name: string;
    model: string;
    scope?: string | Record<string, any>;
  };

  /** Progress tracking */
  progress?: {
    current?: number;
    total?: number;
    status?: string;
  };

  // ========== Task Delegation ==========
  /**
   * Short digest/summary for display in task status
   * Agents can set this via <agent_digest>...</agent_digest> tags
   * to provide a 1-sentence summary or question for the user
   */
  digest?: string;

  // ========== File Operations ==========
  /** File changes made by this agent */
  fileChanges?: Array<{
    path: string;
    type: 'create' | 'modify' | 'delete';
    timestamp?: Date | string;
  }>;

  // ========== Fork Metadata ==========
  /** ID of parent session if this is a fork */
  parentSessionId?: AgentId;

  /** When this session was forked from parent */
  forkedAt?: string;

  /** Message index at which the fork occurred (number of messages copied) */
  forkPoint?: number;

  /** IDs of sessions forked from this one */
  childSessionIds?: AgentId[];

  /** Additional fork context */
  forkMetadata?: {
    /** Text that was selected when forking */
    selectedText?: string;
    /** Model that was selected for the fork */
    selectedModel?: string;
  };
}

/**
 * Pending agent session (not yet connected to backend)
 *
 * Used when creating an agent before the backend session is established.
 */
export interface PendingAgentSession extends Omit<AgentSession, 'backendSessionId' | 'status'> {
  backendSessionId: null;
  status: 'pending';
  isPending: true;
  agentConfig?: {
    agentId?: string;
    rules?: string;
    prompt?: string;
    model?: string;
  };
}

/**
 * Type guard to check if a session is pending
 */
export function isPendingAgentSession(
  session: AgentSession | PendingAgentSession,
): session is PendingAgentSession {
  return (session as any).isPending === true || (session as any).status === 'pending';
}

/**
 * Resolve the provider for an agent session, with fallback chain.
 * Checks top-level `provider`, then `metadata.provider`, then `config.provider`.
 * Filters out the legacy 'acp' value (protocol name, not a real provider).
 * Falls back to inferring provider from the model ID if available.
 */
export function getAgentProvider(session: AgentSession): string | undefined {
  const explicit =
    session.provider ?? session.metadata?.provider ?? (session as any).config?.provider;

  // 'acp' is the protocol name, not a provider ID -- treat it as unset
  if (explicit && explicit !== 'acp') {
    return explicit;
  }

  // Fallback: infer provider from model ID.
  // parseCompoundModelId handles both compound ('opencode:haiku4.5' -> 'opencode')
  // and bare ('haiku4.5' -> default provider) model IDs.
  if (session.model) {
    return parseCompoundModelId(session.model).providerId;
  }

  return undefined;
}

/**
 * Returns true if the session belongs to the Auggie provider.
 *
 * Used to gate `auggie session stats`-backed features (workspace credit
 * polling, per-agent stats tooltips) since the IPC handler shells out to the
 * `auggie` CLI and only understands Auggie sessions. Sessions whose provider
 * resolves to anything other than `'auggie'` (e.g. claude-code, codex,
 * opencode) must be skipped — including sessions where the provider can't be
 * resolved at all (no provider field and no model to infer from).
 */
export function isAuggieSession(session: AgentSession): boolean {
  return getAgentProvider(session) === 'auggie';
}

/**
 * Returns true once an agent has executed its first prompt/session work.
 *
 * Blank agents may already have backend/runtime setup before the first prompt, so
 * provider/model locking should key off the first real user message instead of
 * backend session IDs or ACP session initialization alone.
 */
export function hasAgentHandledFirstPrompt(session: AgentSession): boolean {
  return session.messages.length > 0;
}
