/**
 * Token Usage Types
 *
 * Shared types for workspace token usage scanning. Consumed by the main-process
 * scanner service and the main/renderer tokenUsage store slices.
 */

/**
 * Aggregated token consumption counters: the 4 consumption fields from
 * type-10 `token_usage` nodes.
 */
export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Per-model token totals keyed by `effective_model_name` from the type-9
 * `billing_metadata` node preceding each type-10 `token_usage` node; token
 * nodes without a resolvable model name aggregate under `"unknown"`.
 */
export type TokenUsageByModel = Record<string, TokenUsageTotals>;

/** Totals + per-model breakdown summed from one session file in a single pass. */
export interface SessionTokenUsage {
  totals: TokenUsageTotals;
  byModel: TokenUsageByModel;
}

/**
 * Cached per-agent token totals. `lastMessageId` is the cache validity token:
 * if the agent's persisted last message id is unchanged, the cached totals are
 * reused without re-reading the session file.
 */
export interface CachedAgentTokens extends TokenUsageTotals {
  agentId: string;
  sessionId: string;
  lastMessageId: string | null;
  /** Per-model breakdown of this agent's totals. */
  byModel: TokenUsageByModel;
  computedAt: number;
}

/**
 * Snapshot of a workspace's aggregated token usage as exposed over IPC
 * (`TOKEN_USAGE_CHANNELS.GET` response data and `CHANGED` push payload).
 */
export interface WorkspaceTokenUsageSnapshot {
  workspaceId: string;
  /** Per-agent cached totals keyed by agentId (aggregated numbers + lastMessageId only). */
  byAgentId: Record<string, CachedAgentTokens>;
  /** Workspace-wide totals across all agents in `byAgentId`. */
  totals: TokenUsageTotals;
  /** Workspace-wide per-model totals merged across all agents in `byAgentId`. */
  byModel: TokenUsageByModel;
  /** Epoch ms of the last completed scan; null before the first scan. */
  lastScanAt: number | null;
  /** Whether a scan for this workspace is currently in flight. */
  status: 'idle' | 'scanning';
}

/** Result of a full workspace token usage scan. */
export interface WorkspaceTokenScanResult {
  /** Per-agent totals keyed by agentId (cache hits included). */
  perAgent: Record<string, CachedAgentTokens>;
  /** Workspace-wide totals across all agents in `perAgent`. */
  totals: TokenUsageTotals;
  /** Workspace-wide per-model totals merged across all agents in `perAgent`. */
  byModel: TokenUsageByModel;
  /** Number of agents whose session file was actually read and summed. */
  scannedCount: number;
  /** Number of agents served from the cache without a session-file read. */
  cacheHits: number;
  /** Agents skipped (no session id, or missing/corrupt files). */
  skippedAgentIds: string[];
}

