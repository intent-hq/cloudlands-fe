/**
 * Token Usage Slice Types
 *
 * Per-workspace aggregated token usage cache. State holds only aggregated
 * numbers + per-agent `lastMessageId` cache keys — no message bodies and no
 * per-node data.
 */

import type {
  CachedAgentTokens,
  TokenUsageByModel,
  TokenUsageTotals,
} from "../../../../features/token-usage/token-usage-types";
import { createEmptyTotals } from "../../../../features/token-usage/utils/token-usage-utils";

export type TokenUsageScanStatus = "idle" | "scanning";

export interface WorkspaceTokenUsageState {
  /** Per-agent cached totals keyed by agentId. */
  byAgentId: Record<string, CachedAgentTokens>;
  /** Workspace-wide totals across all agents in `byAgentId`. */
  totals: TokenUsageTotals;
  /** Workspace-wide per-model totals merged across all agents in `byAgentId`. */
  byModel: TokenUsageByModel;
  /** Epoch ms of the last completed scan; null before the first scan. */
  lastScanAt: number | null;
  /** In-flight guard: 'scanning' while a scan for this workspace is running. */
  status: TokenUsageScanStatus;
}

export interface TokenUsageState {
  byWorkspaceId: Record<string, WorkspaceTokenUsageState>;
}

export const emptyWorkspaceTokenUsageState: WorkspaceTokenUsageState = {
  byAgentId: {},
  totals: createEmptyTotals(),
  byModel: {},
  lastScanAt: null,
  status: "idle",
};

export const initialState: TokenUsageState = {
  byWorkspaceId: {},
};

