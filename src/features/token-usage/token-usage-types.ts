/**
 * Token Usage Types
 *
 * Wire types for the daemon-owned token usage read (`workspace.getTokenUsage`,
 * PROTOCOL §5.23) and its `workspace:tokenUsage-changed` push event. The
 * daemon-internal periodic scan job owns the accounting; the FE only mirrors
 * this shape.
 */

/**
 * Provider-reported cost in an ISO 4217 currency. Omitted (never `null`, per
 * PROTOCOL §5.23) whenever no provider reported a cost for the entry — never
 * estimated by the daemon or the FE.
 */
export interface TokenUsageCost {
  amount: number;
  currency: string;
}

/** Aggregated token consumption counters (five disjoint buckets, §5.23). */
export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /**
   * Reasoning ("thought") tokens — a counter disjoint from `outputTokens`
   * since intentd 0.8.20, so the canonical total is the five-counter sum.
   * Omitted (never `null`, per PROTOCOL §5.23) when no provider reported any,
   * so pre-field payloads keep their exact previous shape.
   */
  thoughtTokens?: number;
  cost?: TokenUsageCost;
}

/**
 * Per-model token totals keyed by the effective model name (`"unknown"`
 * fallback).
 */
export type TokenUsageByModel = Record<string, TokenUsageTotals>;

/** One sparse materialized agent × model cell (PROTOCOL §5.23). */
export interface TokenUsageCrossFilterRow {
  agentId: string;
  model: string;
  totals: TokenUsageTotals;
  humanMessages: number;
  agentMessages: number;
}

/**
 * `TokenUsage` (PROTOCOL §5.23): the durable per-workspace usage rollup.
 * `byAgentId` keys are `agent-{uuid}`; `lastScanAt` is the RFC-3339 timestamp
 * of the daemon's last internal scan (`null` before the first scan).
 */
export interface TokenUsage {
  byAgentId: Record<string, TokenUsageTotals>;
  totals: TokenUsageTotals;
  byModel: TokenUsageByModel;
  /**
   * Presence-detected sparse cross-filter projection. Absence means a legacy
   * snapshot and must not be interpreted as an authoritative empty matrix.
   */
  byAgentModel?: TokenUsageCrossFilterRow[];
  lastScanAt: string | null;
}
