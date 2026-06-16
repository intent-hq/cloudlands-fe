/**
 * Token Usage Types (renderer)
 *
 * Renderer mirror of per-workspace aggregated token usage, fed via IPC from
 * the main-process tokenUsage slice.
 */

import type {
  CachedAgentTokens,
  TokenUsageByModel,
  TokenUsageTotals,
} from "../../../../features/token-usage/token-usage-types";
import { createEmptyTotals } from "../../../../features/token-usage/utils/token-usage-utils";

/** Per-workspace token usage as mirrored in the renderer. */
export type WorkspaceTokenUsageState = {
  /** Per-agent cached totals keyed by agentId. */
  byAgentId: Record<string, CachedAgentTokens>;
  /** Workspace-wide totals across all agents in `byAgentId`. */
  totals: TokenUsageTotals;
  /** Workspace-wide per-model totals merged across all agents in `byAgentId`. */
  byModel: TokenUsageByModel;
  /** Epoch ms of the last completed main-process scan; null before the first. */
  lastScanAt: number | null;
  /** True until a snapshot is received, or after a fetch failure. */
  isStale: boolean;
};

/** Token usage slice state */
export type TokenUsageState = {
  byWorkspaceId: Record<string, WorkspaceTokenUsageState>;
};

export const emptyWorkspaceTokenUsageState: WorkspaceTokenUsageState = {
  byAgentId: {},
  totals: createEmptyTotals(),
  byModel: {},
  lastScanAt: null,
  isStale: true,
};

export const initialState: TokenUsageState = {
  byWorkspaceId: {},
};

