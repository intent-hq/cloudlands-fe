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
import { parseCompoundModelId } from '$shared/utils/compound-model-id';
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
  /**
   * Turn-correlation id (PROTOCOL §6.6). Fresh enqueues set `turnId = id`; a
   * terminal-failure requeue mints a new entry `id` but PRESERVES the failed
   * turn's `turnId`. Omitted by older daemons.
   */
  turnId?: string;
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
  /**
   * Optional editing flag (STAB-27). When true, the daemon holds this message
   * and skips it during queue drain. Only included in responses when true.
   */
  editing?: boolean;
  /**
   * Optional terminal-failure requeue marker (STAB-112). When true, this message
   * was requeued after a terminal provider failure and should be visually distinguished
   * from normal queued messages (e.g., "failed — will retry" indicator). Backward-compatible:
   * field is only present when true.
   */
  requeuedAfterFailure?: boolean;
  /**
   * Optional opaque metadata attached by the daemon and echoed on read.
   * System event wakes carry `{ type: 'event_notification', eventCount,
   * eventTypes, events? }` so the UI can render them as system notifications
   * instead of raw `[WORKSPACE EVENTS]` text. Agent-to-agent messages carry
   * `{ type: 'agent_message', fromAgentId, fromAgentName? }` so the UI can
   * render sender attribution.
   */
  messageMetadata?: Record<string, unknown>;
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
 * Cumulative per-session usage counters (PROTOCOL §5.24).
 *
 * Emitted verbatim from `agent.getSessionStats` and the
 * `agent:session-stats-changed` event; `creditsUsed` is `null` when the
 * provider has not reported a credit total yet.
 */
export interface SessionStats {
  creditsUsed: number | null;
  messageCount: number;
  toolCount: number;
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

  /** Model identifier (e.g., "sonnet-3.5", "gpt-4"). Null when using provider/settings default (persisted from backend). Undefined when omitted. */
  model?: string | null;

  /** ACP provider ID (e.g., "auggie", "claude-code", "opencode"). Mutable only until first real session use, then locked. */
  provider?: string;

  /** System prompt for the agent */
  systemPrompt?: string;

  // ========== State ==========
  /** Current status of the agent */
  status: AgentStatus;

  /** Activation state (pending/activating/active/error) */
  activationState?: AgentActivationState;

  /** Canonical runtime activity flag from backend/status events */
  isActive?: boolean;

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

  /**
   * Daemon-owned activity flag (PROTOCOL.md §5.5): the in-flight turn has an
   * unresolved `tool_use` block. Implies `isResponding`. Rendered verbatim —
   * the FE no longer derives this from message internals.
   */
  isWaitingOnTool?: boolean;

  /**
   * Daemon-owned activity flag (PROTOCOL.md §5.5): the agent parents one or
   * more pending completion watches. Rendered verbatim.
   */
  isWaitingForOtherAgents?: boolean;

  /**
   * Daemon-owned companion to `isWaitingForOtherAgents` (PROTOCOL.md §5.5): the
   * distinct child `agentId`s this agent currently parents a pending completion
   * watch against. Emitted on `AgentLite` (`agent.list`/`agent.get`) and the
   * `chat.subscribe` seq-0 snapshot as `string[]` (never `null`/omitted). Not
   * present on `workspace.agentSummary.agents[]` — read it from those surfaces.
   * Rendered verbatim.
   */
  waitingForAgentIds?: string[];

  /**
   * Process queue hint (PROTOCOL §6.5 agent:process:queued/resumed).
   * Set when the agent is queued for a process slot, cleared when resumed or
   * transitions to normal running state. UI renders as "Waiting for a free agent
   * slot (used/cap busy)".
   */
  processQueueHint?: {
    waiting: boolean;
    used: number;
    cap: number;
  };

  /** Canonical stop/finish reason from the latest terminal stream/status event */
  stopReason?: string | null;

  /**
   * Derived corrupted/poisoned-session flag (monorepo#940). Present (`true`)
   * only when the session is parked in `error` and the failure classifies as
   * session-fatal — `agent.retry` will recreate the provider session instead
   * of resuming. Omitted when false and on older daemons.
   */
  sessionCorrupted?: boolean;

  /**
   * Cumulative usage counters (PROTOCOL §5.24). Point-read via
   * `agent.getSessionStats`; live-updated by `agent:session-stats-changed`.
   */
  stats?: SessionStats;

  // ========== Attention Request ==========
  /**
   * Pending attention request raised by the agent (requestDiscussion /
   * reportBlocker). Present only while pending — the daemon clears all three
   * fields when the user next responds, i.e. on a user-origin delivery
   * (`agent.sendMessage`, `agent.sendQueuedMessageNow`,
   * `agent.editAndRegenerate`, or a drained user-origin queue entry),
   * emitting `agent:updated` with `attentionRequestCleared: true`; automatic
   * deliveries (A2A sends, parent/subscription wakes) do not clear them.
   * Exposed top-level on the full session projection and under `metadata` on
   * `AgentLite` (agent.list / agent.get). Rendered verbatim.
   */
  attentionRequestKind?: 'discussion' | 'blocker';

  /** Reason text accompanying the pending attention request. */
  attentionRequestReason?: string;

  /** ISO timestamp when the pending attention request was raised. */
  attentionRequestTimestamp?: string;

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
 * Falls back to inferring provider from the model ID if available —
 * `defaultProviderId` (the registry default from the provider catalog)
 * attributes bare model ids.
 */
export function getAgentProvider(
  session: AgentSession,
  defaultProviderId: string,
): string | undefined {
  const explicit =
    session.provider ?? session.metadata?.provider ?? (session as any).config?.provider;

  // 'acp' is the protocol name, not a provider ID -- treat it as unset
  if (explicit && explicit !== 'acp') {
    return explicit;
  }

  // Fallback: infer provider from model ID.
  // parseCompoundModelId handles both compound ('opencode:haiku4.5' -> 'opencode')
  // and bare ('haiku4.5' -> default provider) model IDs. An empty resolution
  // (bare id before catalog hydration, or a malformed ':model' prefix) is
  // "unknown", never an empty-string provider id.
  if (session.model) {
    return parseCompoundModelId(session.model, defaultProviderId).providerId || undefined;
  }

  return undefined;
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
